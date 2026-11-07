/**
 * Dump every fillable field of an IRS PDF: name, type, tooltip (/TU, which
 * the IRS uses to say which line a field is), page and position. Used to
 * hand-build src/output/maps/<year>/<form>.json.
 *
 *   node --import tsx scripts/dump-fields.ts assets/irs/2025/f1040.pdf
 */
import { readFile } from 'node:fs/promises';
import {
  decodePDFRawStream,
  PDFArray,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRadioGroup,
  PDFRawStream,
  PDFRef,
  PDFString,
  PDFTextField,
} from 'pdf-lib';

export interface FieldInfo {
  name: string;
  type: 'text' | 'checkbox' | 'radio' | 'other';
  tooltip: string;
  page: number;
  x: number;
  y: number;
  w: number;
  maxLength?: number;
  onValues?: string[];
}

/**
 * IRS forms keep their per-field descriptions in the XFA template
 * (<field name="f1_47">…<speak>1a. Total amount from Form(s) W-2…</speak>),
 * which pdf-lib drops; read them first. short name → descriptions in order.
 */
function xfaSpeaks(doc: PDFDocument): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const af = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  const xfa = af?.lookup(PDFName.of('XFA'));
  if (!(xfa instanceof PDFArray)) return out;
  for (let i = 0; i + 1 < xfa.size(); i += 2) {
    if (!xfa.lookup(i).toString().includes('template')) continue;
    const s = xfa.lookup(i + 1);
    if (!(s instanceof PDFRawStream)) continue;
    const xml = Buffer.from(decodePDFRawStream(s).decode()).toString('utf8');
    for (const m of xml.matchAll(
      /<field\s[^>]*?name="([^"]+)"[\s\S]*?<\/field\s*>/g
    )) {
      const speak = /<speak[^>]*>([\s\S]*?)<\/speak/.exec(m[0])?.[1] ?? '';
      const tip = /<toolTip[^>]*>([\s\S]*?)<\/toolTip/.exec(m[0])?.[1] ?? '';
      const text = (speak.trim() || tip.trim())
        .replace(/&#xD;|&#13;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
      const list = out.get(m[1]!) ?? [];
      list.push(text);
      out.set(m[1]!, list);
    }
  }
  return out;
}

export async function dumpFields(bytes: Uint8Array): Promise<FieldInfo[]> {
  const doc = await PDFDocument.load(bytes);
  const speaks = xfaSpeaks(doc);
  const pages = doc.getPages();
  const pageOfRef = new Map<string, number>();
  pages.forEach((p, i) => {
    const annots = p.node.Annots();
    if (!annots) return;
    for (let j = 0; j < annots.size(); j++) {
      const r = annots.get(j);
      if (r instanceof PDFRef) pageOfRef.set(r.toString(), i + 1);
    }
  });
  const out: FieldInfo[] = [];
  for (const f of doc.getForm().getFields()) {
    const tu = f.acroField.dict.get(PDFName.of('TU'));
    let tooltip =
      tu instanceof PDFString || tu instanceof PDFHexString
        ? tu.decodeText()
        : '';
    if (!tooltip) {
      const m = /([^.[\]]+)\[(\d+)\]$/.exec(f.getName());
      if (m) {
        const list = speaks.get(m[1]!) ?? [];
        tooltip = list[Number(m[2])] ?? list[0] ?? '';
      }
    }
    const widgets = f.acroField.getWidgets();
    const w0 = widgets[0];
    const rect = w0?.getRectangle() ?? { x: 0, y: 0, width: 0, height: 0 };
    const ref = w0 ? doc.context.getObjectRef(w0.dict) : undefined;
    const page = ref ? (pageOfRef.get(ref.toString()) ?? 0) : 0;
    const info: FieldInfo = {
      name: f.getName(),
      type:
        f instanceof PDFTextField
          ? 'text'
          : f instanceof PDFCheckBox
            ? 'checkbox'
            : f instanceof PDFRadioGroup
              ? 'radio'
              : 'other',
      tooltip: tooltip.replace(/\s+/g, ' ').trim(),
      page,
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.round(rect.width),
    };
    if (f instanceof PDFTextField) {
      const m = f.getMaxLength();
      if (m) info.maxLength = m;
    }
    if (f instanceof PDFCheckBox || f instanceof PDFRadioGroup) {
      info.onValues = widgets
        .map((w) => w.getOnValue()?.decodeText() ?? '')
        .filter(Boolean);
    }
    out.push(info);
  }
  return out.sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
}

if (
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].split('/').pop()!)
) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: dump-fields.ts <pdf>');
    process.exit(1);
  }
  const fields = await dumpFields(await readFile(file));
  for (const f of fields) {
    console.log(
      [
        f.page,
        f.y,
        f.x,
        f.type,
        f.name.replace(/^topmostSubform\[0\]\./, ''),
        f.maxLength ?? '',
        (f.onValues ?? []).join('/'),
        f.tooltip,
      ].join('\t')
    );
  }
}
