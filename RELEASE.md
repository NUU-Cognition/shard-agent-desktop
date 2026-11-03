# 0.1.0

- First version (NUU Flint Task 1325), modelled on Agent Browser 0.11.5, for `agent-desktop` 1.0.2.
- The model: one desktop for each machine, shared with the person. Each Orbh session gets its own agent-desktop session and claims the apps that it drives.
- The script `flint shard ad desktop` (`list`, `start`, `id`, `claim`, `release`, `end`, `gc`). The claim is the `desktop` key on the Orbh session interface. Only one live Orbh session can hold the headed claim.
- The skill `use_desktop`: check, start, claim, drive with the observe-act-verify loop, close only what you launched, end.
- The knowledge `knw-ad-cli`: the envelope, sessions, refs, delivery and retry, headless and headed input, surfaces, waits, Chromium and Electron with Agent Browser, private content, troubleshooting, and the zsh trap with `$VAR:e1`.
- The setup checks the Accessibility grant from an interactive session and from a headless subagent, because the app that starts the process owns the grant on macOS.
- No artifact type. A type `(Desktop App)` for the notes of each app can come when two or three apps need one.
- The first outside test of `use_desktop` (NUU Flint session 7ce86fa6) changed the first version: `desktop start` prints only the id on stdout; `desktop claim` warns when one name is inside the other, and gives a note when no running app has that display name; the skill has a branch for a running app with no window, the rule for `press`, the dead end of `select`, `batch`, and `-i` for a value; the guides of the CLI are read only when needed.
