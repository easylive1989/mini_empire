#!/usr/bin/env bash
# Clone the CC0 KayKit asset packs used by the game into a source folder.
# Usage: tools/fetch-assets.sh <dest-dir>
set -euo pipefail
DEST="${1:?usage: fetch-assets.sh <dest-dir>}"
mkdir -p "$DEST"
for repo in \
  KayKit-Medieval-Hexagon-Pack-1.0 \
  KayKit-Character-Pack-Adventures-1.0 \
  KayKit-Character-Pack-Skeletons-1.0 \
  KayKit-Dungeon-Remastered-1.0 \
  KayKit-Halloween-Bits-1.0; do
  if [ ! -d "$DEST/$repo" ]; then
    git clone --depth 1 "https://github.com/KayKit-Game-Assets/$repo" "$DEST/$repo"
  fi
done
