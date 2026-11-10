@AGENTS.md

## Testing plan

Pick the checks by what you changed, cheapest first. Details: `docs/e2e-testing.md`.

- **Any change:** `pnpm format:check`, `pnpm typecheck`, `pnpm test`. A change to the engine, the interview, the forms or the field maps also runs the tool journey: `pnpm --filter 1040kit test:journey`. Every case must pass or be `blocked` (out of scope). For any `fail`, fix it or say why. Read the `volunteered` and `defaulted` lists for questions the interview misses or goldens that lack an answer.
- **New tax behavior:** add or extend a golden return in `packages/engine/test/golden/`, worked by hand from the IRS form or publication. It joins the engine tests and both journeys automatically.
- **Skills, tool descriptions or tool results the assistant reads:** run the assistant journey, `pnpm --filter 1040kit test:journey:assistant` (three representative returns; `--all` for every golden). It needs a signed-in Claude Code and costs model usage, so ask before an `--all` run. When a case fails here but passes the tool journey, read that case's `conversation.md`.
- **After an npm release:** `pnpm test:install -- triple-rainbow/1040kit-plugin <version>` and `pnpm --filter 1040kit test:journey -- --server=npm@<version>`.
- Report the results as counts (pass, blocked, fail) with each failure. Never call a journey passed from a partial run.
