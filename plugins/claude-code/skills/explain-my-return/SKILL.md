---
name: explain-my-return
description: Use when the user asks why a number on their 1040kit tax return is what it is ("why is line 16 this much?", "where did my refund come from?", "why do I owe?"), wants a line, form or tax term on their federal return explained, or asks a what-if about a return already in a 1040kit workspace.
---

# Explain my return (1040kit)

You explain the user's own return using only what the 1040kit tools return. If there's no 1040kit workspace yet, or they want to change or file the return, use the do-my-taxes skill instead.

## Rules

The do-my-taxes guardrails apply in full (`../do-my-taxes/references/guardrails.md`). The ones that matter most here:

- Every number you say is copied from a tool result. Don't add, subtract or estimate; if a child line doesn't obviously "add up" to its parent, quote the `formula` from the trace instead of doing the math.
- Every rule you state carries the citation the tool gave you, named in plain words with its link.
- 1040kit never stores SSNs; employer and payer IDs appear as tokens such as `{{EIN:w2_1}}` (call it "the employer ID on your W-2"). Never ask for or repeat an SSN or account number.
- This is an explanation of their return, not tax advice.

## Steps

1. **Find the workspace.** Ask which tax year, then call `workspace_init({ year })` (it's idempotent and returns the existing `workspace`). On `ok: false`, follow `../do-my-taxes/references/errors.md`.
2. **Get the current lines.** Call `calc_return({ workspace })`. Match the user's question to a line `id` (or a ref like `f1040:16`). `calc_return` lists only non-zero lines on forms that are on the return, so for a line that's zero or missing ("why no earned income credit?") call `explain_line` with its `form:line` ref, such as `f1040:27a`. If `complete` is false, say the return isn't finished and the numbers may change.
3. **Explain.** Call `explain_line({ workspace, ref, depth: 2 })`. Go one level deeper (`depth: 3`, or `explain_line` on a child `id`) only if they ask. From the result, say:
   - what the line is (`label`, form and line) and its value;
   - how it's computed (the trace `formula`) and the values feeding it, with where each came from: a document (file name and box), "you told me", or "inferred";
   - the IRS source (`citations`).
4. **Rule questions** the citations don't answer: `kb_search({ query, taxYear })` with a generic question (no names, amounts or identifiers). Quote the passage and source. On `KB_UNAVAILABLE`, say you can't confirm it right now.
5. **What-ifs** ("what if I contributed to a SEP-IRA?", "what if I'd had another child?"): `scenario_compare({ workspace, scenarios })` and quote each `delta` as returned. Scenarios change nothing; changing the return goes through the do-my-taxes skill.
6. **Something looks wrong?** Check where the input came from (step 3). A document value they believe is wrong → ask them to compare with the paper copy; corrections go through the do-my-taxes skill (`profile_set`, then `calc_return`, then `review_checks`).

## Example (illustrative numbers)

User: "Why is my taxable income $41,250?"
→ `calc_return` → find the taxable income line id → `explain_line({ workspace, ref: '<that id>' })` →
"Your taxable income is $41,250 (Form 1040 line 15). 1040kit got it as adjusted gross income minus your deductions: $57,000 of AGI, from your W-2 from Acme (box 1), and the $15,750 standard deduction for single filers. Source: IRS Form 1040 instructions, line 15 (link)."
Every figure in that answer appears in the tool result; none is computed by you.
