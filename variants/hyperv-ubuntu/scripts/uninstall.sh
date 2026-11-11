#!/usr/bin/env bash
# Remove the theme: restore the desktop entry and delete the themed copy. The official app is untouched.
set -Eeuo pipefail
PREFIX="${CLAUDE_MOE_PREFIX:-$HOME/.local/share/claude-moe}"
DESKTOP_ID=com.anthropic.Claude.desktop
user_desktop="${XDG_DATA_HOME:-$HOME/.local/share}/applications/$DESKTOP_ID"

if pgrep -f -- "^$PREFIX/app/claude-desktop( |\$)" >/dev/null 2>&1; then
  echo 'Quit the themed Claude first.' >&2
  exit 1
fi
if [ -f "$user_desktop" ] && grep -q '^X-Claude-Moe=true' "$user_desktop"; then
  if [ -f "$PREFIX/$DESKTOP_ID.before-moe" ]; then
    mv "$PREFIX/$DESKTOP_ID.before-moe" "$user_desktop"
  else
    rm -f "$user_desktop"     # the official app writes its own entry again on next start
  fi
  update-desktop-database "$(dirname "$user_desktop")" >/dev/null 2>&1 || true
fi
# Put back desktop icons that install.sh replaced with links.
desk_dir=$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")
for saved in "$PREFIX"/desktop-icons/*.desktop; do
  [ -f "$saved" ] || continue
  icon="$desk_dir/$(basename "$saved")"
  if [ -L "$icon" ] || [ ! -e "$icon" ]; then
    rm -f "$icon"
    cp -p "$saved" "$icon"
    gio set "$icon" metadata::trusted true >/dev/null 2>&1 || true
  fi
done
# An "open at login" entry written by the themed copy points at it; point it back at the official app.
autostart="${XDG_CONFIG_HOME:-$HOME/.config}/autostart/claude-desktop.desktop"
[ -f "$autostart" ] && sed -i -e "s|\"$PREFIX/app/claude-desktop\"|\"/usr/lib/claude-desktop/claude-desktop\"|" \
  -e "s|\"$PREFIX/bin/claude-moe\"|\"/usr/lib/claude-desktop/claude-desktop\"|" "$autostart"
# The themed copy registered the browser-extension native host under its own path; point it back.
for manifest in "${XDG_CONFIG_HOME:-$HOME/.config}"/*/NativeMessagingHosts/com.anthropic.claude_browser_extension.json; do
  [ -f "$manifest" ] && grep -q "$PREFIX/app/resources/" "$manifest" &&
    sed -i "s|$PREFIX/app/resources/|/usr/lib/claude-desktop/resources/|" "$manifest"
done
case "$PREFIX" in
  "$HOME"/.local/share/claude-moe) rm -rf -- "$PREFIX" ;;
  *) echo "Not deleting unexpected prefix $PREFIX; remove it yourself." >&2; exit 1 ;;
esac
echo 'Theme removed; the official Claude is unchanged.'
