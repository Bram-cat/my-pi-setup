import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Box, Markdown } from "@earendil-works/pi-tui";

type Mood = "idle" | "thinking" | "success" | "warn";
type Theme = { fg: (color: never, text: string) => string };
type ContextUsage = { tokens?: number | null; contextWindow?: number | null; percent?: number | null };

interface FamiliarState {
  mood: Mood;
  frame: number;
  contextPct: number;
  handoff: string;
  heatmap: string;
}

const WIDGET_ID = "context-cat";
const LEGACY_WIDGET_ID = "pi-familiar";
const CONTENT_WIDTH = 46;
const FACE_WIDTH = 8;
const HEATMAP_CELLS = 18;
const FILLER_WORDS = [
  "stuff",
  "things",
  "just",
  "basically",
  "simply",
  "actually",
  "really",
  "very",
  "quite",
  "rather",
  "pretty much",
  "kind of",
  "sort of",
  "maybe",
  "probably",
  "might",
  "could",
  "seems like",
  "looks like",
  "i think",
  "i believe",
];
const CONTEXT_SIGNAL_WORDS = [
  "goal",
  "spec",
  "requirement",
  "acceptance criteria",
  "decision",
  "constraint",
  "tradeoff",
  "error",
  "reproduce",
  "expected",
  "actual",
  "file",
  "path",
  "test",
  "command",
  "output",
  "next",
  "blocker",
  "done",
  "todo",
  "verify",
  "source",
  "commit",
];
const INTENT_WORDS = ["summarize", "compare", "extract", "classify", "calculate", "rewrite", "create", "debug", "fix", "implement", "review", "explain", "research", "generate", "edit"];
const SLOT_WORDS = ["for", "audience", "length", "format", "include", "exclude", "deadline", "language", "tone", "file", "path", "repo", "branch", "error", "expected", "actual"];
const EVIDENCE_WORDS = ["use only", "cite", "source", "quote", "grounded", "evidence", "do not guess", "not stated", "verify", "check"];
const OUTPUT_WORDS = ["json", "table", "markdown", "bullet", "list", "diff", "patch", "summary", "report", "2-3", "short", "format"];
const AMBIGUITY_WORDS = ["maybe", "probably", "might", "could", "seems", "appears", "unclear", "somehow", "whatever"];
const DISTRACTOR_PATTERNS = [
  "ignore previous",
  "unrelated",
  "by the way",
  "for later",
  "not relevant",
  "side note",
  "random",
];

const palette = {
  fur: "muted",
  border: "dim",
  title: "accent",
  text: "text",
  dim: "dim",
  good: "success",
  warn: "warning",
  bad: "error",
};

