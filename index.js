import { spawn } from "node:child_process";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "vibe", version: "0.2.1" },
  { capabilities: { tools: {} } }
);

const TOOL_RUN = "vibe_run";
const TOOL_RESUME = "vibe_resume";
const TOOL_MANAGE = "vibe_manage";

const statePath =
  process.env.VIBE_MCP_STATE ||
  path.join(os.homedir(), ".local/share/mcp-servers/vibe-mcp/state.json");

const sessionDir = path.join(os.homedir(), ".vibe/logs/session");
const homeLocalBin = path.join(os.homedir(), ".local/bin");
const homeCargoBin = path.join(os.homedir(), ".cargo/bin");

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: TOOL_RUN,
      description:
        "Run Vibe CLI in programmatic mode and store the session ID per project.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "User instruction to pass to Vibe.",
          },
          project_dir: {
            type: "string",
            description: "Working directory for the Vibe run (defaults to current).",
          },
          stdin: {
            type: "string",
            description: "Optional stdin content to pipe into Vibe.",
          },
          max_turns: {
            type: "number",
            description: "Maximum number of assistant turns (programmatic mode).",
          },
          max_price: {
            type: "number",
            description: "Maximum cost in dollars (programmatic mode).",
          },
          plan: {
            type: "boolean",
            description: "Enable plan mode (read-only tools).",
          },
          enabled_tools: {
            type: "array",
            items: { type: "string" },
            description:
              "Restrict enabled tools in programmatic mode (glob/regex supported).",
          },
          agent: {
            type: "string",
            description: "Agent configuration name from ~/.vibe/agents/NAME.toml.",
          },
          vibe_bin: {
            type: "string",
            description: "Override Vibe binary path (default: vibe).",
          },
          auto_install: {
            type: "boolean",
            description:
              "If true and Vibe binary is missing, try to install automatically.",
          },
          auto_update: {
            type: "boolean",
            description:
              "If true, run Vibe update flow before execution (best effort).",
          },
          install_method: {
            type: "string",
            enum: ["auto", "uv"],
            description:
              "Installation strategy when auto_install is enabled (default: auto; uv-only).",
          },
        },
        required: ["prompt"],
      },
    },
    {
      name: TOOL_RESUME,
      description:
        "Resume a project session using the last stored Vibe session ID.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "User instruction to pass to Vibe.",
          },
          project_dir: {
            type: "string",
            description: "Working directory for the Vibe run (defaults to current).",
          },
          session_id: {
            type: "string",
            description: "Override session ID to resume.",
          },
          stdin: {
            type: "string",
            description: "Optional stdin content to pipe into Vibe.",
          },
          max_turns: {
            type: "number",
            description: "Maximum number of assistant turns (programmatic mode).",
          },
          max_price: {
            type: "number",
            description: "Maximum cost in dollars (programmatic mode).",
          },
          plan: {
            type: "boolean",
            description: "Enable plan mode (read-only tools).",
          },
          enabled_tools: {
            type: "array",
            items: { type: "string" },
            description:
              "Restrict enabled tools in programmatic mode (glob/regex supported).",
          },
          agent: {
            type: "string",
            description: "Agent configuration name from ~/.vibe/agents/NAME.toml.",
          },
          vibe_bin: {
            type: "string",
            description: "Override Vibe binary path (default: vibe).",
          },
          auto_install: {
            type: "boolean",
            description:
              "If true and Vibe binary is missing, try to install automatically.",
          },
          auto_update: {
            type: "boolean",
            description:
              "If true, run Vibe update flow before execution (best effort).",
          },
          install_method: {
            type: "string",
            enum: ["auto", "uv"],
            description:
              "Installation strategy when auto_install is enabled (default: auto; uv-only).",
          },
        },
        required: ["prompt"],
      },
    },
    {
      name: TOOL_MANAGE,
      description:
        "Manage Vibe runtime: status/install/update with auto-detection.",
      inputSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["status", "install", "update"],
            description: "Operation to perform.",
          },
          install_method: {
            type: "string",
            enum: ["auto", "uv"],
            description: "Install/update strategy (default: auto; uv-only).",
          },
          vibe_bin: {
            type: "string",
            description: "Override Vibe binary path for status checks.",
          },
        },
        required: ["action"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (
    request.params.name !== TOOL_RUN &&
    request.params.name !== TOOL_RESUME &&
    request.params.name !== TOOL_MANAGE
  ) {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const {
    action,
    prompt,
    project_dir,
    session_id,
    stdin,
    max_turns = 1,
    max_price = 0,
    plan = false,
    enabled_tools,
    agent,
    vibe_bin,
    auto_install = false,
    auto_update = false,
    install_method = "auto",
  } = request.params.arguments ?? {};

  if (request.params.name === TOOL_MANAGE) {
    const manageResult = await runManageAction({
      action,
      installMethod: install_method,
      vibeBin: vibe_bin,
    });
    return {
      content: [{ type: "text", text: manageResult }],
    };
  }

  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    throw new Error("prompt is required and must be a non-empty string");
  }

  const projectDir = project_dir || process.cwd();
  const projectKey = resolveProjectKey(projectDir);
  const state = loadState();

  const args = ["-p", prompt, "--output", "json", "--max-turns", String(max_turns)];
  args.push("--max-price", String(max_price));

  if (plan) {
    args.push("--plan");
  }

  if (Array.isArray(enabled_tools)) {
    for (const tool of enabled_tools) {
      args.push("--enabled-tools", String(tool));
    }
  }

  if (agent) {
    args.push("--agent", agent);
  }

  if (request.params.name === TOOL_RESUME) {
    const storedSession = session_id || state.projects[projectKey]?.session_id;
    if (!storedSession) {
      return {
        content: [
          {
            type: "text",
            text: "error: no stored session for this project; run vibe_run first or pass session_id",
          },
        ],
      };
    }
    args.unshift("--resume", storedSession);
  }

  const env = {
    ...process.env,
    PATH: `${homeLocalBin}:${homeCargoBin}:${process.env.PATH || ""}`,
    NO_COLOR: "1",
    TERM: "dumb",
    FORCE_COLOR: "0",
  };

  if (auto_update || process.env.VIBE_MCP_AUTO_UPDATE === "true") {
    await ensureVibeAvailable({
      preferredBin: vibe_bin || process.env.VIBE_BIN || "vibe",
      installMethod: install_method,
      allowInstall: false,
      allowUpdate: true,
      cwd: projectDir,
      env,
    });
  }

  const resolvedVibeBin = await ensureVibeAvailable({
    preferredBin: vibe_bin || process.env.VIBE_BIN || "vibe",
    installMethod: install_method,
    allowInstall: Boolean(auto_install),
    allowUpdate: false,
    cwd: projectDir,
    env,
  });

  const startMs = Date.now();
  const beforeFiles = listSessionFiles();

  const result = await runCommand({
    command: resolvedVibeBin,
    args,
    cwd: projectDir,
    stdin,
    timeoutMs: 120 * 1000,
    env,
  });

  const parsed = parseJsonOutput(result.stdout);
  const costInfo = computeMonthlyCost();
  const text = formatResult(result, parsed.text, costInfo);

  const sessionId = findSessionId({
    beforeFiles,
    startMs,
    projectDir,
  });

  if (sessionId) {
    state.projects[projectKey] = {
      session_id: sessionId,
      updated_at: new Date().toISOString(),
    };
    saveState(state);
  }

  return {
    content: [{ type: "text", text }],
  };
});

