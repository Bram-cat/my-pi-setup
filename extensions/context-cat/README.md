# Context Cat

Animated Pi context-window companion widget.

Context Cat shows a small cat above the editor, tracks current context usage, paints a compact heatmap of useful/noisy/bad context, and can create a handoff session when the context window gets risky.

## Commands

- `/context-cat` — repaint/show the widget
- `/context-cat-handoff` — open a compact Context Cat handoff session immediately

## Behavior

- Green cells: compact useful context
- Yellow cells: bulky/noisy context such as long stdout, diffs, installs, or large tool output
- Red cells: stack traces, failed extension loads, or oversized context entries

Auto-handoff triggers near high context usage or when red/noisy zones accumulate.

## Install dependencies

```bash
cd ~/.pi/agent/extensions/context-cat
bun install
```

Pi discovers this extension from `~/.pi/agent/extensions/context-cat/index.ts`.