export default function piFamiliar(pi: ExtensionAPI) {
  pi.registerMessageRenderer("context-cat-explain", (message, _options, theme) => {
    const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
    box.addChild(new Markdown(String(message.content ?? ""), 0, 0, getMarkdownTheme()));
    return box;
  });

  let timer: NodeJS.Timeout | undefined;
  let commandCtx: ExtensionCommandContext | undefined;
  let autoHandoffRunning = false;
  let autoHandoffSessionId: string | undefined;
  let state: FamiliarState = {
    mood: "idle",
    frame: 0,
    contextPct: 0,
    handoff: "watch context map",
    heatmap: makeSessionHeatmap(0, []),
  };

  const updateContext = (ctx?: {
    getContextUsage?: () => ContextUsage | undefined;
    sessionManager?: { getBranch?: () => unknown[] };
  }) => {
    const usage = ctx?.getContextUsage?.();
    if (typeof usage?.percent === "number") {
      state.contextPct = Math.min(100, Math.max(0, Math.round(usage.percent)));
    } else if (usage?.tokens && usage?.contextWindow) {
      state.contextPct = Math.min(100, Math.round((usage.tokens / usage.contextWindow) * 100));
    }

    state.heatmap = makeSessionHeatmap(state.contextPct, ctx?.sessionManager?.getBranch?.() ?? []);

    const badCells = countChars(state.heatmap, "!");
    const noisyCells = countChars(state.heatmap, "~");

    if (state.contextPct >= 85 || badCells >= 3) {
      state.handoff = "compress red zones";
      state.mood = "warn";
    } else if (state.contextPct >= 75 || badCells >= 1 || noisyCells >= 4) {
      state.handoff = "map hot zones";
      state.mood = "warn";
    } else if (state.contextPct >= 60 || noisyCells >= 2) {
      state.handoff = "snapshot key facts";
    } else {
      state.handoff = "watch context map";
    }
  };

  const renderWidget = (width: number, theme?: Theme) => renderFamiliar(state, width, theme);

  pi.on("session_start", (_event, ctx) => {
    const widgetFactory = () => ({
      render(width: number): string[] {
        updateContext(ctx);
        return renderWidget(width, ctx.ui.theme);
      },
      invalidate() {},
    });

    ctx.ui.setWidget(WIDGET_ID, widgetFactory, { placement: "aboveEditor" });
    ctx.ui.setStatus(WIDGET_ID, ctx.ui.theme.fg("accent" as never, "context cat awake"));
    ctx.ui.setStatus(LEGACY_WIDGET_ID, undefined);

    timer = setInterval(() => {
      state.frame++;
      ctx.ui.setWidget(WIDGET_ID, widgetFactory, { placement: "aboveEditor" });
    }, 350);
  });

  pi.on("agent_start", (_event, ctx) => {
    updateContext(ctx);
    if (state.mood !== "warn") state.mood = "thinking";
  });

  pi.on("turn_start", (_event, ctx) => updateContext(ctx));

  pi.on("agent_end", (_event, ctx) => {
    updateContext(ctx);
    if (state.mood !== "warn") state.mood = "success";
    void maybeAutoHandoff(ctx);
    setTimeout(() => {
      updateContext(ctx);
      if (state.mood !== "warn") state.mood = "idle";
    }, 2500);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (timer) clearInterval(timer);
    timer = undefined;
    ctx.ui.setWidget(WIDGET_ID, undefined);
    ctx.ui.setWidget(LEGACY_WIDGET_ID, undefined);
    ctx.ui.setStatus(WIDGET_ID, undefined);
    ctx.ui.setStatus(LEGACY_WIDGET_ID, undefined);
  });

  pi.registerCommand("context-cat", {
    description: "Show/repaint the Context Cat context widget",
    handler: async (_args, ctx) => {
      commandCtx = ctx;
      updateContext(ctx);
      ctx.ui.setWidget(WIDGET_ID, () => ({
        render: (width: number) => renderWidget(width, ctx.ui.theme),
        invalidate() {},
      }), { placement: "aboveEditor" });
      ctx.ui.notify("Context Cat repainted.", "info");
    },
  });

  pi.registerCommand("context-cat-handoff", {
    description: "Immediately switch to a Context Cat custom handoff session",
    handler: async (_args, ctx) => {
      commandCtx = ctx;
      await runAutoHandoff(ctx, "manual context cat handoff");
    },
  });

  pi.registerCommand("context-cat-explain", {
    description: "Explain why Context Cat marked heatmap cells green/yellow/red",
    handler: async (_args, ctx) => {
      commandCtx = ctx;
      updateContext(ctx);
      pi.sendMessage({
        customType: "context-cat-explain",
        content: buildContextCatExplanation(state.contextPct, ctx.sessionManager.getBranch()),
        display: true,
      });
      ctx.ui.notify("Context Cat explanation shown in transcript.", "info");
    },
  });

  async function maybeAutoHandoff(ctx: {
    isIdle?: () => boolean;
    sessionManager?: { getSessionId?: () => string; getBranch?: () => unknown[]; getSessionFile?: () => string | undefined };
    getContextUsage?: () => ContextUsage | undefined;
    ui?: { notify?: (message: string, level?: "info" | "warning" | "error") => void };
  }) {
    if (!commandCtx || autoHandoffRunning || ctx.isIdle?.() === false) return;
    const sessionId = ctx.sessionManager?.getSessionId?.();
    if (!sessionId || autoHandoffSessionId === sessionId) return;

    const branch = ctx.sessionManager?.getBranch?.() ?? [];
    const reason = getAutoHandoffReason(state.contextPct, state.heatmap, branch);
    if (!reason) return;

    autoHandoffSessionId = sessionId;
    autoHandoffRunning = true;
    try {
      await runAutoHandoff(commandCtx, reason);
    } finally {
      autoHandoffRunning = false;
    }
  }
}

function renderFamiliar(state: FamiliarState, width: number, theme?: Theme) {
  const paint = makePainter(theme);
  const cat = catFace(state.mood, state.frame, paint);
  const headline = contextCatHeadline(state);
  const moodLine = `${paint("dim", "mood")} ${paint(moodColor(state.mood), headline)}`;
  const ctxLine = `${paint("dim", "ctx ")} ${paint(contextColor(state.contextPct), `${String(state.contextPct).padStart(3)}%`)} ${colorizeHeatmap(state.heatmap, theme)}`;
  const handoffLine = `${paint("dim", "next")} ${paint(contextColor(state.contextPct), state.handoff)}`;

  const rows = [
    [cat[0], paint("accent", "context cat")],
    [cat[1], moodLine],
    [cat[2], ctxLine],
    [cat[3], handoffLine],
  ].map(([left, right]) => padVisible(`${padVisible(left, FACE_WIDTH)}   ${right}`, CONTENT_WIDTH));

  return rightBox(box(rows, theme, CONTENT_WIDTH), width).map((line) => padVisible(line, width));
}

