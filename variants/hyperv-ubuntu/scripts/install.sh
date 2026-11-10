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
  template=/usr/share/applications/$DESKTOP_ID
  if [ -f "$user_desktop" ] && ! grep -q '^X-Claude-Moe=true' "$user_desktop"; then
    cp "$user_desktop" "$PREFIX/$DESKTOP_ID.before-moe"
    grep -q '^X-Claude-Generated=true' "$user_desktop" && template="$PREFIX/$DESKTOP_ID.before-moe"
  fi
  # No X-Claude-Generated line: the official app then leaves this entry alone.
  sed -e '/^X-Claude-Generated=/d' -e '/^TryExec=/d' \
      -e "s|^Exec=claude-desktop|Exec=$PREFIX/bin/claude-moe|" \
      -e '/^\[Desktop Entry\]$/a X-Claude-Moe=true' \
      "$template" > "$user_desktop.tmp"
  mv "$user_desktop.tmp" "$user_desktop"
  update-desktop-database "$(dirname "$user_desktop")" >/dev/null 2>&1 || true
  echo "Desktop entry now opens the themed copy: $user_desktop"
fi
echo "Installed to $PREFIX"
