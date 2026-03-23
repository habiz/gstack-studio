#!/bin/bash

# Get the directory where this script lives
DIR="$(cd "$(dirname "$0")" && pwd)"
BINARY="$DIR/gstack-studio"

# Make sure the binary exists
if [ ! -f "$BINARY" ]; then
  echo "Error: gstack-studio not found in $DIR"
  echo "Make sure launch.command and gstack-studio are in the same folder."
  read -p "Press Enter to close..."
  exit 1
fi

# Remove quarantine flag (set by macOS on downloaded files)
xattr -d com.apple.quarantine "$BINARY" 2>/dev/null

# Make executable
chmod +x "$BINARY"

# Run
"$BINARY"
