# 1040kit

Free AI tax software that runs on your computer. This package is the 1040kit MCP server: your AI assistant (Claude Code or Codex) uses it to prepare your US federal income tax return (Form 1040) from your W-2s and 1099s, then fills the official IRS PDFs for you to print and mail, or gives you a sheet to type into IRS Free File Fillable Forms.

Your documents and your return stay on your computer. Documents are read locally (scans and photos with local OCR), and the return is stored encrypted in a folder on your machine.

**1040kit is not tax advice.** You are the preparer: you review and sign your own return.

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

## Links

- Website: https://1040kit.com
- What it handles and what it doesn't: [docs/coverage.md](https://github.com/triple-rainbow/1040kit-plugin/blob/main/docs/coverage.md)
- Source and issues: https://github.com/triple-rainbow/1040kit-plugin

## License

AGPL-3.0-only. See [LICENSE](LICENSE).
