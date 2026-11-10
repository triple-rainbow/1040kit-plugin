import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { PersonId } from '@1040kit/engine';

import { isEinShaped, Vault } from '../pii/vault.ts';
import type { DocEntry, DocKind, StoreData } from '../store/types.ts';
import { inboxPath } from '../store/workspace.ts';
import { classify, isCorrected } from './classify.ts';
import { type LowConfidence, type ParsedDoc } from './parsers/common.ts';
import { parseDiv1099 } from './parsers/div.ts';
import { parseEstPayment } from './parsers/est-payment.ts';
import { parse1098E } from './parsers/e1098.ts';
import { parseInt1099 } from './parsers/int.ts';
import { parseK1099 } from './parsers/k.ts';
import { parseMisc1099 } from './parsers/misc.ts';
import { parseNec1099 } from './parsers/nec.ts';
import { parsePrior1040 } from './parsers/prior-1040.ts';
import { parseW2 } from './parsers/w2.ts';
import { readDocText, type TextResult } from './text.ts';

type FactKind = Exclude<
  DocKind,
  'prior_1040' | 'est_payment' | 'bank_csv' | 'unknown'
>;
type Collection =
  | 'estimatedPayments'
  | 'w2s'
  | 'int1099s'
  | 'div1099s'
  | 'nec1099s'
  | 'misc1099s'
  | 'k1099s'
  | 'e1098s';

const KINDS: Record<
  FactKind,
  {
    coll: Collection;
    prefix: string;
    parse: (t: string, c: boolean) => ParsedDoc;
    payerField: string;
    label: string;
  }
> = {
  w2: {
    coll: 'w2s',
    prefix: 'w2',
    parse: parseW2,
    payerField: 'employerEinToken',
    label: 'W-2',
  },
  '1099int': {
    coll: 'int1099s',
    prefix: 'int',
    parse: parseInt1099,
    payerField: 'payerToken',
    label: '1099-INT',
  },
  '1099div': {
    coll: 'div1099s',
    prefix: 'div',
    parse: parseDiv1099,
    payerField: 'payerToken',
    label: '1099-DIV',
  },
  '1099nec': {
    coll: 'nec1099s',
    prefix: 'nec',
    parse: parseNec1099,
    payerField: 'payerToken',
    label: '1099-NEC',
  },
  '1099misc': {
    coll: 'misc1099s',
    prefix: 'misc',
    parse: parseMisc1099,
    payerField: 'payerToken',
    label: '1099-MISC',
  },
  '1099k': {
    coll: 'k1099s',
    prefix: 'k',
    parse: parseK1099,
    payerField: 'payerToken',
    label: '1099-K',
  },
  '1098e': {
    coll: 'e1098s',
    prefix: 'e1098',
    parse: parse1098E,
    payerField: 'lenderToken',
    label: '1098-E',
  },
};

const isFactKind = (k: DocKind): k is FactKind => k in KINDS;

export interface ExtractedDoc {
  docId: string;
  kind: DocKind;
  fields: Record<string, number | string | boolean>;
  factPaths: string[];
  lowConfidence: LowConfidence[];
}

export interface ExtractResult {
  extracted: ExtractedDoc[];
  skipped: { docId: string; reason: string }[];
}

/** Text for a document; M7 plugs OCR in here. */
export type TextReader = (
  absPath: string,
  entry: DocEntry
) => Promise<TextResult & { ocr?: boolean }>;

