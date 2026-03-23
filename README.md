# gstack Studio

Run a full product ideation sprint in your browser — **Office Hours → CEO Review → Design Review → Eng Review → Design Doc** — powered by Claude Code and gstack.

## Prerequisites

Install these once before your first run:

1. **Claude Code**
   ```sh
   npm install -g @anthropic-ai/claude-code
   claude login
   ```

2. **gstack**
   ```sh
   npm install -g gstack
   ```

> If anything is missing, gstack Studio will detect it and show you exactly what to install when you open it.

## Start

```sh
npx gstack-studio
```

Your browser opens automatically. Every time — including after the first run.

## How to use

1. Describe your idea and click **Start Sprint**
2. Answer Claude's questions as it works through each phase
3. Click **Move to next phase** when you're ready to advance
4. After the final phase, your **Design Doc** is ready to download

Past sprints are saved automatically. Come back any time to pick up where you left off.

## Developer Setup

```sh
git clone https://github.com/habiz/gstack-studio
cd gstack-studio
bun install
bun run start
```

## How It Works

```
Browser  ←→  Bun server (localhost:3000)  ←→  claude CLI  ←→  gstack skills
```

Each sprint phase spawns a `claude` subprocess with the relevant gstack skill. Output streams to the browser live via SSE. Sessions are saved to `~/.gstack-studio/sessions/`.

## License

MIT
