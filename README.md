# gstack Studio

A local web UI for gstack's ideation sprint — run **Office Hours → CEO Review → Design Review → Eng Review → Design Doc** in your browser without touching a terminal.

## Prerequisites

You need two things installed before running gstack Studio:

1. **Claude Code** — [claude.ai/code](https://claude.ai/code)
   ```sh
   npm install -g @anthropic-ai/claude-code
   claude login
   ```

2. **gstack** — the skills that power each sprint phase
   ```sh
   npm install -g gstack
   ```

If anything is missing, gstack Studio will detect it on launch and show you exactly what to install.

## Download

1. Grab `gstack-studio` and `launch.command` from [Releases](../../releases)
2. Put both files in the same folder
3. Double-click `launch.command`

Your browser opens automatically.

> **First launch only:** macOS may show a security warning on `launch.command`. Right-click it → **Open** → **Open** to allow it. This only happens once.

No Bun, no Node, no terminal required after setup.

## Usage

1. Double-click `gstack-studio` (or run `./gstack-studio` in a terminal)
2. Your browser opens at `http://localhost:3000`
3. Describe your idea and click **Start Sprint**
4. Work through each phase — answer questions, click **Move to next phase** when ready
5. Download your **Design Doc** at the end

Past sprints are saved automatically and appear on the start screen. You can reload any previous sprint to review its output or continue from where you left off.

## Developer Setup

Clone the repo and run with hot reload:

```sh
bun install
bun run start
```

Build the standalone binary:

```sh
bun run build
```

Output: `./gstack-studio` (~58MB, includes the Bun runtime).

## How It Works

```
Browser UI  ←→  Bun HTTP server (localhost:3000)
                    ↓
              claude CLI subprocess
                    ↓
              gstack skills (~/.claude/skills/)
```

- Each sprint phase spawns a `claude` subprocess with the appropriate gstack skill
- Output streams to the browser via SSE in real time
- Sessions are persisted to `~/.gstack-studio/sessions/` as JSON
- The binary embeds all static assets — nothing to deploy, nothing to configure

## License

MIT