const digits = (s: string | undefined) => (s ?? '').replace(/\D/g, '');
const normName = (s: string | undefined) =>
  (s ?? '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim();

/** Matches a CORRECTED form to its original: payer EIN (or name) + recipient name. */
function payerKeyOf(kind: DocKind, p: ParsedDoc): string | undefined {
  const tin = p.pii.payerTin;
  const payer =
    tin && isEinShaped(tin)
      ? digits(tin)
      : normName(p.names.payer) || undefined;
  if (!payer) return undefined;
  return createHash('sha256')
    .update(`${kind}|${payer}|${normName(p.names.recipient)}`)
    .digest('hex');
}

function nextFactId(data: StoreData, kind: FactKind): string {
  const { coll, prefix } = KINDS[kind];
  const re = new RegExp(`^${prefix}_(\\d+)$`);
  let max = 0;
  const ids = [
    ...(data.facts[coll] as { id: string }[]).map((f) => f.id),
    ...data.docs.map((d) => d.factId ?? ''),
  ];
  for (const id of ids) {
    const n = Number(re.exec(id)?.[1] ?? 0);
    if (n > max) max = n;
  }
  return `${prefix}_${max + 1}`;
}

const nameParts = (full: string) => {
  const words = normName(full).split(' ').filter(Boolean);
  return { first: words[0], last: words[words.length - 1] };
};

function sameName(
  full: string,
  n: { firstName?: string; lastName?: string } | undefined
): boolean {
  if (!n?.lastName) return false;
  const a = nameParts(full);
  const first = normName(n.firstName).split(' ')[0];
  return (
    a.last === normName(n.lastName).split(' ').pop() &&
    (!first || a.first === first)
  );
}

/**
 * Whose document this is, from the recipient's name (1040kit never reads
 * SSNs). The first name seen becomes the taxpayer's; a different name
 * becomes the spouse's, flagged for confirmation.
 */
function assignOwner(
  data: StoreData,
  recipient: string | undefined,
  low: LowConfidence[]
): PersonId {
  const t = data.identity.taxpayer;
  const s = data.identity.spouse;
  if (!recipient || nameParts(recipient).last === undefined) {
    low.push({
      field: 'owner',
      reason: 'No recipient name found; assumed it is the taxpayer’s.',
    });
    return 'taxpayer';
  }
  if (!t?.lastName || sameName(recipient, t)) return 'taxpayer';
  if (sameName(recipient, s)) return 'spouse';
  if (
    !s?.lastName &&
    data.facts.filingStatus !== 'single' &&
    data.facts.filingStatus !== 'hoh'
  ) {
    low.push({
      field: 'owner',
      reason:
        'Different name from the taxpayer’s; assigned to the spouse. Confirm.',
    });
    return 'spouse';
  }
  low.push({
    field: 'owner',
    reason:
      'The name on this document matches neither the taxpayer nor the spouse. Confirm whose document this is.',
  });
  return 'taxpayer';
}

function setNames(
  data: StoreData,
  owner: PersonId,
  full: string | undefined
): void {
  if (!full) return;
  const cur = data.identity[owner];
  if (cur?.firstName || cur?.lastName) return;
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return;
  const lastName = parts.pop()!;
  data.identity[owner] = { ...cur, firstName: parts.join(' '), lastName };
}

/** Replace (never duplicate) the fact `id`, keeping values the user overrode. */
function upsertFact(
  data: StoreData,
  coll: Collection,
  fact: Record<string, unknown> & { id: string },
  docId: string,
  fieldOf: (k: string) => string,
  at: string
): string[] {
  const list = (data.facts[coll] ?? []) as unknown as (Record<
    string,
    unknown
  > & {
    id: string;
  })[];
  const idx = list.findIndex((f) => f.id === fact.id);
  const old = idx >= 0 ? list[idx]! : undefined;
  const prefix = `${coll}[${fact.id}].`;
  for (const k of Object.keys(data.provenance)) {
    if (!k.startsWith(prefix)) continue;
    const field = k.slice(prefix.length);
    if (data.provenance[k]!.source === 'user' && old && field in old) {
      fact[field] = old[field];
      continue;
    }
    delete data.provenance[k];
  }
  if (idx >= 0) list[idx] = fact;
  else list.push(fact);
  const paths: string[] = [];
  for (const k of Object.keys(fact)) {
    if (k === 'id') continue;
    const path = prefix + k;
    paths.push(path);
    if (!data.provenance[path]) {
      data.provenance[path] = { source: 'doc', docId, field: fieldOf(k), at };
    }
  }
  return paths;
}

function removeFact(data: StoreData, coll: Collection, id: string): void {
  const list = data.facts[coll] as unknown as { id: string }[];
  const idx = list.findIndex((f) => f.id === id);
  if (idx >= 0) list.splice(idx, 1);
  delete data.vault[`{{EIN:${id}}}`];
  const prefix = `${coll}[${id}].`;
  for (const k of Object.keys(data.provenance))
    if (k.startsWith(prefix)) delete data.provenance[k];
}

const BOX: Record<string, string> = {
  wages: 'box1',
  federalWithheld: 'box2/box4',
  ssWages: 'box3',
  ssTax: 'box4',
  medicareWages: 'box5',
  medicareTax: 'box6',
  ssTips: 'box7',
  allocatedTips: 'box8',
  interest: 'box1',
  earlyWithdrawalPenalty: 'box2',
  usSavingsBondInterest: 'box3',
  taxExemptInterest: 'box8',
  ordinaryDividends: 'box1a',
  qualifiedDividends: 'box1b',
  capitalGainDistributions: 'box2a',
  section199aDividends: 'box5',
  exemptInterestDividends: 'box12',
  nonemployeeComp: 'box1',
  rents: 'box1',
  royalties: 'box2',
  otherIncome: 'box3',
  grossAmount: 'box1a',
  owner: 'recipient name',
  employerEinToken: 'box b',
  payerToken: 'payer TIN',
  lenderToken: 'lender TIN',
  box2Checked: 'box2',
  corrected: 'CORRECTED',
};

const SKIP_REASON: Partial<Record<DocEntry['status'], string>> = {
  needs_ocr: 'needs_ocr',
  encrypted_pdf: 'encrypted_pdf',
  unsupported_form: 'unsupported_form',
};

interface Parsed {
  entry: DocEntry;
  kind: FactKind;
  parsed: ParsedDoc;
  key?: string;
}

/**
 * Extract facts from inbox documents into `data` (mutated in place).
 * Never throws for a bad document: problems land in `skipped`.
 */
export async function extractDocs(
  ws: string,
  data: StoreData,
  docIds: string[] | undefined,
  at: string,
  readText: TextReader = (p) => readDocText(p)
): Promise<ExtractResult> {
  const vault = new Vault(data.vault);
  const result: ExtractResult = { extracted: [], skipped: [] };
  const skip = (docId: string, reason: string) => {
    if (!result.skipped.some((s) => s.docId === docId))
      result.skipped.push({ docId, reason });
  };

  const targets: DocEntry[] = [];
  if (docIds?.length) {
    for (const id of docIds) {
      const d = data.docs.find((x) => x.docId === id);
      if (d) targets.push(d);
      else skip(id, 'unknown_doc_id');
    }
  } else {
    targets.push(...data.docs.filter((d) => d.status !== 'extracted'));
  }

  const parsed: Parsed[] = [];
  for (const entry of targets) {
    if (entry.status === 'duplicate') {
      skip(entry.docId, `duplicate_of:${entry.duplicateOf}`);
      continue;
    }
    if (entry.kind === 'bank_csv') {
      skip(entry.docId, 'use_expenses_import');
      continue;
    }
    const preset = SKIP_REASON[entry.status];
    if (preset && entry.status !== 'needs_ocr') {
      skip(entry.docId, preset);
      continue;
    }
    if (/\.(heic|heif)$/i.test(entry.file)) {
      skip(entry.docId, 'unsupported_image');
      continue;
    }
    const t = await readText(join(inboxPath(ws), entry.file), entry);
    if (t.status !== 'ok') {
      const reason =
        t.status === 'not_pdf'
          ? 'unknown_document'
          : t.status === 'unreadable'
            ? 'unreadable'
            : t.status;
      if (t.status === 'needs_ocr' || t.status === 'encrypted_pdf')
        entry.status = t.status;
      skip(entry.docId, reason);
      continue;
    }
    if (t.ocr) entry.ocr = true;
    let kind = entry.kind;
    if (kind === 'unknown' && t.ocr) {
      const c = classify(t.text);
      if (!('unsupported' in c)) kind = c.kind;
      entry.kind = kind;
    }
    if (kind === 'prior_1040') {
      const { summary, fields } = parsePrior1040(t.text);
      data.priorYear = summary;
      entry.status = 'extracted';
      result.extracted.push({
        docId: entry.docId,
        kind,
        fields,
        factPaths: ['priorYear'],
        lowConfidence: t.ocr
          ? Object.keys(fields).map((field) => ({
              field,
              reason: 'Read by OCR; confirm.',
            }))
          : [],
      });
      continue;
    }
    if (kind === 'est_payment') {
      const r = parseEstPayment(t.text);
      const year = data.facts.taxYear;
      if (r.purpose === 'extension' || r.purpose === 'balance_due') {
        entry.status = 'extracted';
        entry.note =
          r.purpose === 'extension'
            ? 'An extension payment (Form 4868): not an estimated tax payment. 1040kit v1 can’t include it yet.'
            : 'A payment of a balance due, not an estimated tax payment: it does not count on this return.';
        skip(entry.docId, `not_estimated_payment:${r.purpose}`);
        continue;
      }
      if (r.taxYear !== undefined && r.taxYear !== year) {
        entry.status = 'extracted';
        entry.note = `An estimated tax payment for ${r.taxYear}, not ${year}: it does not count on this return.`;
        skip(entry.docId, `other_tax_year:${r.taxYear}`);
        continue;
      }
      const low: LowConfidence[] = [];
      if (r.amount === undefined)
        low.push({
          field: 'amount',
          reason: 'Payment amount not found; confirm it with the user.',
        });
      if (r.taxYear === undefined)
        low.push({
          field: 'taxYear',
          reason: `The tax year isn’t on the receipt; confirm the payment is for ${year}.`,
        });
      if (r.purpose === 'unknown')
        low.push({
          field: 'purpose',
          reason: 'Confirm this was an estimated tax payment (Form 1040-ES).',
        });
      if (t.ocr)
        low.push({
          field: 'amount',
          reason: 'Read by OCR from an image; confirm against the receipt.',
        });
      data.facts.estimatedPayments ??= [];
      let id = entry.factId;
      if (!id) {
        let max = 0;
        for (const x of [
          ...data.facts.estimatedPayments.map((p) => p.id),
          ...data.docs.map((d) => d.factId ?? ''),
        ])
          max = Math.max(max, Number(/^estpay_(\d+)$/.exec(x)?.[1] ?? 0));
        id = `estpay_${max + 1}`;
      }
      const fact: Record<string, unknown> & { id: string } = {
        id,
        amount: r.amount ?? 0,
        ...(r.date ? { date: r.date } : {}),
      };
      const factPaths = upsertFact(
        data,
        'estimatedPayments',
        fact,
        entry.docId,
        (k) => (k === 'amount' ? 'payment amount' : 'payment date'),
        at
      );
      entry.factId = id;
      entry.status = 'extracted';
      result.extracted.push({
        docId: entry.docId,
        kind,
        fields: {
          amount: fact.amount as number,
          ...(r.date ? { date: r.date } : {}),
          ...(r.taxYear ? { taxYear: r.taxYear } : {}),
        },
        factPaths,
        lowConfidence: low,
      });
      continue;
    }
    if (!isFactKind(kind)) {
      skip(entry.docId, 'unknown_document');
      continue;
    }
    const p = KINDS[kind].parse(t.text, isCorrected(t.text));
    if (t.ocr) {
      for (const field of Object.keys(p.amounts)) {
        if (!p.lowConfidence.some((l) => l.field === field)) {
          p.lowConfidence.push({
            field,
            reason: 'Read by OCR from an image; confirm against the document.',
          });
        }
      }
    }
    parsed.push({ entry, kind, parsed: p, key: payerKeyOf(kind, p) });
  }

  // Corrections: a CORRECTED form replaces the original from the same payer.
  const correctedByKey = new Map<string, DocEntry>();
  for (const d of data.docs) {
    if (
      d.corrected &&
      d.payerKey &&
      d.status === 'extracted' &&
      !d.supersededBy
    )
      correctedByKey.set(d.payerKey, d);
  }
  for (const p of parsed)
    if (p.parsed.corrected && p.key) correctedByKey.set(p.key, p.entry);

  const ordered = [
    ...parsed.filter((p) => !p.parsed.corrected),
    ...parsed.filter((p) => p.parsed.corrected),
  ];
  for (const p of ordered) {
    const { entry, kind, parsed: doc } = p;
    const info = KINDS[kind];
    const low = [...doc.lowConfidence];

    if (!doc.corrected && p.key) {
      const corr = correctedByKey.get(p.key);
      if (corr && corr.docId !== entry.docId) {
        if (entry.factId && !corr.factId) {
          // The correction takes over this fact id when it is processed.
        } else if (entry.factId && corr.factId !== entry.factId) {
          removeFact(data, info.coll, entry.factId);
          delete entry.factId;
        }
        entry.status = 'extracted';
        entry.supersededBy = corr.docId;
        entry.payerKey = p.key;
        skip(entry.docId, `corrected_supersedes:${corr.docId}`);
        continue;
      }
    }

    let factId = entry.factId;
    if (doc.corrected && p.key && !factId) {
      const orig = data.docs.find(
        (d) =>
          d.docId !== entry.docId &&
          d.payerKey === p.key &&
          !d.corrected &&
          d.factId
      );
      if (orig) {
        factId = orig.factId;
        delete orig.factId;
        orig.supersededBy = entry.docId;
        orig.status = 'extracted';
        skip(orig.docId, `corrected_supersedes:${entry.docId}`);
      }
    }
    factId ??= nextFactId(data, kind);

    const owner = assignOwner(data, doc.names.recipient, low);
    const fact: Record<string, unknown> & { id: string } = {
      id: factId,
      owner,
    };
    const fields: ExtractedDoc['fields'] = { owner };
    const tinField =
      kind === 'w2'
        ? 'employerEin'
        : kind === '1098e'
          ? 'lenderTin'
          : 'payerTin';
    vault.delete(`{{EIN:${factId}}}`);
    if (doc.pii.payerTin && isEinShaped(doc.pii.payerTin)) {
      const tok = vault.tokenize('EIN', factId, doc.pii.payerTin);
      fact[info.payerField] = tok;
      fields[tinField] = tok;
    } else if (doc.pii.payerTin) {
      // An individual payer's SSN: discarded, like every SSN.
      low.push({
        field: tinField,
        reason:
          'The payer’s ID is a Social Security number; 1040kit does not keep it.',
      });
    } else {
      low.push({ field: tinField, reason: 'Payer ID number not found.' });
    }
    for (const [k, v] of Object.entries(doc.amounts)) {
      fact[k] = v;
      fields[k] = v;
    }
    for (const [k, v] of Object.entries(doc.flags)) {
      fact[k] = v;
      fields[k] = v;
    }
    if (doc.corrected && kind === 'w2') fact.corrected = true;
    if (doc.corrected) fields.corrected = true;
    if (doc.names.payer) {
      data.labels[factId] = doc.names.payer;
      fields[
        kind === 'w2'
          ? 'employerName'
          : kind === '1098e'
            ? 'lenderName'
            : 'payerName'
      ] = doc.names.payer;
    }
    setNames(data, owner, doc.names.recipient);
    if (owner === 'spouse' && !data.facts.spouse)
      data.facts.spouse = { id: 'spouse' };

    const factPaths = upsertFact(
      data,
      info.coll,
      fact,
      entry.docId,
      (k) => BOX[k] ?? k,
      at
    );
    entry.factId = factId;
    entry.status = 'extracted';
    entry.corrected = doc.corrected || undefined;
    if (p.key) entry.payerKey = p.key;
    delete entry.supersededBy;
    result.extracted.push({
      docId: entry.docId,
      kind,
      fields,
      factPaths,
      lowConfidence: low,
    });
  }
  return result;
}
