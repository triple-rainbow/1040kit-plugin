# 1040kit — Agent Instructions

Public repo: the tax engine, the MCP server (npm `1040kit`) and the assistant plugins. The website and the IRS knowledge-base pipeline live in a separate private repo.

## Layout

- `packages/engine` (`@1040kit/engine`, private, inlined into the npm bundle): pure, deterministic, zero dependencies. Per-year parameters in `src/params/`, forms in `src/forms/`, rules in `src/rules/`. Every value is a traced node with an IRS citation; form line numbers come from `formLines` / `lineAliases`.
- `packages/mcp` (`1040kit`): stdio MCP server. Tools in `src/tools/`, storage behind `openStore`, PDF filling in `src/output/` (IRS PDFs and field maps in `assets/`, resolved from the package root), MCP Apps widgets in `src/ui/`. Published as one esbuild bundle, `dist/bin.js`; see `docs/releasing.md`.
- `plugins/claude-code`, `plugins/codex`: skills (Codex skills are symlinks to the Claude Code ones). `plugins/scripts/check-skills.ts` checks that skills only name real tools, in playbook order.
- `plugins/dev/1040kit-dev.sh`: runs the server from source with a sandbox in `.dev/`.

## Commands

- `pnpm test` — engine, MCP and skill-linter tests
- `pnpm typecheck`
- `pnpm --filter 1040kit widget:harness` — build the widget test host
- `pnpm --filter 1040kit test:pack` — pack the npm package, install it outside the workspace and drive the installed bin (needs the network)
- `pnpm test:install`, `pnpm --filter 1040kit test:journey`, `pnpm --filter 1040kit test:journey:assistant` — end-to-end: install the plugin, run every golden return through the tools, and a real conversation with a simulated taxpayer (needs a signed-in Claude Code; costs model usage). See `docs/e2e-testing.md`

## Rules

- Never do tax arithmetic outside the engine. Change a number by changing a parameter or a node, with its citation, and a test.
- Tests use synthetic people only (no real names, SSNs, EINs or addresses). `packages/engine/test/private/` is for the owner's real returns and is gitignored.
- 1040kit never stores SSNs, ITINs or bank account numbers.
- The widget page loads nothing from the network and writes text with `textContent`, never `innerHTML`.
- License: AGPL-3.0-only. Don't copy in code under an incompatible license.
