---
description: "The agent-desktop CLI — the JSON envelope, sessions, the observe-act-verify loop, qualified refs, delivery and retry, headless and headed input, surfaces, waits, apps and windows, Chromium and Electron, private content, and troubleshooting"
---

# Knowledge: The agent-desktop CLI

`agent-desktop` is a Rust CLI from Vercel Labs. It reads and operates desktop apps through the accessibility tree of the OS (macOS AX, Windows UIA, Linux AT-SPI). It is a tool, not an agent: you run the loop. This file keeps only the rules that do not go stale, and the conventions of this workspace. It was checked against agent-desktop 1.0.2.

**The CLI is the authority.** It contains its own guides, matched to the installed version. When this file and the CLI disagree, the CLI wins.

```bash
agent-desktop status                          # the platform, the permissions, the supported surfaces
agent-desktop skills get desktop              # the loop, refs, delivery, and the retry rules
agent-desktop skills get platform             # what differs on this OS
agent-desktop skills get desktop workflows    # worked patterns and the anti-patterns
agent-desktop skills get desktop <commands-observation|commands-interaction|commands-system>
agent-desktop <command> --help                # the flags of one command
```

Each `skills get` prints a JSON envelope. The guide text is in `data.content`: `agent-desktop skills get desktop | jq -r '.data.content'`.

## The JSON Envelope

Each command prints one JSON envelope on stdout: `{ version, ok, command, data }` or `{ version, ok: false, command, error }`.

- Branch on `ok`, `error.code`, and the disposition. Do not branch on `message` or `suggestion`: their text can change.
- An action result has `data.disposition`. An error has `error.disposition`. Each disposition has `delivery` and `retry`.
- `data.steps` names the mechanism of each step: `semantic_api` is an accessibility call, and `physical_synthetic` is synthesized input.

## Sessions

An agent-desktop session is a folder under `~/.agent-desktop/sessions/<id>/` (`AGENT_DESKTOP_HOME` moves the root). It holds the snapshots of the session and, when the trace is on, a trace. In this workspace, each Orbh session has its own agent-desktop session, and the script of the shard makes it:

```bash
flint shard ad desktop start                  # stdout has only the id run-<ms>-<pid>-<n>; the messages go to stderr; stored in the Orbh key `desktop`
flint shard ad desktop id                     # prints the id again
```

- **Pass `--session <id>` to every command, with the literal id.** Each shell call of an agent is a new process, so an `export AGENT_DESKTOP_SESSION=…` or a variable such as `$S` does not reach the next call. In this file, `<S>` is the literal id.
- **A ref belongs to its session.** A ref from one session fails with `SNAPSHOT_NOT_FOUND` in another session, or with no session.
- **An ended session refuses every command** except `version` and `skills` (`INVALID_ARGS`, `details.kind: "session_ended"`). So close your apps and read the trace before `flint shard ad desktop end`. The trace files stay in `~/.agent-desktop/sessions/<id>/trace/`.
- `agent-desktop --session <id> trace show` reads the trace of an open session. `trace export --out <file>` writes an HTML viewer. Write it in `$ORBH_SCRATCH_DIR`.
- `session start --screenshots` stores a screenshot before and after each action. These files are not redacted. Use it only when the person asks for it.

## The Loop: Observe, Act, Verify

```bash
agent-desktop --session <S> snapshot --app "Calculator" -i --compact    # observe: each actionable element has a ref
agent-desktop --session <S> click @s1nyctnh1u0fzn:e6                    # act on a qualified ref
agent-desktop --session <S> snapshot --root @s1nyctnh1u0fzn:e1 --compact # verify: read the same region again, with no -i
```

- **A small app:** take a full `snapshot --app "<App>" -i --compact`.
- **A dense app** (Slack, Xcode, an Electron app): map it first, then look inside one region. `snapshot --skeleton --app "<App>" -i --compact` gives a shallow map with `children_count` on each cut branch. `snapshot --root @<ref> -i --compact` reads one region.
- **A known target:** `find --app "<App>" --role button --name "Save" --first` returns the ref with no snapshot of the tree.
- **Never take a skeleton of a menu, sheet, or alert.** Each one is already small.
- **Do not read the full menu bar.** `--surface menubar -i` gave 176 refs on Calculator, and a skeleton of it still gave 82. To reach one item, use `find --app "<App>" --surface menubar --name "<Item>" --first`.
- **Verify by reading, not by the return code.** An accessibility call can return success and do nothing. Read again with a drill-down snapshot, `get`, or `is`.
- **`-i` hides static text.** It keeps only interactive elements, and static text gets no ref. To read a label or a display (for example the result of Calculator), take a drill-down snapshot of the region with no `-i`, and read the `name` or `value` of the text node. `get --property value` on the container can return `null`.
- **A displayed value can hold invisible characters.** The display of Calculator reads U+200E and then `144`, so an exact compare with `144` fails. Remove the format characters first, for example with `jq 'gsub("\\p{Cf}"; "")'`.

## Refs

