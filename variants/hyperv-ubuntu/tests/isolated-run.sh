#!/usr/bin/env bash
# Start the themed copy with a throwaway profile, so the real Claude (and its sign-in) is untouched:
# separate HOME, config and data dirs, and a separate XDG_RUNTIME_DIR so the Cowork socket cannot clash.
# Usage: isolated-run.sh <work-dir> [seconds]   (default 40s, then the app is asked to quit)
set -Eeuo pipefail
work=${1:?work dir}; seconds=${2:-40}
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
PREFIX="${CLAUDE_MOE_PREFIX:-$HOME/.local/share/claude-moe}"
real_runtime=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}
mkdir -p "$work/home" "$work/run"
chmod 700 "$work/run"

env -i \
  HOME="$work/home" XDG_CONFIG_HOME="$work/home/.config" XDG_DATA_HOME="$work/home/.local/share" \
  XDG_CACHE_HOME="$work/home/.cache" XDG_STATE_HOME="$work/home/.local/state" XDG_RUNTIME_DIR="$work/run" \
  WAYLAND_DISPLAY="$real_runtime/${WAYLAND_DISPLAY:-wayland-0}" DISPLAY="${DISPLAY:-:0}" XAUTHORITY="${XAUTHORITY:-}" \
  DBUS_SESSION_BUS_ADDRESS="unix:path=$real_runtime/bus" XDG_SESSION_TYPE=wayland \
  XDG_CURRENT_DESKTOP="${XDG_CURRENT_DESKTOP:-ubuntu:GNOME}" LANG="${LANG:-C.UTF-8}" PATH=/usr/bin:/bin \
  CLAUDE_MOE_PREFIX="$PREFIX" CLAUDE_MOE_DIAG=1 CLAUDE_MOE_CAPTURE=1 ${CLAUDE_MOE_CONFIG:+CLAUDE_MOE_CONFIG="$CLAUDE_MOE_CONFIG"} \
  CLAUDE_MOE_SELFTEST_URL="file://$here/selftest.html" \
  "$PREFIX/bin/claude-moe" > "$work/app.log" 2>&1 &
launcher=$!
sleep "$seconds"
pid=$(pgrep -f -- "^$PREFIX/app/claude-desktop( |\$)" | head -1 || true)
if [ -n "$pid" ]; then
  kill -TERM "$pid"
  for _ in $(seq 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
fi
wait "$launcher" 2>/dev/null || true
echo "status: $work/home/.config/Claude/claude-moe/status.json"
