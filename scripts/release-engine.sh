#!/usr/bin/env bash
# Build pub-engine.mjs, reject any import that is not a node: URL, and print
# the GitHub Release command. Upload only when PUB_CUT_RELEASE=1.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

pnpm build

asset="extension/bin/pub-engine.mjs"
node --experimental-strip-types --disable-warning=ExperimentalWarning \
  "$ROOT/scripts/scan-engine-imports.ts" "$asset"

version="$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync("package.json","utf8")).version)')"
tag="v${version}"
target="$(git rev-parse HEAD)"
printf 'gh release create %s --target %s --title %s %s\n' "$tag" "$target" "$tag" "$asset"

if [[ "${PUB_CUT_RELEASE:-}" == "1" ]]; then
  gh release create "$tag" --target "$target" --title "$tag" "$asset"
fi
