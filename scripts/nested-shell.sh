#!/usr/bin/env bash
# Ephemeral nested GNOME Shell for PUB via Mutter Development Kit.
# Isolated XDG so the host session and the next login are not rewritten.
# Keep HOME / XDG_RUNTIME_DIR / WAYLAND_DISPLAY so the window lands on
# the current desktop and Engine still finds credentials.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NEST="${PUB_NEST_DIR:-/tmp/pub-nested}"
EXT="$ROOT/extension"

if [[ ! -f "$EXT/metadata.json" ]]; then
  echo "missing $EXT/metadata.json" >&2
  exit 1
fi
if [[ -z "${WAYLAND_DISPLAY:-}" ]]; then
  echo "WAYLAND_DISPLAY is empty; nested shell needs the current Wayland session" >&2
  exit 1
fi
if [[ ! -x /usr/libexec/mutter-devkit ]]; then
  echo "missing /usr/libexec/mutter-devkit (package mutter-dev-bin)" >&2
  exit 1
fi

rm -rf "$NEST"
mkdir -p \
  "$NEST/config/pub" \
  "$NEST/cache" \
  "$NEST/data/gnome-shell/extensions" \
  "$NEST/state"
ln -sfn "$EXT" "$NEST/data/gnome-shell/extensions/pub@noirbright"
if [[ -f "$HOME/.config/pub/settings.json" ]]; then
  cp "$HOME/.config/pub/settings.json" "$NEST/config/pub/settings.json"
fi
if [[ -f "$HOME/.config/pub/credentials.json" ]]; then
  cp "$HOME/.config/pub/credentials.json" "$NEST/config/pub/credentials.json"
fi
if [[ -f "$HOME/.config/pub/credentials.json" ]]; then
  cp "$HOME/.config/pub/credentials.json" "$NEST/config/pub/credentials.json"
fi
printf 'ephemeral nested PUB session\nstarted %s\n' "$(date -Iseconds)" > "$NEST/README"

export XDG_CONFIG_HOME="$NEST/config"
export XDG_CACHE_HOME="$NEST/cache"
export XDG_DATA_HOME="$NEST/data"
export XDG_STATE_HOME="$NEST/state"
unset DCONF_PROFILE
export MUTTER_DEBUG_DUMMY_MODE_SPECS="${MUTTER_DEBUG_DUMMY_MODE_SPECS:-1600x1000}"
export PUB_PROBE=1
export PUB_NEST_MODE="${PUB_NEST_MODE:-user}"

exec dbus-run-session -- bash -c '
  set -euo pipefail
  printf "%s\n" "$DBUS_SESSION_BUS_ADDRESS" > "'"$NEST"'/bus-address"
  printf "%s\n" "$$" > "'"$NEST"'/wrapper.pid"
  gnome-shell --wayland --devkit --mode="'"${PUB_NEST_MODE:-user}"'" > "'"$NEST"'/gnome-shell.log" 2>&1 &
  printf "%s\n" "$!" > "'"$NEST"'/gnome-shell.pid"
  ready=0
  for _ in $(seq 1 80); do
    if gdbus call --session \
         --dest org.gnome.Shell.Extensions \
         --object-path /org/gnome/Shell/Extensions \
         --method org.gnome.Shell.Extensions.ListExtensions >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 0.25
  done
  if [[ "$ready" -ne 1 ]]; then
    echo "nested gnome-shell did not export Extensions API" >&2
    tail -n 80 "'"$NEST"'/gnome-shell.log" >&2 || true
    exit 1
  fi
  gsettings set org.gnome.desktop.media-handling automount false || true
  gsettings set org.gnome.desktop.media-handling automount-open false || true
  gsettings set org.gnome.shell disable-user-extensions false
  gnome-extensions enable pub@noirbright
  gnome-extensions info pub@noirbright > "'"$NEST"'/extension-info.txt" 2>&1 || true
  wait "$(cat "'"$NEST"'/gnome-shell.pid")"
'
