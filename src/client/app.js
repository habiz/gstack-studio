// ── Phase definitions (mirrors server) ───────────────────────────────────────

const PHASES = [
  { name: "Office Hours",  icon: "◐" },
  { name: "CEO Review",    icon: "◎" },
  { name: "Design Review", icon: "◇" },
  { name: "Eng Review",    icon: "◈" },
  { name: "Design Doc",    icon: "◉" },
];

// ── State ─────────────────────────────────────────────────────────────────────

let state = {
  screen: "start",   // "start" | "sprint"
  phase: -1,
  runState: "idle",  // "idle" | "running" | "awaiting_input" | "complete" | "error"
  phaseOutputs: {},  // phase index → full text
};

let eventSource = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

const startScreen   = $("start-screen");
const sprintScreen  = $("sprint-screen");
const phaseStepper  = $("phase-stepper");
const startForm     = $("start-form");
const ideaInput     = $("idea-input");
const startBtn      = $("start-btn");
const outputContent = $("output-content");
const outputScroll  = $("output-scroll");
const cursor        = $("cursor");
const thinkingBar   = $("thinking-bar");
const inputForm     = $("input-form");
const replyInput    = $("reply-input");
const continueBar   = $("continue-bar");
const nextPhaseName = $("next-phase-name");
const continueBtn   = $("continue-btn");
const docBar        = $("doc-bar");
const downloadBtn   = $("download-btn");
const newSprintBtn  = $("new-sprint-btn");
const errorBar        = $("error-bar");
const retryBtn        = $("retry-btn");
const interruptedBar  = $("interrupted-bar");
const interruptedDismiss = $("interrupted-dismiss");
const pastSprints   = $("past-sprints");
const pastList      = $("past-list");

// ── Stepper ───────────────────────────────────────────────────────────────────

function renderStepper() {
  phaseStepper.innerHTML = PHASES.map((p, i) => {
    const cls = i === state.phase ? "active" : i < state.phase ? "done" : "";
    return [
      i > 0 ? `<div class="stepper-sep"></div>` : "",
      `<div class="stepper-phase ${cls}">
        <div class="stepper-dot"></div>
        ${p.name}
      </div>`,
    ].join("");
  }).join("");
}

// ── Markdown renderer ──────────────────────────────────────────────────────────

