# Security policy

1040kit handles tax documents on your computer, so security reports matter to us.

## Reporting a vulnerability

Please don't open a public issue. Report it privately through GitHub instead: on this repo's **Security** tab, choose **Report a vulnerability**. You'll get a reply within a few days, and we'll keep you updated until it's fixed.

Never include real tax documents, SSNs or other personal data in a report. Synthetic examples are enough.

## Supported versions

Only the latest release of the `1040kit` npm package and the `main` branch get security fixes.

## Scope

In scope: the tax engine, the `1040kit` MCP server (including how it stores workspaces, keys and documents on disk), the widget, and the plugins and skills in this repo.

Out of scope: the AI assistants themselves (Claude, ChatGPT, Codex) and how they handle what you type into the chat.
