import { spawn } from "bun";

// Static assets — embedded at compile time via import attributes
// @ts-ignore
import indexHtml from "./client/index.html" with { type: "text" };
// @ts-ignore
import styleCss from "./client/style.css" with { type: "text" };
// @ts-ignore
import appJs from "./client/app.js" with { type: "text" };
// @ts-ignore
import setupHtml from "./client/setup.html" with { type: "text" };

// ─── Dep checker ──────────────────────────────────────────────────────────────

const REQUIRED_SKILLS = [
  "office-hours",
  "plan-ceo-review",
  "plan-design-review",
  "plan-eng-review",
];

type DepStatus = { claudeOk: boolean; gstackOk: boolean };

async function checkDeps(): Promise<DepStatus> {
  // Check claude: try running it rather than relying on Bun.which PATH resolution
  let claudeOk = false;
  try {
    const proc = spawn({ cmd: ["claude", "--version"], stdout: "pipe", stderr: "pipe" });
    const code = await proc.exited;
    claudeOk = code === 0;
  } catch { claudeOk = false; }

  // Check gstack skills exist as directories under ~/.claude/skills/
  const home = process.env.HOME!;
  const skillsDir = `${home}/.claude/skills`;
  const gstackChecks = await Promise.all(
    REQUIRED_SKILLS.map(async (skill) => {
      try {
        await Bun.file(`${skillsDir}/${skill}/SKILL.md`).text();
        return true;
      } catch { return false; }
    })
  );
  const gstackOk = gstackChecks.every(Boolean);

  return { claudeOk, gstackOk };
}

function buildSetupPage(deps: DepStatus): string {
  const claudeMissing = !deps.claudeOk;
  const gstackMissing = !deps.gstackOk;
  const allGood = !claudeMissing && !gstackMissing;

  const checkItem = (ok: boolean, name: string, okMsg: string, failMsg: string) => `
    <div class="check-item">
      <span class="check-icon ${ok ? "ok" : "fail"}">${ok ? "✓" : "✗"}</span>
      <div class="check-body">
        <div class="check-name">${name}</div>
        <div class="${ok ? "check-status-ok" : "check-status-fail"}">${ok ? okMsg : failMsg}</div>
      </div>
    </div>`;

  const checks = [
    checkItem(deps.claudeOk, "Claude Code", "Installed", "Not found in PATH — see steps below"),
    checkItem(deps.gstackOk, "gstack skills", "Installed", "Not found — see steps below"),
  ].join("");

  const stepsDisplay = allGood ? "none" : "block";
  const claudeDisplay = claudeMissing ? "block" : "none";
  const gstackDisplay = gstackMissing ? "block" : "none";
  const allGoodDisplay = allGood ? "block" : "none";
  const gstackStepNum = claudeMissing ? "2" : "1";
  const finalStepNum = (claudeMissing && gstackMissing ? 3 : 2).toString();

  return setupHtml
    .replace("__CHECKS__", checks)
    .replace("__STEPS_DISPLAY__", stepsDisplay)
    .replace("__STEPS_DISPLAY__", stepsDisplay) // second occurrence (final step)
    .replace("__CLAUDE_DISPLAY__", claudeDisplay)
    .replace("__GSTACK_DISPLAY__", gstackDisplay)
    .replace("__ALL_GOOD_DISPLAY__", allGoodDisplay)
    .replace("__GSTACK_STEP_NUM__", gstackStepNum)
    .replace("__FINAL_STEP_NUM__", finalStepNum);
}

const PORT = 3000;

// ─── Phase definitions ────────────────────────────────────────────────────────

const PHASES = [
  { name: "Office Hours",  skill: "/office-hours" },
  { name: "CEO Review",    skill: "/plan-ceo-review" },
  { name: "Design Review", skill: "/plan-design-review" },
  { name: "Eng Review",    skill: "/plan-eng-review" },
  { name: "Design Doc",    skill: null }, // auto-compiled
] as const;

// ─── Session state ────────────────────────────────────────────────────────────

type SessionState = "idle" | "running" | "awaiting_input" | "complete" | "error";