- A ref is qualified: `@<snapshot_id>:e<N>`, for example `@s8f3k2p9:e8`. A bare `@e8` fails with `INVALID_ARGS`. Give the ref exactly as the snapshot printed it.
- A ref is valid for one observation. After a change of the UI, take a new snapshot of the region. A drill-down gives new refs to the elements in its region.
- `STALE_REF`: the ref does not match the live UI. Take a new snapshot.
- `AMBIGUOUS_TARGET`: more than one element or window matches. Narrow the target with `find --role --name --exact`, `--root`, or `--window-id` (the snapshot lists the candidate window ids in `error.details`).
- `SNAPSHOT_NOT_FOUND`: the snapshot expired, or the command ran in another session. Take a new snapshot in the same session.

**The zsh trap.** zsh reads `$VAR:e1` as the variable with the modifier `:e`, so `"@$SNAP:e1"` becomes `@1`. Write `"@${SNAP}:e1"`, or give the ref as text. In PowerShell, put each ref in quotes (`'@s8f3k2p9:e1'`).

## Delivery and Retry

| `delivery` | What it means | What to do |
|---|---|---|
| `not_delivered` | No input reached the app. `retry` is `safe`. | Fix the cause, then run the command again |
| `delivered_unverified` | The input was sent, but no effect was confirmed | Read the state. Do not repeat the action |
| `delivered_verified` | The effect was confirmed (for example `close-app` with `details.evidence: "process_instance_exited"`) | Continue |
| Any other value | The action can have landed | Read the state. Do not repeat the action |

- **Retry an action only when `disposition.retry` is `safe`.** A repeat of a delivered action can click, type, or submit two times, and a second `toggle` undoes the first.
- After a result that is not safe, read the live state (`get`, `is`, or a new snapshot), and decide from that state. `details.post_state` helps when it is there.
- `details.retryable: false` means that a wait cannot change the result. Use another approach.
- An action waits up to 5000 ms for its target to become actionable (`--timeout-ms 0` turns this off), then fails with `TIMEOUT`.

## Headless and Headed Input

Each ref action is **headless** by default. It uses accessibility calls only. It does not take focus, move the pointer, synthesize keys, or use the clipboard, so it is safe while a person uses the desktop. When no accessibility path exists, the action fails closed (`ACTION_NOT_SUPPORTED`, `POLICY_DENIED`). It never changes to physical input by itself.

The global flag `--headed` is a permission for physical input: it can take focus, move the real pointer, and synthesize keys and pointer events. In this workspace:

- Use `--headed` only when the step needs physical input by nature (a drag, a hover, a double-click with no `AXOpen`) **and** the person permits it.
- Take the headed claim first: `flint shard ad desktop claim "<App>" --headed`. Only one Orbh session on the machine can hold it. Release it after the step: `flint shard ad desktop release --headed`.
- **Never add `--headed` to recover from a headless failure.** The failure means that the semantic path is missing or that the UI changed. A headed retry moves the pointer of the person, and it can act two times. Take a new snapshot, wait for `actionable`, or use the semantic command (`set-value` for `type`, `check` for `click` on a checkbox).
- `POLICY_DENIED` means that the policy blocked a physical or focus path. Nothing was delivered. Ask the person before any headed retry.
- On macOS, `double-click` (with no `AXOpen`), `triple-click`, `hover`, `drag`, and the `mouse-*` commands need `--headed`. `agent-desktop skills get platform` has the table for each OS.
- A physical result is usually `delivered_unverified`. Read the state after it.

**`press` is the exception.** It is always synthesized key input: the result reports `physical_synthetic` also with no `--headed`. In this workspace:

- `press <keys> --app "<App>"` needs no headed permit, in an app that you claim. The keys go to that process, the focus stays, and the pointer does not move.
- A key acts as the app defines it. Escape cleared the display of Calculator. So use a semantic command when one exists, read the state after each key, and do not repeat a key: `retry` is `unsafe`.
- `press` with no `--app` or `--window-id` goes to the foreground app, which can be the app of the person. Never run it without a headed permit and the headed claim.
- `press --app` fails with `ACTION_FAILED` and `not_delivered` when the app has no focused element, for example when it has no window.

## Surfaces

A surface is a UI layer that you observe alone: `menu`, `menubar`, `sheet`, `popover`, `alert`, or `focused` (on macOS, `status` lists them in `supported_surfaces`).

- `find --app "<App>" --surface menubar --name "<Item>" --first` reaches one item of the File, Edit, and View menus. A headless `click` on its ref works (`semantic_api`).
- An action that opens a menu, sheet, or alert lists it in `data.surfaces`. Read that surface next.
- **While a surface is open, the refs of the window behind it are the wrong target.**
- On macOS, when `right-click` returns `APP_UNRESPONSIVE` with `retry: unsafe`, the menu is open: do not retry. Read it with `--surface menu`. For a combo box or a menu button, use `select @<ref> "<Option>"`.
- `select` can refuse a control with the role `button` (`ACTION_NOT_SUPPORTED`, with `delivery` and `retry` both `unknown`), and a `click` on it can return `ok: true` and open no surface (the Mode control of Calculator). Read the state, and then use the same command in the menu bar.

## Waits

