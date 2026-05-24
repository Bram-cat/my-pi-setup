import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { basename, dirname, join, normalize, relative } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "typebox";

const VAULT_ROOT = "/home/ram-dev/Documents";
const WIKI_ROOT = join(VAULT_ROOT, "wiki");
const INDEX_PATH = join(VAULT_ROOT, "index.md");
const LOG_PATH = join(VAULT_ROOT, "log.md");
const PROFILE_PATH = join(WIKI_ROOT, "personal-ai-profile.md");
const MEMORY_INBOX_PATH = join(WIKI_ROOT, "agent-memory-inbox.md");

function nowStamp() {
  return new Date().toISOString();
}

function stringify(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function asErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function ensureVault() {
  mkdirSync(WIKI_ROOT, { recursive: true });
  if (!existsSync(INDEX_PATH)) writeFileSync(INDEX_PATH, "# Brain Index\n\n", "utf8");
  if (!existsSync(LOG_PATH)) writeFileSync(LOG_PATH, "# Log\n\n", "utf8");
  if (!existsSync(PROFILE_PATH)) writeFileSync(PROFILE_PATH, "# Personal AI Profile\n\n", "utf8");
  if (!existsSync(MEMORY_INBOX_PATH)) writeFileSync(MEMORY_INBOX_PATH, "# Agent Memory Inbox\n\n", "utf8");
}

function safeWikiPath(input: string) {
  const cleaned = input.replace(/^\/+/, "");
  const fullPath = normalize(join(WIKI_ROOT, cleaned));
  const rel = relative(WIKI_ROOT, fullPath);

  if (rel.startsWith("..") || rel === "" || rel.includes("\0")) {
    throw new Error(`Path must stay inside ${WIKI_ROOT}`);
  }

  if (!fullPath.endsWith(".md")) {
    throw new Error("Only markdown files under wiki/ can be edited");
  }

  return fullPath;
}

function wikiLinkFor(fullPath: string) {
  const rel = relative(VAULT_ROOT, fullPath).replace(/\.md$/, "");
  return `[[${rel}]]`;
}

function appendLog(message: string) {
  appendFileSync(LOG_PATH, `\n- ${nowStamp()} — ${message}\n`, "utf8");
}

function ensureIndexLink(fullPath: string, label?: string) {
  const link = wikiLinkFor(fullPath);
  const text = readFileSync(INDEX_PATH, "utf8");
  if (text.includes(link)) return;
  appendFileSync(INDEX_PATH, `\n- ${link}${label ? ` — ${label}` : ""}\n`, "utf8");
}

function readMaybe(path: string, maxChars = 8000) {
  if (!existsSync(path)) return "";
  const text = readFileSync(path, "utf8");
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n\n...[truncated]` : text;
}

function listMarkdownFiles(dir: string, max = 120) {
  const files: string[] = [];

  function walk(current: string) {
    if (files.length >= max) return;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".md")) files.push(relative(WIKI_ROOT, full));
      if (files.length >= max) return;
    }
  }

  walk(dir);
  return files;
}

async function rg(query: string, maxResults: number) {
  return await new Promise<Array<{ file: string; line: number; text: string }>>((resolve, reject) => {
    execFile("rg", ["--line-number", "--ignore-case", "--glob", "*.md", query, WIKI_ROOT], { maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error && (error as NodeJS.ErrnoException).code !== "1") {
        reject(error);
        return;
      }

      const results = stdout
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(0, maxResults)
        .map((line) => {
          const [file, lineNo, ...rest] = line.split(":");
          return { file: relative(WIKI_ROOT, file), line: Number(lineNo), text: rest.join(":").trim() };
        });

      resolve(results);
    });
  });
}

function addProfileBullet(section: string, bullet: string) {
  const text = readFileSync(PROFILE_PATH, "utf8");
  const heading = `## ${section}`;
  const line = `- ${bullet}`;
  if (text.includes(line)) return false;

  if (!text.includes(heading)) {
    appendFileSync(PROFILE_PATH, `\n${heading}\n${line}\n`, "utf8");
    return true;
  }

  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((item) => item.trim() === heading);
  let insertAt = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith("## ")) {
      insertAt = index;
      break;
    }
  }

  lines.splice(insertAt, 0, line);
  writeFileSync(PROFILE_PATH, lines.join("\n"), "utf8");
  return true;
}

