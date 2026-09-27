#!/usr/bin/env bash
# Build pub-engine.mjs, reject any import that is not a node: URL, and print
# the GitHub Release command. Upload only when PUB_CUT_RELEASE=1.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

version="$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync("package.json","utf8")).version)')"
tag="v${version}"

# ADR 0011: the tag points at the commit that was built, so build a clean,
# pushed HEAD and never move an existing tag.
if [[ -n "$(git status --porcelain)" ]]; then
  echo "release-engine: working tree is not clean" >&2
  exit 1
fi
if ! git merge-base --is-ancestor HEAD '@{u}' 2>/dev/null; then
  echo "release-engine: HEAD is not pushed to its upstream" >&2
  exit 1
fi
if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  echo "release-engine: tag $tag already exists" >&2
  exit 1
fi

pnpm build

asset="extension/bin/pub-engine.mjs"
node --experimental-strip-types --disable-warning=ExperimentalWarning \
  "$ROOT/scripts/scan-engine-imports.ts" "$asset"

target="$(git rev-parse HEAD)"
printf 'gh release create %s --target %s --title %s %s\n' "$tag" "$target" "$tag" "$asset"

if [[ "${PUB_CUT_RELEASE:-}" == "1" ]]; then
  gh release create "$tag" --target "$target" --title "$tag" "$asset"
fi
