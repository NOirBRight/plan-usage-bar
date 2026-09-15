#!/usr/bin/env bash
# Click PUB Strip and assert the Popover opened.
#   PUB_PROBE_MODE=host  (default) host pointer on Mutter Development Kit
#   PUB_PROBE_MODE=virt  Clutter virtual pointer inside nested gnome-shell
# Exit 0 = isOpen true. Exit 1 = still closed (the user-facing bug).
set -euo pipefail

NEST="${PUB_NEST_DIR:-/tmp/pub-nested}"
PROBE="$NEST/state/pub-probe.json"
CMD="$NEST/state/pub-probe.cmd"
LOG="$NEST/gnome-shell.log"
MODE="${PUB_PROBE_MODE:-host}"

if [[ ! -f "$NEST/bus-address" ]]; then
  echo "FAIL missing nested session at $NEST" >&2
  exit 1
fi
if [[ ! -f "$PROBE" ]]; then
  echo "FAIL probe file missing: $PROBE" >&2
  exit 1
fi

unset NO_AT_BRIDGE || true
export AT_SPI_BUS_ADDRESS="${AT_SPI_BUS_ADDRESS:-unix:path=/run/user/1000/at-spi/bus}"

python3 - "$PROBE" "$CMD" "$LOG" "$MODE" <<'PY'
import json, os, sys, time
from pathlib import Path

probe_path = Path(sys.argv[1])
cmd_path = Path(sys.argv[2])
log_path = Path(sys.argv[3])
mode = sys.argv[4]

def read_probe():
    if not probe_path.exists():
        return None
    text = probe_path.read_text(encoding='utf-8').strip()
    if not text:
        return None
    return json.loads(text.splitlines()[-1])

def send_cmd(name):
    cmd_path.write_text(name + '\n', encoding='utf-8')

def wait_until(pred, timeout=2.5):
    end = time.time() + timeout
    last = read_probe()
    while time.time() < end:
        last = read_probe() or last
        if last and pred(last):
            return last
        time.sleep(0.05)
    return last

def fail(msg, extra=None):
    print(f'FAIL {msg}')
    if extra is not None:
        print(json.dumps(extra, ensure_ascii=False, indent=2))
    sys.exit(1)

def log_hits():
    if not log_path.exists():
        return ''
    lines = log_path.read_text(encoding='utf-8', errors='replace').splitlines()
    interesting = [ln for ln in lines if any(s in ln for s in (
        'JS ERROR', 'TypeError', 'SyntaxError', 'PUB:', 'DEBUG-pub1'))]
    return '\n'.join(interesting[-40:])

before = read_probe()
if before is None:
    fail('probe unreadable')
print(f'MODE {mode}')
print(f'BEFORE {json.dumps(before, ensure_ascii=False)}')

if before.get('isOpen'):
    send_cmd('close')
    before = wait_until(lambda s: s.get('isOpen') is False)
    print(f'CLOSED {json.dumps(before, ensure_ascii=False)}')
if before.get('isOpen'):
    fail('could not close popover before click', before)

stable = wait_until(lambda s: (s.get('width') or 0) > 64 and (s.get('stageW') or 0) > 0, timeout=4.0)
if stable:
    before = stable
print(f'STABLE {json.dumps(before, ensure_ascii=False)}')

if mode == 'virt':
    send_cmd('click')
    print('CMD click')
else:
    import gi
    gi.require_version('Atspi', '2.0')
    from gi.repository import Atspi

    def find_devkit_window(desktop):
        for i in range(desktop.get_child_count()):
            app = desktop.get_child_at_index(i)
            if (app.get_name() or '') != 'gnome-shell':
                continue
            try:
                stage = app.get_child_at_index(0)
                panel = stage.get_child_at_index(0)
                group = panel.get_child_at_index(0)
            except Exception:
                continue
            for j in range(group.get_child_count()):
                win = group.get_child_at_index(j)
                name = win.get_name() or ''
                if 'Wayland window' not in name and 'X11 window' not in name:
                    continue
                try:
                    ext = Atspi.Component.get_extents(win, Atspi.CoordType.SCREEN)
                except Exception:
                    continue
                if 1200 <= ext.width <= 1400 and 820 <= ext.height <= 980:
                    return ext
        return None

    desktop = Atspi.get_desktop(0)
    win = find_devkit_window(desktop)
    if win is None:
        fail('could not find Mutter Development Kit window on host AT-SPI')
    stage_x = before.get('stageX') or 0
    stage_y = before.get('stageY') or 0
    stage_w = before.get('stageW') or 1280
    stage_h = before.get('stageH') or 800
    width = before.get('width') or 32
    height = before.get('height') or 32
    scale_x = win.width / stage_w
    scale_y = (win.height - 46) / stage_h if stage_h else 1
    title = max(0, win.height - stage_h * scale_y)
    click_x = int(win.x + (stage_x + min(24, width / 2)) * scale_x)
    click_y = int(win.y + title + (stage_y + height / 2) * scale_y)
    print(f'WINDOW ({win.x},{win.y},{win.width},{win.height})')
    print(f'STAGE {stage_w}x{stage_h} scale=({scale_x:.3f},{scale_y:.3f}) title={title:.1f}')
    print(f'CLICK host=({click_x},{click_y}) nested_stage=({stage_x},{stage_y}) size={width}x{height}')
    print(f'MOUSE b1c returned {Atspi.generate_mouse_event(click_x, click_y, "b1c")}')

after = wait_until(lambda s: s.get('isOpen') is True or s.get('event') in (
    'button-press', 'click-gesture', 'open-state-changed', 'open-failed', 'probe-click'), timeout=2.0)
if after and after.get('event') in ('button-press', 'click-gesture', 'probe-click') and after.get('isOpen') is not True:
    after = wait_until(lambda s: s.get('isOpen') is True, timeout=0.8)

print(f'AFTER {json.dumps(after, ensure_ascii=False)}')
errors = log_hits()
if errors:
    print('LOG')
    print(errors)

reached = after and after.get('event') in (
    'button-press', 'click-gesture', 'open-state-changed', 'open-failed', 'probe-click')
if after and after.get('isOpen') is True:
    print('PASS popover isOpen=true')
    sys.exit(0)
if not reached:
    fail('click did not reach the Strip (no button-press / gesture)', after)
fail('click reached the Strip but popover did not stay open', after)
PY
