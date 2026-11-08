import type {
  PersonId,
  PriorYearSummary,
  ReturnResult,
  ScheduleCExpense,
  TaxFacts,
  TaxYear,
} from '@1040kit/engine';

export interface WorkspaceMeta {
  id: string;
  taxYear: TaxYear;
  createdAt: string;
  version: 1;
}

export type FactSource = 'doc' | 'user' | 'inferred';

export interface ProvenanceEntry {
  source: FactSource;
  docId?: string;
  /** Document field, e.g. "box1". */
  field?: string;
  note?: string;
  at: string;
  /** Set when a user answer replaced a value read from a document. */
  overrides?: 'doc';
  /** The value was removed (profile_set null): kept for the record, but not an answer. */
  removed?: true;
}

export type DocKind =
  | 'w2'
  | '1099int'
  | '1099div'
  | '1099nec'
  | '1099misc'
  | '1099k'
  | '1098e'
  | 'prior_1040'
  | 'bank_csv'
  | 'unknown';

export type DocStatus =
  | 'new'
  | 'extracted'
  | 'duplicate'
  | 'needs_ocr'
  | 'encrypted_pdf'
  | 'unsupported_form';

export interface DocEntry {
  docId: string;
  /** Relative to the inbox. */
  file: string;
  sha256: string;
  kind: DocKind;
  status: DocStatus;
  duplicateOf?: string;
  note?: string;
  /** Internal: the fact this document produced, e.g. "w2_1". */
  factId?: string;
  /** Internal: CORRECTED form. */
  corrected?: boolean;
  /** Internal: a later CORRECTED document replaced this one. */
  supersededBy?: string;
  /** Internal: text came from OCR. */
  ocr?: boolean;
  /** Internal: sha256 of kind + payer EIN (or name) + recipient name, to match corrections. */
  payerKey?: string;
}

export interface NameParts {
  firstName?: string;
  lastName?: string;
}

export interface Identity {
  taxpayer?: NameParts & { occupation?: string };
  spouse?: NameParts & { occupation?: string };
  dependents?: Record<string, NameParts>;
  address?: {
    street?: string;
    apt?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  phone?: string;
  /** Schedule E line 1a, by rental id. */
  rentals?: Record<
    string,
    {
      address?: {
        street?: string;
        city?: string;
        state?: string;
        zip?: string;
      };
    }
  >;
}

export interface ExpenseImport {
  owner: PersonId;
  file: string;
  byCategory: Partial<Record<ScheduleCExpense, number>>;
  at: string;
}

export interface LastCalc {
  at: string;
  factsHash: string;
  result: ReturnResult;
}

/** The user's one-time agreement at the start (see output/acknowledgment.ts). */
export interface Acknowledgment {
  text: string;
  at: string;
}

/** The last return_review that found nothing blocking (see tools/return-review.ts). */
export interface Review {
  at: string;
  /** The facts that were reviewed; forms_fill needs a review of the current facts. */
  factsHash: string;
}

export interface StoreData {
  version: 1;
  facts: TaxFacts;
  provenance: Record<string, ProvenanceEntry>;
  docs: DocEntry[];
  /**
   * EIN token → real EIN. Never leaves the store except inside forms_fill.
   * Never holds SSNs, ITINs or bank account numbers.
   */
  vault: Record<string, string>;
  /** Interview answers that aren't facts (e.g. "user doesn't know"). */
  answers: Record<string, unknown>;
  identity: Identity;
  /** fact id → payer / employer name (Schedule B lists payers). */
  labels: Record<string, string>;
  priorYear?: PriorYearSummary;
  lastCalc?: LastCalc;
  /** `${owner}:${file}` → what that import contributed. */
  expenseImports: Record<string, ExpenseImport>;
  acknowledgment?: Acknowledgment;
  review?: Review;
}
