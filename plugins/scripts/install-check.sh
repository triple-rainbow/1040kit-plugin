#!/usr/bin/env bash
# Install check (layer 1 in docs/e2e-testing.md): install the Claude Code
# plugin the way a user does, into a throwaway Claude config, and check what
# arrived: the version, both skills, the MCP server entry, and that Claude
# Code connects to the server. Then one golden return through that npm
# version (the tool journey), so the server users get is the one checked.
#
#   plugins/scripts/install-check.sh                 # from GitHub, version on main
#   plugins/scripts/install-check.sh . 0.1.3         # this checkout as the marketplace
#   plugins/scripts/install-check.sh triple-rainbow/1040kit-plugin 0.1.2
#
# Needs the claude CLI and the network (npx). No sign-in: nothing here calls
# a model. The user's own Claude config is not touched.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
source="${1:-triple-rainbow/1040kit-plugin}"
[ "$source" = "." ] && source="$root"
want="${2:-$(node -p "require('$root/plugins/claude-code/.claude-plugin/plugin.json').version")}"

tmp="$(mktemp -d "${TMPDIR:-/tmp}/1040kit-install-XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
export CLAUDE_CONFIG_DIR="$tmp/config"
mkdir -p "$tmp/project"
cd "$tmp/project"

fail() { echo "✗ $*" >&2; exit 1; }
ok() { echo "✓ $*"; }

claude plugin marketplace add "$source" >/dev/null || fail "marketplace add $source"
ok "marketplace added: $source"
claude plugin install 1040kit@1040kit >/dev/null || fail "plugin install"
claude plugin list | grep -q "Version: $want" ||
  fail "installed version is not $want: $(claude plugin list | grep Version)"
ok "plugin 1040kit@1040kit $want installed"

plugin="$CLAUDE_CONFIG_DIR/plugins/cache/1040kit/1040kit/$want"
for skill in do-my-taxes explain-my-return; do
  [ -f "$plugin/skills/$skill/SKILL.md" ] || fail "skill $skill missing"
done
ok "skills: do-my-taxes, explain-my-return"
grep -q '"npx"' "$plugin/.mcp.json" && grep -q '"1040kit"' "$plugin/.mcp.json" ||
  fail ".mcp.json does not start npx 1040kit: $(cat "$plugin/.mcp.json")"
ok ".mcp.json runs npx -y 1040kit"

claude mcp list 2>&1 | grep -q 'plugin:1040kit:1040kit.*Connected' ||
  fail "Claude Code can't connect to the server: $(claude mcp list 2>&1 | tail -3)"
ok "Claude Code connects to the 1040kit server"

cd "$root"
node --import tsx packages/mcp/test/journey/tools.ts --server="npm@$want" w2-single-simple ||
  fail "a golden return through npm 1040kit@$want failed"
ok "1040kit@$want from npm prepares a golden return"
