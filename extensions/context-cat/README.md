# Context Cat

![Context Cat preview](./assets/context-cat-preview.png)

Animated Pi context-window companion widget.

Context Cat shows a small cat above the editor, tracks current context usage, paints a compact heatmap of useful/noisy/bad context, and can create a handoff session when the context window gets risky.

## Commands

- `/context-cat` — repaint/show the widget
- `/context-cat-handoff` — open a compact Context Cat handoff session immediately

## Behavior

Context Cat follows a simple context-engineering model inspired by common coding-agent practice: keep compact goals, decisions, constraints, files, tests, and next actions; mark bulky logs, diffs, vague prose, and failures as context pressure.

- Green cells: compact useful context with enough signal to keep
- Yellow cells: bulky/noisy context such as long stdout, diffs, installs, large tool output, or filler-heavy user text
- Red cells: stack traces, failed extension loads, hard errors, or oversized context entries

Low-signal user text is yellow, not red. It is detected from a standard feature set: filler/hedging words (`just`, `basically`, `maybe`, `probably`, `stuff`, `things`, etc.), weak signal density, and missing task anchors like `goal`, `spec`, `decision`, `file`, `test`, `expected`, `actual`, or `next`.

Auto-handoff triggers near high context usage or when red/noisy zones accumulate.

## Install dependencies

```bash
cd ~/.pi/agent/extensions/context-cat
bun install
```

Pi discovers this extension from `~/.pi/agent/extensions/context-cat/index.ts`.
