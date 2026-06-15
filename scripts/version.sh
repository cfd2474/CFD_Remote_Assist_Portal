#!/usr/bin/env bash
# Print the EUD Remote Assist Portal release version from the repo root.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cat "$ROOT/VERSION"
