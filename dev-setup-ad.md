# Setup Agent Desktop

One-time setup for each machine: install the `agent-desktop` CLI, and check its permissions from an interactive and a headless Orbh session. There is no configuration to record.

# Prerequisites

- Node.js 18 or later, and `npm` on the PATH
- macOS 13 or later (Intel or Apple Silicon), Windows, or Linux with a graphical session and `at-spi2-core`
- A person at the machine for the permission grant in System Settings (macOS)

# Actions

1. **Install the CLI globally.** Let its install script run, so that the command is the native binary and not a Node launcher (more than 100 ms for each call):
   ```bash
   npm i -g agent-desktop --allow-scripts=agent-desktop     # npm 11
   npm install-scripts approve agent-desktop                # npm 12, then: npm i -g agent-desktop
   ```
2. **Check which binary runs.** An old Homebrew tap or Scoop bucket can hide the npm command:
   ```bash
   command -v agent-desktop
   agent-desktop version
   agent-desktop status
   ```
   `status` gives the platform, the permissions, and `supported_surfaces`. On Linux, an empty `supported_surfaces` means that the AT-SPI bus did not answer.
3. **Check the permissions in this interactive session.**
   ```bash
   agent-desktop permissions
   ```
   - `accessibility` must be `granted`. `screen_recording` is necessary only for `screenshot`. `automation` stays `unknown` until macOS must ask.
   - When a permission is `denied`, run `agent-desktop permissions --guide`. It opens System Settings with a panel that names the app to add. **A person must do the grant** (Touch ID or a password). Then run `agent-desktop permissions` again: no restart is necessary.
   - On macOS the grant belongs to the app that started the process (Obsidian, Ghostty, iTerm2, Terminal, VS Code), not to the shell. Each app that runs agents needs its own grant. Under tmux or SSH, add the terminal app that started tmux.
4. **Check the permissions from a headless Orbh session.** A headless session starts from the Orbh orchestrator, not from the terminal of the person, so the grant can differ. Dispatch one small subagent:
   ```bash
   flint orbh request -q <runtime/profile> 'Run `agent-desktop permissions` and `agent-desktop snapshot --app Finder -i --compact`. Do not act on any element and do not print the tree. Return the permissions JSON, and ok, data.ref_count, and error.code of the snapshot.'
   ```
   - When it reports `granted` and a snapshot with refs, headless sessions can use the shard.
   - When it reports `denied`, a person adds the `agent-desktop` binary itself in System Settings > Privacy & Security > Accessibility (the real file of `command -v agent-desktop`, after symbolic links). Then dispatch the check again. When the grant is still not possible, write in the Flint Init that only interactive sessions use the shard on this machine.
5. **Run one smoke test** on an app that the person does not use now. Calculator is a good target when it does not run:
   ```bash
   S=$(flint shard ad desktop start)     # run this block in one shell call: $S does not reach the next call
   flint shard ad desktop claim Calculator
   agent-desktop --session "$S" launch Calculator
   agent-desktop --session "$S" snapshot --app Calculator -i --compact   # refs for the buttons
   agent-desktop --session "$S" close-app Calculator                     # delivered_verified
   flint shard ad desktop end
   ```
6. **Mark the setup complete.**
   ```bash
   flint shard setup ad --complete
   ```

# Verification

- `agent-desktop version` prints a version, and `agent-desktop permissions` shows `accessibility: granted`.
- The headless check of action 4 has a result.
- `flint shard ad desktop list` runs and shows no open agent-desktop session after the smoke test.
