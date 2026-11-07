# 1040kit

Free AI tax software that runs on your computer. Your AI assistant (Claude Code, Codex, and soon Claude Desktop and ChatGPT) prepares your US federal return with 1040kit: W-2 and 1099 income, filed by printing and mailing it or by entering it in IRS Free File Fillable Forms. Your documents and your return never leave your computer.

1040kit is not tax advice. You review and sign your own return.

To install it, see [`docs/install.md`](docs/install.md). What it computes, flags or doesn't handle yet: [`docs/coverage.md`](docs/coverage.md). Website: https://1040kit.com

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

Requires Node.js 20+ and pnpm.

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

Note: `1040kit@0.0.1` on npm today is a placeholder (README only, no server), so the `npx` install commands don't work yet.

## License

[AGPL-3.0](LICENSE). Copyright (C) 2026 Triple Rainbow.
