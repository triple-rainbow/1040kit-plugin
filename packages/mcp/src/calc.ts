import { createHash } from 'node:crypto';
import {
  SUMMARY_NODE_IDS,
  type FormId,
  type LineNode,
  type ReturnResult,
  type TaxFacts,
} from '@1040kit/engine';

import type { Deps } from './deps.ts';
import { ToolError } from './envelope.ts';
import type { StoreData } from './store/types.ts';

function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
        .map((k) => [k, stable((v as Record<string, unknown>)[k])])
    );
  }
  return v;
}

/** Hash of the facts, to tell whether a cached computation is still current. */
export function factsHash(facts: TaxFacts): string {
  return createHash('sha256')
    .update(JSON.stringify(stable(facts)))
    .digest('hex');
}

/**
 * What a return_review covers: the facts, the documents and their status
 * (a new or unreadable document must be reviewed too), and the names and
 * address the forms print. Any change makes an earlier review stale.
 */
export function reviewHash(data: StoreData): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        stable({
          facts: data.facts,
          docs: data.docs.map((d) => [d.docId, d.status, d.supersededBy ?? '']),
          identity: data.identity,
        })
      )
    )
    .digest('hex');
}

/** Calls the engine; engine failures become ENGINE_ERROR envelopes. */
export function engineCall<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    throw new ToolError(
      'ENGINE_ERROR',
      `The tax engine failed: ${(e as Error)?.message ?? String(e)}`
    );
  }
}

/** Computes and caches the return in `data.lastCalc`. */
export function computeAndCache(deps: Deps, data: StoreData): ReturnResult {
  const result = engineCall(() => deps.engine.computeReturn(data.facts));
  data.lastCalc = {
    at: deps.now().toISOString(),
    factsHash: factsHash(data.facts),
    result,
  };
  return result;
}

/** The cached result when the facts haven't changed since, else a fresh one. */
export function currentResult(
  deps: Deps,
  data: StoreData
): { result: ReturnResult; fresh: boolean } {
  if (data.lastCalc && data.lastCalc.factsHash === factsHash(data.facts)) {
    return { result: data.lastCalc.result, fresh: false };
  }
  return { result: computeAndCache(deps, data), fresh: true };
}

/** Filing order: Form 1040, then the IRS "Attachment Sequence No." of each form. */
export const FORM_ORDER: FormId[] = [
  'f1040',
  'sch1', // 01
  'sch1a', // 1A
  'sch2', // 02
  'schB', // 08
  'schC.taxpayer', // 09
  'schC.spouse',
  'schE', // 13
  'schSE.taxpayer', // 17
  'schSE.spouse',
  'schEIC', // 43
  'sch8812', // 47
  'f8995', // 55
  'f8959', // 71
  'f8960', // 72
  'f8829.taxpayer', // 176
  'f8829.spouse',
];

/** IRS attachment sequence numbers, for the mailing instructions. */
export const ATTACHMENT_SEQUENCE: Partial<Record<FormId, string>> = {
  sch1: '01',
  sch1a: '1A',
  sch2: '02',
  schB: '08',
  'schC.taxpayer': '09',
  'schC.spouse': '09',
  schE: '13',
  'schSE.taxpayer': '17',
  'schSE.spouse': '17',
  schEIC: '43',
  sch8812: '47',
  f8995: '55',
  f8959: '71',
  f8960: '72',
  'f8829.taxpayer': '176',
  'f8829.spouse': '176',
};

const lineKey = (line: string) =>
  line.replace(/\d+/g, (d) => d.padStart(4, '0')).toLowerCase();

export function compareLines(
  a: { form?: FormId; line?: string },
  b: { form?: FormId; line?: string }
): number {
  const fa = FORM_ORDER.indexOf(a.form!);
  const fb = FORM_ORDER.indexOf(b.form!);
  if (fa !== fb) return fa - fb;
  return lineKey(a.line ?? '').localeCompare(lineKey(b.line ?? ''));
}

export interface PrintedLine {
  id: string;
  form: FormId;
  line: string;
  label: string;
  value: number;
}

/** Lines that print on a form, in form order, without traces. */
export function printedLines(result: ReturnResult): PrintedLine[] {
  return Object.values(result.nodes)
    .filter(
      (n): n is LineNode & { form: FormId; line: string } =>
        !!n.form && !!n.line
    )
    .sort(compareLines)
    .map((n) => ({
      id: n.id,
      form: n.form,
      line: n.line,
      label: n.label,
      value: n.value,
    }));
}

/**
 * The three Form 1040 entries with the largest absolute value that feed
 * `refundOrOwed`: lines that bring a number onto the 1040 from a document,
 * a schedule or the filer's situation (wages, a deduction, withholding), not
 * the 1040's own subtotals. Found by walking the trace graph (no arithmetic).
 */
export function drivers(
  result: ReturnResult,
  n = 3
): { id: string; label: string; value: number }[] {
  const summary = new Set<string>(SUMMARY_NODE_IDS);
  const on1040 = (id: string) => result.nodes[id]?.form === 'f1040';
  const seen = new Set<string>();
  const queue = ['refundOrOwed'];
  const found: LineNode[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = result.nodes[id];
    if (!node || !(summary.has(id) || on1040(id))) continue;
    // A 1040 subtotal reads only other 1040 lines (1z = 1a + ... + 1h).
    const subtotal =
      node.trace.inputs.length > 0 &&
      node.trace.inputs.every(
        (i) => i.kind === 'node' && (on1040(i.ref) || summary.has(i.ref))
      );
    if (!summary.has(id) && node.value !== 0 && !subtotal) found.push(node);
    for (const input of node.trace.inputs) {
      if (input.kind === 'node') queue.push(input.ref);
    }
  }
  return found
    .sort(
      (a, b) =>
        Math.abs(b.value) - Math.abs(a.value) || a.id.localeCompare(b.id)
    )
    .slice(0, n)
    .map((x) => ({ id: x.id, label: x.label, value: x.value }));
}
