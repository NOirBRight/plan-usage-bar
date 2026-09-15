#!/usr/bin/env bash
# Put PUB in the app grid: click to start, right-click for 重新加载 / 退出.
# PUB's visible shell is still the GNOME extension (ADR 0002); this only toggles it.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UUID="pub@noirbright"
APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
DESKTOP="$APPS/pub.desktop"

mkdir -p "$APPS"
cat > "$DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Name=PUB
GenericName=Plan Usage Bar
Comment=在顶栏显示各 coding 套餐的剩余额度
Icon=$ROOT/extension/icons/pub-app.svg
Exec=gnome-extensions enable $UUID
Terminal=false
Categories=Utility;
Keywords=quota;usage;plan;claude;codex;cursor;grok;ollama;
Actions=reload;quit;

[Desktop Action reload]
Name=重新加载
Exec=sh -c "gnome-extensions disable $UUID; gnome-extensions enable $UUID"

[Desktop Action quit]
Name=退出
Exec=gnome-extensions disable $UUID
EOF

update-desktop-database "$APPS" >/dev/null 2>&1 || true
echo "installed $DESKTOP"