function makePainter(theme?: Theme) {
  return (color: string, text: string) => {
    if (!theme) return text;
    try {
      return theme.fg(color as never, text);
    } catch {
      return theme.fg("text" as never, text);
    }
  };
}

function box(lines: string[], theme?: Theme, contentWidth = maxVisibleWidth(lines)) {
  const paint = makePainter(theme);
  const top = `${paint(palette.border, "╭")}${paint(palette.border, "─".repeat(contentWidth + 2))}${paint(palette.border, "╮")}`;
  const body = lines.map((line) => `${paint(palette.border, "│")} ${padVisible(line, contentWidth)} ${paint(palette.border, "│")}`);
  const bottom = `${paint(palette.border, "╰")}${paint(palette.border, "─".repeat(contentWidth + 2))}${paint(palette.border, "╯")}`;
  return [top, ...body, bottom];
}

function catFace(mood: Mood, frame: number, paint: (color: string, text: string) => string) {
  const step = frame % 8;
  const face = (() => {
    if (mood === "idle") return step === 2 ? "( -.- )" : "( o.o )";
    if (mood === "thinking") return step % 4 === 1 ? "( o.O )" : step % 4 === 2 ? "( O.o )" : "( o.o )";
    if (mood === "success") return step === 3 ? "( >.< )" : "( ^.^ )";
    return step % 2 === 0 ? "( O.O )" : "( o.O )";
  })();
  const pi = "π";

  return [
    paint(palette.fur, String.raw` /\_/\  `),
    paint(palette.fur, face),
    `${paint(palette.fur, "/ ")}${paint("error", ">")}${paint("warning", pi)}${paint("success", "<")}${paint(palette.fur, "\\")}`,
    paint(palette.fur, "  U U   "),
  ];
}

function contextCatHeadline(state: FamiliarState) {
  const badCells = countChars(state.heatmap, "!");
  const noisyCells = countChars(state.heatmap, "~");
  if (state.contextPct >= 90) return "handoff now";
  if (state.contextPct >= 85) return "context critical";
  if (badCells >= 3) return "red context zones";
  if (state.handoff.includes("compress")) return "red zones need trim";
  if (state.contextPct >= 75 && (badCells > 0 || noisyCells >= 4)) return "hot context map";
  if (state.contextPct >= 75) return "near context edge";
  if (badCells > 0) return "bad context found";
  if (noisyCells >= 4) return "noisy context trail";
  if (state.contextPct >= 60 || state.handoff.includes("snapshot")) return "snapshot facts";
  if (state.mood === "thinking") return "working";
  if (state.mood === "success") return "task clean";
  if (state.mood === "warn") return "watch context";
  return "context guardian";
}

function colorizeHeatmap(heatmap: string, theme?: Theme) {
  if (!theme) return heatmap.replace(/[=~!]/g, "█").replace(/\./g, "░");
  let out = "";
  for (const char of heatmap) {
    if (char === "=") out += theme.fg("success" as never, "█");
    else if (char === "~") out += theme.fg("warning" as never, "█");
    else if (char === "!") out += theme.fg("error" as never, "█");
    else if (char === ".") out += theme.fg("dim" as never, "░");
    else out += theme.fg("muted" as never, char);
  }
  return out;
}

function moodColor(mood: Mood) {
  if (mood === "success") return "success";
  if (mood === "warn") return "warning";
  if (mood === "thinking") return "accent";
  return "text";
}

function contextColor(pct: number) {
  if (pct >= 85) return "error";
  if (pct >= 60) return "warning";
  return "success";
}

async function runAutoHandoff(ctx: ExtensionCommandContext, reason: string) {
  const currentSessionFile = ctx.sessionManager.getSessionFile();
  const branch = ctx.sessionManager.getBranch();
  const usage = ctx.getContextUsage?.();
  const prompt = buildFamiliarHandoffPrompt(branch, reason, usage);

  ctx.ui.notify(`Context Cat auto-handoff: ${reason}`, "warning");
  const result = await ctx.newSession({
    parentSession: currentSessionFile,
    withSession: async (replacementCtx) => {
      replacementCtx.ui.setEditorText(prompt);
      replacementCtx.ui.notify("Context Cat switched to handoff session.", "info");
    },
  });

  if (result.cancelled) ctx.ui.notify("Context Cat auto-handoff cancelled by Pi", "warning");
}

function getAutoHandoffReason(pct: number, heatmap: string, branch: unknown[]) {
  const badCells = countChars(heatmap, "!");
  const noisyCells = countChars(heatmap, "~");
  const recent = branch.slice(-8).map(safeStringify).join("\n").toLowerCase();

  if (pct >= 85) return `context ${pct}%`;
  if (badCells >= 3) return `${badCells} bad context zones`;
  if (pct >= 75 && (badCells >= 1 || noisyCells >= 4)) return `context ${pct}% with noisy/bad zones`;
  if (recent.includes("failed to load extension") || recent.includes("traceback") || recent.includes("stack trace")) return "recent error context";
  if (recent.includes("successfully") && pct >= 70) return "major task completed near context limit";
  return undefined;
}

