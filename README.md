# my-pi-setup

Personal configuration repo for my [Pi coding-agent](https://pi.dev) setup.

This repo snapshots the custom Pi extensions and themes I use across projects so the setup can be reviewed, versioned, and restored on a new machine.

## What is included

```text
extensions/
  agentyc-mcp/          MCP bridge for agentyc browser automation (66 tools: navigate, click,
                        type, extract, screenshots). Auto-connects on startup. `/agentyc` to status.
  agentmemory/          Cross-session memory tools backed by a local agentmemory server
  contextia/            Contextro/Contextia codebase indexing and semantic search tools
  subagents/            Scout/researcher/reviewer/worker subagent orchestration
  code-improve/         /code-improve and /code-review commands — deep multi-axis code quality review
                        dispatching sub-agents (Architect, Reviewer, Minimalist, Security)
  codegraph.ts          @colbymchenry/codegraph integration tools
  copy-all.ts           Copy/export helper command
  crawl4ai-search.ts    Local Crawl4AI web search and scraping tools
  diff.ts               Diff display helper
  flow-title.ts         Session/title helper
  learn-anything.ts     /learn and /learn-codebase commands for learning workflows
  obsidian-brain.ts     Durable Obsidian wiki memory tools
  opencode-zen-login.ts OpenCode Zen login helper
  design-polish/        /design-polish command, skill, audit helpers, and Remotion video templates
  tps-tracker.ts        Tokens-per-second status tracker
  usage.ts              Usage/cost analysis helper
  yeet.ts               Fast command/helper extension
  zsh-user-bash.ts      Shell/user environment helper

themes/
  github-dark-default.json
```

## What is intentionally excluded

Secrets and machine-local runtime state are **not** committed:

- `.env` / `.env.*`
- `auth.json`
- `node_modules/`
- session logs
- provider tokens or API keys

## Browser automation (agentyc MCP)

This setup includes an MCP bridge extension that spawns `agentyc mcp` as a child process,
discovers all 66 tools via the Model Context Protocol, and registers them with Pi's tool
system so the LLM can call them directly.

**Commands:**
- `/agentyc` — show connection status and tool list
- `/agentyc restart` — restart the MCP server

**Prerequisite:** `uv tool install agentyc` (or `pip install agentyc`)

**Install dependencies:** `cd ~/.pi/agent/extensions/agentyc-mcp && bun install`

## Code quality commands

This setup includes a `code-improve` extension that runs deep multi-axis code quality review.
It combines candid-review methodology with ambitious structural improvement
(code judo, anti-spaghetti, 1k-line boundary) and dispatches specialized sub-agents
in parallel for a complete audit.

```text
/code-improve [path] [options]
/code-review  (shorthand alias)
```

Options:

- `--harsh` / `--constructive` — tone control
- `--focus security|performance|architecture|edge-case` — narrow the review
- `--auto-commit` — auto-commit fixes after user selects them
- `--exclude <pattern>` — skip matching files

**Sub-agents dispatched (parallel):**

| Agent | Focus |
|-------|-------|
| 👁️ Code Reviewer | Correctness, security, maintainability, performance |
| 🏛️ Software Architect | Structure, boundaries, code judo, anti-spaghetti, 1k-line gate |
| 🪡 Minimal Change Engineer | Scope discipline, diff size, no premature abstraction |
| 🔒 Security Engineer | Auto-dispatched when auth/data changes |

## Learning commands

This setup includes a small `learn-anything.ts` extension that routes learning requests into the Understand-Anything workflow when those skills are installed.

```text
/learn <topic, repo, folder, or concept>
/learn-codebase [path]
```

Use it when you want Pi to teach you a codebase, architecture, domain model, or knowledge base instead of just making edits.

## Install / restore

Clone the repo, then run:

```bash
./scripts/install.sh
```

By default the script installs into:

```text
~/.pi/agent
```

To restore into a different Pi agent directory:

```bash
PI_AGENT_DIR=/path/to/.pi/agent ./scripts/install.sh
```

After installing, restart Pi or run:

```text
/reload
```

The `design-polish` extension also has its own local package for Remotion-based video mode. If you want video rendering available after install, run:

```bash
cd ~/.pi/agent/extensions/design-polish
bun install
```

## How Pi discovers these files

Pi auto-discovers global extensions from:

```text
~/.pi/agent/extensions/*.ts
~/.pi/agent/extensions/*/index.ts
```

Pi auto-discovers global themes from:

```text
~/.pi/agent/themes/*.json
```

## Update this repo from the local Pi setup

From this repo:

```bash
rsync -a --delete --exclude 'node_modules/' ~/.pi/agent/extensions/ extensions/
rsync -a --delete ~/.pi/agent/themes/ themes/
git status
```

Review the diff before committing so secrets or local state never get added.

## License

This repository is licensed under the [MIT License](./LICENSE).

You can use, copy, modify, and share this setup, but it is provided as-is with no warranty. Third-party tools, package names, trademarks, and services referenced by these extensions remain under their own licenses and terms.
