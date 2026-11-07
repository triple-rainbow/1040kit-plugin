/**
 * Fetch the official fillable IRS PDFs for a tax year into assets/irs/<year>/
 * and record their sha256 in manifest.json. Run once per year, review, commit:
 *
 *   node --import tsx scripts/fetch-irs-pdfs.ts 2025
 *
 * Prefers the archived copy (irs-prior/<form>--<year>.pdf), falling back to the
 * current revision (irs-pdf/<form>.pdf) only when its text names the year.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractText, getDocumentProxy } from 'unpdf';

export const FORMS = [
  'f1040',
  'f1040s1',
  'f1040s1a',
  'f1040s2',
  'f1040sb',
  'f1040sc',
  'f1040sse',
  'f1040s8',
  'f8995',
  'f1040se',
  'f1040sei',
  'f8829',
  'f8959',
  'f8960',
] as const;

async function get(url: string): Promise<Uint8Array | null> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) return null;
  return new Uint8Array(await res.arrayBuffer());
}

async function namesYear(bytes: Uint8Array, year: number): Promise<boolean> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  return text.slice(0, 3000).includes(String(year));
}

async function main() {
  const year = Number(process.argv[2] ?? 2025);
  const dir = fileURLToPath(new URL(`../assets/irs/${year}/`, import.meta.url));
  await mkdir(dir, { recursive: true });
  const manifest: Record<
    string,
    { source: string; sha256: string; bytes: number }
  > = {};
  const missing: string[] = [];
  for (const form of FORMS) {
    const urls = [
      `https://www.irs.gov/pub/irs-prior/${form}--${year}.pdf`,
      `https://www.irs.gov/pub/irs-pdf/${form}.pdf`,
    ];
    let saved = false;
    for (const url of urls) {
      const bytes = await get(url);
      if (
        !bytes ||
        Buffer.from(bytes.subarray(0, 5)).toString('latin1') !== '%PDF-'
      )
        continue;
      if (!(await namesYear(bytes, year))) {
        console.warn(`${url}: not the ${year} revision, skipped`);
        continue;
      }
      await writeFile(join(dir, `${form}.pdf`), bytes);
      manifest[form] = {
        source: url,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        bytes: bytes.length,
      };
      console.log(`${form}: ${url}`);
      saved = true;
      break;
    }
    if (!saved) missing.push(form);
  }
  await writeFile(
    join(dir, 'manifest.json'),
    JSON.stringify(
      {
        taxYear: year,
        fetchedAt: new Date().toISOString().slice(0, 10),
        forms: manifest,
        missing,
      },
      null,
      2
    ) + '\n'
  );
  if (missing.length)
    console.warn(`Not published for ${year}: ${missing.join(', ')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
