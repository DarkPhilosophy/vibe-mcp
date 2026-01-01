#!/usr/bin/env bash
set -euo pipefail

repo_url="https://github.com/DarkPhilosophy/vibe-mcp.git"
install_root="$HOME/.local/share/mcp-servers"
repo_dir="$install_root/vibe-mcp"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script_path="$script_dir/install.sh"

usage() {
  cat <<'USAGE'
Usage: install.sh [--print-only]

Installs or updates the Vibe MCP entry in Codex config and prints snippets for other agents.
If this script is run outside the repo, it will move (or clone) into:
  ~/.local/share/mcp-servers/vibe-mcp
USAGE
}

print_only="false"
if [[ ${1:-} == "--help" || ${1:-} == "-h" ]]; then
  usage
  exit 0
fi
if [[ ${1:-} == "--print-only" ]]; then
  print_only="true"
fi

if [[ "$script_dir" != "$repo_dir" ]]; then
  mkdir -p "$install_root"

  if [[ -d "$repo_dir" ]]; then
    :
  elif [[ -d "$script_dir/.git" ]]; then
    mv "$script_dir" "$repo_dir"
  else
    git clone "$repo_url" "$repo_dir"
  fi

  exec "$repo_dir/install.sh" "$@"
fi

server_path="$repo_dir/index.js"

codex_config="$HOME/.codex/config.toml"
amp_settings="$HOME/.config/amp/settings.json"
opencode_config="$HOME/.config/opencode/opencode.json"

snippet_codex=$(cat <<EOF_SNIP
[mcp_servers.vibe]
command = "node"
args = ["$HOME/.local/share/mcp-servers/vibe-mcp/index.js"]
startup_timeout_sec = 30.0
EOF_SNIP
)

snippet_amp=$(cat <<EOF_SNIP
{
  "amp.mcpServers": {
    "vibe": {
      "command": "node",
      "args": [
        "$HOME/.local/share/mcp-servers/vibe-mcp/index.js"
      ]
    }
  }
}
EOF_SNIP
)

snippet_opencode=$(cat <<EOF_SNIP
{
  "mcp": {
    "vibe": {
      "type": "local",
      "command": [
        "node",
        "$HOME/.local/share/mcp-servers/vibe-mcp/index.js"
      ],
      "enabled": true
    }
  }
}
EOF_SNIP
)

if [[ "$print_only" == "true" ]]; then
  echo "Codex snippet:"
  echo "$snippet_codex"
  echo
  echo "Amp snippet:"
  echo "$snippet_amp"
  echo
  echo "OpenCode snippet:"
  echo "$snippet_opencode"
  exit 0
fi

if [[ -f "$codex_config" ]]; then
  backup="$codex_config.backup-$(date +%Y%m%d-%H%M)"
  cp -a "$codex_config" "$backup"

  if grep -q "\[mcp_servers\.vibe\]" "$codex_config"; then
    tmp="$codex_config.tmp"
    awk -v server_path="$server_path" '
      BEGIN {in_block=0}
      /^\[mcp_servers\.vibe\]/ {print; in_block=1; next}
      /^\[/ {if (in_block) in_block=0; print}
      in_block==1 {
        if ($0 ~ /^command =/) {next}
        if ($0 ~ /^args =/) {next}
        if ($0 ~ /^startup_timeout_sec =/) {next}
        next
      }
      {print}
      END {}
    ' "$codex_config" > "$tmp"
    cat >> "$tmp" <<EOF_BLOCK
[mcp_servers.vibe]
command = "node"
args = ["$server_path"]
startup_timeout_sec = 30.0
EOF_BLOCK
    mv "$tmp" "$codex_config"
  else
    printf "\n%s\n" "$snippet_codex" >> "$codex_config"
  fi

  echo "Updated: $codex_config"
  echo "Backup: $backup"
else
  echo "Codex config not found: $codex_config"
  echo "Manual snippet:"
  echo "$snippet_codex"
fi

echo

if [[ -f "$amp_settings" ]]; then
  if ! command -v python3 >/dev/null 2>&1; then
    echo "python3 not found; cannot update $amp_settings"
  else
    backup="$amp_settings.backup-$(date +%Y%m%d-%H%M)"
    cp -a "$amp_settings" "$backup"
    python3 - <<PY
import json
from pathlib import Path

path = Path("$amp_settings")
with path.open("r", encoding="utf-8") as fh:
    data = json.load(fh)

servers = data.setdefault("amp.mcpServers", {})
servers.setdefault("vibe", {"command": "node", "args": ["$HOME/.local/share/mcp-servers/vibe-mcp/index.js"]})

with path.open("w", encoding="utf-8") as fh:
    json.dump(data, fh, indent=2)
    fh.write("\n")
PY
    echo "Updated: $amp_settings"
    echo "Backup: $backup"
  fi
else
  echo "Amp settings not found: $amp_settings"
  echo "Manual snippet:"
  echo "$snippet_amp"
fi

echo

if [[ -f "$opencode_config" ]]; then
  if ! command -v python3 >/dev/null 2>&1; then
    echo "python3 not found; cannot update $opencode_config"
  else
    backup="$opencode_config.backup-$(date +%Y%m%d-%H%M)"
    cp -a "$opencode_config" "$backup"
    python3 - <<PY
import json
from pathlib import Path

path = Path("$opencode_config")
with path.open("r", encoding="utf-8") as fh:
    data = json.load(fh)

mcp = data.setdefault("mcp", {})
mcp.setdefault("vibe", {"type": "local", "command": ["node", "$HOME/.local/share/mcp-servers/vibe-mcp/index.js"], "enabled": True})

with path.open("w", encoding="utf-8") as fh:
    json.dump(data, fh, indent=2)
    fh.write("\n")
PY
    echo "Updated: $opencode_config"
    echo "Backup: $backup"
  fi
else
  echo "OpenCode config not found: $opencode_config"
  echo "Manual snippet:"
  echo "$snippet_opencode"
fi

rm -f "$script_path"
