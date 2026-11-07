import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FormId, TaxYear } from '@1040kit/engine';

/** A hand-built map from printed line ids to PDF field names (see scripts/dump-fields.ts). */
export interface FieldMap {
  pdf: string;
  /** `ssn` is never filled (the user writes it); kept to document the box. */
  header?: { name: string; ssn: string };
  lines: Record<string, string>;
  /** target line ← first source line that has a value (e.g. 11b ← 11a). */
  copies?: Record<string, string[]>;
  labels?: Record<string, string>;
  fields?: Record<string, string>;
  dependents?: Record<string, string>[];
  interestRows?: [string, string][];
  dividendRows?: [string, string][];
  businessRows?: { name: string; tin: string }[];
  /** Line ids (before any ":column") printed by form-specific code from facts. */
  consumed?: string[];
  /** Schedule E line 1a/1b/2, per property column A-C. */
  rentalRows?: {
    address: string;
    type: string;
    fairRentalDays: string;
    personalUseDays: string;
  }[];
  /** Schedule EIC child columns 1-3. `ssn` is never filled. */
  childRows?: {
    name: string;
    ssn: string;
    year: [string, string, string, string];
    studentYes: string;
    studentNo: string;
    disabledYes: string;
    disabledNo: string;
    relationship: string;
    months: string;
  }[];
}

export const PDF_FOR_FORM: Record<FormId, string> = {
  f1040: 'f1040',
  sch1: 'f1040s1',
  sch1a: 'f1040s1a',
  sch2: 'f1040s2',
  schB: 'f1040sb',
  'schC.taxpayer': 'f1040sc',
  'schC.spouse': 'f1040sc',
  'schSE.taxpayer': 'f1040sse',
  'schSE.spouse': 'f1040sse',
  sch8812: 'f1040s8',
  f8995: 'f8995',
  schE: 'f1040se',
  schEIC: 'f1040sei',
  'f8829.taxpayer': 'f8829',
  'f8829.spouse': 'f8829',
  f8959: 'f8959',
  f8960: 'f8960',
};

export const FORM_TITLES: Record<FormId, string> = {
  f1040: 'Form 1040',
  sch1: 'Schedule 1',
  sch1a: 'Schedule 1-A',
  sch2: 'Schedule 2',
  schB: 'Schedule B',
  'schC.taxpayer': 'Schedule C (you)',
  'schC.spouse': 'Schedule C (spouse)',
  'schSE.taxpayer': 'Schedule SE (you)',
  'schSE.spouse': 'Schedule SE (spouse)',
  sch8812: 'Schedule 8812',
  f8995: 'Form 8995',
  schE: 'Schedule E',
  schEIC: 'Schedule EIC',
  'f8829.taxpayer': 'Form 8829 (you)',
  'f8829.spouse': 'Form 8829 (spouse)',
  f8959: 'Form 8959',
  f8960: 'Form 8960',
};

/** The form's own name, without the owner ("Schedule C"), for handwrite text. */
export const formName = (f: FormId) =>
  FORM_TITLES[f].replace(/ \((?:you|spouse)\)$/, '');

/**
 * The package folder (the nearest one holding package.json). This module runs
 * from src/output/ in development and from the bundled dist/bin.js once
 * published, so asset paths are resolved from the package root, not from here.
 */
function packageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, 'package.json'))) {
    const up = dirname(dir);
    if (up === dir) throw new Error('1040kit: package root not found');
    dir = up;
  }
  return dir;
}

let root: string | undefined;
const asset = (...parts: string[]) =>
  join((root ??= packageRoot()), 'assets', ...parts);

export const assetPath = (year: TaxYear, pdf: string) =>
  asset('irs', String(year), `${pdf}.pdf`);
const mapPath = (year: TaxYear, pdf: string) =>
  asset('maps', String(year), `${pdf}.json`);

export function hasForms(year: TaxYear): boolean {
  return (
    existsSync(assetPath(year, 'f1040')) && existsSync(mapPath(year, 'f1040'))
  );
}

const cache = new Map<string, FieldMap>();

export function loadFieldMap(year: TaxYear, pdf: string): FieldMap | null {
  const key = `${year}/${pdf}`;
  if (cache.has(key)) return cache.get(key)!;
  const p = mapPath(year, pdf);
  if (!existsSync(p)) return null;
  const m = JSON.parse(readFileSync(p, 'utf8')) as FieldMap;
  cache.set(key, m);
  return m;
}

/** Engine line ids may be "1a", "Line 1a" or "1A"; maps use "1a". */
export const normLine = (line: string) =>
  line
    .toLowerCase()
    .replace(/^line\s*/, '')
    .replace(/\s+/g, '');
