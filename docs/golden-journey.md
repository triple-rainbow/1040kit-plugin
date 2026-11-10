# Golden journey

`packages/mcp/test/golden-journey.ts` runs every engine golden return (`packages/engine/test/golden/*.json`) through the MCP server the way a user's assistant would, from the agreement to the filing instructions, and checks the result. Use it before a release, after changing the interview, the forms or the field maps, and to check a published npm version.

```bash
pnpm --filter 1040kit test:journey                         # this checkout (src/bin.ts)
pnpm --filter 1040kit test:journey -- --server=dist        # the built bundle (run build first)
pnpm --filter 1040kit test:journey -- --server=npm@0.1.2   # a published version, via npx
pnpm --filter 1040kit test:journey -- single-freelance w2- # only goldens whose file name matches
```

Options: `--server=src|dist|npm[@version]` (default `src`), `--concurrency=N` (default 4), `--out=<file>` for the JSON report (default: a temp folder, printed at the end), `--keep` to keep each case's workspace and PDF. It exits 1 when any case fails. It is not part of `pnpm test`: a full run takes a few minutes, and `npm@…` needs the network.

## What each case does

Each golden gets its own server and `KIT1040_HOME`:

1. `workspace_init`: the agreement must be asked, and `interview_next` must refuse (`ACK_REQUIRED`) until the user agrees.
2. Documents: one PDF per W-2, 1099-NEC/INT/DIV/MISC/K and 1098-E in the golden, written into the inbox, then `docs_scan` and `docs_extract`.
3. Interview: `interview_next` → `profile_set` until done, answering only what is asked, from the golden facts (the situations checklist, group forms, the new-dependent form with `addAnother`).
4. Deductions: every `deductions_find` item whose fact paths the golden has is claimed.
5. Facts nobody asked about are then given as if the user volunteered them, and listed as `volunteered`.
6. Names and address (do-my-taxes step 5), then `calc_return`. Every node in the golden's `expect`, its `forms` and every stored fact must match.
7. `review_checks`, `return_review` (`forms_fill` must refuse before it), the user's confirmation, `forms_fill`.
8. The flattened PDF: every printed line's value must be on its form's pages, on the row that carries the line's IRS label. That label is read from the page text, so this check doesn't depend on the field maps.
9. `filing_prepare` for mail and Free File Fillable Forms; the entry sheet must list every line.

## Reading the report

Each case is `pass`, `blocked` or `fail`:

- **blocked**: `return_review` stopped only on `unsupported:*` items, things 1040kit doesn't do yet (Form 8995-A, provisional 2026 values). Not a failure.
- **fail**: one or more `failures`, each a thing 1040kit did wrong: a wrong number, a rejected answer, a missing line, a value on the wrong row, the interview going back to income after deductions started.

Read these lists too; they aren't failures:

- `defaulted`: questions the golden has no answer for, answered from `DEFAULTS` in the script (business code, vehicle questions…). Add the answer to the golden when it matters to the case.
- `volunteered`: golden facts the interview and `deductions_find` never asked for. Expected for some (a valid SSN when no credit needs it). For others, such as estimated tax payments or blindness, it means the interview misses a question.
- `notes`: low-confidence extraction fields, `attention` items, and printed values whose row label wasn't found (Schedule 1 "top", Schedule EIC line 6, whose labels sit elsewhere on the form).

People and documents are synthetic (`test/fixtures/make-pdfs.ts`: Pat and Sam Example, fake SSNs and EINs). The script never reads real returns.
