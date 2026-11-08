# Filing the return

1040kit doesn't e-file directly. There are two ways to file, both free:

- **A. Print and mail** (`path: 'mail'`): the user prints the filled IRS forms, signs them and mails them to the IRS.
- **B. IRS Free File Fillable Forms** (`path: 'fillable_forms'`): the IRS's free online forms, which e-file. The user types the return in themselves, line by line, from 1040kit's entry sheet.

Help them choose: Free File Fillable Forms is faster and confirms receipt, but means typing every line and creating an account there. Mailing needs only a printer, stamps and patience. Don't claim processing times or dates; if they ask, use `kb_search`.

## Before either path

- The user must have confirmed the `return_review` (they said the numbers look good), and `forms_fill` must have succeeded. `filing_prepare` refuses otherwise (`REVIEW_REQUIRED`, `RETURN_INCOMPLETE`): see `errors.md`.
- Tell the user that everything in `outputs/` is on their computer only. The PDF has no SSNs (they write those in), but it holds their income and other details, so they should keep it private and delete copies they don't need.

## A. Print and mail

Call `filing_prepare({ workspace, path: 'mail' })`. It writes `<year>-mailing-instructions.md` in `outputs/`. Read that file and walk the user through it, using its content (not your own knowledge) for the address, attachments, payment options and deadline:

1. Print the return PDF from `outputs/` (one-sided is safest).
2. Write in every SSN (and, for a direct-deposit refund, the bank routing and account numbers) in the boxes `forms_fill` listed in `handwrite`, from their own records. Then check the name and address on page 1.
3. Sign and date where the instructions say. For a joint return, both spouses sign.
4. Attach what the instructions list (for example W-2 copies) in the order given.
5. If they owe, follow the payment section of the instructions.
6. Mail it to the address in the instructions, which depends on their state and whether they're due a refund or owe. Suggest keeping a copy of everything they mail.

## B. IRS Free File Fillable Forms

Call `filing_prepare({ workspace, path: 'fillable_forms' })`. It writes `<year>-free-file-fillable-forms.md` in `outputs/`: every form in the order Free File Fillable Forms uses, and every non-zero line as Form · Line · Value.

1. The user goes to the IRS Free File page (https://www.irs.gov/freefile), chooses Free File Fillable Forms, and creates their own account. You don't create accounts or sign in for them.
2. They add the forms the entry sheet lists, in its order, and type each line's value exactly as written. Where the sheet says **type this yourself** (every SSN), they type it from their own records.
3. Offer to go through the sheet with them one form at a time, reading out the next lines on request.
4. The site will ask for identity checks and an electronic signature. They follow its prompts; you don't enter those details.
5. The user reviews and presses submit themselves, then watches for the IRS acceptance or rejection email. If it's rejected, they can tell you the reason shown, and you help find the line by checking the entry sheet and using `explain_line`. Changes to the return go through `profile_set` → `return_review` (and the user's confirmation) → `forms_fill` → `filing_prepare` again; never edit numbers by hand.

If the user asks you to type the entries into the website in their browser for them: they sign in themselves, they type every SSN and identity detail themselves, and they press submit themselves. You may fill only the line values from the entry sheet, with them watching.

## State returns

1040kit prepares federal returns only. Tell the user to check their state tax agency's website to find out whether they need to file a state return and how. Don't state which states have income tax unless `kb_search` gives you a citation.
