'use strict';
// Chat background, page side; runs in an isolated world of the claude.ai page.
// Adapted from claude-moe-theme (MIT): one muted looping video anchored to the chat container,
// under a translucent wash. It never reads conversation content.
function installClaudeChatBackground(poster, encodedVideo, suspended = false, options = {}) {
  const SLOT = '__claudeFixedBackground';
  if (window[SLOT]) { window[SLOT].refresh(); return true; }
  const WASH = Math.min(0.95, Math.max(0, Number(options.wash ?? 0.65)));
  // 'transparent' (default): the composer box loses its fill but keeps its border and shadow.
  // 'solid': the composer box keeps its own background.
  const SOLID_COMPOSER = options.composer === 'solid';
  const DROP_LIMIT = 0.15, DROP_STRIKES = 2, QUALITY_MS = 10000;
  let source = null, frame = null, timer = null, active = null, scanCount = 0;
  let degraded = null, strikes = 0, lastQuality = null, qualityTimer = null, composers = [];
  const scopes = new Map();
  const anchors = '[data-chat-transcript],[data-epitaxy-transcript-region],[data-testid="chat-transcript"],[data-chat-input-container],[data-chat-dock],[contenteditable="true"][role="textbox"],main [contenteditable="true"],main textarea,[role="main"] textarea';
  const boundary = 'main,[role="main"],.epitaxy-root,.dframe-content-inner,.dframe-content';
  const excluded = 'aside,nav,header,[role="banner"],.dframe-sidebar,[role="dialog"],[data-artifact-viewer-mode],pre,code';
  const marked = new Set();

  function mediaSource() {
    if (source) return source;
    let bytes;
    if (Uint8Array.fromBase64) bytes = Uint8Array.fromBase64(encodedVideo);
    else { const binary = atob(encodedVideo); bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i); }
    source = URL.createObjectURL(new Blob([bytes], {type: 'video/mp4'}));
    encodedVideo = null;
    return source;
  }
  function updateTheme() {
    if (!active) return;
    const root = document.documentElement;
    const dark = root.classList.contains('dark') || root.getAttribute('data-mode') === 'dark' ||
      (root.getAttribute('data-mode') === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    active.wash.style.background = dark ? `rgba(28,25,23,${WASH})` : `rgba(250,248,244,${WASH})`;
  }

  // Too many dropped frames means the machine cannot keep up: freeze on the current frame for good.
  function checkQuality() {
    const v = active?.video;
    if (!v || v.paused || degraded) { lastQuality = null; return; }
    const q = v.getVideoPlaybackQuality();
    if (lastQuality) {
      const total = q.totalVideoFrames - lastQuality.total, dropped = q.droppedVideoFrames - lastQuality.dropped;
      strikes = total > 0 && dropped / total > DROP_LIMIT ? strikes + 1 : 0;
      if (strikes >= DROP_STRIKES) { degraded = {at: Date.now(), ratio: +(dropped / total).toFixed(2)}; v.pause(); }
    }
    lastQuality = {total: q.totalVideoFrames, dropped: q.droppedVideoFrames};
  }

  function geometry() {
    frame = null;
    if (!active) return;
    const {host, layer, video} = active, r = host.getBoundingClientRect(), doc = host.ownerDocument;
    const left = Math.max(0, r.left), top = Math.max(0, r.top);
    const right = Math.min(doc.documentElement.clientWidth, r.right), bottom = Math.min(doc.documentElement.clientHeight, r.bottom);
    const width = Math.max(0, right - left), height = Math.max(0, bottom - top), visible = width >= 240 && height >= 160 && !doc.hidden;
    if (visible !== active.visible) { active.visible = visible; layer.style.display = visible ? 'block' : 'none'; }
    if (visible && !suspended && !degraded) { if (video.paused) video.play().catch(() => {}); }
    else if (!video.paused) video.pause();
    lastQuality = null;
  }
  function scheduleGeometry() { if (!frame) frame = requestAnimationFrame(geometry); }
  function clearMarks() { for (const node of marked) node.removeAttribute('data-claude-background'); marked.clear(); }
  function mark(node, host) {
    if (!node || !host.contains(node)) return;
    for (let depth = 0; node && depth < 28; node = node.parentElement, depth++) {
      if (node.matches('html,body') || node.closest(excluded)) break;
      node.setAttribute('data-claude-background', '');
      marked.add(node);
      if (node === host) break;
    }
  }
  function removeLayer() {
    if (!active) return;
    const {host, video, layer, resize} = active;
    video.pause(); video.removeAttribute('src'); video.load(); resize.disconnect(); layer.remove();
    host.removeAttribute('data-claude-video-host'); host.removeAttribute('data-claude-relative-host');
    active = null;
    clearMarks();
  }
  function addLayer(host) {
    if (active?.host === host) return;
    removeLayer();
    const doc = host.ownerDocument, layer = doc.createElement('div'), video = doc.createElement('video'), wash = doc.createElement('div');
    layer.setAttribute('data-claude-video-layer', ''); layer.setAttribute('aria-hidden', 'true'); layer.inert = true;
    host.setAttribute('data-claude-video-host', '');
    if (getComputedStyle(host).position === 'static') host.setAttribute('data-claude-relative-host', '');
    video.setAttribute('data-claude-background-video', '');
    Object.assign(video, {muted: true, defaultMuted: true, loop: true, playsInline: true, preload: 'auto', controls: false,
      disablePictureInPicture: true, tabIndex: -1, poster, src: mediaSource()});
    // Anchor to the chat container itself; viewport offsets go wrong under transformed ancestors.
    Object.assign(layer.style, {position: 'absolute', inset: '0', overflow: 'hidden', pointerEvents: 'none', zIndex: '-1', borderRadius: 'inherit'});
    for (const node of [video, wash]) Object.assign(node.style, {position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none'});
    video.style.objectFit = 'cover';
    layer.append(video, wash);
    host.append(layer);
    const resize = new ResizeObserver(scheduleGeometry);
    resize.observe(host);
    active = {host, layer, video, wash, resize};
    updateTheme();
    scheduleGeometry();
  }
  function relevant(node) {
    return node.nodeType === 1 && !node.closest('[data-claude-video-layer]') && (node.matches(anchors + ',iframe') || node.querySelector(anchors + ',iframe'));
  }
  function discover(node) {
    if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) return;
    if (node.shadowRoot) addScope(node.shadowRoot);
    for (const child of node.querySelectorAll('*')) if (child.shadowRoot) addScope(child.shadowRoot);
    for (const iframe of node.querySelectorAll('iframe:not([sandbox])')) {
      const connect = () => {
        try {
          const doc = iframe.contentDocument;
          if (doc?.body && doc.location.origin === location.origin && /^\/(epitaxy|chat|code|new)(\/|$)/.test(doc.location.pathname)) addScope(doc);
        } catch {}
      };
      connect();
      iframe.addEventListener('load', connect, {once: true});
    }
  }
  function addScope(scope) {
    if (scopes.has(scope)) return;
    const doc = scope.nodeType === 9 ? scope : scope.ownerDocument;
    if (!doc.head || !doc.body) return;
    const style = doc.createElement('style');
    style.setAttribute('data-claude-background-style', '');
    const nonce = doc.querySelector('style[nonce],script[nonce]')?.nonce;
    if (nonce) style.nonce = nonce;
    style.textContent = '[data-claude-background]{background-color:transparent!important;background-image:none!important}[data-claude-video-host]{isolation:isolate!important}[data-claude-relative-host]{position:relative!important}[data-claude-video-layer]{pointer-events:none!important}';
    (scope.nodeType === 9 ? doc.head : scope).appendChild(style);
    // Only structural changes trigger a rescan; streaming text inside existing nodes does not.
    const observer = new MutationObserver(records => {
      let dirty = active && !active.host.isConnected;
      for (const record of records) {
        if (record.target.nodeType === 1 && record.target.closest('[data-claude-video-layer]')) continue;
        for (const node of record.addedNodes) { if (relevant(node)) dirty = true; if (node.nodeType === 1 && !node.hasAttribute('data-claude-video-layer')) discover(node); }
        for (const node of record.removedNodes) if (relevant(node)) dirty = true;
      }
      if (dirty) schedule();
    });
    observer.observe(scope.nodeType === 9 ? doc.body : scope, {childList: true, subtree: true});
    scopes.set(scope, {style, observer});
    doc.addEventListener('scroll', scheduleGeometry, {capture: true, passive: true});
    doc.addEventListener('visibilitychange', scheduleGeometry);
    doc.defaultView.addEventListener('resize', () => { schedule(); scheduleGeometry(); }, {passive: true});
    discover(scope);
    schedule();
  }
  function refresh() {
    clearTimeout(timer);
    timer = null;
    scanCount++;
    const candidates = [];
    for (const scope of scopes.keys()) for (const anchor of scope.querySelectorAll(anchors)) {
      if (anchor.closest(excluded)) continue;
      const host = anchor.closest(boundary);
      if (!host || host.closest(excluded)) continue;
      const r = host.getBoundingClientRect();
      if (r.width < 240 || r.height < 160) continue;
      candidates.push({anchor, host, area: r.width * r.height});
    }
    candidates.sort((a, b) => b.area - a.area);
    if (!candidates.length) { removeLayer(); return; }
    const host = candidates[0].host;
    addLayer(host);
    clearMarks();
    // Work out every starting point before marking anything: marked nodes read as transparent.
    const starts = [];
    composers = [];
    for (const {anchor} of candidates) if (host.contains(anchor)) {
      if (anchor.matches('[contenteditable],textarea,[data-chat-input-container],[data-chat-dock]')) {
        if (!SOLID_COMPOSER) {
          // Clear everything from just above the text field outwards, the composer box included.
          composers.push({how: 'transparent', box: describe(anchor)});
          starts.push(anchor.parentElement?.parentElement);
          continue;
        }
        const composer = composerOf(anchor, host);
        composers.push({how: composer.how, box: describe(composer.node)});
        starts.push(composer.node?.parentElement);
      } else starts.push(anchor);
    }
    mark(host, host);
    for (const start of starts) mark(start, host);
    scheduleGeometry();
  }
  function schedule() { if (!timer) timer = setTimeout(refresh, 250); }

  // The composer box must keep its own background. Chat and Code mark it with
  // data-chat-input-container; where no marker exists (Project pages), the box is the nearest
  // ancestor of the text field that paints itself. A solid fill is preferred over a border or a
  // shadow, since inner wrappers can carry a focus ring while only the box itself is filled.
  function filled(node) {
    const m = getComputedStyle(node).backgroundColor.match(/rgba?\(([^)]+)\)/);
    const parts = m ? m[1].split(/[\s,/]+/).filter(Boolean) : [];
    return parts.length >= 3 && (parts.length < 4 || parseFloat(parts[3]) >= 0.5);
  }
  function outlined(node) {
    const s = getComputedStyle(node);
    return parseFloat(s.borderTopWidth) > 0 || s.boxShadow !== 'none';
  }
  function composerOf(anchor, host) {
    const known = anchor.closest('[data-chat-input-container],[data-chat-dock],form');
    if (known && host.contains(known)) return {node: known, how: 'marker'};
    for (const [test, how] of [[filled, 'filled'], [outlined, 'outlined']]) {
      for (let node = anchor.parentElement, depth = 0; node && node !== host && depth < 10; node = node.parentElement, depth++) {
        if (test(node)) return {node, how};
      }
    }
    return {node: anchor.parentElement, how: 'fallback'};
  }
  const describe = node => node ? {tag: node.tagName, attrs: [...node.attributes].map(a => a.name).filter(n => n.startsWith('data-') || n === 'role').slice(0, 6)} : null;

  addScope(document);
  new MutationObserver(updateTheme).observe(document.documentElement, {attributes: true, attributeFilter: ['class', 'data-mode']});
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateTheme);
  qualityTimer = setInterval(checkQuality, QUALITY_MS);
  window.addEventListener('unload', () => { clearInterval(qualityTimer); active?.video.pause(); if (source) URL.revokeObjectURL(source); }, {once: true});
  window[SLOT] = {
    refresh,
    setSuspended(value) { suspended = Boolean(value); geometry(); },
    stats() {
      const v = active?.video, r = active?.host.getBoundingClientRect(), b = active?.layer.getBoundingClientRect();
      const q = v?.getVideoPlaybackQuality();
      return {
        players: active ? 1 : 0, scans: scanCount, suspended, degraded, wash: WASH, composers: composers.slice(0, 3),
        host: active ? {tag: active.host.tagName, width: Math.round(r.width), height: Math.round(r.height)} : null,
        maxEdgeError: active ? Math.max(...['left', 'top', 'right', 'bottom'].map(k => Math.abs(r[k] - b[k]))) : null,
        video: v ? {width: v.videoWidth, height: v.videoHeight, paused: v.paused, error: v.error?.code || null,
          frames: q.totalVideoFrames, dropped: q.droppedVideoFrames} : null,
      };
    },
  };
  refresh();
  return true;
}
