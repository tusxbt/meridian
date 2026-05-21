import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..", "..");
const CLI_PATH = path.join(PROJECT_ROOT, "cli.js");

const CLI_COMMANDS = new Set([
  "balance", "positions", "pnl", "candidates", "deploy", "close",
  "claim", "swap", "screen", "manage", "config",
]);

function parseCommand(text) {
  const parts = text.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase();
  if (CLI_COMMANDS.has(cmd)) {
    return { type: "cli", command: cmd, args: parts.slice(1) };
  }
  return { type: "agent", goal: text };
}

export function handleTerminalMessage(ws, msg, wsManager) {
  if (msg.type === "command") {
    const parsed = parseCommand(msg.payload.text);
    if (parsed.type === "cli") {
      runCliCommand(ws, parsed.command, parsed.args, wsManager);
    } else {
      runAgentCommand(ws, parsed.goal, wsManager);
    }
  }
}

function runCliCommand(ws, command, args, wsManager) {
  wsManager.send(ws, "command_output", {
    text: `> meridian ${command} ${args.join(" ")}\n`,
    done: false,
  });

  const child = spawn("node", [CLI_PATH, command, ...args], {
    cwd: PROJECT_ROOT,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";

  child.stdout.on("data", (data) => {
    const text = data.toString();
    output += text;
    wsManager.send(ws, "command_output", { text, done: false });
  });

  child.stderr.on("data", (data) => {
    const text = data.toString();
    output += text;
    wsManager.send(ws, "command_output", { text: `[stderr] ${text}`, done: false });
  });

  child.on("close", (code) => {
    wsManager.send(ws, "command_output", {
      text: `\n[exit code: ${code}]\n`,
      done: true,
    });
  });

  child.on("error", (err) => {
    wsManager.send(ws, "command_output", {
      text: `[error] ${err.message}\n`,
      done: true,
    });
  });
}

async function runAgentCommand(ws, goal, wsManager) {
  wsManager.send(ws, "command_output", {
    text: `> [agent] ${goal}\n`,
    done: false,
  });

  try {
    const { agentLoop } = await import("../../agent.js");
    const result = await agentLoop(goal, 10, [], "GENERAL", null, null, {
      onToolStart: (name, args) => {
        wsManager.send(ws, "tool_start", { name, args });
        wsManager.send(ws, "command_output", {
          text: `  [tool] ${name}...\n`,
          done: false,
        });
      },
      onToolFinish: (name, result) => {
        const success = !result?.error;
        wsManager.send(ws, "tool_finish", { name, success });
      },
    });

    wsManager.send(ws, "agent_response", { content: result.content, done: true });
    wsManager.send(ws, "command_output", {
      text: `\n${result.content}\n`,
      done: true,
    });
  } catch (err) {
    wsManager.send(ws, "command_output", {
      text: `[agent error] ${err.message}\n`,
      done: true,
    });
  }
}
