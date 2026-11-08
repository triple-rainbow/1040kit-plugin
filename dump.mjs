import { PDFDocument, PDFCheckBox, PDFRadioGroup } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
const doc = await PDFDocument.load(await readFile(process.argv[2]));
for (const fld of doc.getForm().getFields()) {
  const ws = fld.acroField.getWidgets();
  const r = ws[0].getRectangle();
  const page = doc.getPages().findIndex(p => p.ref === ws[0].P()) ;
  let extra='';
  if (fld instanceof PDFCheckBox || fld instanceof PDFRadioGroup) extra = ' opts=' + ws.map(w=>w.getOnValue()?.decodeText?.() ?? String(w.getOnValue())).join(',');
  const tu = fld.acroField.dict.get(PDFDocument.prototype.constructor ? (await import('pdf-lib')).PDFName.of('TU') : null);
  console.log(fld.constructor.name, fld.getName().replace('topmostSubform[0].',''), Math.round(r.x), Math.round(r.y), extra, tu?.decodeText?.() ?? '');
}