function buildFamiliarHandoffPrompt(
  branch: unknown[],
  reason: string,
  usage?: ContextUsage,
) {
  const contextEntries = branch.filter(isContextBearingEntry);
  const recent = contextEntries.slice(-24);
  const files = extractPaths(contextEntries).slice(0, 24);
  const cleaned = recent.map(extractEntryText).filter(Boolean).map(cleanHandoffText);
  const facts = unique(cleaned.filter(isLikelyFact).slice(-8));
  const assumptions = unique(cleaned.filter(isLikelyAssumption).slice(-6));
  const openQuestions = unique(cleaned.filter(isLikelyOpenQuestion).slice(-6));
  const userPreferences = unique(cleaned.filter(isLikelyUserPreference).slice(-6));
  const foggyPreferenceQuestions = buildFoggyPreferenceQuestions(userPreferences, assumptions, openQuestions);
  const errorEvidence = unique(cleaned.filter(isLikelyErrorEvidence).slice(-6));
  const nextActions = inferNextActions(cleaned, files, foggyPreferenceQuestions);
  const pct = usage?.percent ?? (usage?.tokens && usage?.contextWindow ? Math.round((usage.tokens / usage.contextWindow) * 100) : undefined);

  return [
    "# Context Cat Handoff",
    "",
    `Auto-created because: ${reason}.`,
    pct !== undefined ? `Context usage at handoff: ${pct}%.` : undefined,
    "",
    "## Continue from here",
    "Use this handoff as a compact map, not proof. Re-open source files before editing and verify claims marked as assumptions.",
    "",
    "## Context-window heatmap guide",
    "Engineers identify context-window pressure by comparing prompt+history+tool-result tokens against the active model's published context window. Pi exposes that as getContextUsage(); this widget turns the percent into heatmap cells.",
    "- Green cells: compact useful context, usually safe to keep.",
    "- Yellow cells: bulky/noisy context such as long stdout/stderr, diffs, installs, or large tool outputs; summarize before continuing.",
    "- Red cells: error traces, failed extension loads, huge entries, or oversized context; re-read only the needed source files and discard the rest.",
    "- Empty cells: unused window.",
    "When yellow/red grows near the right edge, make a handoff: current goal, decisions, files touched, commands run, blockers, and exact next action.",
    "",
    "## How this handoff was detected",
    "The extension buckets context-bearing session entries into cells, classifies each bucket, and triggers handoff when usage or noisy/red cells cross thresholds.",
    "",
    "",
    "## Relevant files seen",
    files.length ? files.map((file) => `- ${file}`).join("\n") : "- None detected from session entries.",
    "",
    "## Verified / high-confidence facts",
    facts.length ? facts.map((text) => `- ${clip(text, 260)}`).join("\n") : "- No high-confidence facts extracted.",
    "",
    "## Assumptions to verify",
    assumptions.length ? assumptions.map((text) => `- ${clip(text, 240)}`).join("\n") : "- None detected.",
    "",
    "## User preferences detected",
    userPreferences.length ? userPreferences.map((text) => `- ${clip(text, 220)}`).join("\n") : "- None detected.",
    "",
    "## Grill-me clarification queue (max 5 questions)",
    foggyPreferenceQuestions.length
      ? ["Use the grill-me skill style: ask these directly, resolve ambiguity before acting.", ...foggyPreferenceQuestions.map((text, index) => `${index + 1}. ${text}`)].join("\n")
      : "- No foggy user-preference areas detected.",
    "",
    "## Open questions / user intent",
    openQuestions.length ? openQuestions.map((text) => `- ${clip(text, 220)}`).join("\n") : "- No open questions detected.",
    "",
    "## Error / noisy evidence to avoid carrying forward",
    errorEvidence.length ? errorEvidence.map((text) => `- ${clip(text, 220)}`).join("\n") : "- None detected.",
    "",
    "## Next move",
    nextActions.join("\n"),
    "",
  ].filter((line) => line !== undefined).join("\n");
}

function cleanHandoffText(text: string) {
  const replacements: Array<[RegExp, string | ((match: string) => string)]> = [
    [/\b(stuff|things?)\b/gi, "items"],
    [/\b(just|basically|simply|obviously|clearly|actually|really|very|quite|rather|pretty much|kind of|sort of)\b/gi, ""],
    [/\b(in order to|due to the fact that|at this point in time|for the purpose of)\b/gi, (match: string) => phraseReplacement(match)],
    [/\b(maybe|probably|might|could|seems like|looks like|appears to|I think|I believe)\b/gi, "possibly"],
  ];

  let cleaned = text;
  for (const [pattern, replacement] of replacements) {
    cleaned = typeof replacement === "string" ? cleaned.replace(pattern, replacement) : cleaned.replace(pattern, replacement);
  }
  return cleaned.replace(/\s+/g, " ").trim();
}

