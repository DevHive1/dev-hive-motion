#!/usr/bin/env bash
# Wrapper around a real Chromium binary for environments (like Termux/Android)
# where Remotion's own bundled Chrome Headless Shell has no build at all.
# Remotion's browserExecutable option just needs an executable path it can
# spawn with Chrome-compatible flags appended - this script forwards to your
# actual Chromium, injecting the extra flags Remotion's typed
# chromiumOptions doesn't expose (only gl/enableMultiProcessOnLinux/headless
# are - see src/server/render.ts).
#
# Set CHROME_EXECUTABLE_PATH in .env to your real binary, e.g. the output of:
#   which chromium-browser

set -euo pipefail

if [ -z "${CHROME_EXECUTABLE_PATH:-}" ]; then
  echo "chromium-wrapper.sh: CHROME_EXECUTABLE_PATH is not set" >&2
  exit 1
fi

exec "$CHROME_EXECUTABLE_PATH" \
  --no-sandbox \
  --disable-features=NetworkService,NetworkServiceSandbox \
  "$@"
