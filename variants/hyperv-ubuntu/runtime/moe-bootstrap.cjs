'use strict';
// Entry point of the themed Claude copy. It adds the startup splash and the chat background,
// then loads the official main script unchanged. Any failure here leaves the official app running.
const {app, BrowserWindow, powerMonitor, webContents} = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

const ORIGINAL_MAIN = './.vite/build/index.pre.js';
const assets = path.join(process.resourcesPath, 'moe');
const DEFAULTS = {splash: true, splashWaitForApp: true, splashMaxWait: 20, background: true, wash: 0.65,
  composer: 'transparent', pauseWhenUnfocused: true, diagnostics: false};

const CONFIG_FILE = process.env.CLAUDE_MOE_CONFIG || path.join(os.homedir(), '.local/share/claude-moe/config.json');
function loadConfig() {
  try { return {...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))}; } catch { return {...DEFAULTS}; }
}

// Apply a new wash as soon as config.json changes, so it can be tuned against the real UI without
// a restart. Watches the directory because editors often replace the file instead of writing it.
function watchWash(background, current) {
  let timer = null, wash = current;
  try {
    fs.watch(path.dirname(CONFIG_FILE), (_type, name) => {
      if (name && name !== path.basename(CONFIG_FILE)) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        let next;
        try { next = Number(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')).wash); } catch { return; }
        if (!Number.isFinite(next) || next === wash) return;
        wash = next;
        background.setWash(wash);
        status('wash_changed', wash);
      }, 200);
    }).unref();
  } catch {}
}

// Event log for troubleshooting: codes and timings only, never page content.
const events = [];
function status(code, detail) {
  events.push({t: Math.round(process.uptime() * 1000), code, ...(detail ? {detail} : {})});
  if (events.length > 200) events.splice(0, events.length - 200);
  try {
    const dir = path.join(app.getPath('userData'), 'claude-moe');
    fs.mkdirSync(dir, {recursive: true, mode: 0o700});
    fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify({version: app.getVersion(), events}, null, 1), {mode: 0o600});
  } catch {}
}

function capture(name, contents) {
  if (process.env.CLAUDE_MOE_CAPTURE !== '1' || !contents || contents.isDestroyed()) return;
  contents.capturePage().then(image => {
    const dir = path.join(app.getPath('userData'), 'claude-moe', 'capture');
    fs.mkdirSync(dir, {recursive: true, mode: 0o700});
    fs.writeFileSync(path.join(dir, name + '.png'), image.toPNG());
  }).catch(() => {});
}

// The official main window is parentless, visible at launch and at least 600x400 (its minimum size).
// The quick-entry window is large too but is created hidden, so it never qualifies here.
function describe(win) {
  return {parent: !!win.getParentWindow(), visible: win.isVisible(), size: win.getSize(), min: win.getMinimumSize()};
}
function isMainWindow(win) {
  if (win.isDestroyed() || win.getParentWindow()) return false;
  const [minWidth, minHeight] = win.getMinimumSize(), [width, height] = win.getSize();
  return (minWidth >= 400 && minHeight >= 300) || (win.isVisible() && width >= 600 && height >= 400);
}

// The app's "open at login" entry runs process.execPath directly, which would skip the launcher
// and its rebuild after an official update. Point it at the launcher instead; the app writes the
// entry when the setting is toggled, so this runs at start and again at quit.
function routeAutostartThroughLauncher() {
  const launcher = path.resolve(process.resourcesPath, '..', '..', 'bin', 'claude-moe');
  const file = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'autostart',
    path.basename(process.execPath) + '.desktop');
  try {
    if (!fs.existsSync(launcher)) return;
    const text = fs.readFileSync(file, 'utf8');
    if (!text.includes(process.execPath)) return;
    fs.writeFileSync(file, text.split(process.execPath).join(launcher));
    status('autostart_routed');
  } catch {}
}