function phraseReplacement(match: string) {
  const replacements: Record<string, string> = {
    "in order to": "to",
    "due to the fact that": "because",
    "at this point in time": "now",
    "for the purpose of": "for",
  };
  return replacements[match.toLowerCase()] ?? match;
}

function isLikelyFact(text: string) {
  const lower = text.toLowerCase();
  return !isLikelyErrorEvidence(text) && (
    lower.includes("wrote ") ||
    lower.includes("edited ") ||
    lower.includes("created ") ||
    lower.includes("removed ") ||
    lower.includes("renamed ") ||
    lower.includes("validated") ||
    lower.includes("no output") ||
    lower.includes("successfully") ||
    lower.includes("reported success") ||
    /\b\S+\.tsx?\b|\b\S+\.jsx?\b|\b\S+\.rs\b|\b\S+\.md\b/.test(lower)
  );
}

function isLikelyAssumption(text: string) {
  return /\bVERIFY:|assum|guess|unverified|likely|appears|seems|probably|maybe|might|could\b/i.test(text);
}

function isLikelyOpenQuestion(text: string) {
  return /\?|user asked|user wants|request|should |can you|need to|next/i.test(text);
}

function isLikelyUserPreference(text: string) {
  return /\b(user|prefer|preference|wants?|likes?|dislikes?|should|always|never|ask me|go with|recommendation|caveman|short|strict|under \d+ questions)\b/i.test(text);
}

function buildFoggyPreferenceQuestions(preferences: string[], assumptions: string[], openQuestions: string[]) {
  const candidates: string[] = [];
  const foggy = [...preferences, ...assumptions, ...openQuestions].filter((text) => /VERIFY:|prefer|preference|should|always|never|strict|foggy|unclear|ask/i.test(text));

  if (foggy.some((text) => /aggressive|compress|filler|remove/i.test(text))) {
    candidates.push("How aggressive should Context Cat be when compressing handoff text: light cleanup, strong compression, or maximum semantic compression?");
  }
  if (foggy.some((text) => /preference|prefer|always|never|should/i.test(text))) {
    candidates.push("Which detected user preference is a stable rule versus only for this task?");
  }
  if (foggy.some((text) => /ask|question|grill|clar/i.test(text))) {
    candidates.push("What must be clarified before acting, and what can be safely assumed?");
  }
  if (foggy.some((text) => /verify|assum|maybe|might|could|seems/i.test(text))) {
    candidates.push("Which assumptions should be verified by reading files or running checks before continuing?");
  }
  if (foggy.length && candidates.length < 5) {
    candidates.push("What is the exact next acceptable action after this handoff?");
  }

  return unique(candidates).slice(0, 5);
}

function isLikelyErrorEvidence(text: string) {
  return /error|failed|traceback|stack trace|stderr|exit code|exception|syntaxerror|typeerror|misalign|broken/i.test(text);
}

function inferNextActions(cleaned: string[], files: string[], foggyPreferenceQuestions: string[]) {
  const latestIntent = [...cleaned].reverse().find(isLikelyOpenQuestion);
  const actions = [
    "1. Re-read source files before editing; do not trust summarized code snippets.",
    foggyPreferenceQuestions.length
      ? "2. Ask the clarification queue only for choices still blocking the next edit."
      : latestIntent ? `2. Continue latest user intent: ${clip(latestIntent, 170)}` : "2. Ask user for current goal if latest intent unclear.",
    files[0] ? `3. Start with ${files[0]}; verify behavior with repo check command after changes.` : "3. Identify target files, then run narrowest available check command.",
    "4. Treat assumptions and noisy/error evidence above as leads, not facts.",
  ];
  return actions;
}

function unique(items: string[]) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function extractEntryText(entry: unknown) {
  if (!entry || typeof entry !== "object") return clip(String(entry), 400);
  const record = entry as Record<string, unknown>;
  if (typeof record.summary === "string") return record.summary;
  if (typeof record.content === "string") return record.content;
  const message = record.message as Record<string, unknown> | undefined;
  if (!message) return clip(safeStringify(entry), 400);
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .map((block) => typeof block === "object" && block && "text" in block ? String((block as { text?: unknown }).text ?? "") : "")
      .filter(Boolean)
      .join(" ");
  }
  return clip(safeStringify(entry), 400);
}

