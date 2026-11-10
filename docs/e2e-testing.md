# End-to-end testing

`pnpm test` checks the engine against the golden returns (`packages/engine/test/golden/*.json`) and each MCP tool on its own. The end-to-end tests check what a user gets: the plugin as installed, the server as published, and the whole conversation from "do my taxes" to the filing instructions. They come in three layers, cheapest first. All of them use the same golden returns and synthetic people (Pat and Sam Example, fake SSNs and EINs).

| Layer        | Command                                        | What plays the user            | Needs                            | Time, cost                                     |
| ------------ | ---------------------------------------------- | ------------------------------ | -------------------------------- | ---------------------------------------------- |
| 1. Install   | `pnpm test:install`                            | a script installs the plugin   | `claude` CLI, network            | ~1 min, free                                   |
| 2. Tools     | `pnpm --filter 1040kit test:journey`           | a script calls the tools       | nothing (network for `npm@…`)    | ~2 min for all 34, free                        |
| 3. Assistant | `pnpm --filter 1040kit test:journey:assistant` | a second model is the taxpayer | a signed-in Claude Code or a key | ~10–20 min per return, model usage (see below) |

The scripts are in `plugins/scripts/install-check.sh` and `packages/mcp/test/journey/`. Layers 2 and 3 share `shared.ts`: the golden returns as documents and answers, and `verifyReturn`, which checks a finished workspace.

## 1. Install check

```bash
pnpm test:install                                         # from GitHub, the version on main
bash plugins/scripts/install-check.sh . 0.1.3             # this checkout as the marketplace
bash plugins/scripts/install-check.sh triple-rainbow/1040kit-plugin 0.1.2
```

This installs the plugin into a throwaway `CLAUDE_CONFIG_DIR`, so your own Claude config isn't touched. It runs `claude plugin marketplace add` and `claude plugin install 1040kit@1040kit`, then checks:

- the installed version;
- both skills;
- the `.mcp.json` entry (`npx -y 1040kit`);
- that `claude mcp list` connects to the server.

Last, it runs one golden return through that version from npm (layer 2), so the server users get is the one checked. Nothing here calls a model, so it needs no sign-in.

## 2. Tool journey

```bash
pnpm --filter 1040kit test:journey                         # this checkout (src/bin.ts)
pnpm --filter 1040kit test:journey -- --server=dist        # the built bundle (run build first)
pnpm --filter 1040kit test:journey -- --server=npm@0.1.2   # a published version, via npx
pnpm --filter 1040kit test:journey -- single-freelance w2- # goldens whose file name matches
```

A script plays both the user and the assistant, calling the tools in the do-my-taxes playbook order. Each golden gets its own server and `KIT1040_HOME`:

1. **Agreement.** `workspace_init` asks for it, and `interview_next` must refuse (`ACK_REQUIRED`) until the user agrees.
2. **Documents.** One PDF per W-2, 1099-NEC/INT/DIV/MISC/K and 1098-E goes into the inbox, then `docs_scan` and `docs_extract`.
3. **Interview.** `interview_next` → `profile_set` until done, answering only what is asked, from the golden facts. This includes the situations checklist, group forms and the new-dependent form with `addAnother`.
4. **Deductions.** Every `deductions_find` item whose fact paths the golden has is claimed.
5. **Unasked facts.** Facts nobody asked about are given as if the user volunteered them, and listed as `volunteered`.
6. **Names and address** (do-my-taxes step 5).
7. **`verifyReturn`**:
   - `calc_return`: every node in the golden's `expect`, its `forms` and every stored fact must match;
   - `review_checks`, then `return_review` (`forms_fill` must refuse before it), the confirmation, then `forms_fill`;
   - every printed value must be on its form's pages, on the row that carries its IRS line label. The label is read from the page text, so this check doesn't depend on the field maps;
   - `filing_prepare` for both paths, and the Free File entry sheet must list every line.

Options: `--server=src|dist|npm[@version]`, `--concurrency=N` (default 4), `--out=<file>`, `--keep` (keep workspaces and PDFs). It exits 1 when a case fails.

