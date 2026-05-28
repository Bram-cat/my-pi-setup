import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const baseDir = dirname(fileURLToPath(import.meta.url));
const skillPath = join(baseDir, "SKILL.md");

const AGENT_ROSTER = {
  reviewer: {
    path: "/home/ram-dev/Work/marketing team/agency-agents/engineering/engineering-code-reviewer.md",
    label: "Code Reviewer 👁️",
    callout: "Reviews code like a mentor, not a gatekeeper. Focus: correctness, security, maintainability, performance.",
  },
  architect: {
    path: "/home/ram-dev/Work/marketing team/agency-agents/engineering/engineering-software-architect.md",
    label: "Software Architect 🏛️",
    callout: "Every decision has a trade-off — name it. Focus: structure, boundaries, code judo, abstractions, anti-spaghetti.",
  },
  minimalist: {
    path: "/home/ram-dev/Work/marketing team/agency-agents/engineering/engineering-minimal-change-engineer.md",
    label: "Minimal Change Engineer 🪡",
    callout: "The smallest diff that solves the problem. Focus: scope discipline, blocking unnecessary churn and premature abstraction.",
  },
  security: {
    path: "/home/ram-dev/Work/marketing team/agency-agents/engineering/engineering-security-engineer.md",
    label: "Security Engineer 🔒",
    callout: "Thinks like an attacker to defend like an engineer. Optional — dispatched when diff touches auth, input handling, data, or external APIs.",
  },
};

const HOME = process.env.HOME || "/home/ram-dev";

function expandHome(p: string): string {
  return p.startsWith("~/") ? p.replace("~", HOME) : p;
}

function readAgent(role: string, info: { path: string; label: string; callout: string }): string {
  const resolved = expandHome(info.path);
  if (!existsSync(resolved)) {
    return `## ${info.label}\n\n_(agent file not found at ${resolved})_\n\n${info.callout}`;
  }
  const content = readFileSync(resolved, "utf-8").trim();
  const body = content.startsWith("---")
    ? content.replace(/---[\s\S]*?---\n*/g, "")
    : content;
  return [
    `## ${info.label}`,
    ``,
    `**Role:** ${info.callout}`,
    ``,
    `**Agent Definition:**`,
    "```markdown",
    body.slice(0, 3000),
    body.length > 3000 ? `\n... (truncated, ${body.length} total)` : "",
    "```",
  ].join("\n");
}

function detectGitScope(): { summary: string; diff: string } {
  try {
    let staged = "";
    try {
      staged = execSync("git diff --cached --stat 2>/dev/null", { encoding: "utf-8" }).trim();
    } catch { /* ignore */ }

    if (staged) {
      const fileCount = staged.split("\n").length;
      const stat = (() => {
        try { return execSync("git diff --cached --numstat 2>/dev/null", { encoding: "utf-8" }).trim(); }
        catch { return ""; }
      })();
      const [added, removed] = stat
        ? stat.split("\n").reduce(
            ([a, r], line) => {
              const parts = line.split("\t");
              return [a + Number(parts[0] || 0), r + Number(parts[1] || 0)];
            },
            [0, 0],
          )
        : [0, 0];
      const raw = execSync("git diff --cached 2>/dev/null", { encoding: "utf-8" }).trim();
      return {
        summary: `Staged changes: ${fileCount} file(s), +${added}/-${removed} lines`,
        diff: raw,
      };
    }

    let unstaged = "";
    try {
      unstaged = execSync("git diff --stat 2>/dev/null", { encoding: "utf-8" }).trim();
    } catch { /* ignore */ }

    if (unstaged) {
      const fileCount = unstaged.split("\n").length;
      const raw = execSync("git diff 2>/dev/null", { encoding: "utf-8" }).trim();
      return {
        summary: `Unstaged changes: ${fileCount} file(s)`,
        diff: raw,
      };
    }

    const branch = (() => {
      try { return execSync("git branch --show-current 2>/dev/null", { encoding: "utf-8" }).trim(); }
      catch { return ""; }
    })();

    if (branch && branch !== "HEAD") {
      for (const target of ["develop", "main", "stable", "master"]) {
        try {
          const result = execSync(`git diff ${target}...HEAD --stat 2>/dev/null`, {
            encoding: "utf-8",
          }).trim();
          if (result) {
            const fileCount = result.split("\n").length;
            const raw = execSync(`git diff ${target}...HEAD 2>/dev/null`, { encoding: "utf-8" }).trim();
            return {
              summary: `Branch ${branch} vs ${target}: ${fileCount} file(s) changed`,
              diff: raw,
            };
          }
        } catch {
          continue;
        }
      }
      return { summary: `Branch: ${branch} (no branch diff detected)`, diff: "" };
    }

    return { summary: "No changes detected", diff: "" };
  } catch {
    return { summary: "Not a git repository", diff: "" };
  }
}

