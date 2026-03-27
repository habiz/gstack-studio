#!/usr/bin/env node

const { execSync, spawn } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs");

const BUN_DEFAULT = path.join(os.homedir(), ".bun", "bin", "bun");

function findBun() {
  try { execSync("bun --version", { stdio: "ignore" }); return "bun"; } catch {}
  if (fs.existsSync(BUN_DEFAULT)) return BUN_DEFAULT;
  return null;
}

function installBun() {
  console.log("");
  console.log("┌─────────────────────────────────────────────┐");
  console.log("│           gstack Studio — First Run          │");
  console.log("└─────────────────────────────────────────────┘");
  console.log("");
  console.log("  Bun runtime not found. Installing now...");
  console.log("  This is a one-time setup (~10 seconds).");
  console.log("");

  try {
    if (process.platform === "win32") {
      execSync('powershell -c "irm bun.sh/install.ps1 | iex"', { stdio: "inherit" });
    } else {
      execSync("curl -fsSL https://bun.sh/install | bash", { stdio: "pipe" });
    }
    console.log("  ✓ Bun installed.");
    console.log("");
  } catch {
    console.error("  ✗ Failed to install Bun automatically.");
    console.error("    Install it manually: https://bun.sh");
    console.error("    Then run: npx gstack-studio");
    process.exit(1);
  }
}

let bun = findBun();
if (!bun) {
  installBun();
  bun = findBun();
  if (!bun) {
    console.error("  ✗ Bun was installed but could not be found in this session.");
    console.error("    Open a new terminal window and run: npx gstack-studio");
    process.exit(1);
  }
}

console.log("  Starting gstack Studio...");

const serverPath = path.join(__dirname, "..", "src", "server.ts");
const proc = spawn(bun, ["run", serverPath], { stdio: "inherit" });
proc.on("exit", (code) => process.exit(code == null ? 0 : code));
