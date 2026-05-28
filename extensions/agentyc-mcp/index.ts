/**
 * agentyc MCP Bridge Extension
 *
 * Spawns the agentyc MCP server as a child process, discovers all tools
 * via the Model Context Protocol, and registers each one with Pi's tool
 * system so the LLM can call them directly.
 *
 * 66 tools exposed: navigation, interaction, extraction, frames/storage,
 * tabs/session, observability/network, and lifecycle.
 *
 * Usage:
 *   /agentyc          — show connection status and tool count
 *   /agentyc restart  — restart the MCP server
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// ── MCP JSON-RPC client (lightweight, no SDK needed) ──────────────

interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface MCPCallResult {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
}

class MCPStdioClient {
  private proc: ChildProcess | null = null;
  private rl: ReturnType<typeof createInterface> | null = null;
  private reqId = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private buffer = "";
  private _connected = false;

  get connected() {
    return this._connected;
  }

  async start(command: string, args: string[]): Promise<void> {
    this.proc = spawn(command, args, {
      stdio: ["pipe", "pipe", "inherit"],
      env: { ...process.env, AGENTYC_LOGGING_LEVEL: "WARNING" },
    });

    this.rl = createInterface({ input: this.proc.stdout! });
    this.rl.on("line", (line) => this.handleLine(line));
    this.rl.on("close", () => {
      this._connected = false;
      // Reject all pending
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error("MCP server disconnected"));
        this.pending.delete(id);
      }
    });

    this.proc.on("exit", (code) => {
      this._connected = false;
    });

    // Handshake: initialize
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "pi", version: "1.0.0" },
    });

    this._connected = true;
  }

  async listTools(): Promise<MCPTool[]> {
    const result = (await this.request("tools/list", {})) as { tools: MCPTool[] };
    return result.tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<MCPCallResult> {
    const result = (await this.request("tools/call", {
      name,
      arguments: args,
    })) as MCPCallResult;
    return result;
  }

  async stop(): Promise<void> {
    if (this.proc) {
      this.proc.kill("SIGTERM");
      // Wait briefly then SIGKILL
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          this.proc?.kill("SIGKILL");
          resolve();
        }, 2000);
        this.proc?.on("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
      this.proc = null;
      this.rl = null;
    }
    this._connected = false;
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    if (!this.proc || !this.proc.stdin) {
      throw new Error("MCP server not running");
    }

    const id = ++this.reqId;
    const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timed out: ${method}`));
      }, 60000); // 60s timeout for browser operations

      this.pending.set(id, { resolve, reject, timer });

      try {
        this.proc!.stdin!.write(msg);
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }

  private handleLine(line: string) {
    let obj: { id?: number; result?: unknown; error?: { message: string } };
    try {
      obj = JSON.parse(line);
    } catch {
      // Non-JSON output (e.g. log lines before MCP starts)
      return;
    }

    if (obj.id !== undefined && this.pending.has(obj.id)) {
      const p = this.pending.get(obj.id)!;
      clearTimeout(p.timer);
      this.pending.delete(obj.id);

      if (obj.error) {
        p.reject(new Error(obj.error.message));
      } else {
        p.resolve(obj.result);
      }
    }
  }
}



// ── State ─────────────────────────────────────────────────────────

let mcpClient: MCPStdioClient | null = null;
let registeredTools = new Set<string>();

async function connectMCP(ctx: ExtensionContext): Promise<boolean> {
  if (mcpClient?.connected) return true;

  // Find agentyc binary
  const paths = [
    "agentyc",
    join(process.env.HOME || "/home/ram-dev", ".local", "bin", "agentyc"),
    "/usr/local/bin/agentyc",
  ];

  const agentycBin = paths.find((p) => p === "agentyc" || existsSync(p));
  if (!agentycBin) {
    ctx.ui.notify("agentyc binary not found. Install: uv tool install agentyc", "error");
    return false;
  }

  try {
    mcpClient = new MCPStdioClient();
    await mcpClient.start(agentycBin, ["mcp"]);

    // Discover and register tools
    const tools = await mcpClient.listTools();
    ctx.ui.notify(`agentyc MCP: discovering ${tools.length} tools...`, "info");

    const server = mcpClient;
    let registered = 0;

    for (const tool of tools) {
      if (registeredTools.has(tool.name)) continue;

      // Build description with inline JSON Schema for the LLM
      const schemaJson = tool.inputSchema
        ? JSON.stringify(tool.inputSchema, null, 2)
        : "{}";
      const fullDesc = [
        tool.description || `MCP tool: ${tool.name}`,
        "",
        "Parameters (JSON Schema):",
        "```json",
        schemaJson,
        "```",
      ].join("\n");

      // Use a permissive Record schema — validation is handled by the MCP server
      pi.registerTool({
        name: tool.name,
        label: `agentyc: ${tool.name}`,
        description: fullDesc,
        parameters: Type.Record(Type.String(), Type.Any()),
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
          if (!server.connected) {
            throw new Error("agentyc MCP server is not connected");
          }

          // Simplify params: remove TypeBox wrappers (they add extra keys)
          const cleanParams = JSON.parse(JSON.stringify(params));

          const result = await server.callTool(tool.name, cleanParams);

          // Format MCP content into text response
          const textParts: string[] = [];
          for (const c of result.content) {
            if (c.type === "text" && c.text) textParts.push(c.text);
            else if (c.type === "resource") textParts.push(`[Resource: ${c.mimeType || "unknown"}]`);
          }

          return {
            content: [{ type: "text", text: textParts.join("\n") }],
            isError: result.isError,
            details: {},
          };
        },
      });

      registeredTools.add(tool.name);
      registered++;
    }

    ctx.ui.notify(`agentyc MCP: ${registered} tools registered`, "info");
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    ctx.ui.notify(`agentyc MCP connection failed: ${msg}`, "error");
    mcpClient = null;
    return false;
  }
}

async function disconnectMCP(): Promise<void> {
  if (mcpClient) {
    await mcpClient.stop();
    mcpClient = null;
  }
}

// ── Extension ─────────────────────────────────────────────────────

let statusLine = "agentyc: disconnected";
let pi: ExtensionAPI;

export default function agentycMCPExtension(api: ExtensionAPI) {
  pi = api;

  // ── Connect on startup ──
  pi.on("session_start", async (_event, ctx) => {
    const ok = await connectMCP(ctx);
    if (ok) {
      statusLine = `agentyc: ${registeredTools.size} tools`;
      ctx.ui.setStatus("agentyc-mcp", statusLine);
    } else {
      statusLine = "agentyc: disconnected";
      ctx.ui.setStatus("agentyc-mcp", statusLine);
    }
  });

  // ── Cleanup on shutdown ──
  pi.on("session_shutdown", async () => {
    await disconnectMCP();
    statusLine = "agentyc: disconnected";
  });

  // ── /agentyc command ──
  pi.registerCommand("agentyc", {
    description: "Show agentyc MCP status or restart the connection",
    handler: async (args, ctx) => {
      const arg = args?.trim().toLowerCase();

      if (arg === "restart" || arg === "reconnect") {
        ctx.ui.notify("Restarting agentyc MCP...", "info");
        await disconnectMCP();
        registeredTools.clear();
        const ok = await connectMCP(ctx);
        if (ok) {
          statusLine = `agentyc: ${registeredTools.size} tools`;
          ctx.ui.setStatus("agentyc-mcp", statusLine);
          ctx.ui.notify(`agentyc MCP: ${registeredTools.size} tools registered`, "info");
        }
        return;
      }

      // Show status
      const lines: string[] = [
        "agentyc MCP Status",
        "",
        mcpClient?.connected
          ? `✅ Connected — ${registeredTools.size} tools registered`
          : "❌ Disconnected",
        "",
      ];

      if (mcpClient?.connected && registeredTools.size > 0) {
        lines.push("Registered tools:");
        for (const name of [...registeredTools].sort()) {
          lines.push(`  \`${name}\``);
        }
      }

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  // ── Update status periodically ──
  setInterval(() => {
    if (pi) {
      const anyPi = pi as unknown as { getActiveTools?: () => string[] };
      const count = registeredTools.size;
      statusLine = mcpClient?.connected
        ? `agentyc: ${count} tools`
        : "agentyc: disconnected";
    }
  }, 30000);
}