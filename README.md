# my-pi-setup

Personal configuration repo for my [Pi coding-agent](https://pi.dev) setup.

This repo snapshots the custom Pi extensions and themes I use across projects so the setup can be reviewed, versioned, and restored on a new machine.

## What is included

```text
extensions/
  agentmemory/          Cross-session memory tools backed by a local agentmemory server
  contextia/            Contextro/Contextia codebase indexing and semantic search tools
  subagents/            Scout/researcher/reviewer/worker subagent orchestration
  codegraph.ts          @colbymchenry/codegraph integration tools
  copy-all.ts           Copy/export helper command
  crawl4ai-search.ts    Local Crawl4AI web search and scraping tools
  diff.ts               Diff display helper
  flow-title.ts         Session/title helper
  learn-anything.ts     /learn and /learn-codebase commands for learning workflows
  obsidian-brain.ts     Durable Obsidian wiki memory tools
  opencode-zen-login.ts OpenCode Zen login helper
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

Personal setup repository. Treat as reference unless a license is added.