// Single-session design — localhost solo tool only.
// Two open browser tabs or a second LAN user will silently stomp each other:
// /api/start overwrites the session and clears eventBuffer with no warning.
const session = {
  id: crypto.randomUUID(),
  createdAt: new Date().toISOString(),
  state: "idle" as SessionState,
  phase: -1,
  idea: "",
  phaseOutputs: [] as string[],
};

// ─── Session persistence ──────────────────────────────────────────────────────

const home = process.env.HOME!;
const SESSIONS_DIR = `${home}/.gstack-studio/sessions`;

async function ensureSessionsDir() {
  await Bun.$`mkdir -p ${SESSIONS_DIR}`.quiet();
}

async function persistSession() {
  try {
    await Bun.write(
      `${SESSIONS_DIR}/${session.id}.json`,
      JSON.stringify(session, null, 2)
    );
  } catch { /* non-fatal */ }
}

async function loadLatestSession() {
  try {
    const files = await Array.fromAsync(
      new Bun.Glob("*.json").scan({ cwd: SESSIONS_DIR, absolute: true })
    );
    if (files.length === 0) return;

    // Pick the most recently modified session file
    const withMtime = await Promise.all(
      files.map(async (f) => {
        try { return { f, mtime: (await Bun.file(f).stat()).mtime }; }
        catch { return { f, mtime: 0 }; }
      })
    );
    withMtime.sort((a, b) => b.mtime - a.mtime);
    const latest = withMtime[0].f;
    const data = await Bun.file(latest).json() as typeof session;

    // Restore session state
    session.id = data.id ?? session.id;
    session.createdAt = data.createdAt ?? session.createdAt;
    session.state = data.state ?? "idle";
    session.phase = data.phase ?? -1;
    session.idea = data.idea ?? "";
    session.phaseOutputs = data.phaseOutputs ?? [];

    // If the server was killed mid-run, mark as error
    if (session.state === "running") {
      session.state = "error";
      await persistSession();
    }
  } catch { /* no sessions yet, start fresh */ }
}

await ensureSessionsDir();
await loadLatestSession();

// ─── SSE broadcast infrastructure ─────────────────────────────────────────────

let eventBuffer: Array<{ event: string; data: unknown }> = [];
let subscribers = new Set<ReadableStreamDefaultController>();

const MAX_BUFFER = 500; // events per phase; shift() is O(n) so keep this small

function broadcast(event: string, data: unknown) {
  eventBuffer.push({ event, data });
  if (eventBuffer.length > MAX_BUFFER) eventBuffer.shift();
  for (const ctrl of [...subscribers]) {
    try {
      writeSSE(ctrl, event, data);
    } catch {
      subscribers.delete(ctrl);
    }
  }
}

