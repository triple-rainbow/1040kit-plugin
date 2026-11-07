# Install 1040kit

1040kit is free AI tax software. It works inside an AI assistant on your computer (Claude Code or Codex) and prepares your US federal return: W-2 and 1099 income, filed by printing and mailing it or by entering it in IRS Free File Fillable Forms. Your documents and your return never leave your computer.

1040kit is not tax advice. You review and sign your own return.

## What you need

- **Node.js 20 or later.** Check with `node --version`. Get it from https://nodejs.org if needed.
- **Claude Code** or **Codex**, installed and signed in.

The first time your assistant starts 1040kit, `npx` downloads the `1040kit` package from npm. After that, 1040kit works offline, except when the assistant looks up an IRS rule (see "What goes over the network" below).

## Claude Code

In Claude Code, run:

```
/plugin marketplace add triple-rainbow/1040kit-plugin
/plugin install 1040kit@1040kit
```

Or from a terminal:

```
claude plugin marketplace add triple-rainbow/1040kit-plugin
claude plugin install 1040kit@1040kit
```

Restart Claude Code, then say **"do my taxes"**.

The plugin adds the 1040kit tools and two skills: `do-my-taxes` (prepare and file) and `explain-my-return` (ask why any number is what it is).

## Codex

1. Add the 1040kit tools. Either run

   ```
   codex mcp add 1040kit -- npx -y 1040kit
   ```

   or add this to `~/.codex/config.toml`:

   ```toml
   [mcp_servers.1040kit]
   command = "npx"
   args = ["-y", "1040kit"]
   ```

2. Add the skills. Download this repository and copy them (the `-L` matters: it copies the files, not links):

   ```
   git clone https://github.com/triple-rainbow/1040kit-plugin.git
   mkdir -p ~/.codex/skills
   cp -RL 1040kit-plugin/plugins/codex/skills/do-my-taxes 1040kit-plugin/plugins/codex/skills/explain-my-return ~/.codex/skills/
   ```

3. Restart Codex, then say **"do my taxes"**.

If your Codex version doesn't pick up skills on its own, copy `plugins/codex/AGENTS.md.example` into your `~/.codex/AGENTS.md` (or add its text to the existing file).

## Where your files live

| What                                       | Where                                                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Your tax-year workspace                    | `~/Taxes/<year>/` (for example `~/Taxes/2025/`)                                                                    |
| Documents you add                          | `~/Taxes/<year>/inbox/`                                                                                            |
| Your saved return (encrypted)              | `~/Taxes/<year>/.1040kit/return.enc`                                                                               |
| The key that unlocks it                    | `~/.1040kit/keys/` (kept outside the Taxes folder on purpose, so a synced or shared Taxes folder doesn't carry it) |
| Filled forms, filing instructions, summary | `~/Taxes/<year>/outputs/`                                                                                          |

Keep a backup of `~/.1040kit/keys/`: without the key, the saved return can't be opened. The files in `outputs/` are not encrypted (you need to print or upload them) and the filled forms contain your full SSN, so keep them private.

To use different folders, set `KIT1040_HOME` (instead of `~/Taxes`) and `KIT1040_CONFIG_DIR` (instead of `~/.1040kit`) in your environment before starting the assistant.

## What goes over the network

Your documents and your return never leave your computer. When the assistant needs to look up an IRS rule, 1040kit sends only the question text to 1040kit's IRS knowledge base (`https://api.1040kit.com/kb/search`), with SSNs and account numbers removed. 1040kit has no analytics or tracking.

Your conversation with the AI assistant itself (what you type and what the tools show it) is handled under that assistant's own privacy terms.

## Delete everything

1. Remove the plugin or tools:
   - Claude Code: `/plugin uninstall 1040kit@1040kit`
   - Codex: `codex mcp remove 1040kit`, then delete `~/.codex/skills/do-my-taxes` and `~/.codex/skills/explain-my-return`.
2. Delete your tax-year folder(s): `~/Taxes/<year>` (this removes your documents, saved return and filled forms; move out anything you want to keep first).
3. Delete the keys and settings: `~/.1040kit`.