function renderMarkdown(md) {
  const escape = (s) => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

  // Inline formatting
  const inline = (s) => escape(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");

  const lines = md.split("\n");
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const code = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        code.push(escape(lines[i]));
        i++;
      }
      out.push(`<pre><code${lang ? ` class="language-${escape(lang)}"` : ""}>${code.join("\n")}</code></pre>`);
      i++;
      continue;
    }

    // Headings
    const hm = line.match(/^(#{1,4})\s+(.+)/);
    if (hm) { out.push(`<h${hm[1].length}>${inline(hm[2])}</h${hm[1].length}>`); i++; continue; }

    // HR
    if (/^---+$/.test(line.trim())) { out.push("<hr>"); i++; continue; }

    // Unordered list
    if (/^[-*]\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^[-*]\s/, ""))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^\d+\.\s/, ""))}</li>`);
        i++;
      }
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    // Blank line
    if (!line.trim()) { out.push("<br>"); i++; continue; }

    // Paragraph
    out.push(`<p>${inline(line)}</p>`);
    i++;
  }

  return out.join("\n");
}

function renderPhaseAsMarkdown(phase) {
  const text = state.phaseOutputs[phase];
  if (!text || !currentPhaseNode || currentPhaseNode.dataset.phase !== String(phase)) return;
  const div = document.createElement("div");
  div.className = "markdown-body";
  div.dataset.phase = String(phase);
  div.innerHTML = renderMarkdown(text);
  currentPhaseNode.replaceWith(div);
  currentPhaseNode = div;
  scrollToBottom();
}

// ── Output helpers ─────────────────────────────────────────────────────────────

let currentPhaseNode = null; // the <span> being streamed into

function appendPhaseHeader(phaseIndex) {
  const hr = document.createElement("hr");
  hr.className = "phase-divider";
  if (outputContent.children.length > 0) outputContent.appendChild(hr);

  const label = document.createElement("div");
  label.className = "phase-label";
  label.textContent = PHASES[phaseIndex].name;
  outputContent.appendChild(label);

  currentPhaseNode = document.createElement("span");
  outputContent.appendChild(currentPhaseNode);
}

function appendChunk(text, phase, replaying = false) {
  // If this is a new phase, set up a phase header node
  if (!currentPhaseNode || currentPhaseNode.dataset.phase !== String(phase)) {
    appendPhaseHeader(phase);
    currentPhaseNode.dataset.phase = String(phase);
  }
  currentPhaseNode.appendChild(document.createTextNode(text));

  // Track in local state for download
  state.phaseOutputs[phase] = (state.phaseOutputs[phase] ?? "") + text;

  // Keep cursor at end
  outputContent.appendChild(cursor);
  if (!replaying) scrollToBottom();
}

function appendUserEcho(text) {
  const div = document.createElement("div");
  div.className = "user-echo";
  div.textContent = `> ${text}`;
  outputContent.appendChild(div);

  // Re-create phase node after user echo
  currentPhaseNode = document.createElement("span");
  currentPhaseNode.dataset.phase = String(state.phase);
  outputContent.appendChild(currentPhaseNode);

  outputContent.appendChild(cursor);
  scrollToBottom();
}

function scrollToBottom() {
  outputScroll.scrollTop = outputScroll.scrollHeight;
}

// ── Bottom bar state ───────────────────────────────────────────────────────────

function setBottomBar(mode) {
  thinkingBar.classList.add("hidden");
  inputForm.classList.add("hidden");
  continueBar.classList.add("hidden");
  docBar.classList.add("hidden");
  errorBar.classList.add("hidden");
  cursor.classList.add("hidden");

  if (mode === "error") {
    errorBar.classList.remove("hidden");
  } else if (mode === "running") {
    thinkingBar.classList.remove("hidden");
    cursor.classList.remove("hidden");
  } else if (mode === "awaiting_input") {
    inputForm.classList.remove("hidden");
    cursor.classList.remove("hidden");
    replyInput.focus();

  } else if (mode === "phase_complete") {
    // Subprocess exited on its own (rare) — same logic
    const nextPhase = state.phase + 1;
    if (nextPhase < PHASES.length) {
      nextPhaseName.textContent = PHASES[nextPhase].name;
      continueBar.classList.remove("hidden");
    } else {
      docBar.classList.remove("hidden");
    }
  }
}

// ── SSE stream ─────────────────────────────────────────────────────────────────

function connectStream(onReplayDone = null) {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }

  let replaying = true;

  eventSource = new EventSource("/api/stream");

  eventSource.addEventListener("chunk", (e) => {
    const { text, phase } = JSON.parse(e.data);
    appendChunk(text, phase, replaying);
  });

  eventSource.addEventListener("state", (e) => {
    const { state: s, phase } = JSON.parse(e.data);
    if (!replaying) handleRunState(s, phase);
  });

  eventSource.addEventListener("replay_done", () => {
    replaying = false;
    outputScroll.scrollTop = outputScroll.scrollHeight;
    if (onReplayDone) onReplayDone();
  });

  eventSource.onerror = () => {
    // Will auto-reconnect; the server replays the buffer on reconnect
  };
}

function handleRunState(s, phase) {
  state.runState = s;
  if (phase !== undefined) state.phase = phase;

  if (s === "running") {
    setBottomBar("running");
    renderStepper();
  } else if (s === "awaiting_input") {
    setBottomBar("awaiting_input");
  } else if (s === "complete") {
    setBottomBar("phase_complete");
    renderStepper();
    // Phase 4 (Design Doc) renders as formatted markdown when complete
    if (phase === 4) renderPhaseAsMarkdown(phase);
  } else if (s === "error") {
    setBottomBar("error");
  }
}

// ── Past sprints ───────────────────────────────────────────────────────────────

async function loadPastSprints() {
  try {
    const res = await fetch("/api/sessions");
    const sessions = await res.json();
    if (!sessions.length) return;

    pastList.innerHTML = "";
    for (const s of sessions) {
      const phaseLabel = s.phase >= 0 ? PHASES[s.phase].name : "Not started";
      const badgeClass = s.state === "complete" && s.phase === 4 ? "complete"
        : s.state === "error" ? "error" : "partial";
      const badgeText = s.state === "complete" && s.phase === 4 ? "Complete"
        : s.state === "error" ? "Error"
        : s.phase >= 0 ? `Phase ${s.phase + 1}/5` : "Not started";
      const date = new Date(s.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

      const btn = document.createElement("button");
      btn.className = "past-item";
      btn.innerHTML = `
        <div class="past-item-body">
          <div class="past-idea">${s.idea}</div>
          <div class="past-meta">${date} · ${phaseLabel}</div>
        </div>
        <span class="past-badge ${badgeClass}">${badgeText}</span>`;
      btn.addEventListener("click", () => loadSession(s.id));
      pastList.appendChild(btn);
    }

    pastSprints.classList.remove("hidden");
  } catch { /* non-fatal */ }
}

async function loadSession(id) {
  const res = await fetch(`/api/sessions/${id}/load`, { method: "POST" });
  const data = await res.json();
  if (!data.ok) return;

  state.phase = data.phase;
  state.runState = data.state;
  state.screen = "sprint";
  state.phaseOutputs = {};

  outputContent.innerHTML = "";
  currentPhaseNode = null;
  outputContent.appendChild(cursor);

  startScreen.classList.add("hidden");
  sprintScreen.classList.remove("hidden");
  phaseStepper.classList.remove("hidden");
  newSprintBtn.classList.remove("hidden");

  renderStepper();
  if (data.wasInterrupted) interruptedBar.classList.remove("hidden");

  connectStream(() => {
    // Applied after replay_done — guaranteed to run after all buffered events
    handleRunState(data.state, data.phase);
    if (data.phase === 4 && data.state === "complete") renderPhaseAsMarkdown(4);
  });
}

// ── Actions ────────────────────────────────────────────────────────────────────

async function newSprint() {
  if (!confirm("Start a new sprint? Your current sprint will be saved.")) return;

  await fetch("/api/new-sprint", { method: "POST" });

  if (eventSource) { eventSource.close(); eventSource = null; }

  state.screen = "start";
  state.phase = -1;
  state.runState = "idle";
  state.phaseOutputs = {};

  sprintScreen.classList.add("hidden");
  phaseStepper.classList.add("hidden");
  newSprintBtn.classList.add("hidden");
  interruptedBar.classList.add("hidden");
  startScreen.classList.remove("hidden");
  startBtn.disabled = false;
  ideaInput.value = "";
}

async function startSprint(idea) {
  // Switch to sprint screen
  state.screen = "sprint";
  startScreen.classList.add("hidden");
  sprintScreen.classList.remove("hidden");
  phaseStepper.classList.remove("hidden");
  newSprintBtn.classList.remove("hidden");

  renderStepper();
  setBottomBar("running");

  // Reset output
  outputContent.innerHTML = "";
  currentPhaseNode = null;
  outputContent.appendChild(cursor);

  // POST to start, then open stream
  await fetch("/api/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idea }),
  });

  connectStream();
}

async function sendReply(text) {
  appendUserEcho(text);
  setBottomBar("running");

  await fetch("/api/input", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

async function retryPhase() {
  setBottomBar("running");
  await fetch("/api/retry", { method: "POST" });
}

async function advancePhase() {
  setBottomBar("running");

  await fetch("/api/advance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  // Stream is already connected; server will broadcast the new phase's events
}

function downloadDesignDoc() {
  const parts = PHASES.map((p, i) => {
    const output = state.phaseOutputs[i] ?? "";
    return output ? `# ${p.name}\n\n${output}` : "";
  }).filter(Boolean);

  const doc = parts.join("\n\n---\n\n");
  const blob = new Blob([doc], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "design-doc.md";
  a.click();
  URL.revokeObjectURL(url);
}

