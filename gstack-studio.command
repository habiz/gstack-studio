#!/bin/bash

# ── gstack Studio launcher ────────────────────────────────────────────────────
# Double-click this file to start gstack Studio in your browser.
# Updates happen automatically via npx — no re-download ever needed.

echo ""
echo "┌─────────────────────────────────────────────┐"
echo "│              gstack Studio                   │"
echo "└─────────────────────────────────────────────┘"
echo ""

# ── Check for Node / npm ──────────────────────────────────────────────────────

if ! command -v npx &>/dev/null; then
  echo "  Node.js is not installed."
  echo ""
  echo "  Install it from: https://nodejs.org"
  echo "  Then double-click this file again."
  echo ""
  read -p "  Press Enter to close..."
  exit 1
fi

# ── Launch ────────────────────────────────────────────────────────────────────

echo "  Starting gstack Studio..."
echo "  (your browser will open automatically)"
echo ""

npx gstack-studio

echo ""
read -p "  Session ended. Press Enter to close..."