function extractPaths(entries: unknown[]) {
  const paths = new Set<string>();
  const pattern = /(?:~|\.|\/)?(?:[\w.-]+\/)+[\w.@-]+\.[A-Za-z0-9]+/g;
  for (const entry of entries) {
    for (const match of safeStringify(entry).matchAll(pattern)) {
      const path = match[0];
      if (!path.includes("node_modules") && !path.includes("target/release")) paths.add(path);
    }
  }
  return [...paths];
}

function clip(text: string, max: number) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function makeSessionHeatmap(pct: number, entries: unknown[]) {
  return `[${buildHeatmapCells(pct, entries).map((cell) => cell.mark).join("")}]`;
}

function buildContextCatExplanation(pct: number, entries: unknown[]) {
  const cells = buildHeatmapCells(pct, entries);
  const used = cells.filter((cell) => cell.mark !== ".");
  const rows = used.map((cell) => {
    const reasons = cell.reasons.length ? cell.reasons.slice(0, 4).join("; ") : "compact signal / no risk markers";
    const dimensions = cell.dimensions ? formatDimensionSummary(cell.dimensions) : "unused";
    return `| ${cell.index + 1} | ${cell.mark} | ${cell.score} | ${dimensions} | ${cell.entries} | ${reasons} |`;
  });

  return [
    "# Context Cat Explain",
    "",
    `Context usage: ${pct}%`,
    `Heatmap: [${cells.map((cell) => cell.mark).join("")}]`,
    "",
    "Legend: `=` good signal, `~` noisy/context-rot pressure, `!` hard error/toxic context, `.` unused window.",
    "",
    "| Cell | Mark | Risk | Dimensions | Entries | Why |",
    "|---:|:---:|---:|---|---:|---|",
    rows.length ? rows.join("\n") : "| - | . | 0 | - | 0 | no used context cells |",
    "",
    "## Scoring model",
    "Good context is not good words; it is useful structure: clear intent, captured slots/constraints, relevant evidence boundary, output format, and success/verification criteria.",
    "Yellow context has understanding risk: vague intent, missing slots, low context precision, weak recall, hallucination risk, contradictions, length, raw logs/diffs, ambiguity, distractors, or repetition.",
    "Red context has hard failures or impossible/toxic context: tool errors, exit code 1, stack traces, tracebacks, syntax/type errors, failed extension loads, contradictions, or huge entries.",
    "",
    "## Suggested fix",
    used.some((cell) => cell.mark === "!")
      ? "Summarize red cells into decisions/files/next actions, then re-read only source files needed."
      : used.some((cell) => cell.mark === "~")
        ? "Compress yellow cells by replacing raw logs/diffs/vague prose with a short verified summary."
        : "Context looks healthy. Keep adding only task-relevant anchors.",
    "",
  ].join("\n");
}

function buildHeatmapCells(pct: number, entries: unknown[]) {
  const usedCells = Math.round((Math.max(0, Math.min(100, pct)) / 100) * HEATMAP_CELLS);
  const contextEntries = entries.filter(isContextBearingEntry);

  return Array.from({ length: HEATMAP_CELLS }, (_, index) => {
    if (index >= usedCells) return { index, mark: ".", score: 0, entries: 0, reasons: [] as string[] };
    const start = Math.floor((index / Math.max(usedCells, 1)) * contextEntries.length);
    const end = Math.max(start + 1, Math.floor(((index + 1) / Math.max(usedCells, 1)) * contextEntries.length));
    const bucket = contextEntries.slice(start, end);
    const analyses = bucket.map(analyzeEntryRisk);
    const score = Math.max(0, ...analyses.map((analysis) => analysis.score));
    const hasHardFailure = analyses.some((analysis) => analysis.hardFailure);
    const mark = hasHardFailure || score >= 100 ? "!" : score >= 35 ? "~" : "=";
    const reasons = unique(analyses.flatMap((analysis) => analysis.reasons));
    const dimensions = mergeDimensions(analyses.map((analysis) => analysis.dimensions));
    return { index, mark, score, entries: bucket.length, reasons, dimensions };
  });
}

function isContextBearingEntry(entry: unknown) {
  if (!entry || typeof entry !== "object") return true;
  const record = entry as { type?: unknown; customType?: unknown };
  if (record.customType === "context-cat-explain") return false;
  const type = record.type;
  return type === "message" || type === "custom_message" || type === "compaction" || type === "branch_summary";
}

function classifyContextBucket(entries: unknown[]) {
  let hasNoisy = false;
  for (const entry of entries) {
    const mark = classifyEntry(entry);
    if (mark === "!") return "!";
    if (mark === "~") hasNoisy = true;
  }
  return hasNoisy ? "~" : "=";
}

function classifyEntry(entry: unknown) {
  const risk = analyzeEntryRisk(entry).score;
  if (risk >= 100) return "!";
  if (risk >= 35) return "~";
  return "=";
}