## 3. Assistant journey

```bash
pnpm --filter 1040kit test:journey:assistant                       # three representative returns
pnpm --filter 1040kit test:journey:assistant -- w2-hoh --server=npm@0.1.2
pnpm --filter 1040kit test:journey:assistant -- --all --concurrency=2
```

This is the real conversation. Claude Code runs headless (`claude -p`, resumed each turn) with this checkout's `plugins/claude-code` skills and the chosen server, and is told "I'd like to do my taxes". A second `claude -p` session (`--user-model`, default sonnet) plays the taxpayer. It has the golden facts and these rules:

- answer only what's asked;
- say the documents are saved when given the inbox path (the script puts them there);
- never give an SSN;
- agree to the terms, and say "looks good" at the review;
- choose print and mail;
- say `DONE` at the end.

Afterwards it checks two things:

- **The tools, from the transcript:**
  - every playbook step happened, in order;
  - the assistant agreed to the terms and confirmed the review only in a later turn than the one where it showed them to the user;
  - any denied tool calls are noted.
- **The return**, with the same `verifyReturn` as layer 2.

Each case's folder keeps `conversation.md`, the whole exchange with the tools called each turn. The report has the cost per case.

It needs a signed-in Claude Code (`claude auth login`), or `CLAUDE_CODE_OAUTH_TOKEN` (`claude setup-token`) or `ANTHROPIC_API_KEY`. It checks sign-in with one cheap call first and exits 2 if that fails.

Options:

- `--plugin-dir=<dir>`;
- `--model=<m>` (the assistant), `--user-model=<m>`;
- `--turns=N` (default 40);
- `--budget=<usd>` (per assistant turn, default 2);
- `--concurrency=N` (default 1);
- `--all`, `--out=<file>`.

A model is not deterministic. When a case fails here but passes layer 2, read `conversation.md`: the cause is in the skills, or in what the assistant made of a tool result, not in the engine.

## Reading a report

Each case is `pass`, `blocked` or `fail`:

- **blocked**: `return_review` stopped only on `unsupported:*` items, things 1040kit doesn't do yet (Form 8995-A, provisional 2026 values). Not a failure.
- **fail**: one or more `failures`. Each is something 1040kit (or, in layer 3, the assistant) did wrong: a wrong number, a rejected answer, a missing line, a value on the wrong row, a playbook step skipped.

Read these too; they aren't failures:

- `defaulted`: questions the golden has no answer for, answered from `DEFAULTS` in `shared.ts` (business code, vehicle questions…). Add the answer to the golden when it matters to the case.
- `volunteered`: golden facts the interview and `deductions_find` never asked for. Some are expected (a valid SSN when no credit needs it). Others, such as estimated tax payments or blindness, mean the interview misses a question.
- `notes`: low-confidence extraction fields, `attention` items, out-of-scope stops, and printed values whose row label wasn't found (Schedule 1 "top", Schedule EIC line 6, whose labels sit elsewhere on the form).

## When to run what (proposal)

| When                      | Run                                                           | How                                                                                                        |
| ------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Every PR                  | `pnpm test`, `test:pack` (today) **+ layer 2 `--server=src`** | Add `pnpm --filter 1040kit test:journey` to `ci.yml` once the open journey failures are fixed (it exits 1) |
| After `npm publish`       | layer 1 and layer 2 `--server=npm@<version>`                  | A job after publish in `release.yml`, or by hand (releasing.md step 4)                                     |
| Before a release          | layer 3 on the representative three, `--server=dist`          | By hand, signed in; read any failing `conversation.md`                                                     |
| Weekly, or skill changes  | layer 3 `--all`                                               | A scheduled workflow with a `CLAUDE_CODE_OAUTH_TOKEN` secret and `--budget`                                |
| Before a major UI release | a person, in Claude Desktop                                   | The question card (MCP Apps) only renders in a desktop host; `widget:harness` covers it in a browser       |

A new golden return joins all three layers automatically. When the interview gains a question the goldens can't answer, add it to the goldens, or to `DEFAULTS` if the answer doesn't change the numbers.
