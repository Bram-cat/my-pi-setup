# my-pi-setup

Personal Pi coding-agent setup: global extensions and themes from `~/.pi/agent`.

## Contents

- `extensions/` — Pi extensions auto-discovered from `~/.pi/agent/extensions`.
- `themes/` — Pi TUI themes auto-discovered from `~/.pi/agent/themes`.
- `scripts/install.sh` — restores this repo into a Pi agent directory.

## Install / restore

```bash
./scripts/install.sh
```

By default this installs into `~/.pi/agent`. To install elsewhere:

```bash
PI_AGENT_DIR=/path/to/.pi/agent ./scripts/install.sh
```

After installing, restart Pi or run `/reload`.

## Notes

Secrets and local runtime state are intentionally not included. This repo excludes `.env*`, `auth.json`, and `node_modules`.
