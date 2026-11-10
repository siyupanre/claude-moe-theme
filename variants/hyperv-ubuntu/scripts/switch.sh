#!/usr/bin/env bash
# Switch the Claude desktop icon (and claude:// links) between the themed copy and the official app.
#   switch.sh             with Claude quit: back up the sign-in data, point the icon at the themed copy, start it
#   switch.sh --official  point the icon back at the official app (the themed copy stays installed)
set -Eeuo pipefail
project=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
PREFIX="${CLAUDE_MOE_PREFIX:-$HOME/.local/share/claude-moe}"
OFFICIAL=/usr/lib/claude-desktop/claude-desktop
DESKTOP_ID=com.anthropic.Claude.desktop
user_desktop="${XDG_DATA_HOME:-$HOME/.local/share}/applications/$DESKTOP_ID"
profile="${XDG_CONFIG_HOME:-$HOME/.config}/Claude"

autostart="${XDG_CONFIG_HOME:-$HOME/.config}/autostart/claude-desktop.desktop"

running() { pgrep -f -- "^$1( |\$)" >/dev/null 2>&1; }

# Point an existing "open at login" entry at the given program (the app writes its own path there).
route_autostart() {
  [ -f "$autostart" ] || return 0
  sed -i -e "s|\"$OFFICIAL\"|\"$1\"|" -e "s|\"$PREFIX/app/claude-desktop\"|\"$1\"|" -e "s|\"$PREFIX/bin/claude-moe\"|\"$1\"|" "$autostart"
}

to_official() {
  if [ -f "$user_desktop" ] && grep -q '^X-Claude-Moe=true' "$user_desktop"; then
    if [ -f "$PREFIX/$DESKTOP_ID.before-moe" ]; then
      cp "$PREFIX/$DESKTOP_ID.before-moe" "$user_desktop"
    else
      rm -f "$user_desktop"     # the official app writes its own entry again on next start
    fi
    update-desktop-database "$(dirname "$user_desktop")" >/dev/null 2>&1 || true
  fi
  route_autostart "$OFFICIAL"
  echo 'The Claude icon now opens the official app. The themed copy is still installed.'
}

if [ "${1:-}" = --official ]; then to_official; exit 0; fi

if running "$OFFICIAL" || running "$PREFIX/app/claude-desktop"; then
  echo 'Claude is still running. Quit it first (menu > Quit, or Ctrl+Q; closing the window only hides it), then run this again.' >&2
  exit 1
fi

# Sign-in and session data only; caches and the downloaded Claude Code binaries are left out.
backups="$PREFIX/backups"
mkdir -p "$backups"; chmod 700 "$backups"
backup="$backups/profile-$(date +%Y%m%d-%H%M%S).tar.gz"
( umask 077; tar -czf "$backup" -C "$profile" \
    --exclude=./Cache --exclude='./Code Cache' --exclude=./GPUCache --exclude=./DawnGraphiteCache \
    --exclude=./DawnWebGPUCache --exclude=./claude-code --exclude=./logs --exclude=./Crashpad . )
echo "Backed up sign-in data to $backup"

bash "$project/scripts/install.sh" --desktop
route_autostart "$PREFIX/bin/claude-moe"

# First start in diagnostic mode so the background's placement and frame drops are logged.
setsid -f env CLAUDE_MOE_DIAG=1 "$PREFIX/bin/claude-moe" > "$PREFIX/last-launch.log" 2>&1 < /dev/null
cat <<EOF

Themed Claude is starting.
  Back to the official app:  $project/scripts/switch.sh --official
  Event log:                 $profile/claude-moe/status.json
If you find yourself signed out, quit Claude, run "switch.sh --official", then restore the backup:
  tar -xzf "$backup" -C "$profile"
EOF