// Resolves once claude.ai has rendered a usable page: a composer on chat pages, or a fully loaded
// document elsewhere (settings and the like have no composer). Checks presence only, never content,
// from its own isolated world; gives up after 40s so it never keeps polling.
const READY_WORLD = 24603;
const READY_PROBE = `(() => {
  if (document.readyState !== 'complete') return false;
  if (document.querySelector('[data-chat-input-container],[data-message-box],[contenteditable="true"][role="textbox"],main textarea')) return true;
  return !/^\\/(?:$|new|chat|epitaxy|code|cowork|recents|tasks|project)(?:\\/|$)/.test(location.pathname);
})()`;
function waitForApp() {
  const started = Date.now();
  let busy = false, done = false;
  return new Promise(resolve => {
    const timer = setInterval(async () => {
      if (busy || done) return;
      if (Date.now() - started > 40000) { done = true; clearInterval(timer); status('app_ready_unknown'); return; }
      busy = true;
      try {
        for (const wc of webContents.getAllWebContents()) {
          if (wc.isDestroyed()) continue;
          try { if (new URL(wc.getURL()).hostname !== 'claude.ai') continue; } catch { continue; }
          try {
            if (await wc.executeJavaScriptInIsolatedWorld(READY_WORLD, [{code: READY_PROBE}])) {
              done = true;
              clearInterval(timer);
              status('app_ready', Date.now() - started);
              return resolve();
            }
          } catch {}
        }
      } finally { busy = false; }
    }, 400);
  });
}

function install() {
  app.whenReady().then(routeAutostartThroughLauncher);
  app.on('will-quit', routeAutostartThroughLauncher);
  const config = loadConfig();
  const onBattery = () => { try { return powerMonitor.isOnBatteryPower(); } catch { return false; } };
  let background = null;
  if (config.background) {
    try {
      background = require('./chat-background.cjs')(app, assets, {config, onBattery, status});
      watchWash(background, Number(config.wash));
    } catch (error) { status('background_unavailable', String(error && error.message)); }
  }

  let quitting = false, splashUsed = !config.splash, cover = null;
  const ignored = new WeakSet();            // windows this module opens itself
  app.on('before-quit', () => { quitting = true; cover?.close('quit'); cover = null; });
  app.on('browser-window-created', (_event, win) => {
    if (splashUsed || quitting) return;
    // Decide after the constructor and the app's own setup have run, then once more when the window is shown.
    setImmediate(() => {
      if (win.isDestroyed() || ignored.has(win)) return;
      status('window_created', describe(win));
      if (isMainWindow(win)) return claim(win);
      const timer = setTimeout(() => win.off('show', onShow), 4000);
      const onShow = () => { clearTimeout(timer); setImmediate(() => { if (isMainWindow(win)) claim(win); }); };
      win.once('show', onShow);
    });
  });

  function claim(win) {
    if (splashUsed || quitting || win.isDestroyed()) return;
    splashUsed = true;
    const begin = () => {
      if (quitting || win.isDestroyed()) return;
      try {
        background?.setSuspended(true);
        const power = onBattery() ? 'battery' : 'ac';
        const holdSeconds = Math.min(60, Math.max(0, Number(config.splashMaxWait) || 0));
        cover = require('./startup-cover.cjs')(win, {
          assets, power, capture,
          appReady: config.splashWaitForApp && holdSeconds > 0 ? waitForApp() : null,
          holdSeconds,
          onReady: () => status('splash_ready', power),
          onError: reason => status('splash_failed', reason),
          onClose: reason => {
            cover = null;
            background?.setSuspended(false);
            status('splash_closed', reason);
            setTimeout(() => {
              if (win.isDestroyed()) return;
              capture('main-window', win.webContents);
              win.contentView.children.forEach((child, i) => capture('main-view-' + i, child.webContents));
            }, 3000).unref();
          },
        });
        status('splash_attached', power);
      } catch (error) {
        background?.setSuspended(false);
        status('splash_failed', String(error && error.message));
      }
    };
    // A hidden launch (autostart to tray) shows no splash; a normal launch shows the window at once.
    setImmediate(() => {
      if (win.isDestroyed()) return;
      if (win.isVisible()) return begin();
      const timer = setTimeout(() => { win.off('show', onShow); status('splash_skipped', 'window_hidden'); }, 4000);
      const onShow = () => { clearTimeout(timer); begin(); };
      win.once('show', onShow);
    });
  }
  // Test hook: open a fixture page that mimics the chat layout, so the background can be checked
  // without signing in. Only active when the test runner sets CLAUDE_MOE_SELFTEST_URL.
  const fixture = process.env.CLAUDE_MOE_SELFTEST_URL;
  if (fixture && background) {
    app.whenReady().then(() => setTimeout(() => {
      const probe = new BrowserWindow({width: 900, height: 640, title: 'claude-moe self-test', webPreferences: {sandbox: true, contextIsolation: true}});
      ignored.add(probe);
      probe.loadURL(fixture).catch(() => status('selftest_failed', 'load'));
      setTimeout(() => capture('selftest', probe.webContents), 9000).unref();
    }, 6000));
  }
  status('bootstrap_ready', {splash: config.splash, background: !!background, wash: config.wash});
}

try { install(); } catch (error) { status('bootstrap_failed', String(error && error.message)); }
require(ORIGINAL_MAIN);
