import type { TaxYear } from '../types.ts';
import { ty2025 } from './ty2025.ts';
import { ty2026 } from './ty2026.ts';
import type { YearParams } from './types.ts';

export type {
  Bracket,
  FormLine,
  ProvisionalItem,
  YearParams,
} from './types.ts';

const BY_YEAR: Partial<Record<TaxYear, YearParams>> = {
  2025: ty2025,
  2026: ty2026,
};

export function getParams(year: TaxYear): YearParams {
  const p = BY_YEAR[year];
  if (!p) throw new Error(`No tax parameters for ${year}`);
  return p;
}
