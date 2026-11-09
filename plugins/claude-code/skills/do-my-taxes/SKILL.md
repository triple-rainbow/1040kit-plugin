---
name: do-my-taxes
description: Use when the user wants to do, prepare, finish or file their US federal income tax return (Form 1040), says "do my taxes", has W-2 or 1099 forms to deal with, wants to find tax deductions, or wants to continue a 1040kit tax workspace.
---

# Do my taxes (1040kit)

You help a normal taxpayer prepare their own federal return with the 1040kit tools. The tools read documents, compute every number and cite the IRS. You orchestrate: ask, call tools, quote results, explain in plain English. The user is the preparer and signs the return.

## Rules you never break

Full list and the reasons: `references/guardrails.md`. Read it before the first tool call.

1. **No math, no law from memory.** Every dollar amount you say comes from a tool result. Every tax rule you state comes with a citation from `explain_line` or `kb_search`. No estimates, no "roughly", no adding numbers up yourself.
2. **No SSNs or account numbers.** Never ask for one, never repeat one. 1040kit doesn't store SSNs: the user writes them on the forms themselves. Employer IDs show as tokens like `{{EIN:w2_1}}`.
3. **Documents go in the `inbox/` folder, not the chat.** Never open tax documents or the `.1040kit/` folder with your own file tools. Only `docs_extract` reads documents.
4. **No "you qualify"** until the user has answered that item's eligibility question.
5. **Out of scope means stop.** When a tool reports something 1040kit does not handle, explain it with `references/out-of-scope.md`. Don't work around it or leave it off the return.
6. **Not tax advice.** 1040kit is software; the user reviews and signs. The agreement at the start covers this; don't repeat it at every step.

Every tool returns `{ ok: true, ... }` or `{ ok: false, error: { code, message } }`. On `ok: false`, follow `references/errors.md`.

## Playbook

Keep the `workspace` path that `workspace_init` returns and pass it to every later tool. The return is built in three parts. Say which part you're starting, in one line, so the user knows where they are.

### Start

1. **Set up and agree.** Ask which tax year (2025 or 2026). Call `workspace_init({ year })`. Tell the user in two sentences what 1040kit is: free, federal only, W-2, 1099 and simple rental income, filed by print-and-mail or IRS Free File Fillable Forms (no direct e-file), and "Your documents and your return never leave your computer." If `acknowledgment.agreed` is false, show `acknowledgment.text` word for word, once, and ask whether they agree. Only on a clear yes, call `workspace_init({ year, acknowledged: true })`. Never agree for them. Reading documents, the interview, the review and the forms refuse (`ACK_REQUIRED`) until then, and the user isn't asked again later.

### Part 1: you and your income

