# vibe-mcp

[![ci](https://github.com/DarkPhilosophy/vibe-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/DarkPhilosophy/vibe-mcp/actions/workflows/ci.yml)

Run the Mistral Vibe CLI as an MCP subagent from Codex. This server wraps Vibe programmatic mode (`-p`) and exposes:

- `vibe_run`: run a new Vibe task
- `vibe_resume`: resume a project using the last session ID

## Requirements

- Node.js 18+
- Vibe CLI

Install Vibe:

```bash
curl -LsSf https://mistral.ai/vibe/install.sh | bash
```

## Install

### Official install (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/DarkPhilosophy/vibe-mcp/main/install.sh | bash
```

This will:
- clone/update to `~/.local/share/mcp-servers/vibe-mcp`
- auto-detect and update Codex / Amp / OpenCode configs (no duplicate entries)

### Manual install (clone + configure yourself)

Clone to the standard MCP location:

```bash
git clone https://github.com/DarkPhilosophy/vibe-mcp.git "$HOME/.local/share/mcp-servers/vibe-mcp"
```

If you cloned elsewhere, running `./install.sh` will move it into the standard location **and** update Codex / Amp / OpenCode configs.
If detection fails, see **Configuration** below.

## Configuration

### Codex (`~/.codex/config.toml`)

```toml
[mcp_servers.vibe]
command = "node"
args = ["$HOME/.local/share/mcp-servers/vibe-mcp/index.js"]
startup_timeout_sec = 30.0
```

Restart Codex after changes.

### Amp (`~/.config/amp/settings.json`)

```json
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
```

### OpenCode (`~/.config/opencode/opencode.json`)

```json
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
```

## Usage

Example tool call payload:

```json
{
  "prompt": "Summarize this repo in 3 bullets.",
  "project_dir": "$HOME/Projects/cpufetch",
  "max_turns": 8,
  "max_price": 1
}
```

Resume a task later:

```json
{
  "prompt": "Continue from earlier and list next steps.",
  "project_dir": "$HOME/Projects/cpufetch",
  "max_turns": 5,
  "max_price": 1
}
```

## Session persistence

- Session IDs are stored per project path in:
  `~/.local/share/mcp-servers/vibe-mcp/state.json`
- `vibe_resume` uses the last stored session ID for that project.

## Cost summary

Each response includes a cost line based on Vibe logs in:
`~/.vibe/logs/session/*.json` and `metadata.stats.session_cost`.

Example output:

```
Cost: 0.0022 EUR | Month: 0.0765 EUR
```

## Configuration

Optional env vars:

- `VIBE_BIN`: override the Vibe binary path
- `VIBE_MCP_STATE`: override the state file path

## Roadmap ideas

- Optional transcript return for deeper debugging
- Smarter session selection when multiple runs happen in parallel
- Safer defaults for `max_turns` and `max_price`

## License

GNU General Public License v3.0