function writeSSE(ctrl: ReadableStreamDefaultController, event: string, data: unknown) {
  ctrl.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

// ─── Subprocess management ────────────────────────────────────────────────────

let activeProc: ReturnType<typeof spawn> | null = null;

// How much of a previous phase's output to pass as context.
// Keeps kickoff messages short so the subprocess responds quickly.
const CTX_CHARS = 4000;

function trimCtx(text: string): string {
  if (text.length <= CTX_CHARS) return text;
  return `[...earlier content trimmed...]\n\n${text.slice(-CTX_CHARS)}`;
}

function buildKickoffMessage(phase: number, idea: string, outputs: string[]): string {
  const ctx = (label: string, text: string) =>
    `## ${label}\n\n${trimCtx(text)}`;

  switch (phase) {
    case 0:
      return `/office-hours\n\nI want to explore this idea: ${idea}`;
    case 1:
      return `/plan-ceo-review\n\nIdea: ${idea}\n\n${ctx("Office Hours", outputs[0] ?? "")}`;
    case 2:
      return `/plan-design-review\n\nIdea: ${idea}\n\n${ctx("Office Hours", outputs[0] ?? "")}\n\n${ctx("CEO Review", outputs[1] ?? "")}`;
    case 3:
      return `/plan-eng-review\n\nIdea: ${idea}\n\n${ctx("Office Hours", outputs[0] ?? "")}\n\n${ctx("CEO Review", outputs[1] ?? "")}\n\n${ctx("Design Review", outputs[2] ?? "")}`;
    case 4:
      return (
        "Compile a clean design document in markdown from this ideation sprint.\n\n" +
        ctx("Office Hours", outputs[0] ?? "") + "\n\n" +
        ctx("CEO Review", outputs[1] ?? "") + "\n\n" +
        ctx("Design Review", outputs[2] ?? "") + "\n\n" +
        ctx("Eng Review", outputs[3] ?? "")
      );
    default:
      throw new Error(`Unknown phase ${phase}`);
  }
}

async function startSubprocess(phase: number) {
  if (activeProc) {
    try { activeProc.kill(); } catch {}
    activeProc = null;
  }

  // Clear event buffer for the new phase
  eventBuffer = [];

  const message = buildKickoffMessage(phase, session.idea, session.phaseOutputs);
  session.state = "running";
  session.phase = phase;
  if (!session.phaseOutputs[phase]) session.phaseOutputs[phase] = "";

  broadcast("state", { state: "running", phase });
  persistSession();

  const skillsDir = `${home}/.claude/skills`;

  const proc = spawn({
    cmd: [
      "claude",
      "--print",
      "--output-format", "stream-json",
      "--input-format", "stream-json",
      "--include-partial-messages",
      "--verbose",
      "--plugin-dir", skillsDir,
      "--add-dir", skillsDir,
      "--allowedTools", "Skill,Read,Write,Bash,Glob,Grep",
    ],
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  });

  activeProc = proc;

  // Send the kick-off message
  const firstMsg = JSON.stringify({ type: "user", message: { role: "user", content: message } });
  proc.stdin.write(new TextEncoder().encode(firstMsg + "\n"));

  // Stream stdout
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (proc !== activeProc) break; // superseded — stop processing
          processStreamLine(line, phase);
        }
      }
    } catch { /* stream closed */ }

    const exitCode = await proc.exited;

    // If a newer subprocess has already taken over, this proc was killed intentionally
    // (e.g. user advanced to next phase). Don't broadcast its exit state.
    if (activeProc !== proc) return;

    activeProc = null;

    if (exitCode === 0) {
      session.state = "complete";
      broadcast("state", { state: "complete", phase });
    } else {
      session.state = "error";
      broadcast("state", { state: "error", phase, exitCode });
    }
    persistSession();
  })();
}

function processStreamLine(line: string, phase: number) {
  if (!line.trim()) return;
  let msg: Record<string, unknown>;
  try { msg = JSON.parse(line); } catch { return; }

  const type = msg.type as string;

  // Real-time text delta — emitted by --include-partial-messages
  if (type === "stream_event") {
    const event = msg.event as { type: string; delta?: { type: string; text?: string } };
    if (event?.type === "content_block_delta" && event.delta?.type === "text_delta") {
      const text = event.delta.text ?? "";
      if (text) {
        session.phaseOutputs[phase] = (session.phaseOutputs[phase] ?? "") + text;
        broadcast("chunk", { text, phase });
      }
    }
    return;
  }

  // Turn complete
  if (type === "result") {
    const subtype = msg.subtype as string;
    if (subtype === "success") {
      session.state = "awaiting_input";
      broadcast("state", { state: "awaiting_input", phase });
      persistSession();
    } else if (subtype === "error") {
      session.state = "error";
      broadcast("state", { state: "error", phase });
      persistSession();
    }
  }
}

// ─── HTTP server ──────────────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function serveStatic(text: string, contentType: string) {
  return new Response(text, { headers: { ...CORS, "Content-Type": contentType } });
}

// Find an available port starting from PORT
async function findPort(start: number): Promise<number> {
  for (let p = start; p < start + 10; p++) {
    try {
      const s = Bun.serve({ port: p, fetch: () => new Response("") });
      s.stop(true);
      return p;
    } catch { /* port in use */ }
  }
  return start;
}

const port = await findPort(PORT);

