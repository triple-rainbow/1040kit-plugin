# 1040kit coverage ledger

What 1040kit computes, what it only flags, and what it doesn't handle. Update
this file in the same change as any scope change, and link the tests that
prove each "computed" row. This file says what the code does today.

Status:

- **computed**: the engine calculates it and `forms_fill` prints it.
- **flagged**: detected and explained; the return is marked incomplete
  (`unsupported`) or the user is told to handle it elsewhere. Never silently left off.
- **planned**: not detected beyond the screening questions; listed with its target.

Last updated: 2026-11-06 (every printed total and copy line fills; head of household offered to single filers with a qualifying person; forms need names and the home address).

## Tax years and filers

| Item                                                                                      | Status                                                                                  | Since | Proof                                                            |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------- |
| Tax year 2025 (forms bundled)                                                             | computed                                                                                | v1    | `packages/engine/test/golden/*`, `packages/mcp/test/e2e.test.ts` |
| Tax year 2026 (values final, forms draft)                                                 | computed, `complete: false` until IRS final forms; `forms_fill` → `FORMS_NOT_AVAILABLE` | v1    | `packages/engine/test/ty2026.test.ts`                            |
| Filing status Single, MFJ, HoH                                                            | computed                                                                                | v1    | golden suite                                                     |
| Head of household offered when a single filer has a qualifying person (the user decides)  | computed (`deductions_find` item `head_of_household`, review warning)                   | v1    | `packages/engine/test/hoh.test.ts`                               |
| MFS, Qualifying Surviving Spouse                                                          | flagged                                                                                 | —     | `scope.test.ts`; MFS planned v1.1                                |
| Dependents: qualifying child / relative tests (incl. half/step siblings, nieces, nephews) | computed                                                                                | v1    | `required.test.ts`, golden `w2-hoh-one-child`                    |
| Federal only                                                                              | —                                                                                       | v1    | State returns planned v2                                         |

## Income

| Item                                                                                            | Form                                                     | Status   | Since | Proof                                                                                                              |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------- | ----- | ------------------------------------------------------------------------------------------------------------------ |
| Wages                                                                                           | W-2 (multiple)                                           | computed | v1    | golden suite                                                                                                       |
| Interest                                                                                        | 1099-INT, Schedule B                                     | computed | v1    | golden                                                                                                             |
| Dividends, qualified dividends, cap gain distributions                                          | 1099-DIV, Schedule B, QDCG worksheet                     | computed | v1    | golden                                                                                                             |
| Nonemployee compensation                                                                        | 1099-NEC → Schedule C                                    | computed | v1    | golden, e2e                                                                                                        |
| Other income                                                                                    | 1099-MISC box 3 → Schedule 1 line 8z                     | computed | v1    | golden                                                                                                             |
| Rents and royalties                                                                             | 1099-MISC boxes 1-2 → Schedule E Part I (≤ 3 properties) | computed | v1    | `packages/engine/test/schE.test.ts`, golden `sche-sublet-profit-1099misc`                                          |
| Rents/royalties that are business receipts                                                      | 1099-MISC → Schedule C (`treatAsBusiness`)               | computed | v1    | golden                                                                                                             |
| Payment app / marketplace income                                                                | 1099-K (personal portion reconciled)                     | computed | v1    | golden                                                                                                             |
| Rental depreciation                                                                             | Form 4562, Schedule E line 18                            | flagged  | —     | `scope.test.ts` (`rental_depreciation`); planned v2                                                                |
| Passive loss limits (beyond the $25,000 active-participation exception that needs no Form 8582) | Form 8582                                                | flagged  | —     | `scope.test.ts` (`passive_loss_8582`; the exception case is computed); planned v2                                  |
| Vacation-home rules (personal use > 14 days / 10%)                                              | Pub 527 ch. 5                                            | flagged  | —     | `scope.test.ts` (`vacation_home`); rented < 15 days as a home is left off per Pub 527 (`schE.test.ts`); planned v2 |
| More than 3 rental/royalty properties                                                           | Schedule E continuation                                  | flagged  | —     | `scope.test.ts` (`rental_over_3`); planned v1.1                                                                    |
| Retirement distributions                                                                        | 1099-R                                                   | flagged  | —     | planned v1.1                                                                                                       |
| Social Security                                                                                 | SSA-1099                                                 | flagged  | —     | planned v1.1                                                                                                       |
| Unemployment                                                                                    | 1099-G                                                   | flagged  | —     | planned v1.1-v1.2                                                                                                  |
| Stock / crypto sales                                                                            | 1099-B, 8949, Schedule D                                 | flagged  | —     | planned v2                                                                                                         |
| K-1, foreign income                                                                             | —                                                        | flagged  | —     | planned v2+                                                                                                        |

## Self-employment (Schedule C)

| Item                                                                          | Status                                                   | Since | Proof                                                                     |
| ----------------------------------------------------------------------------- | -------------------------------------------------------- | ----- | ------------------------------------------------------------------------- |
| One Schedule C per person, expense categories                                 | computed                                                 | v1    | golden                                                                    |
| Standard mileage                                                              | computed (2026 uses 72.5¢ for all miles, with a warning) | v1    | golden                                                                    |
| Simplified home office                                                        | computed                                                 | v1    | golden                                                                    |
| Actual-expense home office (Form 8829), incl. 39-year depreciation for owners | computed (casualty losses and pre-1993 homes flagged)    | v1    | `packages/engine/test/f8829.test.ts`, golden `f8829-freelancer-homeowner` |
| Self-employment tax (Schedule SE)                                             | computed                                                 | v1    | golden, e2e                                                               |
| QBI deduction (simplified, Form 8995; rentals excluded)                       | computed                                                 | v1    | golden                                                                    |
| Above-threshold QBI (Form 8995-A)                                             | flagged                                                  | —     | planned v2                                                                |
| Multiple Schedule Cs per person                                               | flagged                                                  | —     | planned v2+                                                               |