function getProjectLabel(): string {
  try {
    const origin = (() => {
      try { return execSync("git config --get remote.origin.url 2>/dev/null", { encoding: "utf-8" }).trim(); }
      catch { return ""; }
    })();
    const branch = (() => {
      try { return execSync("git branch --show-current 2>/dev/null", { encoding: "utf-8" }).trim(); }
      catch { return ""; }
    })();
    const root = (() => {
      try { return execSync("git rev-parse --show-toplevel 2>/dev/null", { encoding: "utf-8" }).trim(); }
      catch { return ""; }
    })();
    const name = root.split("/").pop() || "unknown";
    return origin ? `${name} (${origin}) — branch: ${branch}` : `${name} — branch: ${branch}`;
  } catch {
    return "unknown project";
  }
}

function loadStandardFiles(ctx: ExtensionContext): string {
  const sections: string[] = [];

  for (const candidate of [
    "./Technical.md",
    ".candid/Technical.md",
    ".github/copilot-instructions.md",
    "CONTEXT.md",
  ]) {
    const resolved = resolve(ctx.cwd, candidate);
    if (existsSync(resolved)) {
      sections.push(`**Standards file found:** \`${candidate}\``);
      sections.push("```markdown");
      sections.push(readFileSync(resolved, "utf-8").slice(0, 3000));
      sections.push("```");
      sections.push("");
      break;
    }
  }

  for (const cfgPath of [resolve(ctx.cwd, ".candid/config.json"), resolve(HOME, ".candid/config.json")]) {
    if (existsSync(cfgPath)) {
      sections.push(`**Config found:** \`${cfgPath}\``);
      sections.push("```json");
      sections.push(readFileSync(cfgPath, "utf-8").slice(0, 2000));
      sections.push("```");
      sections.push("");
      break;
    }
  }

  const registerPath = resolve(ctx.cwd, ".candid/register/review-decision-register.md");
  if (existsSync(registerPath)) {
    sections.push(`**Decision register found:** \`${registerPath}\``);
    sections.push("```markdown");
    sections.push(readFileSync(registerPath, "utf-8").slice(0, 2000));
    sections.push("```");
    sections.push("");
  }

  return sections.join("\n");
}

function parseArgs(args: string): {
  scope: string | null;
  harsh: boolean;
  constructive: boolean;
  focus: string | null;
  autoCommit: boolean;
  exclude: string[];
} {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  const result = {
    scope: null as string | null,
    harsh: false,
    constructive: false,
    focus: null as string | null,
    autoCommit: false,
    exclude: [] as string[],
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "--harsh") result.harsh = true;
    else if (t === "--constructive") result.constructive = true;
    else if (t === "--auto-commit") result.autoCommit = true;
    else if (t === "--focus" && i + 1 < tokens.length) {
      result.focus = tokens[++i];
    } else if (t === "--exclude" && i + 1 < tokens.length) {
      result.exclude.push(tokens[++i]);
    } else if (result.scope === null) {
      result.scope = t;
    }
  }

  return result;
}

