#!/bin/bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$SRCROOT"
if ! command -v "${STUDIO_NODE:-node}" >/dev/null; then
  echo "error: Install Node 22.12 or newer, or set STUDIO_NODE to its absolute path." >&2
  exit 1
fi
"${STUDIO_NODE:-node}" -e 'const [major,minor]=process.versions.node.split(".").map(Number); if(major<22 || major===22 && minor<12) throw new Error("Node 22.12 or newer is required");'
if [ ! -d node_modules/@electron/packager ]; then
  echo "error: Run npm ci in the ScreenshotStudio project before building in Xcode." >&2
  exit 1
fi
"${STUDIO_NODE:-node}" tools/package.mjs --xcode