## Adjustments and deductions

| Item                                                     | Form/line                  | Status                   | Since | Proof                                                                 |
| -------------------------------------------------------- | -------------------------- | ------------------------ | ----- | --------------------------------------------------------------------- |
| Half of SE tax, SE health insurance, SEP                 | Schedule 1                 | computed                 | v1    | golden                                                                |
| Student loan interest                                    | 1098-E, Schedule 1 line 21 | computed                 | v1    | `packages/engine/test/student-loan.test.ts`, golden `sli-w2-phaseout` |
| Schedule 1-A (tips, overtime, car loan interest, senior) | Schedule 1-A               | computed                 | v1    | golden                                                                |
| Standard deduction                                       | 1040 line 12               | computed                 | v1    | golden                                                                |
| Itemized deductions                                      | Schedule A                 | flagged (`itemize_flag`) | —     | planned v1.1                                                          |
| HSA                                                      | Form 8889                  | flagged                  | —     | planned v1.1-v1.2                                                     |

## Taxes and credits

| Item                                                    | Form                          | Status   | Since | Proof                                                                                                                                                                |
| ------------------------------------------------------- | ----------------------------- | -------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Income tax (Tax Table, Tax Computation Worksheet, QDCG) | 1040 line 16                  | computed | v1    | `tax/table` tests (all 2,060 rows)                                                                                                                                   |
| Additional Medicare Tax                                 | Form 8959, Schedule 2 line 11 | computed | v1    | `packages/engine/test/f8959-f8960.test.ts` (i8959 examples), golden `mfj-high-income-8959-8960`                                                                      |
| Net Investment Income Tax                               | Form 8960, Schedule 2 line 12 | computed | v1    | `packages/engine/test/f8959-f8960.test.ts`, golden `mfj-high-income-8959-8960`                                                                                       |
| Child Tax Credit, Credit for Other Dependents, ACTC     | Schedule 8812                 | computed | v1    | golden                                                                                                                                                               |
| Earned Income Credit                                    | 1040 line 27, Schedule EIC    | computed | v1    | `packages/engine/test/eic-table.test.ts` (all 1,374 rows of the 2025 EIC Table), `eic.test.ts`, goldens `eitc-hoh-one-child`, `eitc-single-no-child`, `ctc-hoh-actc` |
| EITC after a prior disallowance                         | Form 8862                     | flagged  | —     | `scope.test.ts` (`eitc_8862`); planned v2                                                                                                                            |
| Education credits                                       | Form 8863                     | flagged  | —     | planned v1.1                                                                                                                                                         |
| Child and dependent care, Saver's credit                | 2441, 8880                    | flagged  | —     | planned v1.1-v1.2                                                                                                                                                    |
| AMT                                                     | Form 6251                     | flagged  | —     | planned v2+                                                                                                                                                          |

## Identifiers (SSNs, ITINs, bank accounts)

| Item                                                                                                                    | Status                                                                                                                                                | Since |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| SSNs and ITINs (taxpayer, spouse, dependents, Schedule EIC)                                                             | **never stored**. Extraction discards them; the PDF leaves them blank and the handwrite list names every box; the entry sheet says "type it yourself" | v1    |
| Refund direct deposit routing/account numbers                                                                           | never stored; written in by the user                                                                                                                  | v1    |
| Employer/payer EINs                                                                                                     | read from documents, kept as tokens toward the AI, printed by `forms_fill`                                                                            | v1    |
| Sign-off acknowledgment (user entered identifiers, reviewed every number, 1040kit takes no responsibility for accuracy) | required by `forms_fill`                                                                                                                              | v1    |

## Outputs and filing

| Item                                                                                                                                                                                                                                  | Status                                                   | Since |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ----- |
| Filled, flattened IRS PDFs (2025) for every computed form; every line of every 2025 golden return has a field (`packages/mcp/test/golden-forms.test.ts`)                                                                              | computed                                                 | v1    |
| Totals and copy lines print (Schedule 2 line 21, Schedule 1 lines 10/26, Schedule 8812 lines 1-14 and Part II, Schedule SE 3/4c/6/8d/9, Schedule C 3/5/48, Form 8995 lines 1(c)/2/13/15) (`packages/mcp/test/required-lines.test.ts`) | computed                                                 | v1    |
| Names and home address required before forms are filled (`IDENTITY_REQUIRED`)                                                                                                                                                         | computed                                                 | v1    |
| Output PDFs are not encrypted (they hold no SSNs)                                                                                                                                                                                     | decided                                                  | v1    |
| Path A: print and mail, with mailing address by state                                                                                                                                                                                 | computed (addresses still being checked against irs.gov) | v1    |
| Path B: Free File Fillable Forms entry sheet                                                                                                                                                                                          | computed                                                 | v1    |
| E-file through a partner or our own transmitter                                                                                                                                                                                       | planned                                                  | later |
| Prior-year return import (comparison only)                                                                                                                                                                                            | computed (parser has no test yet)                        | v1    |
