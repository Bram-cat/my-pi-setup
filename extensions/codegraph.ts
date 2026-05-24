import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PACKAGE_NAME = "@colbymchenry/codegraph";
const ALLOWED_COMMANDS = new Set([
  "init",
  "uninit",
  "index",
  "sync",
  "status",
  "query",
  "files",
  "context",
  "visualize",
  "mark-dirty",
  "sync-if-dirty",
  "unlock",
  "affected",
]);

const codegraphParams = Type.Object({
  command: Type.String({
    description:
      "CodeGraph command to run: init, index, sync, status, query, files, context, affected, visualize, etc.",
  }),
  args: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Extra arguments/options after the command. Example: ['authentication flow'] for query, or ['--format','json'] if supported.",
    }),
  ),
  path: Type.Optional(
    Type.String({
      description:
        "Working directory to run CodeGraph from. Defaults to pi's current working directory.",
    }),
  ),
});

function truncateOutput(text: string, max = 24000) {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[truncated ${text.length - max} chars]`;
}

async function runCodegraph(command: string, args: string[], cwd: string) {
  if (!ALLOWED_COMMANDS.has(command)) {
    throw new Error(
      `Unsupported CodeGraph command: ${command}. Allowed: ${Array.from(ALLOWED_COMMANDS).join(", ")}`,
    );
  }

  const result = await execFileAsync("npx", ["-y", PACKAGE_NAME, command, ...args], {
    cwd,
    timeout: 120_000,
    maxBuffer: 1024 * 1024 * 8,
    env: process.env,
  });

  return {
    stdout: truncateOutput(result.stdout ?? ""),
    stderr: truncateOutput(result.stderr ?? ""),
  };
}

export default function codegraphExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "codegraph",
    label: "CodeGraph",
    description:
      "Run @colbymchenry/codegraph commands for codebase indexing, status, symbol search, file graph, and task context.",
    promptSnippet:
      "Run CodeGraph CLI commands such as init, index, sync, status, query, files, context, and affected",
    promptGuidelines: [
      "Use codegraph when the user asks to inspect, index, search, or build task context with @colbymchenry/codegraph.",
      "Use codegraph status before assuming a project has a CodeGraph index.",
    ],
    parameters: codegraphParams,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const command = params.command.trim();
      const args = params.args ?? [];
      const cwd = params.path?.trim() || ctx.cwd;

      onUpdate?.({
        content: [{ type: "text", text: `Running: npx -y ${PACKAGE_NAME} ${command} ${args.join(" ")}` }],
      });

      try {
        if (signal?.aborted) throw new Error("CodeGraph command aborted before start");
        const output = await runCodegraph(command, args, cwd);
        const text = [output.stdout, output.stderr && `stderr:\n${output.stderr}`]
          .filter(Boolean)
          .join("\n");

        return {
          content: [{ type: "text", text: text || "CodeGraph command completed with no output." }],
          details: { package: PACKAGE_NAME, command, args, cwd, ...output },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `CodeGraph failed: ${message}` }],
          details: { package: PACKAGE_NAME, command, args, cwd, error: message },
          isError: true,
        };
      }
    },
  });

  pi.registerCommand("codegraph", {
    description:
      "Run CodeGraph CLI. Examples: /codegraph status, /codegraph init ., /codegraph query auth flow",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      if (parts.length === 0) {
        ctx.ui.notify("Usage: /codegraph <command> [...args]", "warning");
        return;
      }

      const [command, ...rest] = parts;
      try {
        ctx.ui.setStatus("codegraph", `codegraph ${command}...`);
        const output = await runCodegraph(command, rest, ctx.cwd);
        const text = [output.stdout, output.stderr && `stderr:\n${output.stderr}`]
          .filter(Boolean)
          .join("\n") || "CodeGraph command completed with no output.";
        ctx.ui.notify(text, "info");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`CodeGraph failed: ${message}`, "error");
      } finally {
        ctx.ui.setStatus("codegraph", "");
      }
    },
  });

  pi.on("session_start", (event, ctx) => {
    if (event.reason === "startup" || event.reason === "reload") {
      ctx.ui.notify("CodeGraph extension loaded. Use tool codegraph or /codegraph.", "info");
    }
  });
}