function analyzeEntryRisk(entry: unknown) {
  const text = safeStringify(entry);
  const lower = text.toLowerCase();
  let score = 0;
  const reasons: string[] = [];
  const userText = extractUserMessageText(entry);
  const clean = normalizeContextText(userText || text);
  const words = clean.split(/\s+/).filter(Boolean);
  const dimensions = analyzeUnderstandingDimensions(clean, words, userText);

  const hardFailures = [
    ['"iserror":true', "tool error flag"],
    ['"exitcode":1', "exit code 1"],
    ['"exit_code":1', "exit code 1"],
    ["traceback (most recent call last)", "python traceback"],
    ["uncaught exception", "uncaught exception"],
    ["failed to load extension", "failed extension load"],
  ];
  const hardReason = hardFailures.find(([needle]) => lower.includes(needle))?.[1];
  if (hardReason || text.length > 30_000) {
    return { score: 100, reasons: [hardReason ?? "huge entry >30k chars"], dimensions, hardFailure: true };
  }

  const quotedErrorTerms = ["stack trace", "syntaxerror", "typeerror"];
  if (quotedErrorTerms.some((needle) => lower.includes(needle))) addRisk(35, "quoted error/debug evidence");

  // Chroma context-rot lesson: length alone creates degradation; irrelevant/distracting text compounds it.
  if (text.length > 8_000) addRisk(45, "long entry >8k chars");
  else if (text.length > 4_000) addRisk(24, "long entry >4k chars");
  else if (text.length > 1_500) addRisk(10, "medium entry >1.5k chars");

  // Tool-result noise: useful short-term, usually not worth keeping raw deep in history.
  if (
    lower.includes('"stderr"') ||
    lower.includes('"stdout"') ||
    lower.includes("diff --git") ||
    lower.includes("node_modules") ||
    lower.includes("target/release") ||
    lower.includes("cargo build") ||
    lower.includes("npm install") ||
    lower.includes("bun install")
  ) addRisk(35, "raw tool/log/diff/install output");

  const signalHits = CONTEXT_SIGNAL_WORDS.reduce((hits, word) => hits + countPhrase(clean, word), 0);
  const structureRisk = understandingRisk(dimensions, words.length);
  if (structureRisk >= 100) addRisk(structureRisk, "contradictory/impossible prompt structure");
  else if (structureRisk >= 40) addRisk(structureRisk, "weak prompt-understanding structure");
  else if (structureRisk >= 20) addRisk(structureRisk, "partial prompt-understanding structure");

  const fillerHits = FILLER_WORDS.reduce((hits, word) => hits + countPhrase(clean, word), 0);
  const ambiguityHits = AMBIGUITY_WORDS.reduce((hits, word) => hits + countPhrase(clean, word), 0);
  const distractorHits = DISTRACTOR_PATTERNS.reduce((hits, phrase) => hits + countPhrase(clean, phrase), 0);
  const repetitionRatio = repeatedWordRatio(words);

  // Good context is focused: goal/spec/decision/file/test/expected/actual/next. Lack of anchors raises risk.
  if (words.length >= 35 && signalHits === 0) addRisk(18, "no task anchors");
  if (words.length >= 70 && signalHits <= 1) addRisk(12, "weak task-anchor density");

  // User prose can be context pressure when it is hedged, vague, or filler-heavy.
  if (userText) {
    const fillerDensity = fillerHits / Math.max(words.length, 1);
    if (fillerHits >= 6 || fillerDensity >= 0.08) addRisk(28, "filler-heavy user text");
    if (ambiguityHits >= 3) addRisk(14, "ambiguous/hedged user text");
    if (clean.includes("?") && signalHits === 0 && words.length > 70) addRisk(18, "long question without anchors");
  }

  // Research-inspired distractor/repetition risk: similar-looking or repeated material makes retrieval less reliable.
  if (distractorHits > 0) addRisk(22, "distractor/side-note phrase");
  if (repetitionRatio >= 0.28 && words.length >= 80) addRisk(20, "high repetition");

  return { score: Math.min(score, 95), reasons, dimensions, hardFailure: false };

  function addRisk(points: number, reason: string) {
    score += points;
    reasons.push(reason);
  }
}

function extractUserMessageText(entry: unknown) {
  if (!entry || typeof entry !== "object") return "";
  const record = entry as Record<string, unknown>;
  if (record.type !== "message") return "";
  const message = record.message as Record<string, unknown> | undefined;
  if (!message || message.role !== "user") return "";
  return extractEntryText(entry);
}

