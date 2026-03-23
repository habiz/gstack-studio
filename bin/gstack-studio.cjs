#!/usr/bin/env node

const { execSync, spawn } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs");

const BUN_DEFAULT = path.join(os.homedir(), ".bun", "bin", "bun");

function findBun() {
  // Check PATH first
  try { execSync("bun --version", { stdio: "ignore" }); return "bun"; } catch {}
  // Check default install location
  if (fs.existsSync(BUN_DEFAULT)) return BUN_DEFAULT;
  return null;
}

function installBun() {
  console.log("Installing Bun (required to run gstack Studio)...");
  try {
    if (process.platform === "win32") {
      execSync('powershell -c "irm bun.sh/install.ps1 | iex"', { stdio: "inherit" });
    } else {
      execSync("curl -fsSL https://bun.sh/install | bash", { stdio: "inherit" });
    }
    console.log("Bun installed.\n");
  } catch {
    console.error("Failed to install Bun. Install it manually from https://bun.sh then run npx gstack-studio again.");
    process.exit(1);
  }
}

let bun = findBun();
if (!bun) {
  installBun();
  bun = findBun();
  if (!bun) {
    console.error("Bun installed but not found. Open a new terminal and run npx gstack-studio again.");
    process.exit(1);
  }
}

const serverPath = path.join(__dirname, "..", "src", "server.ts");
const proc = spawn(bun, ["run", serverPath], { stdio: "inherit" });
proc.on("exit", (code) => process.exit(code ?? 0));