export default function obsidianBrain(pi: ExtensionAPI) {
  ensureVault();

  pi.on("before_agent_start", async (event) => {
    const profile = readMaybe(PROFILE_PATH, 2500);
    const index = readMaybe(INDEX_PATH, 2500);

    return {
      systemPrompt:
        event.systemPrompt +
        `\n\n## Obsidian Brain Harness\n\nDurable user memory lives in ${VAULT_ROOT}. Use the Obsidian brain tools when the user reveals durable preferences, project facts, recurring workflows, school/writing knowledge, or asks to remember/grow the harness. Keep notes concise; do not dump the vault into context.\n\nCore profile excerpt:\n${profile}\n\nBrain index excerpt:\n${index}\n`,
    };
  });

  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setStatus("brain", "Obsidian brain ready");
  });

  pi.registerTool({
    name: "brain_search",
    label: "Search Brain",
    description: "Search the Obsidian wiki memory under /home/ram-dev/Documents/wiki.",
    promptSnippet: "Search durable Obsidian memory before guessing user preferences or prior project context.",
    promptGuidelines: [
      "Use before answering questions that may rely on the user's notes, preferences, coursework, plans, or project history.",
      "Prefer focused search over reading many files.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search text or regex for rg." }),
      maxResults: Type.Optional(Type.Number({ description: "Maximum results. Defaults to 20.", minimum: 1, maximum: 100 })),
    }),
    async execute(_toolCallId, params) {
      try {
        const p = params as { query: string; maxResults?: number };
        const results = await rg(p.query, p.maxResults ?? 20);
        return { content: [{ type: "text", text: stringify(results) }], details: { results } };
      } catch (error) {
        return { content: [{ type: "text", text: `Brain search failed: ${asErrorMessage(error)}` }], details: { error: asErrorMessage(error) }, isError: true };
      }
    },
  });

  pi.registerTool({
    name: "brain_read",
    label: "Read Brain Note",
    description: "Read a markdown note from /home/ram-dev/Documents/wiki by relative path.",
    promptSnippet: "Read a focused Obsidian wiki note when durable user memory is relevant.",
    parameters: Type.Object({
      path: Type.String({ description: "Relative path under wiki/, e.g. personal-ai-profile.md or projects/README.md." }),
      maxChars: Type.Optional(Type.Number({ description: "Maximum characters. Defaults to 12000.", minimum: 1000, maximum: 50000 })),
    }),
    async execute(_toolCallId, params) {
      try {
        const p = params as { path: string; maxChars?: number };
        const fullPath = safeWikiPath(p.path);
        const text = readMaybe(fullPath, p.maxChars ?? 12000);
        return { content: [{ type: "text", text }], details: { path: fullPath } };
      } catch (error) {
        return { content: [{ type: "text", text: `Brain read failed: ${asErrorMessage(error)}` }], details: { error: asErrorMessage(error) }, isError: true };
      }
    },
  });

  pi.registerTool({
    name: "brain_remember",
    label: "Remember in Brain",
    description: "Append a durable memory to the Obsidian wiki inbox and log. Optionally promote preferences to personal-ai-profile.md.",
    promptSnippet: "Persist durable user preferences, recurring workflow facts, and project facts into Obsidian when worth remembering.",
    promptGuidelines: [
      "Use for durable facts, preferences, recurring workflows, project decisions, and stable personal context.",
      "Do not store secrets, transient todos, or raw private content unless the user explicitly asks.",
      "If unsure whether to remember, ask first.",
    ],
    parameters: Type.Object({
      title: Type.String({ description: "Short title for the memory." }),
      content: Type.String({ description: "Concise durable memory in markdown." }),
      kind: Type.Optional(StringEnum(["preference", "project", "workflow", "coursework", "personal", "note"] as const)),
      updateProfile: Type.Optional(Type.Boolean({ description: "Also add a bullet to personal-ai-profile.md. Defaults to false." })),
    }),
    async execute(_toolCallId, params) {
      try {
        const p = params as { title: string; content: string; kind?: string; updateProfile?: boolean };
        const kind = p.kind ?? "note";
        const entry = `\n## ${p.title}\n- Date: ${nowStamp()}\n- Kind: ${kind}\n\n${p.content.trim()}\n`;
        appendFileSync(MEMORY_INBOX_PATH, entry, "utf8");
        ensureIndexLink(MEMORY_INBOX_PATH, "durable memories captured by agents");
        appendLog(`Remembered ${kind}: ${p.title}`);

        let profileUpdated = false;
        if (p.updateProfile) {
          profileUpdated = addProfileBullet("Learned preferences", `${p.title}: ${p.content.trim().replace(/\s+/g, " ").slice(0, 240)}`);
          if (profileUpdated) appendLog(`Updated personal AI profile from memory: ${p.title}`);
        }

        return { content: [{ type: "text", text: `Remembered in ${MEMORY_INBOX_PATH}${profileUpdated ? " and updated profile" : ""}.` }], details: { path: MEMORY_INBOX_PATH, profileUpdated } };
      } catch (error) {
        return { content: [{ type: "text", text: `Brain remember failed: ${asErrorMessage(error)}` }], details: { error: asErrorMessage(error) }, isError: true };
      }
    },
  });

  pi.registerTool({
    name: "brain_write_note",
    label: "Write Brain Note",
    description: "Create or replace a markdown note under /home/ram-dev/Documents/wiki and update the brain index/log.",
    promptSnippet: "Write synthesized durable notes into Obsidian when the user asks to preserve context or improve the harness.",
    promptGuidelines: [
      "Write concise synthesized notes, not huge raw dumps.",
      "Keep source-of-truth raw files untouched.",
      "Use relative paths under wiki/, e.g. projects/my-project.md or skills/my-workflow.md.",
    ],
    parameters: Type.Object({
      path: Type.String({ description: "Relative markdown path under wiki/." }),
      content: Type.String({ description: "Full markdown note content." }),
      indexLabel: Type.Optional(Type.String({ description: "Optional description to add beside the index link." })),
    }),
    async execute(_toolCallId, params) {
      try {
        const p = params as { path: string; content: string; indexLabel?: string };
        const fullPath = safeWikiPath(p.path);
        mkdirSync(dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, p.content.endsWith("\n") ? p.content : `${p.content}\n`, "utf8");
        ensureIndexLink(fullPath, p.indexLabel);
        appendLog(`Wrote brain note ${wikiLinkFor(fullPath)}`);
        return { content: [{ type: "text", text: `Wrote ${fullPath}` }], details: { path: fullPath } };
      } catch (error) {
        return { content: [{ type: "text", text: `Brain write failed: ${asErrorMessage(error)}` }], details: { error: asErrorMessage(error) }, isError: true };
      }
    },
  });

  pi.registerTool({
    name: "brain_profile_update",
    label: "Update AI Profile",
    description: "Add a concise bullet to a section in personal-ai-profile.md.",
    promptSnippet: "Update the user's AI profile when stable preferences or harness behavior rules become clear.",
    parameters: Type.Object({
      section: Type.String({ description: "Profile section heading without ##, e.g. Preferred behavior or Learned preferences." }),
      bullet: Type.String({ description: "Single concise bullet, without leading dash." }),
    }),
    async execute(_toolCallId, params) {
      try {
        const p = params as { section: string; bullet: string };
        const changed = addProfileBullet(p.section, p.bullet);
        if (changed) appendLog(`Updated personal AI profile: ${p.section} — ${p.bullet}`);
        return { content: [{ type: "text", text: changed ? "Profile updated." : "Profile already had that bullet." }], details: { path: PROFILE_PATH, changed } };
      } catch (error) {
        return { content: [{ type: "text", text: `Profile update failed: ${asErrorMessage(error)}` }], details: { error: asErrorMessage(error) }, isError: true };
      }
    },
  });

  pi.registerTool({
    name: "brain_overview",
    label: "Brain Overview",
    description: "List key Obsidian brain files and current profile/index excerpts.",
    promptSnippet: "Get a quick overview of the Obsidian brain before using durable memory.",
    parameters: Type.Object({
      maxFiles: Type.Optional(Type.Number({ description: "Maximum wiki files to list. Defaults to 80.", minimum: 10, maximum: 200 })),
    }),
    async execute(_toolCallId, params) {
      try {
        const p = params as { maxFiles?: number };
        const files = listMarkdownFiles(WIKI_ROOT, p.maxFiles ?? 80);
        const details = {
          vaultRoot: VAULT_ROOT,
          wikiRoot: WIKI_ROOT,
          indexPath: INDEX_PATH,
          profilePath: PROFILE_PATH,
          fileCount: files.length,
          files,
          profileExcerpt: readMaybe(PROFILE_PATH, 2500),
          indexExcerpt: readMaybe(INDEX_PATH, 2500),
        };
        return { content: [{ type: "text", text: stringify(details) }], details };
      } catch (error) {
        return { content: [{ type: "text", text: `Brain overview failed: ${asErrorMessage(error)}` }], details: { error: asErrorMessage(error) }, isError: true };
      }
    },
  });
}
