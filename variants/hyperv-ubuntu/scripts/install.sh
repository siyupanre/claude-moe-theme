#!/usr/bin/env bash
# Install the theme for the current user and build the themed copy.
#   install.sh            copy files to ~/.local/share/claude-moe and build (the desktop icon still opens the official app)
#   install.sh --desktop  also make the Claude desktop icon and claude:// links open the themed copy
set -Eeuo pipefail
project=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
PREFIX="${CLAUDE_MOE_PREFIX:-$HOME/.local/share/claude-moe}"
DESKTOP_ID=com.anthropic.Claude.desktop
user_desktop="${XDG_DATA_HOME:-$HOME/.local/share}/applications/$DESKTOP_ID"

[ "$(id -u)" -ne 0 ] || { echo 'Run as your normal user, not root.' >&2; exit 1; }
[ -x /usr/lib/claude-desktop/claude-desktop ] || { echo 'The official Claude Desktop is not installed.' >&2; exit 1; }

mkdir -p "$PREFIX/bin" "$PREFIX/lib"
rm -rf "$PREFIX/runtime.new"
cp -r "$project/runtime" "$PREFIX/runtime.new"
rm -rf "$PREFIX/runtime"
mv "$PREFIX/runtime.new" "$PREFIX/runtime"
install -m 0755 "$project/scripts/build.py" "$PREFIX/lib/build.py"
install -m 0755 "$project/scripts/claude-moe" "$PREFIX/bin/claude-moe"
[ -f "$PREFIX/config.json" ] || cat > "$PREFIX/config.json" <<'EOF'
{
 "splash": true,
 "splashWaitForApp": true,
 "splashMaxWait": 20,
 "background": true,
 "wash": 0.65,
 "composer": "transparent",
 "pauseWhenUnfocused": true,
 "diagnostics": false
}
EOF
# Never replace the files of a running copy; the launcher rebuilds on the next start instead.
if pgrep -f -- "^$PREFIX/app/claude-desktop( |\$)" >/dev/null 2>&1; then
  echo 'The themed Claude is running: files updated, the copy is rebuilt the next time Claude starts.'
else
  python3 -I "$PREFIX/lib/build.py" --prefix "$PREFIX"
fi

if [ "${1:-}" = --desktop ]; then
  mkdir -p "$(dirname "$user_desktop")"
  # Keep the app's own generated entry (it carries X-Claude-Generated) so uninstall can restore it,
  # and start from it because it lists more launcher actions than the packaged one.
  # Reinstalls reuse that backup, so the extra actions survive a second run.
  template=/usr/share/applications/$DESKTOP_ID
  backup="$PREFIX/$DESKTOP_ID.before-moe"
  if [ -f "$user_desktop" ] && ! grep -q '^X-Claude-Moe=true' "$user_desktop"; then
    cp "$user_desktop" "$backup"
  fi
  if [ -f "$backup" ] && grep -q '^X-Claude-Generated=true' "$backup"; then template="$backup"; fi
  # No X-Claude-Generated line: the official app then leaves this entry alone.
  sed -e '/^X-Claude-Generated=/d' -e '/^TryExec=/d' \
      -e "s|^Exec=claude-desktop|Exec=$PREFIX/bin/claude-moe|" \
      -e '/^\[Desktop Entry\]$/a X-Claude-Moe=true' \
      "$template" > "$user_desktop.tmp"
  mv "$user_desktop.tmp" "$user_desktop"
  chmod 0755 "$user_desktop"      # a desktop icon linked to this entry must be executable to launch
  update-desktop-database "$(dirname "$user_desktop")" >/dev/null 2>&1 || true
  echo "Desktop entry now opens the themed copy: $user_desktop"
  # A Claude launcher copied onto the desktop is a separate file that keeps starting the official app.
  # Back it up and replace it with a link to the entry above, so the desktop icon follows switch.sh too.
  desk_dir=$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")
  for icon in "$desk_dir"/*.desktop; do
    [ -f "$icon" ] && [ ! -L "$icon" ] && grep -q '^Exec=claude-desktop' "$icon" || continue
    mkdir -p "$PREFIX/desktop-icons"
    cp -p "$icon" "$PREFIX/desktop-icons/$(basename "$icon")"
    ln -sf "$user_desktop" "$icon"
    gio set "$icon" metadata::trusted true >/dev/null 2>&1 || true
    echo "Desktop icon now follows the Claude entry: $icon"
  done
fi
echo "Installed to $PREFIX"
