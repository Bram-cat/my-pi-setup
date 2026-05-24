import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Type } from "typebox";

const execFileAsync = promisify(execFile);
const extensionDir = dirname(fileURLToPath(import.meta.url));
const helperPath = join(extensionDir, "contextia_client.py");
const contextiaPython = process.env.PI_CONTEXTIA_PYTHON ?? `${process.env.HOME}/.local/bin/contextia-python`;

const registeredToolNames = new Set<string>();
let contextiaReady = false;
let contextiaLoadError = "";

const keyGuidelines: Record<string, string[]> = {
  index: [
    "Use ctx_index before ctx_search when Contextia has not indexed the current project yet. Omit path to index the current working directory.",
  ],
  search: [
    "Use ctx_search before broad read or bash scanning when you need to locate relevant code by meaning or keywords.",
  ],
  find_symbol: [
    "Use ctx_find_symbol before grep when you need the definition location for a symbol.",
  ],
  explain: [
    "Use ctx_explain for a compact symbol overview before reading multiple files by hand.",
  ],
  impact: [
    "Use ctx_impact before renaming, deleting, or changing a symbol signature.",
  ],
  code: [
    "Use ctx_code for AST-aware symbol and pattern operations when structural code understanding matters.",
  ],
  session_snapshot: [
    "Use ctx_session_snapshot first after compaction or when recovering prior Contextia work.",
  ],
  remember: [
    "Use ctx_remember to persist important project decisions or facts that should survive the current session.",
  ],
  recall: [
    "Use ctx_recall to recover previously stored decisions and notes before re-researching the same topic.",
  ],
};

function ctxToolName(name: string) {
  return `ctx_${name}`;
}

function sentence(text?: string) {
  if (!text) return "Contextia tool";
  return text.split(/\n\s*\n|\n/)[0]?.trim() || "Contextia tool";
}

function schemaToTypeBox(schema: any): any {
  if (!schema || typeof schema !== "object") {
    return Type.Any();
  }

  if (Array.isArray(schema.enum) && schema.enum.every((value) => typeof value === "string")) {
    return Type.Union(schema.enum.map((value) => Type.Literal(value)));
  }

  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    return Type.Union(schema.anyOf.map(schemaToTypeBox));
  }

  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return Type.Union(schema.oneOf.map(schemaToTypeBox));
  }

  if (schema.type === "object") {
    const properties = schema.properties && typeof schema.properties === "object" ? schema.properties : {};
    const required = new Set(Array.isArray(schema.required) ? schema.required : []);
    const mapped = Object.fromEntries(
      Object.entries(properties).map(([key, value]) => {
        const child = schemaToTypeBox(value);
        return [key, required.has(key) ? child : Type.Optional(child)];
      }),
    );

    return Type.Object(mapped, {
      additionalProperties: schema.additionalProperties ?? true,
      description: schema.description,
    });
  }

  if (schema.type === "array") {
    return Type.Array(schemaToTypeBox(schema.items ?? {}), {
      description: schema.description,
    });
  }

  if (schema.type === "integer") {
    return Type.Integer({
      description: schema.description,
      default: schema.default,
    });
  }

  if (schema.type === "number") {
    return Type.Number({
      description: schema.description,
      default: schema.default,
    });
  }

  if (schema.type === "boolean") {
    return Type.Boolean({
      description: schema.description,
      default: schema.default,
    });
  }

  if (schema.type === "string") {
    return Type.String({
      description: schema.description,
      default: schema.default,
    });
  }

  return Type.Any({ description: schema.description });
}

async function runHelper(args: string[]) {
  const { stdout } = await execFileAsync(contextiaPython, [helperPath, ...args], {
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
  });

  return JSON.parse(stdout);
}

function normalizeParams(toolName: string, params: Record<string, unknown>, cwd: string) {
  if (toolName !== "index") return params;

  const path = typeof params.path === "string" ? params.path.trim() : "";
  if (path) return params;

  return {
    ...params,
    path: cwd,
  };
}

