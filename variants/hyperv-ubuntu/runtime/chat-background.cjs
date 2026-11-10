'use strict';
// Chat background, main-process side. Adapted from claude-moe-theme (MIT).
// Injects chat-background.js into an isolated world of the claude.ai chat pages only, and
// pauses the video while the splash plays, while no window is visible or focused, and on battery.
const fs = require('node:fs'), path = require('node:path');

const WORLD = 24602;
// Pages that host a chat transcript. Sign-in, settings, artifacts and previews are left alone.
const CHAT_PATH = /^\/(?:$|new(?:\/|$)|chat(?:\/|$)|epitaxy(?:\/|$)|code(?:\/|$)|cowork(?:\/|$)|recents(?:\/|$)|tasks(?:\/|$)|project(?:\/|$))/;

module.exports = function attachChatBackground(app, assets, {config, onBattery, status}) {
  const {BrowserWindow, powerMonitor} = require('electron');
  const script = fs.readFileSync(path.join(assets, 'chat-background.js'), 'utf8');
  const poster = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(assets, 'chat-background.jpg')).toString('base64');
  const video = fs.readFileSync(path.join(assets, 'chat-background.mp4')).toString('base64');
  const options = JSON.stringify({wash: Number.isFinite(Number(config.wash)) ? Number(config.wash) : 0.65,
    composer: config.composer === 'solid' ? 'solid' : 'transparent'});
  const selfTestUrl = process.env.CLAUDE_MOE_SELFTEST_URL || null;
  const diagnostics = process.env.CLAUDE_MOE_DIAG === '1' || config.diagnostics === true;
  const tracked = new Set(), installed = new Set();
  let suspended = false;

  function eligible(value) {
    if (selfTestUrl && value === selfTestUrl) return true;
    try {
      const u = new URL(value);
      return u.protocol === 'https:' && u.hostname === 'claude.ai' && !u.port && !u.username && !u.password && CHAT_PATH.test(u.pathname);
    } catch { return false; }
  }
  // Origin and first path segment only, so the log never carries conversation ids.
  const where = url => { try { const u = new URL(url); return u.origin + '/' + (u.pathname.split('/')[1] || ''); } catch { return '?'; } };

  function shouldPause() {
    if (suspended) return true;
    const windows = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed());
    if (!windows.some(w => w.isVisible() && !w.isMinimized())) return true;
    if (config.pauseWhenUnfocused && !windows.some(w => w.isFocused())) return true;
    return onBattery();
  }
  function update() {
    const pause = shouldPause();
    for (const wc of tracked) {
      if (wc.isDestroyed() || !eligible(wc.getURL())) continue;
      wc.executeJavaScriptInIsolatedWorld(WORLD, [{code: `window.__claudeFixedBackground?.setSuspended(${pause})`}]).catch(() => {});
    }
  }
  const scheduleUpdate = () => setImmediate(update);

  app.on('web-contents-created', (_event, wc) => {
    tracked.add(wc);
    wc.once('destroyed', () => { tracked.delete(wc); installed.delete(wc); });
    let busy = false;
    async function install() {
      if (busy || wc.isDestroyed() || !eligible(wc.getURL())) return;
      busy = true;
      try {
        const present = await wc.executeJavaScriptInIsolatedWorld(WORLD, [{code: 'Boolean(window.__claudeFixedBackground&&(window.__claudeFixedBackground.refresh(),true))'}]);
        if (!present && !wc.isDestroyed()) {
          await wc.executeJavaScriptInIsolatedWorld(WORLD, [{code: `${script}\ninstallClaudeChatBackground(${JSON.stringify(poster)},${JSON.stringify(video)},${shouldPause()},${options});`}]);
          if (!installed.has(wc)) { installed.add(wc); status('background_installed', where(wc.getURL())); }
          if (diagnostics) for (const delay of [4000, 15000]) setTimeout(() => report(wc), delay).unref();
        }
      } catch (error) {
        status('background_install_failed', String(error && error.message).slice(0, 160));
      } finally { busy = false; }
    }
    wc.on('dom-ready', install);
    wc.on('did-finish-load', install);
    wc.on('did-navigate-in-page', install);
    // In diagnostic mode, also report after in-app navigation (Chat, Code, Project are one page).
    if (diagnostics) wc.on('did-navigate-in-page', () => setTimeout(() => report(wc), 3000).unref());
  });

  async function report(wc) {
    if (wc.isDestroyed() || !eligible(wc.getURL())) return;
    try {
      const stats = await wc.executeJavaScriptInIsolatedWorld(WORLD, [{code: 'window.__claudeFixedBackground?.stats()'}]);
      status('background_stats', {where: where(wc.getURL()), ...stats});
    } catch {}
  }

  app.on('browser-window-created', (_event, win) => {
    for (const event of ['minimize', 'restore', 'show', 'hide', 'focus', 'blur', 'closed']) win.on(event, scheduleUpdate);
  });
  app.whenReady().then(() => {
    powerMonitor.on('on-battery', scheduleUpdate);
    powerMonitor.on('on-ac', scheduleUpdate);
  });

  return {setSuspended(value) { suspended = Boolean(value); update(); }};
};
