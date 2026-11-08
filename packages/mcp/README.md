# 1040kit

**Self-employed tax software you just talk to.** Put your 1099s in a folder, and your AI assistant (Claude Code or Codex) fills in Schedule C, finds your deductions and prepares a US federal return to print and mail, or to e-file through IRS Free File Fillable Forms. No tax know-how needed.

This package is the 1040kit MCP server, the part your assistant talks to. It's built for freelancers, contractors, and 1099-NEC and 1099-K filers, including anyone with a W-2 job on the side. Website: https://1040kit.com

**1040kit is not tax advice.** It is software that helps you prepare your own return, and it is not affiliated with the IRS. You review and sign your own return.

## How it works

1. **Upload your documents.** Put your 1099s, any W-2, bank and card statements (CSV) and last year's return in one folder on your computer. 1040kit sorts them and tells you if anything is missing.
2. **The AI maps every box.** Each amount goes to the right line of Schedule C, Schedule SE and Form 1040. The assistant only asks what your documents can't tell it, and you see your deductions and your refund or balance due as you go.
3. **Review and file.** Ask why for any number and get the IRS rule behind it. Then sign the return yourself, and print and mail the filled IRS PDFs, or e-file with Free File Fillable Forms using a line-by-line entry sheet.

## What it handles

- **Documents:** 1099-NEC, 1099-K (with personal payments taken out), 1099-MISC, W-2, 1099-INT, 1099-DIV, bank and card statements (CSV) and last year's return. Scans and photos are read with local OCR.
- **Self-employment:** one Schedule C per person (you and your spouse), with expenses found in your statements, home office (simplified or actual) and business mileage; Schedule SE, the deduction for half of it, and Additional Medicare Tax on Form 8959; estimated payments you already made.
- **Deductions and credits:** the 20% qualified business income deduction, self-employed health insurance, SEP-IRA contributions, student loan interest, no tax on tips and overtime, the earned income credit, and the child tax credit and credit for other dependents.
- **Filers:** single, married filing jointly and head of household, taking the standard deduction, with rent and royalty income from up to three properties.

Not supported yet: state returns, married filing separately, itemized deductions, Social Security income, retirement distributions, unemployment, HSAs, education and child-care credits, stock or crypto sales, rental property depreciation, K-1s, and planning next year's quarterly payments. Full list: [docs/coverage.md](https://github.com/triple-rainbow/1040kit-plugin/blob/main/docs/coverage.md).

## Privacy and accuracy

- **Your documents and your return stay on your computer.** The return is stored encrypted in a folder on your machine. When the assistant needs an IRS rule, 1040kit sends only the question, with SSNs and account numbers removed. Your conversation with the assistant itself falls under that assistant's own privacy terms.
- **SSNs are masked.** Social Security and account numbers are replaced with placeholders before your information reaches the AI. 1040kit never stores SSNs, ITINs or bank account numbers; you write them on the printed forms.
- **No account.** Nothing to sign up for, no tracking, no ads.
- **The AI never does the math.** Tested tax code calculates every line and shows the IRS instruction it comes from; its test suite includes worked examples from IRS publications.

## Install

Install the plugin for your assistant rather than this package directly. The plugin runs `npx -y 1040kit` for you and adds the skills that guide the interview:

```
claude plugin marketplace add triple-rainbow/1040kit-plugin
claude plugin install 1040kit@1040kit
```

Codex and other setups: see [docs/install.md](https://github.com/triple-rainbow/1040kit-plugin/blob/main/docs/install.md).

Requires Node.js 22 or later.

## Running it by hand

The server speaks MCP over stdin/stdout, so it waits silently:

```
npx -y 1040kit
```

Any MCP client that launches stdio servers can use it with command `npx` and args `["-y", "1040kit"]`.

## Pricing

The 2026 tax year costs nothing. Prices for later tax years aren't set yet; if 1040kit starts charging, that will be announced before the tax year begins, and 2026 returns stay free.

## Links

- Website: https://1040kit.com
- What it handles and what it doesn't: [docs/coverage.md](https://github.com/triple-rainbow/1040kit-plugin/blob/main/docs/coverage.md)
- Source and issues: https://github.com/triple-rainbow/1040kit-plugin

## License

AGPL-3.0-only. See [LICENSE](LICENSE).