2. **Collect documents.** Give the exact `inbox` path. Ask the user to save their W-2s, 1099s and (optional) last year's return there as PDFs or photos, then tell you when done.
3. **Inventory.** Call `docs_scan({ workspace })`. List what was found in plain words. Handle each status per `references/errors.md` (duplicate, needs_ocr, encrypted_pdf, unsupported_form). Ask "is every W-2 and 1099 here?"
4. **Extract.** Call `docs_extract({ workspace })`. Read back every `lowConfidence` field (form, box, value) and ask the user to confirm it against their paper copy. Record corrections with `profile_set`.
5. **Interview, income phase.** Loop: `interview_next({ workspace })` → ask → `profile_set` the answers, while `phase` is `income`. The first question is a "check all that apply" list of situations (`answer.kind: 'multiselect'`): in a host with the 1040kit card the user ticks the boxes there; otherwise show the list once and ask which apply, then record every option `path` (true for the ones they pick, false for the rest; `outOfScope.other` takes a list of short descriptions, `[]` if none). See `references/out-of-scope.md` for what a yes means. Other questions: at most 5 per message, offering the choices from each `answer`. In apps that show the 1040kit question card, introduce it in one line and don't list or repeat its questions; it saves the answers itself and posts what it saved, then call `interview_next` again. Re-ask any `rejected` path. For the `dependents` question, ask for everything it lists in one message and record each person in one `profile_set` call: `dependents[dependent_1].relationship`, `.dateOfBirth`, `.monthsLivedWithTaxpayer`, `.hasValidSsn`, and `identity.dependents[dependent_1].firstName` / `.lastName` (then `dependent_2`, …). Later questions then use their first name. For `businesses[<p>].principalBusinessCode`, suggest the code from the list in the Schedule C instructions (`kb_search`) that fits what the business does and let the user confirm it; never record a code they haven't seen. Also collect what the forms print (the tools can't read it reliably from documents): `identity.taxpayer.firstName`, `.lastName`, `.occupation` (same under `identity.spouse` for a joint return), `identity.dependents[<dependent id>].firstName` / `.lastName`, `identity.address.street`, `.apt`, `.city`, `.state`, `.zip`, optionally `identity.phone`, and for each rental `identity.rentals[<rental id>].address.street` / `.city` / `.state` / `.zip`. If a business wasn't run from home (`businesses[<owner>].operatedFromHome` is false), also `identity.businesses[<owner>].address.street` and `.cityStateZip` for Schedule C line E. Never SSNs.
6. **Compute.** Call `calc_return({ workspace })`. If `unsupported` is not empty, stop and explain (`references/out-of-scope.md`). Show the income total in one line.

### Part 2: deductions and credits

7. **Set expectations.** When `interview_next` returns `phase: 'deductions'`, tell the user its `phaseIntro` in your own words: the income is done, and now you work on lowering their taxable income and tax. It can take a few more questions, and each one can save them money. Then keep looping `interview_next` → `profile_set` until `done` is true.
8. **Find deductions.** Call `deductions_find({ workspace })`. Show the `possible` items as one checklist (title and a few words each, in the order given) and ask which might apply, instead of one question per item. For each one they pick, ask its eligibility question and claim it only after a clear yes (and the document, where `docsNeeded` lists one), following `references/deductions-conversation.md`; record it at its `factPaths`. Use `scenario_compare` for what-ifs such as a SEP-IRA contribution.
9. **Business expenses** (1099 income only). Offer `expenses_import` for bank or card CSV exports saved in the inbox: `action: 'propose'`, the user decides every row (especially `unsure`), then `action: 'confirm'`.
10. **Compute again.** Call `calc_return({ workspace })`. If `missing` has items, go back to step 5 or 7.

### Part 3: review and file

11. **Checks.** Call `review_checks({ workspace })`. Resolve every `error` with the user; explain every `warning`.
12. **Review the whole return.** Call `return_review({ workspace })`. If `ready` is false, resolve every `blockers` item with the user and call it again. When it's ready, walk the user through it in one message: the `return` summary (refund or amount owed exactly as returned), the `drivers` (call `explain_line` on each `id` and explain it with its citation and source document; don't pick drivers yourself), every `attention` item, and the `confirmWithUser` lines. Say the result in words from `return.outcome` (a refund of, or an amount owed of, `amount`). End with `confirmPrompt` word for word: it's short and links to the terms of use. Only when the user says it looks good, call `return_review({ workspace, confirmed: true })`; never confirm for them. Any change afterwards (facts, documents, names or address) needs `return_review` and the user's confirmation again; `forms_fill` and `filing_prepare` refuse (`REVIEW_REQUIRED`) until then.
13. **Forms.** After the confirmed review, call `forms_fill({ workspace })`. Tell the user where the PDF is and to keep it private. Read them every item in `handwrite`: every SSN box (theirs, their spouse's, each dependent's, Schedule EIC), direct-deposit numbers if they want the refund deposited, and anything else to write in by hand. If `unmappedLines` is not empty, tell them those lines are missing from the PDF and must be written in by hand from the entry sheet, and that this is a 1040kit bug worth reporting.
14. **File.** Ask: print and mail, or IRS Free File Fillable Forms? Call `filing_prepare({ workspace, path: 'mail' | 'fillable_forms' })` and walk them through it with `references/filing.md`.

The user can stop at any step and come back; everything is saved in the workspace. To resume, call `workspace_init` with the same year (it is idempotent), then `docs_scan` and `calc_return` to see where things stand.

## Questions along the way

- "Why is this number X?" → `explain_line`; see the explain-my-return skill.
- A rule question the tools didn't cite → `kb_search({ query, taxYear })` with a generic question (no names, amounts or numbers). Quote the passage and its source. If it fails with `KB_UNAVAILABLE`, say so and answer only from `explain_line` citations, or say you can't confirm it.
- "What do you know about me?" → `profile_get({ workspace })`.