function analyzeUnderstandingDimensions(clean: string, words: string[], userText: string) {
  const intent = INTENT_WORDS.some((word) => countPhrase(clean, word) > 0) || /^\s*(can you|please|i want|i need|make|do|tell|show)\b/i.test(userText);
  const slots = SLOT_WORDS.reduce((hits, word) => hits + countPhrase(clean, word), 0);
  const evidence = EVIDENCE_WORDS.reduce((hits, word) => hits + countPhrase(clean, word), 0);
  const output = OUTPUT_WORDS.reduce((hits, word) => hits + countPhrase(clean, word), 0);
  const constraints = CONTEXT_SIGNAL_WORDS.reduce((hits, word) => hits + countPhrase(clean, word), 0);
  const ambiguity = AMBIGUITY_WORDS.reduce((hits, word) => hits + countPhrase(clean, word), 0);
  const distractors = DISTRACTOR_PATTERNS.reduce((hits, phrase) => hits + countPhrase(clean, phrase), 0);
  const contradiction = hasContradiction(clean);

  return {
    intent,
    slots: Math.min(slots, 3),
    evidence: Math.min(evidence, 2),
    output: Math.min(output, 2),
    constraints: Math.min(constraints, 4),
    ambiguity,
    distractors,
    contradiction,
    longEnoughToJudge: words.length >= 25,
  };
}

function understandingRisk(dimensions: ReturnType<typeof analyzeUnderstandingDimensions>, wordCount: number) {
  if (!dimensions.longEnoughToJudge) return 0;
  let risk = 0;
  if (!dimensions.intent) risk += 18;
  if (dimensions.slots === 0) risk += 14;
  if (dimensions.constraints === 0) risk += 12;
  if (dimensions.evidence === 0 && wordCount >= 80) risk += 8;
  if (dimensions.output === 0 && wordCount >= 50) risk += 8;
  if (dimensions.ambiguity >= 3) risk += 10;
  if (dimensions.distractors > 0) risk += 14;
  if (dimensions.contradiction) risk += 55;
  return risk;
}

function formatDimensionSummary(dimensions: ReturnType<typeof mergeDimensions>) {
  const parts = [
    dimensions.intent ? "intent" : "no-intent",
    dimensions.slots ? `slots:${dimensions.slots}` : "no-slots",
    dimensions.evidence ? "evidence" : "no-evidence",
    dimensions.output ? "output" : "no-output",
  ];
  if (dimensions.contradiction) parts.push("contradiction");
  if (dimensions.ambiguity) parts.push(`amb:${dimensions.ambiguity}`);
  return parts.join(", ");
}

function mergeDimensions(items: Array<ReturnType<typeof analyzeUnderstandingDimensions>>) {
  return {
    intent: items.some((item) => item.intent),
    slots: Math.max(0, ...items.map((item) => item.slots)),
    evidence: Math.max(0, ...items.map((item) => item.evidence)),
    output: Math.max(0, ...items.map((item) => item.output)),
    constraints: Math.max(0, ...items.map((item) => item.constraints)),
    ambiguity: Math.max(0, ...items.map((item) => item.ambiguity)),
    distractors: Math.max(0, ...items.map((item) => item.distractors)),
    contradiction: items.some((item) => item.contradiction),
    longEnoughToJudge: items.some((item) => item.longEnoughToJudge),
  };
}

function hasContradiction(text: string) {
  return /\b(detailed|comprehensive|thorough)\b.*\b(short|brief|concise)\b|\b(short|brief|concise)\b.*\b(detailed|comprehensive|thorough)\b|\buse only\b.*\b(use anything|outside knowledge|web)\b/i.test(text);
}

function normalizeContextText(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9\s?./_-]/g, " ").replace(/\s+/g, " ").trim();
}

function repeatedWordRatio(words: string[]) {
  if (!words.length) return 0;
  const counts = new Map<string, number>();
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  return Math.max(...counts.values()) / words.length;
}

function countPhrase(text: string, phrase: string) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.match(new RegExp(`\\b${escaped}\\b`, "g"))?.length ?? 0;
}

function countChars(text: string, char: string) {
  return [...text].filter((item) => item === char).length;
}

function maxVisibleWidth(lines: string[]) {
  return Math.max(0, ...lines.map(visibleWidth));
}

function padVisible(text: string, width: number) {
  return `${text}${" ".repeat(Math.max(0, width - visibleWidth(text)))}`;
}

function rightBox(lines: string[], width: number) {
  return lines.map((line) => `${" ".repeat(Math.max(0, width - visibleWidth(line)))}${line}`);
}

function visibleWidth(text: string) {
  return [...stripAnsi(text)].reduce((width, char) => width + charWidth(char), 0);
}

function charWidth(char: string) {
  const code = char.codePointAt(0) ?? 0;
  if (code === 0) return 0;
  if (code < 32 || (code >= 0x7f && code < 0xa0)) return 0;
  if (
    code >= 0x1100 &&
    (code <= 0x115f ||
      code === 0x2329 ||
      code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6))
  ) return 2;
  return 1;
}

function stripAnsi(text: string) {
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}
