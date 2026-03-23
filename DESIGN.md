# gstack Studio — Design Document

> **Status:** Working prototype (`src/`). Next iteration slot: `gstack-studio/`.
> **Goal:** Builder mode — side project, having fun.
> **Date:** 2026-03-23

---

## What It Is

gstack Studio is a localhost web UI that wraps gstack skills into a guided ideation pipeline. A user types one sentence about their idea, hits Start, and watches five AI review phases run sequentially — each phase informed by the output of the previous one — ending in a compiled design document.

Non-technical users get a browser interface. Under the hood: `claude` subprocesses, SSE streaming, session persistence to `~/.gstack-studio/sessions/`.

---

## The Five-Phase Pipeline

| # | Phase | Skill | Purpose |
|---|-------|-------|---------|
| 0 | Office Hours | `/office-hours` | Brainstorm the idea, builder-mode framing |
| 1 | CEO Review | `/plan-ceo-review` | Strategy, scope, ambition check |
| 2 | Design Review | `/plan-design-review` | UI/UX, visual direction |
| 3 | Eng Review | `/plan-eng-review` | Architecture, code quality, failure modes |
| 4 | Design Doc | *(auto-compiled)* | Synthesized markdown document from all phases |

Each phase receives a kickoff message containing the user's original idea plus trimmed context (≤ 4000 chars) from all prior phases. Phase 4 is not a subprocess — the server prompts Claude to compile the outputs into a clean design document.

---

## Architecture

```
Browser (EventSource)
  │  SSE /api/stream  (replay buffer + live)
  │
Bun.serve() ── HTTP routes
  │
  ├── activeProc: claude --print --output-format stream-json
  │     stdin ← kickoff message (JSON)
  │     stdout → stream-json chunks → broadcast()
  │
  ├── session (single global object)
  │     id, state, phase, idea, phaseOutputs[]
  │
  ├── eventBuffer (ring, MAX_BUFFER=500)
  │     replayed to new SSE subscribers on connect
  │
  └── ~/.gstack-studio/sessions/<id>.json
        persisted after each state change
```

### Key flows

**Start sprint:** `POST /api/start` → `startSubprocess(0)` → SSE broadcasts chunks and state transitions → client `appendChunk()` → user reads live output.

**Advance phase:** `POST /api/advance` → `startSubprocess(phase + 1)` → new kickoff message with trimmed prior output.

**Reconnect:** `GET /api/stream` replays `eventBuffer` snapshot → then streams live. 15s keepalive comments prevent Bun idle timeout.

**Server restart:** `loadLatestSession()` restores most-recently-modified JSON. If state was `running`, resets to `error`. `awaiting_input` is treated as `complete` on reload so the user can advance.

---

## API Surface

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | App shell (or setup page if deps missing) |
| `GET` | `/api/stream` | SSE event stream |
| `GET` | `/api/state` | Current session state + phase statuses |
| `GET` | `/api/sessions` | List past sessions (sorted by date) |
| `POST` | `/api/start` | `{ idea }` — start phase 0 |
| `POST` | `/api/advance` | Advance to next phase |
| `POST` | `/api/input` | `{ text }` — send reply to active subprocess |
| `POST` | `/api/retry` | Restart current phase from error |
| `POST` | `/api/new-sprint` | Reset session, keep old one on disk |
| `POST` | `/api/sessions/:id/load` | Restore a past session |
| `GET` | `/api/health` | Health check |

---

## Client

Three screens, one HTML file, vanilla JS (`app.js`, ~500 lines).

| Screen | Trigger |
|--------|---------|
| **Start** | Default; shows idea input + past sprints list |
| **Sprint** | After start; phase stepper + scrolling output area + bottom bar |
| **Setup** | Replaces app if `claude` or gstack skills not found in PATH |

**Bottom bar states:** `running` (thinking indicator + cursor) → `awaiting_input` (reply textarea) → `phase_complete` (Continue to next phase button) → `doc_complete` (Download Design Doc) → `error` (Retry button).

**Phase 4 rendering:** When the Design Doc phase completes, the raw text is re-rendered as formatted markdown via the built-in `renderMarkdown()` function.

**Download:** Client-side only. Concatenates all phase outputs as `# Phase Name\n\n{output}` sections, downloads as `design-doc.md`.

---

## Design System (current)

