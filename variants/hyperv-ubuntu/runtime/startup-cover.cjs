'use strict';
// Startup splash: a temporary WebContentsView covering the main window's client area.
// Adapted from claude-moe-theme (MIT). It stays offscreen until the splash page reports
// READY, is kept above the views the official app adds, and is always released: on done,
// skip, timeout, renderer failure or window close.
const {WebContentsView, webContents} = require('electron');
const path = require('node:path');

// appReady: optional promise that resolves once the app behind has loaded; the splash then holds
// its last frame for up to holdSeconds after the clip instead of revealing a half-loaded window.
module.exports = function attachStartupCover(win, {assets, power = 'ac', appReady = null, holdSeconds = 20, capture = () => {},
  onReady = () => {}, onClose = () => {}, onError = () => {}}) {
  const maxMs = 12000 + (appReady ? holdSeconds * 1000 : 0);
  const host = win.contentView;
  const originalAdd = host.addChildView, ownAdd = Object.getOwnPropertyDescriptor(host, 'addChildView');
  const view = new WebContentsView({webPreferences: {nodeIntegration: false, contextIsolation: true, sandbox: true,
    backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required'}});
  const wc = view.webContents, keys = new Set();
  let closed = false, attached = false, playing = false, finishing = false, timer;
  const priorFocus = webContents.getFocusedWebContents();

  view.setBackgroundColor('#00000000');
  const fit = () => {
    if (closed || win.isDestroyed()) return;
    const [width, height] = win.getContentSize();
    view.setBounds({x: 0, y: 0, width: Math.max(1, width), height: Math.max(1, height)});
  };
  const resize = () => { fit(); setImmediate(fit); };
  const focus = () => { if (!closed && playing && win.isFocused() && !wc.isDestroyed()) wc.focus(); };
  const key = (event, input) => {
    if (input.type === 'keyDown' && ['Escape', 'Enter', ' '].includes(input.key)) { event.preventDefault(); close('skip'); }
  };
  const trackKeys = contents => {
    if (contents && !keys.has(contents)) { keys.add(contents); contents.on('before-input-event', key); }
  };
  // Views the official app adds later would otherwise stack above the cover.
  const wrapped = function (child) {
    const result = originalAdd.apply(this, arguments);
    if (!closed && child !== view) { trackKeys(child.webContents); if (attached) originalAdd.call(host, view); fit(); }
    return result;
  };

  function close(reason = 'done') {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    win.off('resize', resize); win.off('show', focus); win.off('focus', focus); win.off('closed', parentClosed);
    for (const item of keys) if (!item.isDestroyed()) item.off('before-input-event', key);
    if (host.addChildView === wrapped) {
      if (ownAdd) Object.defineProperty(host, 'addChildView', ownAdd); else delete host.addChildView;
    }
    try { if (!win.isDestroyed()) host.removeChildView(view); } catch {}
    if (!wc.isDestroyed()) {
      wc.executeJavaScript('window.__claudeStopSound?.(0)').catch(() => {}).finally(() => { if (!wc.isDestroyed()) wc.close(); });
    }
    if (!win.isDestroyed() && win.isFocused() && priorFocus && !priorFocus.isDestroyed()) priorFocus.focus();
    onClose(reason);
  }
  const parentClosed = () => close('window-closed');

  try {
    host.addChildView = wrapped;
    fit();
    trackKeys(win.webContents); trackKeys(wc);
    for (const child of host.children) trackKeys(child.webContents);
    win.on('resize', resize); win.on('show', focus); win.on('focus', focus); win.once('closed', parentClosed);
    wc.setWindowOpenHandler(() => ({action: 'deny'}));
    wc.setAudioMuted(true);
    wc.on('will-navigate', event => event.preventDefault());
    wc.on('page-title-updated', (_event, title) => {
      if (title.startsWith('CLAUDE_SPLASH_READY') && !attached && !closed) {
        attached = true;
        originalAdd.call(host, view);
        fit();
        onReady();
        wc.executeJavaScript('window.__claudeBeginPlayback?.()').catch(() => { onError('start-failed'); close('start-failed'); });
      } else if (title.startsWith('CLAUDE_SPLASH_PLAYING')) {
        playing = true;
        focus();
        appReady?.then(() => { if (!closed && !wc.isDestroyed()) wc.executeJavaScript('window.__claudeAppReady?.()').catch(() => {}); });
        setTimeout(() => capture('splash', wc), 2600).unref();
      } else if (title.startsWith('CLAUDE_SPLASH_DONE') && !finishing) {
        finishing = true;
        wc.executeJavaScript("document.documentElement.style.transition='opacity 700ms';document.documentElement.style.opacity='0'").catch(() => {});
        setTimeout(() => close('done'), 720).unref();
      }
    });
    wc.once('render-process-gone', () => { onError('renderer-gone'); close('renderer-failed'); });
    timer = setTimeout(() => close('timeout'), maxMs);
    timer.unref();
    const query = {launcher: '', embedded: '', power, ...(appReady ? {hold: String(holdSeconds)} : {})};
    wc.loadFile(path.join(assets, 'splash', 'splash.html'), {query})
      .catch(() => { onError('load-failed'); close('load-failed'); });
  } catch (error) {
    close('attach-failed');
    throw error;
  }
  return {view, close, get closed() { return closed; }};
};
