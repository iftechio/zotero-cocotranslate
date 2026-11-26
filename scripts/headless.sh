#!/bin/bash
# Linux development without a screen: a virtual X display, a window manager, and helpers to look
# at and click it. Nothing here touches a real desktop.
#
#   scripts/headless.sh up                 start Xvfb :99 + openbox (idempotent)
#   scripts/headless.sh start              (re)start Zotero on it with the dev profile
#   scripts/headless.sh shot OUT.png [WxH+X+Y]   screenshot, optionally cropped
#   scripts/headless.sh click X Y | rclick X Y | move X Y | key KEYS
#   scripts/headless.sh down               stop Zotero, openbox and Xvfb
set -euo pipefail
export DISPLAY="${DISPLAY_NUM:-:99}"
cd "$(dirname "$0")/.."
ZOTERO_BIN="${ZOTERO_BIN:-$HOME/Zotero_linux-x86_64/zotero}"

case "${1:-}" in
  up)
    if ! xdpyinfo >/dev/null 2>&1; then
      Xvfb "$DISPLAY" -screen 0 1600x1000x24 -nolisten tcp >/tmp/coco-xvfb.log 2>&1 &
      for _ in $(seq 50); do xdpyinfo >/dev/null 2>&1 && break; sleep 0.1; done
    fi
    pgrep -x openbox >/dev/null || (openbox >/tmp/coco-openbox.log 2>&1 &)
    ;;
  start)
    "$0" up
    ZOTERO_BIN="$ZOTERO_BIN" node scripts/start.mjs
    ;;
  shot)
    # `xwd -root` leaves menus (override-redirect windows) and windows opened later, such as the
    # settings window, black on Xvfb. Grab each one by id, bottom to top, and paste it over the root
    # image: the menu itself, or the client window inside a window-manager frame.
    tmp=$(mktemp -d)
    xwd -root -silent | convert xwd:- "$tmp/root.png"
    layers=()
    grab() {
      local info x y
      info=$(xwininfo -id "$1")
      grep -q 'Map State: IsViewable' <<<"$info" || return 0
      x=$(awk '/Absolute upper-left X/ {print $NF}' <<<"$info")
      y=$(awk '/Absolute upper-left Y/ {print $NF}' <<<"$info")
      [ "$x" -ge 0 ] && [ "$y" -ge 0 ] || return 0
      xwd -id "$1" -silent | convert xwd:- -alpha off "$tmp/$1.png" && layers+=(-page "+$x+$y" "$tmp/$1.png")
    }
    # xwininfo lists the top window first
    for id in $(xwininfo -root -children | awk '/^ +0x/ {print $1}' | tac); do
      info=$(xwininfo -id "$id")
      grep -q 'Map State: IsViewable' <<<"$info" || continue
      if grep -q 'Override Redirect State: yes' <<<"$info"; then
        grab "$id"
      else
        # the client is the descendant with a WM_CLASS, somewhere under the frame's decorations
        for child in $(xwininfo -id "$id" -tree | awk '/^ +0x/ && /\(".*"\)/ {print $1}'); do grab "$child"; done
      fi
    done
    convert "$tmp/root.png" "${layers[@]}" -flatten ${3:+-crop "$3" +repage} png:"$2"
    rm -rf "$tmp"
    ;;
  click) xdotool mousemove "$2" "$3" click 1 ;;
  rclick) xdotool mousemove "$2" "$3" click 3 ;;
  move) xdotool mousemove "$2" "$3" ;;
  key) shift; xdotool key "$@" ;;
  down)
    ZOTERO_BIN="$ZOTERO_BIN" node scripts/start.mjs --stop || true
    pkill -x openbox || true
    pkill -f "Xvfb $DISPLAY" || true
    ;;
  *) sed -n '2,12p' "$0"; exit 2 ;;
esac