After an asynchronous step (a launch, a save, a load), use `wait` with a predicate. A fixed `sleep` is a race. `agent-desktop wait --help` lists the predicates. Three common forms:

```bash
agent-desktop --session <S> wait --window "<Title>" --app "<App>"    # after a launch: it needs no ref, and the title is in data.window.title
agent-desktop --session <S> wait --element @<ref> --predicate actionable
agent-desktop --session <S> wait --notification --app "<App>"        # a banner that goes away before you list it
```

## Apps, Windows, Keys, and the Clipboard

| Command | Notes |
|---|---|
| `list-apps`, `list-windows --app "<App>"` | `--app` takes the display name that `list-apps` prints. A window id (`w-4521`) is valid for the life of the window. `list-windows` returns `APP_NOT_FOUND` for an app that does not run, and `ok: true` with an empty list for an app that runs with no window |
| `launch "<App>"` | A display name or a bundle id. It returns when the process runs. With no `--activate`, the new window does not take the focus. `--activate` brings the app to the front and waits for a window: that takes the focus of the person. The result can show `visible: false` and zero bounds until the window is ready: use `wait --window` |
| `find --app "<App>" --role <role> --name "<Name>" --first` | The ref is in `data.match.ref_id`, with its `snapshot_id` |
| `close-app "<App>"` | Only for an app that you launched in this task. A protected process of the OS is refused |
| The Close button of a window | Some apps quit with their last window (Dictionary), and some keep running with no window (Script Editor) |
| `press cmd+s --app "<App>"` | Sends synthesized keys to one app without a change of focus (§ Headless and Headed Input). On macOS the modifier is `cmd` |
| Quit shortcuts (`cmd+q`, …) | `POLICY_DENIED` unless `--force`. Never pass `--force`: use `close-app` for an app that you launched |
| `clipboard-get`, `clipboard-set`, `clipboard-clear` | The clipboard of the person. See the rules of the init |
| `batch '[{"command":"click","args":{"ref_id":"@<snapshot>:e3"}}]'` | Many commands in one process, in order. It is not atomic. The envelope has `ok: true` even when an entry fails: read each `data.results[].ok`. `--stop-on-error` halts at the first failure. `--headed` applies to each entry |

## Chromium and Electron Apps

agent-desktop reads a Chromium or Electron app through the accessibility tree, and it turns on the web accessibility of the renderer when it needs it. A dense app is slow to walk, so take a skeleton first.

For the web content of an app that you can start fresh, use agent-desktop to start it with a DevTools port, and the Agent Browser shard (`ab`) to drive the web content:

```bash
agent-desktop --session <S> launch "Obsidian" --cdp --arg=--user-data-dir="$ORBH_SCRATCH_DIR/obsidian-profile"
# data.cdp.port → agent-browser --cdp <port> snapshot -i   (the skill use_electron of the shard ab)
```

- `--cdp` refuses an app that already runs (`ACTION_FAILED`, `details.kind: cdp_requires_fresh_launch`), because a running process has no port. Do not quit the app of the person to get one. A throwaway instance with its own `--user-data-dir` is a second process.
- The native UI (the menu bar, file dialogs, sheets, windows, notifications) stays on agent-desktop.
- While the port is open, each local process of the same user can control the web content. `close-app` ends the process and the port.

## Private Content

Snapshots, screenshots, the clipboard, notifications, traces, and the `--screenshot <PATH.html>` debug output can show the private content of the person: messages, documents, names, and accounts.

- Write each such file in `$ORBH_SCRATCH_DIR`. Never put it in the Mesh, a commit, a message to another session, or an upload.
- Print only the parts of a snapshot that the task needs. Do not paste a full tree into a result.
- Screen Recording is necessary only for `screenshot` and `session start --screenshots`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `PERM_DENIED`, or `permissions` shows `denied` | The app that started this process has no Accessibility grant | Do the setup of the shard: [[dev-setup-ad]] |
| Few nodes or no refs | Missing permission, a custom-drawn UI, or a Chromium renderer that is not ready | Check `permissions`, drop `-i`, raise `--timeout-ms`, and run `list-surfaces` |
| `complete: false`, or a slow snapshot | A deep tree ran out of time | `find`, or a skeleton and `--root` |
| `WINDOW_NOT_FOUND` | The app has no open window. `snapshot` and `find` both return it | `list-windows --app "<App>"`. Start a window only when the task needs one: `launch "<App>" --activate` takes the focus of the person, so ask first |
| `"Invalid ref_id '@1'"` | The zsh trap | Write `"@${SNAP}:e1"` |
| `select` cannot confirm the choice | A menu was open before | Close the open menu, then run `select` again |
| `ACTION_NOT_SUPPORTED` from `select` | The control has no select path | Read the state. Use the same command in the menu bar (§ Surfaces) |
| `ACTION_FAILED` from `press --app` | The app has no focused element | Use a semantic command, or the same command in the menu bar |
| A shortcut does nothing | `ctrl` used for `cmd`, or the keys went to another app | Use `cmd+…`, or scope the keys with `--app` |
| Any other error | — | `agent-desktop skills get platform troubleshooting` |
