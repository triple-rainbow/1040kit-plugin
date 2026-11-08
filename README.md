# 1040kit

**Self-employed tax software you just talk to.** Put your 1099s in a folder, and your AI assistant (Claude Code or Codex) fills in Schedule C, finds your deductions and prepares a US federal return to print and mail, or to e-file through IRS Free File Fillable Forms. No tax know-how needed.

It's built for freelancers, contractors, and 1099-NEC and 1099-K filers, including anyone with a W-2 job on the side. Launching January 2027. Website: https://1040kit.com

1040kit is software that helps you prepare your own return. It is not affiliated with the IRS and does not give tax, legal or accounting advice. You review and sign your own return.

## How it works

1. **Upload your documents.** Put your 1099s, any W-2, bank and card statements (CSV) and last year's return in one folder on your computer. 1040kit sorts them and tells you if anything is missing.
2. **The AI maps every box.** Each amount goes to the right line of Schedule C, Schedule SE and Form 1040. The assistant only asks what your documents can't tell it, and you see your deductions and your refund or balance due as you go.
3. **Review and file.** Ask why for any number and get the IRS rule behind it. Then sign the return yourself, and print and mail it, or e-file with Free File Fillable Forms using a line-by-line entry sheet.

## What it handles

- **Documents:** 1099-NEC, 1099-K (with personal payments taken out), 1099-MISC, W-2, 1099-INT, 1099-DIV, bank and card statements (CSV) and last year's return.
- **Self-employment:** one Schedule C per person (you and your spouse), with expenses found in your statements, home office (simplified or actual) and business mileage; Schedule SE, the deduction for half of it, and Additional Medicare Tax on Form 8959; estimated payments you already made.
- **Deductions and credits:** the 20% qualified business income deduction, self-employed health insurance, SEP-IRA contributions, student loan interest, no tax on tips and overtime, the earned income credit, and the child tax credit and credit for other dependents.
- **Filers:** single, married filing jointly and head of household, taking the standard deduction, with rent and royalty income from up to three properties.

Not supported yet: state returns, married filing separately, itemized deductions, Social Security income, retirement distributions, unemployment, HSAs, education and child-care credits, stock or crypto sales, rental property depreciation, K-1s, and planning next year's quarterly payments. The full list of what it computes, flags or doesn't handle: [`docs/coverage.md`](docs/coverage.md).

## Privacy and accuracy

- **Your documents and your return never leave your computer.** When the assistant needs an IRS rule, 1040kit sends only the question, with SSNs and account numbers removed. Your conversation with the assistant itself falls under that assistant's own privacy terms.
- **SSNs are masked.** Social Security and account numbers are replaced with placeholders before your information reaches the AI. 1040kit never stores SSNs, ITINs or bank account numbers; you write them on the printed forms.
- **No account.** Nothing to sign up for, no tracking, no ads.
- **The AI never does the math.** Tested tax code (`packages/engine`) calculates every line and shows the IRS instruction it comes from; its test suite includes worked examples from IRS publications.

## Pricing

The 2026 tax year costs nothing. Prices for later tax years aren't set yet; if 1040kit starts charging, that will be announced before the tax year begins, and 2026 returns stay free.

## Install

See [`docs/install.md`](docs/install.md). You need Node.js 22+ and Claude Code or Codex.

## What's here

| Path                                   | What                                                                                      |
| -------------------------------------- | ----------------------------------------------------------------------------------------- |
| `packages/engine`                      | `@1040kit/engine`: the deterministic federal tax engine (TY2025, TY2026)                  |
| `packages/mcp`                         | `1040kit`: the MCP server the AI assistant talks to (documents, interview, forms, filing) |
| `plugins/claude-code`, `plugins/codex` | The skills (`do-my-taxes`, `explain-my-return`) and install config                        |
| `plugins/dev`                          | A launcher for running the MCP server from this repo                                      |
| `.claude-plugin/marketplace.json`      | The Claude Code plugin marketplace                                                        |

The engine is pure TypeScript with no dependencies: every number it produces is a traced node with its inputs and an IRS citation. The MCP server is the only part that touches files, and the skills tell the assistant how to run the interview.

## Local testing

Requires Node.js 22+ and pnpm.

```bash
pnpm install
```

Run the test suites:

```bash
pnpm test
```

Start the MCP server by hand (it speaks MCP over stdin/stdout, so it waits silently):

```bash
./plugins/dev/1040kit-dev.sh
```

The launcher runs `packages/mcp/src/bin.ts` with tsx, no build. Unless you set `KIT1040_HOME` and `KIT1040_CONFIG_DIR`, workspaces and keys go to the gitignored sandbox `.dev/taxes` and `.dev/config` in this repo, so tests never touch `~/Taxes`.

**Claude Code, with the skills and the local server.** From the repo root:

```bash
claude --plugin-dir plugins/claude-code --mcp-config plugins/dev/mcp.json --strict-mcp-config
```

`--strict-mcp-config` skips the plugin's own `npx -y 1040kit` server, which would download the npm package. Then say "do my taxes". Put synthetic test documents (no real SSNs) in the inbox folder the assistant gives you.

**Codex, with the local server.** Codex starts servers from any folder, so use the absolute path:

```bash
codex mcp add 1040kit-dev -- "$PWD/plugins/dev/1040kit-dev.sh"
```

```bash
mkdir -p ~/.codex/skills && cp -RL plugins/codex/skills/do-my-taxes plugins/codex/skills/explain-my-return ~/.codex/skills/
```

Remove it afterwards with `codex mcp remove 1040kit-dev`.

**The interview widget.** `interview_next` shows its questions as a card with answer chips in hosts that support MCP Apps. To try the card in a browser without a host:

```bash
pnpm --filter 1040kit widget:harness
```

```bash
python3 -m http.server 4310 -d packages/mcp/.widget-harness
```

Then open http://localhost:4310.

The released server is on npm as [`1040kit`](https://www.npmjs.com/package/1040kit) (what the plugins run with `npx -y 1040kit`). How releases are cut: [`docs/releasing.md`](docs/releasing.md).

## License

[AGPL-3.0](LICENSE). Copyright (C) 2026 Triple Rainbow.