export default function codeImproveExtension(pi: ExtensionAPI) {
  pi.registerCommand("code-improve", {
    description:
      "Deep code quality review with specialized sub-agents (Architect, Reviewer, Minimalist, Security). Combines candid-review methodology with ambitious structural improvement (code judo, 1k-line boundary, anti-spaghetti).",
    handler: async (args, ctx) => {
      const opts = parseArgs(args);

      // Load combined methodology
      const methodology = existsSync(skillPath)
        ? readFileSync(skillPath, "utf-8")
        : `(SKILL.md not found at ${skillPath})`;

      // Detect git scope
      const { summary: scopeSummary, diff: rawDiff } = detectGitScope();
      const projectLabel = getProjectLabel();

      // Load agent definitions (truncated per agent — full content flows via sub-agent tool)
      const agentDefs = Object.entries(AGENT_ROSTER)
        .map(([role, info]) => readAgent(role, info))
        .join("\n\n---\n\n");

      // Load project standards / config
      const standardsSection = loadStandardFiles(ctx);

      // Detect if security-sensitive files are in scope
      const securityPatterns =
        /auth|login|password|token|api.?key|secret|credential|permission|role|session|cookie|input|sanitize|sql|xss|csrf|encrypt|decrypt|hash|signature|cert|jwt|oauth|saml/i;
      const needsSecurity = securityPatterns.test(rawDiff);

      // Build agent dispatch roster
      const alwaysAgents = ["reviewer", "architect", "minimalist"];
      const optionalAgents = needsSecurity ? ["security"] : [];
      const dispatchRoles = [...alwaysAgents, ...optionalAgents];

      // Tone label
      let toneLabel = "Direct / Serious / Demanding (default)";
      if (opts.harsh) toneLabel = "Harsh";
      else if (opts.constructive) toneLabel = "Constructive (Care Personally + Challenge Directly)";

      // Build metadata lines
      const lines: string[] = [
        `- **Tone:** ${toneLabel}`,
      ];
      if (opts.focus) lines.push(`- **Focus mode:** \`--focus ${opts.focus}\``);
      if (opts.exclude.length > 0) lines.push(`- **Excluding files matching:** ${opts.exclude.join(", ")}`);
      if (opts.autoCommit) lines.push("- **Auto-commit enabled:** will commit after applying fixes");
      const metaLines = lines.join("\n");

      const scopeLine = opts.scope ? `- **User-specified scope:** \`${opts.scope}\`` : "";

      const message = [
        `# Code Improvement Review`,
        ``,
        `## Context`,
        ``,
        `- **Project:** ${projectLabel}`,
        `- **Scope:** ${scopeSummary}`,
        scopeLine,
        metaLines,
        ``,
        `## Methodology`,
        ``,
        "```markdown",
        methodology,
        "```",
        ``,
        standardsSection ? `## Project Standards & Config\n\n${standardsSection}\n` : "",
        ``,
        `## Agent Roster`,
        ``,
        `Dispatch the following sub-agents **in parallel** using the \`subagent\` tool. Each receives the same scope but reviews from its own lens.`,
        ``,
        `(${dispatchRoles.length} agents)`,
        ``,
        dispatchRoles.map((role) => `- \`${role}\`: ${AGENT_ROSTER[role as keyof typeof AGENT_ROSTER].label}`).join("\n"),
        ``,
        ``,
        agentDefs,
        ``,
        `## Instructions`,
        ``,
        `1. **Scope detection** is already done above. Use that scope.`,
        `2. **Read the methodology** above — it covers the full workflow.`,
        `3. **Dispatch the listed sub-agents in parallel** using \`subagent\`. Give each the scope, methodology summary, and relevant git diff.`,
        `4. **While sub-agents run**, read changed files in full, trace imports, check tests.`,
        `5. **Merge findings** from all sub-agents with your own analysis into a single prioritized report.`,
        `6. **Present findings** with severity markers, file references, concrete fixes, and confidence levels.`,
        `7. **Offer fix selection** — let the user choose which fixes to apply.`,
        `8. **Apply fixes** if selected, then optionally auto-commit if enabled.`,
        `9. **Save review state** to \`.candid/last-review.json\` and update decision register if one exists.`,
        ``,
        `## Key Rules`,
        ``,
        `- Do not flood output with low-value nits if larger structural issues exist.`,
        `- If ≥3 structural/spaghetti/simplification findings exist, keep nits to 0.`,
        `- The 1k-line gate is a presumptive blocker — flag it.`,
        `- Every line in the diff must be justifiable as required by the task.`,
        `- If there's a code-judo path to delete complexity, push for it.`,
        `- Do not ask whether to continue — just produce the review.`,
        `- Do not rubber-stamp implementations that leave the codebase messier than before.`,
        ``,
        `---`,
        ``,
        `Proceed with the review.`,
      ]
        .filter(Boolean)
        .join("\n");

      ctx.ui.notify(`code-improve: starting review (${scopeSummary})`, "info");
      pi.sendUserMessage(message);
    },
  });

  pi.registerCommand("code-review", {
    description: "Shorthand alias for /code-improve (deep code quality review)",
    handler: async (args, ctx) => {
      const cmd = pi.getRegisteredCommand?.("code-improve");
      if (cmd) {
        await cmd.handler(args, ctx);
      } else {
        ctx.ui.notify("/code-review requires code-improve extension", "error");
      }
    },
  });
}