| Token | Value | Note |
|-------|-------|------|
| `--bg` | `#0c0c0e` | Near-black |
| `--surface` | `#141418` | Card background |
| `--border` | `#252530` | Subtle separator |
| `--accent` | `#7c6aff` | Purple/violet — AI slop risk |
| `--text` | `#e2e2e8` | Body text |
| `--text-dim` | `#6b6b7a` | Secondary text |
| `--mono` | SF Mono, Fira Code, Cascadia Code… | Output/code |
| `--sans` | `-apple-system`, Helvetica, Arial… | UI chrome |
| `--radius` | `10px` | Applied uniformly |

Dark terminal aesthetic. Phase labels use `border-left: 2px solid var(--accent)`. No media queries — desktop-only.

---

## Known Issues & Technical Debt

### Critical

| # | Issue | Impact |
|---|-------|--------|
| C1 | **Zombie proc interleaved writes** — if `activeProc.kill()` fails, the old subprocess continues writing to `session.phaseOutputs[phase]` while a new one starts. The `if (proc !== activeProc) break` guard stops broadcasting but not accumulation. | Silent data corruption in phase output |

### High

| # | Issue | Impact |
|---|-------|--------|
| H1 | **Single global session** — one active session at a time, single `activeProc`. Second tab or concurrent user kills the first. | Expected for solo localhost tool; document the assumption explicitly |
| H2 | **`awaiting_input` silent loss** — if `activeProc` is null when `/api/input` is called, request returns 400 but client may have advanced state. | User sees spinner with no progress |
| H3 | **350ms race in `loadSession()`** — `handleRunState` is called in a `setTimeout(..., 350)` after SSE buffer replay. If replay takes > 350ms (large session), the state transition fires before the last buffered event, leaving the UI in a mismatched state. | Rare; larger sessions more likely to hit this |

### Medium

| # | Issue | Impact |
|---|-------|--------|
| M1 | **`PHASES` duplicated in server and client** — `src/server.ts:90` and `src/client/app.js:3` must stay in sync manually | Drift risk |
| M2 | **`eventBuffer.shift()` is O(n)** — called every broadcast when buffer exceeds 500. Negligible at current scale. | Performance at high volume |
| M3 | **`outputContent.appendChild(cursor)` on every chunk** — DOM moves cursor to end of `outputContent` on each text chunk, which is O(total children). Grows as output accumulates. | Perceptible lag in long sessions |

### Low / Not In Scope

| Item | Rationale |
|------|-----------|
| Multi-user / LAN support | Architecture rewrite required |
| Phase-level cancel / rollback | Complex subprocess lifecycle; defer to v2 |
| Real-time collaboration | Not the use case |
| Syntax highlighting | `renderMarkdown` skeleton is in place; add library later |
| Auth / session expiry | Localhost solo tool |
| Responsive layout | Desktop-first is fine for this use case |

---

## What Already Exists (Reuse in v2)

| Capability | Location |
|-----------|----------|
| Dep checking | `checkDeps()` in `server.ts:24` |
| Auto-resume on restart | `loadLatestSession()` in `server.ts:129` |
| SSE reconnect + buffer replay | `GET /api/stream` + subscriber set |
| Past sprints list | `/api/sessions` + `loadPastSprints()` in client |
| Design doc export | `downloadDesignDoc()` in `app.js:420` |
| Port auto-detection | `findPort()` in `server.ts:365` |
| Setup / onboarding page | `buildSetupPage()` + `setup.html` |

---

## Quick Wins (Before v2)

1. **Fix cursor O(n)** — move cursor node outside `outputContent`, use CSS `position: sticky` or absolute positioning.
2. **Replace `eventBuffer.shift()` with a ring buffer index** — O(1) without allocation.
3. **Deduplicate `PHASES`** — move to a shared JSON file or derive client-side from `/api/state`.

---

## Open Decisions

These were not resolved during the review sprint. Flag before starting v2:

- **Issue H1** — Explicitly document single-session assumption, or add a session-scoping key per browser tab.
- **Issue H2** — Add client-side guard: disable reply submit button when `activeProc` is null (detected via `/api/state`).
- **Issue H3** — Replace fixed 350ms timeout with an event-driven signal (e.g., server sends a `replay_complete` SSE event after replaying the buffer).
- **Test coverage** — Zero automated tests currently. Minimum recommended: subprocess lifecycle (start → chunk → complete), SSE reconnect replay, and phase advance state machine.