function resolveProjectKey(projectDir) {
  try {
    return fs.realpathSync(projectDir);
  } catch {
    return projectDir;
  }
}

function loadState() {
  try {
    const raw = fs.readFileSync(statePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return { projects: {} };
    }
    if (!parsed.projects || typeof parsed.projects !== "object") {
      parsed.projects = {};
    }
    return parsed;
  } catch {
    return { projects: {} };
  }
}

function saveState(state) {
  const dir = path.dirname(statePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function listSessionFiles() {
  try {
    return fs.readdirSync(sessionDir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => path.join(sessionDir, name));
  } catch {
    return [];
  }
}

function findSessionId({ beforeFiles, startMs, projectDir }) {
  const afterFiles = listSessionFiles();
  const newFiles = afterFiles.filter((file) => !beforeFiles.includes(file));

  const candidates = newFiles.length > 0 ? newFiles : afterFiles;

  const scored = candidates
    .map((file) => {
      try {
        const stat = fs.statSync(file);
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        const meta = data.metadata || {};
        const workingDir = meta.environment?.working_directory;
        const matchesDir = workingDir ? resolveProjectKey(workingDir) === resolveProjectKey(projectDir) : false;
        const recent = stat.mtimeMs >= startMs - 2000;
        return { file, stat, meta, matchesDir, recent };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

  const best =
    scored.find((item) => item.matchesDir && item.recent) ||
    scored.find((item) => item.matchesDir) ||
    scored[0];

  if (!best) return null;

  return typeof best.meta.session_id === "string" ? best.meta.session_id : null;
}

function parseJsonOutput(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return { text: "" };
  try {
    const data = JSON.parse(trimmed);
    if (Array.isArray(data)) {
      const assistant = [...data].reverse().find((msg) => msg?.role === "assistant");
      if (assistant && typeof assistant.content === "string") {
        return { text: assistant.content.trim() };
      }
    }
  } catch {
    // fall through
  }
  return { text: trimmed };
}

function formatResult(result, parsedText, costInfo) {
  const { code, stdout, stderr, timedOut } = result;
  const out = (parsedText || "").trim();
  const err = stderr.trim();
  const costLine = formatCostLine(costInfo);

  if (timedOut) {
    return `error: Vibe timed out\n${err || stdout.trim() || out}\n${costLine}`.trim();
  }

  if (code === 0) {
    if (out.length > 0) return `${out}\n${costLine}`.trim();
    if (err.length > 0) return `${err}\n${costLine}`.trim();
    return `ok: Vibe completed with no output\n${costLine}`.trim();
  }

  return `error: Vibe exited with code ${code}\n${err || stdout.trim() || out}\n${costLine}`.trim();
}

function runCommand({ command, args, cwd, stdin, timeoutMs, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: "pipe",
    });

    let stdout = "";
    let stderr = "";
    let finished = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });

    if (stdin && stdin.length > 0) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
}

function which(bin, env = process.env) {
  const candidate = bin && String(bin).trim();
  if (!candidate) return null;
  if (candidate.includes("/") && fs.existsSync(candidate)) {
    return candidate;
  }
  const r = spawnSync("bash", ["-lc", `command -v ${shellEscape(candidate)}`], {
    env: {
      ...env,
      PATH: `${homeLocalBin}:${homeCargoBin}:${env.PATH || ""}`,
    },
    encoding: "utf8",
  });
  if (r.status === 0) {
    return r.stdout.trim() || null;
  }
  return null;
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function pickVibeBinary(preferredBin, env = process.env) {
  return (
    which(preferredBin, env) ||
    which(process.env.VIBE_BIN, env) ||
    which("vibe", env) ||
    which("mistral-vibe", env)
  );
}

async function runShellScript({ script, cwd, env, timeoutMs = 240_000 }) {
  return runCommand({
    command: "bash",
    args: ["-lc", script],
    cwd,
    stdin: "",
    timeoutMs,
    env,
  });
}

async function installVibe({ installMethod, cwd, env }) {
  const method = (installMethod || "auto").toLowerCase();
  const attempts = method === "auto" ? ["uv"] : [method];
  const errors = [];

  for (const m of attempts) {
    if (m === "uv") {
      const uvReady = await ensureUvInstalled({ cwd, env });
      if (!uvReady) {
        errors.push("uv not found and auto-bootstrap failed");
        continue;
      }
      const uvCmds = [
        "uv tool install mistral-vibe",
        "uv tool install --upgrade mistral-vibe",
      ];
      let ok = false;
      for (const cmd of uvCmds) {
        const r = await runShellScript({ script: cmd, cwd, env });
        if (r.code === 0) {
          ok = true;
          break;
        }
        errors.push(`uv failed: ${r.stderr || r.stdout}`.trim());
      }
      if (ok) return;
      continue;
    }

    errors.push(`unsupported install method: ${m}`);
  }

  throw new Error(`Vibe install failed. ${errors.join(" | ")}`.trim());
}

async function updateVibe({ installMethod, cwd, env }) {
  // Vibe doesn't expose an official "vibe update" subcommand in current CLI.
  // Re-running uv tool install/upgrade is the safest universal update path.
  await installVibe({ installMethod, cwd, env });
}

async function ensureUvInstalled({ cwd, env }) {
  if (which("uv", env)) {
    return true;
  }
  if (!which("curl", env)) {
    return false;
  }

  const r = await runShellScript({
    script: "curl -LsSf https://astral.sh/uv/install.sh | sh",
    cwd,
    env,
  });

  if (r.code !== 0) {
    return false;
  }

  return Boolean(which("uv", env));
}

async function ensureVibeAvailable({
  preferredBin,
  installMethod,
  allowInstall,
  allowUpdate,
  cwd,
  env,
}) {
  let resolved = pickVibeBinary(preferredBin, env);
  if (allowUpdate) {
    await updateVibe({ installMethod, cwd, env });
    resolved = pickVibeBinary(preferredBin, env);
  }

  if (!resolved && allowInstall) {
    await installVibe({ installMethod, cwd, env });
    resolved = pickVibeBinary(preferredBin, env);
  }

  if (!resolved) {
    throw new Error(
      [
        "Vibe binary not found.",
        "Install options:",
        "1) curl -LsSf https://astral.sh/uv/install.sh | sh",
        "2) uv tool install --upgrade mistral-vibe",
        "Or pass vibe_bin explicitly.",
      ].join(" ")
    );
  }

  return resolved;
}

async function runManageAction({ action, installMethod, vibeBin }) {
  const env = {
    ...process.env,
    PATH: `${homeLocalBin}:${homeCargoBin}:${process.env.PATH || ""}`,
  };
  const cwd = process.cwd();
  const act = String(action || "").toLowerCase();
  if (!["status", "install", "update"].includes(act)) {
    throw new Error("action must be one of: status, install, update");
  }

  if (act === "install") {
    await installVibe({ installMethod, cwd, env });
  } else if (act === "update") {
    await updateVibe({ installMethod, cwd, env });
  }

  const resolved = pickVibeBinary(vibeBin || process.env.VIBE_BIN || "vibe", env);
  if (!resolved) {
    return "vibe status: missing";
  }

  const versionResult = await runCommand({
    command: resolved,
    args: ["--version"],
    cwd,
    stdin: "",
    timeoutMs: 30_000,
    env,
  });
  const versionText = (versionResult.stdout || versionResult.stderr || "").trim();
  return `vibe status: ok\nbinary: ${resolved}\nversion: ${versionText || "unknown"}`;
}

function computeMonthlyCost() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  let total = 0;

  let latestCost = null;
  let latestTime = 0;

  for (const file of listSessionFiles()) {
    try {
      const raw = fs.readFileSync(file, "utf8");
      const data = JSON.parse(raw);
      const meta = data.metadata || {};
      const cost = Number(meta.stats?.session_cost || 0);
      const start = meta.start_time ? new Date(meta.start_time) : null;
      if (!start || Number.isNaN(start.getTime())) {
        continue;
      }
      if (start.getUTCFullYear() === year && start.getUTCMonth() === month) {
        total += cost;
      }

      if (start.getTime() > latestTime) {
        latestTime = start.getTime();
        latestCost = cost;
      }
    } catch {
      // ignore malformed log entries
    }
  }

  return {
    monthlyTotal: total,
    lastTaskCost: latestCost,
  };
}

function formatCostLine(costInfo) {
  if (!costInfo) return "";
  const total = costInfo.monthlyTotal.toFixed(4);
  const last = costInfo.lastTaskCost != null ? costInfo.lastTaskCost.toFixed(4) : "n/a";
  return `Cost: ${last} EUR | Month: ${total} EUR`;
}

const transport = new StdioServerTransport();
await server.connect(transport);