function buildPromptAppend() {
  if (!contextiaReady) {
    if (!contextiaLoadError) return "";
    return `\n## Contextia Status\nContextia integration failed to load: ${contextiaLoadError}\n`;
  }

  return `
## Contextia Priority

Contextia tools are installed and should be the first choice for code understanding.

- Use ctx_status or ctx_health before assuming the current project is indexed.
- Use ctx_index when the current project is not indexed yet. If no path is provided, ctx_index uses the current working directory.
- Use ctx_search, ctx_find_symbol, ctx_explain, ctx_find_callers, ctx_find_callees, ctx_impact, ctx_code, ctx_architecture, and ctx_overview before broad read/bash exploration whenever they can answer the question.
- Use read and bash after Contextia narrows down the target files, or when you need exact raw file contents, shell execution, or edits.
- Use ctx_session_snapshot first after compaction or when recovering prior Contextia work.
`;
}

async function registerContextiaTools(pi: ExtensionAPI) {
  if (contextiaReady) return;

  const payload = await runHelper(["list-tools"]);
  const tools = Array.isArray(payload.tools) ? payload.tools : [];

  for (const tool of tools) {
    const originalName = typeof tool.name === "string" ? tool.name : "";
    if (!originalName) continue;

    const name = ctxToolName(originalName);
    if (registeredToolNames.has(name)) continue;

    const inputSchema = originalName === "index"
      ? {
          ...(tool.inputSchema ?? {}),
          required: [],
          properties: {
            ...(tool.inputSchema?.properties ?? {}),
            path: {
              ...(tool.inputSchema?.properties?.path ?? {}),
              description: "Absolute path to the codebase directory. Defaults to the current working directory.",
            },
          },
        }
      : tool.inputSchema;

    registeredToolNames.add(name);
    pi.registerTool({
      name,
      label: `Ctx ${originalName}`,
      description: tool.description || `Contextia tool: ${originalName}`,
      promptSnippet: sentence(tool.description),
      promptGuidelines: keyGuidelines[originalName] ?? [],
      parameters: schemaToTypeBox(inputSchema),
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const normalized = normalizeParams(originalName, (params ?? {}) as Record<string, unknown>, ctx.cwd);
        const result = await runHelper(["call", originalName, JSON.stringify(normalized), ctx.cwd]);

        if (result?.isError) {
          throw new Error(result.text || `Contextia tool failed: ${originalName}`);
        }

        const text = typeof result?.text === "string" && result.text.trim().length > 0
          ? result.text
          : JSON.stringify(result?.structured ?? {}, null, 2);

        return {
          content: [{ type: "text", text }],
          details: result?.structured ?? {},
        };
      },
    });
  }

  contextiaReady = true;
}

export default async function contextiaExtension(pi: ExtensionAPI) {
  try {
    await registerContextiaTools(pi);
  } catch (error) {
    contextiaLoadError = error instanceof Error ? error.message : String(error);
  }

  pi.on("session_start", async (_event, ctx) => {
    if (!contextiaReady) {
      if (contextiaLoadError) {
        ctx.ui.notify(`Contextia unavailable: ${contextiaLoadError}`, "warning");
      }
      return;
    }

    const active = pi.getActiveTools();
    const merged = [...new Set([...active, ...registeredToolNames])];
    if (merged.length !== active.length) {
      pi.setActiveTools(merged);
    }
  });

  pi.on("before_agent_start", async (event) => {
    const append = buildPromptAppend();
    if (!append) return;
    return {
      systemPrompt: `${event.systemPrompt}${append}`,
    };
  });

  pi.registerCommand("ctx-index", {
    description: "Index the current working directory or a provided path with Contextia",
    handler: async (args, ctx) => {
      if (!contextiaReady) {
        ctx.ui.notify(`Contextia unavailable: ${contextiaLoadError || "not loaded"}`, "warning");
        return;
      }

      const path = args?.trim() || ctx.cwd;
      const result = await runHelper(["call", "index", JSON.stringify({ path }), ctx.cwd]);
      ctx.ui.notify(result?.text || `Indexing started for ${path}`, "info");
    },
  });

  pi.registerCommand("ctx-status", {
    description: "Show Contextia status",
    handler: async (_args, ctx) => {
      if (!contextiaReady) {
        ctx.ui.notify(`Contextia unavailable: ${contextiaLoadError || "not loaded"}`, "warning");
        return;
      }

      const result = await runHelper(["call", "status", JSON.stringify({}), ctx.cwd]);
      ctx.ui.notify(result?.text || "Contextia status fetched", "info");
    },
  });
}