// ── Event listeners ────────────────────────────────────────────────────────────

startForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const idea = ideaInput.value.trim();
  if (!idea) return;
  startBtn.disabled = true;
  startSprint(idea);
});

// Auto-grow reply textarea
replyInput.addEventListener("input", () => {
  replyInput.style.height = "auto";
  replyInput.style.height = Math.min(replyInput.scrollHeight, 160) + "px";
});

// Submit reply on Enter (Shift+Enter = newline)
replyInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    inputForm.dispatchEvent(new Event("submit"));
  }
});

inputForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = replyInput.value.trim();
  if (!text) return;
  replyInput.value = "";
  replyInput.style.height = "auto";
  sendReply(text);
});

continueBtn.addEventListener("click", advancePhase);
retryBtn.addEventListener("click", retryPhase);
interruptedDismiss.addEventListener("click", () => interruptedBar.classList.add("hidden"));
downloadBtn.addEventListener("click", downloadDesignDoc);
newSprintBtn.addEventListener("click", newSprint);

// ── Init ──────────────────────────────────────────────────────────────────────

// On load, check if there's an active session to resume
(async () => {
  loadPastSprints(); // non-blocking, populates list in background

  try {
    const res = await fetch("/api/state");
    const data = await res.json();

    // Only auto-resume if the subprocess is actively running (not just paused/complete)
    if (data.phase >= 0 && data.state === "running") {
      state.phase = data.phase;
      state.screen = "sprint";

      startScreen.classList.add("hidden");
      sprintScreen.classList.remove("hidden");
      phaseStepper.classList.remove("hidden");
      newSprintBtn.classList.remove("hidden");

      renderStepper();
      connectStream();
      handleRunState(data.state, data.phase);
    }
  } catch {
    // Server not ready — just show start screen
  }
})();