const server = Bun.serve({
  port,
  idleTimeout: 255, // max allowed by Bun; keeps SSE connections alive during slow subprocess output

  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    // ── Static files ──────────────────────────────────────────────────────────
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const deps = await checkDeps();
      if (!deps.claudeOk || !deps.gstackOk) {
        return new Response(buildSetupPage(deps), {
          headers: { ...CORS, "Content-Type": "text/html; charset=utf-8" },
        });
      }
      return serveStatic(indexHtml, "text/html; charset=utf-8");
    }
    if (url.pathname === "/style.css") {
      return serveStatic(styleCss, "text/css");
    }
    if (url.pathname === "/app.js") {
      return serveStatic(appJs, "application/javascript");
    }

    // ── POST /api/new-sprint ──────────────────────────────────────────────────
    // Resets session and returns to start screen (current session stays on disk)
    if (url.pathname === "/api/new-sprint" && req.method === "POST") {
      if (activeProc) { try { activeProc.kill(); } catch {} activeProc = null; }
      eventBuffer = [];
      session.id = crypto.randomUUID();
      session.createdAt = new Date().toISOString();
      session.state = "idle";
      session.phase = -1;
      session.idea = "";
      session.phaseOutputs = [];
      return json({ ok: true });
    }

    // ── POST /api/start ───────────────────────────────────────────────────────
    // Body: { idea: string }  (phase 0 only; subsequent phases use /api/advance)
    if (url.pathname === "/api/start" && req.method === "POST") {
      const body = await req.json().catch(() => ({})) as { idea?: string };
      if (!body.idea?.trim()) return json({ error: "idea is required" }, 400);

      session.idea = body.idea.trim();
      session.phaseOutputs = [];
      startSubprocess(0);
      return json({ ok: true, phase: 0 });
    }

    // ── POST /api/retry ───────────────────────────────────────────────────────
    if (url.pathname === "/api/retry" && req.method === "POST") {
      if (session.state !== "error") return json({ error: "not in error state" }, 400);
      startSubprocess(session.phase);
      return json({ ok: true, phase: session.phase });
    }

    // ── POST /api/advance ─────────────────────────────────────────────────────
    // Advance to the next phase (server already has all prior output buffered)
    if (url.pathname === "/api/advance" && req.method === "POST") {
      const nextPhase = session.phase + 1;
      if (nextPhase >= PHASES.length) return json({ error: "all phases complete" }, 400);
      if (session.state !== "complete") return json({ error: "current phase not complete" }, 400);

      startSubprocess(nextPhase);
      return json({ ok: true, phase: nextPhase });
    }

    // ── POST /api/input ───────────────────────────────────────────────────────
    if (url.pathname === "/api/input" && req.method === "POST") {
      const body = await req.json().catch(() => ({})) as { text?: string };
      const text = body.text?.trim() ?? "";
      if (!text) return json({ error: "text required" }, 400);
      if (!activeProc) return json({ error: "no active process" }, 400);

      const msg = JSON.stringify({ type: "user", message: { role: "user", content: text } });
      activeProc.stdin.write(new TextEncoder().encode(msg + "\n"));

      session.state = "running";
      broadcast("state", { state: "running", phase: session.phase });
      return json({ ok: true });
    }

    // ── GET /api/stream ───────────────────────────────────────────────────────
    // SSE: replays buffer, then streams live
    if (url.pathname === "/api/stream" && req.method === "GET") {
      const snapshot = [...eventBuffer]; // snapshot for replay
      let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
      let streamCtrl: ReadableStreamDefaultController | null = null;

      const stream = new ReadableStream({
        start(ctrl) {
          streamCtrl = ctrl;
          // Replay buffered events
          for (const { event, data } of snapshot) {
            writeSSE(ctrl, event, data);
          }
          // Signal end of replay so client can apply final state reliably
          writeSSE(ctrl, "replay_done", {});
          // Subscribe to live broadcasts
          subscribers.add(ctrl);

          // Send SSE comment every 15s to keep connection alive through Bun's idle timeout
          keepaliveTimer = setInterval(() => {
            try {
              ctrl.enqueue(new TextEncoder().encode(": keepalive\n\n"));
            } catch {
              subscribers.delete(ctrl);
              if (keepaliveTimer) clearInterval(keepaliveTimer);
            }
          }, 15_000);
        },
        cancel() {
          if (streamCtrl) subscribers.delete(streamCtrl);
          if (keepaliveTimer) clearInterval(keepaliveTimer);
        },
      });

      return new Response(stream, {
        headers: {
          ...CORS,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    // ── GET /api/sessions ─────────────────────────────────────────────────────
    if (url.pathname === "/api/sessions" && req.method === "GET") {
      try {
        const files = await Array.fromAsync(
          new Bun.Glob("*.json").scan({ cwd: SESSIONS_DIR, absolute: true })
        );
        const sessions = await Promise.all(
          files.map(async (f) => {
            try {
              const d = await Bun.file(f).json() as typeof session;
              return { id: d.id, createdAt: d.createdAt, idea: d.idea, state: d.state, phase: d.phase };
            } catch { return null; }
          })
        );
        const valid = sessions
          .filter((s) => s !== null && s.idea)
          .sort((a, b) => new Date(b!.createdAt).getTime() - new Date(a!.createdAt).getTime());
        return json(valid);
      } catch { return json([]); }
    }

    // ── POST /api/sessions/:id/load ───────────────────────────────────────────
    if (url.pathname.startsWith("/api/sessions/") && url.pathname.endsWith("/load") && req.method === "POST") {
      const id = url.pathname.split("/")[3];
      if (!id) return json({ error: "missing id" }, 400);
      try {
        const data = await Bun.file(`${SESSIONS_DIR}/${id}.json`).json() as typeof session;

        // Kill any active subprocess
        if (activeProc) { try { activeProc.kill(); } catch {} activeProc = null; }

        // Restore session
        session.id = data.id;
        session.createdAt = data.createdAt;
        session.phase = data.phase;
        session.idea = data.idea;
        session.phaseOutputs = data.phaseOutputs ?? [];

        // No subprocess will be running after a server restart.
        // Treat awaiting_input as complete so the user can advance to the next phase.
        const wasInterrupted = data.state === "awaiting_input";
        session.state = wasInterrupted ? "complete" : data.state;

        // Rebuild event buffer from stored outputs so SSE replay works
        eventBuffer = [];
        for (let i = 0; i <= session.phase; i++) {
          const output = session.phaseOutputs[i];
          if (!output) continue;
          const finalState = i < session.phase ? "complete" : session.state;
          eventBuffer.push({ event: "state", data: { state: "running", phase: i } });
          const CHUNK = 2000;
          for (let pos = 0; pos < output.length; pos += CHUNK) {
            eventBuffer.push({ event: "chunk", data: { text: output.slice(pos, pos + CHUNK), phase: i } });
          }
          eventBuffer.push({ event: "state", data: { state: finalState, phase: i } });
        }

        return json({ ok: true, state: session.state, phase: session.phase, wasInterrupted: wasInterrupted ?? false });
      } catch { return json({ error: "session not found" }, 404); }
    }

    // ── GET /api/state ────────────────────────────────────────────────────────
    if (url.pathname === "/api/state") {
      return json({
        state: session.state,
        phase: session.phase,
        totalPhases: PHASES.length,
        phases: PHASES.map((p, i) => ({
          ...p,
          status: i < session.phase ? "complete" : i === session.phase ? session.state : "idle",
          hasOutput: !!session.phaseOutputs[i],
        })),
      });
    }

    // ── GET /api/health ───────────────────────────────────────────────────────
    if (url.pathname === "/api/health") {
      return json({ ok: true, state: session.state, phase: session.phase });
    }

    return new Response("Not found", { status: 404 });
  },
});

const url = `http://localhost:${server.port}`;
console.log(`gstack Studio → ${url}`);

// Auto-open browser on macOS/Linux
try {
  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  Bun.spawn([opener, url]);
} catch { /* non-fatal */ }
