# Agent Desktop

Operate native desktop apps from inside a Flint with the [`agent-desktop`](https://github.com/vercel-labs/agent-desktop) CLI. The CLI reads the accessibility tree of the OS (macOS AX, Windows UIA, Linux AT-SPI) and acts on refs from a snapshot, with no pixel matching.

**Shorthand:** `ad` · **Load:** `flint shard start ad`

## The Model

A machine has one desktop, and the person uses it at the same time as the agents. Each Orbh session gets its own agent-desktop session, claims the apps that it drives, and leaves the desktop as it found it. Only one session at a time can hold the headed claim, which permits physical input.

```bash
flint shard ad desktop list                  # the permissions, the claims, clashes, open agent-desktop sessions
flint shard ad desktop start                 # one agent-desktop session for this Orbh session → id S
flint shard ad desktop claim "<App>"         # claim an app (--headed: the one headed claim of the machine)
agent-desktop --session S snapshot --app "<App>" -i --compact   # observe → click @<snapshot>:eN → observe again
flint shard ad desktop end                   # end the agent-desktop session and clear the claim
```

The claim is the `desktop` key on the Orbh session interface. The shard has no state file.

## What Is Here

| File | Purpose |
|------|---------|
| `dev-init-ad.md` | The entry point: the model, the desktop script, the safety rules, the end of a task, and the headless rules |
| `dev-setup-ad.md` | The setup for each machine: install the CLI, check the permissions from an interactive and a headless session |
| `knowledge/dev-knw-ad-cli.md` | The usage model: the envelope, sessions, the loop, refs, delivery and retry, headless and headed input, surfaces, waits, Electron, private content, troubleshooting |
| `skills/dev-sk-ad-use_desktop.md` | The entry point for "do X in a desktop app": start, claim, drive, verify, close, end |
| `scripts/dev-desktop.js` | `flint shard ad desktop <list\|start\|id\|claim\|release\|end\|gc>` |

## Design

The shard is thin, the same as Agent Browser. The CLI contains its own guides, matched to its version (`agent-desktop skills get desktop`, `agent-desktop skills get platform`). This shard keeps only the rules that do not go stale and the conventions of the workspace for a desktop that agents and a person share. When the shard and the CLI disagree, the CLI wins.

Agent Desktop and Agent Browser work together on Electron and Chromium apps: `agent-desktop launch "<App>" --cdp` opens a DevTools port, Agent Browser drives the web content, and agent-desktop keeps the native UI.

## Source

The `agent-desktop` CLI is published by [vercel-labs/agent-desktop](https://github.com/vercel-labs/agent-desktop) under Apache-2.0.
