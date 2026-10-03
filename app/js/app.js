(() => {
  const $ = s => document.querySelector(s);
  const video = $('#video'), stage = $('#stage'), wrap = $('#stageWrap'), area = $('#stageArea');
  const court = $('#court'), draw = $('#draw'), cx = draw.getContext('2d'), kx = court.getContext('2d');
  const FPS = 30, FRAME = 1 / FPS;
  const NIGHT = 'rgba(14,21,17,0.64)';
  const HALO = 'rgba(14,21,17,0.72)';   // dark edge under every mark so it reads on bright or busy film

  let W = 0, H = 0, dpr = 1, aspect = 16 / 9;
  let tool = 'pen', color = '#A4F2C4';
  let anns = [], history = [], cur = null, penSeen = false, fade = 1, hasClip = false;

  /* ---------- sizing ---------- */
  function fit() {
    // wheel first (it sits in its own column beside the film), then the film fills what's left
    const o = wrap.getBoundingClientRect();
    const wd = Math.round(Math.max(130, Math.min(240, o.height * 0.42, o.width * 0.17))) + 'px';
    wheelEl.style.width = wd; wheelEl.style.height = wd;
    const r = area.getBoundingClientRect();
    let w = r.width, h = w / aspect;
    if (h > r.height) { h = r.height; w = h * aspect; }
    w = Math.floor(w); h = Math.floor(h);
    stage.style.width = w + 'px'; stage.style.height = h + 'px';
    W = w; H = h; dpr = Math.min(window.devicePixelRatio || 1, 3);
    for (const c of [court, draw]) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    cx.setTransform(dpr, 0, 0, dpr, 0, 0); kx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawCourt(); render();
  }
  const wheelEl = document.getElementById('wheel');
  new ResizeObserver(fit).observe(wrap);

  /* ---------- sample court (particle style, shown until a clip loads) ---------- */
  function drawCourt() {
    kx.clearRect(0, 0, W, H);
    if (hasClip) return;
    kx.fillStyle = '#0E1511'; kx.fillRect(0, 0, W, H);
    const dots = [];
    const add = (x, y) => dots.push([x, y]);
    const line = (x1, y1, x2, y2, step) => { const n = Math.max(2, Math.hypot(x2 - x1, y2 - y1) / step); for (let i = 0; i <= n; i++) add(x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n); };
    const arc = (x, y, rx, ry, a0, a1, step) => { const n = Math.max(6, (a1 - a0) * Math.max(rx, ry) / step); for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; add(x + Math.cos(a) * rx, y + Math.sin(a) * ry); } };
    const s = 9, bx = W * 0.5, by = H * 0.14;   // basket at top, perspective-ish half court
    line(W * .08, by - H * .06, W * .92, by - H * .06, s);           // baseline
    line(W * .08, by - H * .06, W * .02, H * .98, s);                // sidelines
    line(W * .92, by - H * .06, W * .98, H * .98, s);
    line(W * .39, by - H * .06, W * .37, H * .52, s); line(W * .61, by - H * .06, W * .63, H * .52, s); // lane
    line(W * .37, H * .52, W * .63, H * .52, s);
    arc(bx, H * .52, W * .13, H * .08, 0, Math.PI, s);              // free-throw circle
    arc(bx, by - H * .06, W * .36, H * .66, 0.12, Math.PI - 0.12, s); // three-point arc
    arc(bx, by, W * .022, H * .012, 0, Math.PI * 2, 4);              // rim
    kx.fillStyle = 'rgba(140,196,164,0.55)';
    for (const [x, y] of dots) { kx.beginPath(); kx.arc(x, y, 1.3, 0, Math.PI * 2); kx.fill(); }
  }

  /* ---------- annotation rendering ---------- */
  const baseW = () => Math.max(2.5, W * 0.0042);
  const px = p => ({ x: p.x * W, y: p.y * H });

  function strokePts(pts, col, extra = 0) {
    if (!pts.length) return;
    cx.strokeStyle = col; cx.lineCap = 'round'; cx.lineJoin = 'round';
    const P = pts.map(p => ({ ...px(p), w: baseW() * (0.55 + (p.p ?? .5) * 0.9) + extra }));
    if (P.length === 1) { cx.fillStyle = col; cx.beginPath(); cx.arc(P[0].x, P[0].y, P[0].w / 2, 0, Math.PI * 2); cx.fill(); return; }
    let prev = P[0];
    for (let i = 1; i < P.length; i++) {
      const a = P[i - 1], b = P[i];
      const mid = i < P.length - 1 ? { x: (b.x + P[i + 1].x) / 2, y: (b.y + P[i + 1].y) / 2 } : b;
      cx.lineWidth = (a.w + b.w) / 2;
      cx.beginPath(); cx.moveTo(prev.x, prev.y); cx.quadraticCurveTo(b.x, b.y, mid.x, mid.y); cx.stroke();
      prev = mid;
    }
  }

  function drawAnn(a, halo) {
    const w = baseW(), col = halo ? HALO : a.c, extra = halo ? w * 1.4 : 0;
    if (a.t === 'pen') {
      strokePts(a.pts, col, extra);
    } else if (a.t === 'ring') {
      const c = px(a.a), rx = a.r * W;
      cx.strokeStyle = col; cx.lineWidth = w * 1.15 + extra;
      cx.beginPath(); cx.ellipse(c.x, c.y, rx, rx * 0.38, 0, 0, Math.PI * 2); cx.stroke();
    } else if (a.t === 'spot') {
      const c = px(a.a), r = a.r * W;
      cx.strokeStyle = col; cx.lineWidth = w * .9 + extra;
      cx.beginPath(); cx.arc(c.x, c.y, r, 0, Math.PI * 2); cx.stroke();
    }
  }

  function render() {
    cx.clearRect(0, 0, W, H);
    const list = cur ? anns.concat([cur]) : anns;
    cx.globalAlpha = fade;
    const spots = list.filter(a => a.t === 'spot');
    if (spots.length) {
      cx.fillStyle = NIGHT; cx.beginPath(); cx.rect(0, 0, W, H);
      for (const s of spots) { const c = px(s.a); cx.moveTo(c.x + s.r * W, c.y); cx.arc(c.x, c.y, s.r * W, 0, Math.PI * 2); }
      cx.fill('evenodd');
    }
    for (const a of list) drawAnn(a, true);
    for (const a of list) drawAnn(a);
    cx.globalAlpha = 1;
  }

  /* ---------- history ---------- */
  const snapshot = () => history.push(anns.slice());
  function undo() { if (history.length) { anns = history.pop(); render(); } }
  function clearAll(animated = true) {
    if (!anns.length) return;
    snapshot();
    if (!animated || matchMedia('(prefers-reduced-motion: reduce)').matches) { anns = []; render(); return; }
    const t0 = performance.now(), dur = 380;
    const step = now => {
      const k = Math.min(1, (now - t0) / dur); fade = 1 - k * k; render();
      if (k < 1) requestAnimationFrame(step); else { anns = []; fade = 1; render(); }
    };
    requestAnimationFrame(step);
  }

  /* ---------- drawing input (Pencil draws; fingers don't once a Pencil is seen) ---------- */
  const norm = e => { const r = draw.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, p: e.pointerType === 'pen' ? (e.pressure || .5) : .5 }; };
  const touches = new Map(); let twoFinger = null;

  draw.addEventListener('pointerdown', e => {
    if (e.pointerType === 'pen') penSeen = true;
    if (e.pointerType === 'touch' && penSeen) {          // finger: gestures only
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
      if (touches.size === 2) twoFinger = { t: performance.now(), moved: false };
      return;
    }
    if (cur) return;
    e.preventDefault(); draw.setPointerCapture(e.pointerId);
    const p = norm(e);
    cur = { t: tool, c: color, id: e.pointerId };
    if (tool === 'pen') cur.pts = [p];
    else { cur.a = p; cur.b = p; cur.r = 0; }
    render();
  });

  draw.addEventListener('pointermove', e => {
    if (touches.has(e.pointerId)) { const t = touches.get(e.pointerId); if (twoFinger && Math.hypot(e.clientX - t.x, e.clientY - t.y) > 14) twoFinger.moved = true; return; }
    if (!cur || cur.id !== e.pointerId) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    if (cur.pts) { for (const ev of (evs.length ? evs : [e])) cur.pts.push(norm(ev)); }
    else { const p = norm(e); cur.b = p; cur.r = Math.hypot((p.x - cur.a.x) * W, (p.y - cur.a.y) * H) / W; }
    render();
  });

  function endDraw(e) {
    if (touches.has(e.pointerId)) {
      touches.delete(e.pointerId);
      if (touches.size === 0 && twoFinger) { if (!twoFinger.moved && performance.now() - twoFinger.t < 350) undo(); twoFinger = null; }
      return;
    }
    if (!cur || cur.id !== e.pointerId) return;
    const a = cur; cur = null; delete a.id;
    const tiny = a.pts ? a.pts.length < 2 && tool !== 'pen' : (a.r * W < 6 && Math.hypot((a.b.x - a.a.x) * W, (a.b.y - a.a.y) * H) < 8);
    if (!tiny) { snapshot(); anns.push(a); }
    render();
  }
  draw.addEventListener('pointerup', endDraw);
  draw.addEventListener('pointercancel', endDraw);

  /* ---------- jog wheel ---------- */
  const wheel = $('#wheel'), ticks = $('#ticks'), hub = $('#hub');
  const NT = 48;
  for (let i = 0; i < NT; i++) {
    const a = i / NT * Math.PI * 2, long = i % 4 === 0, r1 = long ? 70 : 78, r2 = 90;
    const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    l.setAttribute('x1', 100 + Math.cos(a) * r1); l.setAttribute('y1', 100 + Math.sin(a) * r1);
    l.setAttribute('x2', 100 + Math.cos(a) * r2); l.setAttribute('y2', 100 + Math.sin(a) * r2);
    l.setAttribute('stroke', long ? '#8CC4A4' : 'rgba(163,168,159,.55)'); l.setAttribute('stroke-width', long ? 2.4 : 1.4); l.setAttribute('stroke-linecap', 'round');
    ticks.appendChild(l);
  }
  let rot = 0, jog = null, target = null, seeking = false;
  const setRot = () => ticks.setAttribute('transform', `rotate(${rot * 180 / Math.PI} 100 100)`);
  const angleOf = e => { const r = wheel.getBoundingClientRect(); return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)); };

  function seekTo(t) {
    if (!hasClip || !isFinite(video.duration)) return;
    target = Math.max(0, Math.min(video.duration - 0.001, t));
    pump();
  }
  function pump() {
    if (seeking || target === null) return;
    if (Math.abs(video.currentTime - target) < 0.0005) { target = null; return; }
    seeking = true; video.currentTime = target; target = null;
  }
  video.addEventListener('seeked', () => { seeking = false; pump(); updateTime(); });

  wheel.addEventListener('pointerdown', e => {
    if (e.target === hub) return;
    e.preventDefault(); wheel.setPointerCapture(e.pointerId);
    const wasPlaying = !video.paused;
    if (wasPlaying) video.pause();
    jog = { id: e.pointerId, a: angleOf(e), t: performance.now(), pos: video.currentTime || 0, wasPlaying };
    wheel.classList.add('active');
  });
  wheel.addEventListener('pointermove', e => {
    if (!jog || jog.id !== e.pointerId) return;
    const a = angleOf(e), now = performance.now();
    let d = a - jog.a; if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2;
    const dt = Math.max(1, now - jog.t), degPerMs = Math.abs(d) * 180 / Math.PI / dt;
    // slow turn = about one frame per 12 degrees; faster spins scrub up to 8x faster
    const speed = 1 + 7 * Math.min(1, Math.max(0, (degPerMs - 0.15) / 1.05));
    jog.pos += d / (12 * Math.PI / 180) * FRAME * speed;
    if (hasClip) jog.pos = Math.max(0, Math.min(video.duration || 0, jog.pos));
    jog.a = a; jog.t = now; rot += d; setRot();
    seekTo(jog.pos);
  });
  let resuming = false;
  const endJog = e => {
    if (!jog || jog.id !== e.pointerId) return;
    const resume = jog.wasPlaying; jog = null; wheel.classList.remove('active');
    if (!resume) return;
    // tape was playing when you grabbed the wheel: keep playing from where you let go
    const go = () => { if (seeking || target !== null) return setTimeout(go, 30); resuming = true; video.play().catch(() => {}); };
    go();
  };
  wheel.addEventListener('pointerup', endJog); wheel.addEventListener('pointercancel', endJog);
  hub.addEventListener('click', () => togglePlay());

  /* ---------- playback ---------- */
  function togglePlay() {
    if (!hasClip) return;
    if (video.paused) video.play().catch(() => {}); else video.pause();
  }
  video.addEventListener('play', () => { hub.textContent = 'Pause'; if (!resuming && $('#autoclear').getAttribute('aria-pressed') === 'true') clearAll(true); resuming = false; tick(); });
  video.addEventListener('pause', () => { hub.textContent = 'Play'; updateTime(); });
  video.addEventListener('ended', () => { hub.textContent = 'Play'; });

  const fmt = (t, cs) => { t = Math.max(0, t || 0); const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (cs ? s.toFixed(2).padStart(5, '0') : String(Math.floor(s)).padStart(2, '0')); };
  const seek = $('#seek'), time = $('#time');
  let dragging = false;
  function updateTime() {
    const d = video.duration || 0;
    time.innerHTML = `<b>${fmt(video.currentTime, true)}</b> / ${fmt(d)}`;
    if (!dragging && d) seek.value = Math.round(video.currentTime / d * 1000);
  }
  function tick() { updateTime(); if (!video.paused) requestAnimationFrame(tick); }
  seek.addEventListener('input', () => { dragging = true; if (hasClip) { video.pause(); seekTo(seek.value / 1000 * video.duration); } });
  seek.addEventListener('change', () => { dragging = false; });

  /* ---------- loading ---------- */
  let url = null;
  function load(file) {
    if (!file) return;
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(file);
    video.src = url; video.load();
    $('#clipName').textContent = file.name;
  }
  for (const id of ['#file', '#file2']) $(id).addEventListener('change', e => { load(e.target.files[0]); e.target.value = ''; });
  video.addEventListener('loadedmetadata', () => {
    hasClip = true; $('#empty').hidden = true;
    if (video.videoWidth && video.videoHeight) aspect = video.videoWidth / video.videoHeight;
    anns = []; history = []; fit(); updateTime();
    if (video.duration > 185) $('#clipName').textContent += ' (longer than 3 minutes, may be slow on iPad)';
    try { navigator.wakeLock && navigator.wakeLock.request('screen').catch(() => {}); } catch (_) {}
  });
  video.addEventListener('error', () => { $('#clipName').textContent = 'That file could not be played. Try an MP4 or MOV.'; });
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f && f.type.startsWith('video')) load(f); });

  /* ---------- top bar controls ---------- */
  const rates = ['#sp25', '#sp50', '#sp100'];
  for (const id of rates) $(id).addEventListener('click', e => {
    for (const r of rates) $(r).setAttribute('aria-pressed', 'false');
    e.currentTarget.setAttribute('aria-pressed', 'true');
    video.playbackRate = parseFloat(e.currentTarget.dataset.rate);
  });
  $('#mute').addEventListener('click', e => {
    video.muted = !video.muted;
    e.currentTarget.textContent = video.muted ? 'Clip sound off' : 'Clip sound on';
    e.currentTarget.setAttribute('aria-pressed', String(!video.muted));
  });

  let actx = null;
  $('#sync').addEventListener('click', () => {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = 1000; g.gain.value = 0.35; o.connect(g); g.connect(actx.destination);
      o.start(); o.stop(actx.currentTime + 0.2);
    } catch (_) {}
    const f = $('#flash'); f.classList.add('on'); setTimeout(() => f.classList.remove('on'), 200);
  });

  /* ---------- full screen (Safari only; the Home Screen app is already full screen) ---------- */
  const app = $('#app'), fullBtn = $('#full');
  const standalone = navigator.standalone || matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
  const canFull = app.requestFullscreen || app.webkitRequestFullscreen;
  const isFull = () => document.fullscreenElement || document.webkitFullscreenElement;
  fullBtn.hidden = standalone || !canFull;
  fullBtn.addEventListener('click', () => {
    if (isFull()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else canFull.call(app);
  });
  const onFull = () => { fullBtn.textContent = isFull() ? 'Exit full screen' : 'Full screen'; };
  document.addEventListener('fullscreenchange', onFull); document.addEventListener('webkitfullscreenchange', onFull);

  /* ---------- tools ---------- */
  document.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('[data-tool]').forEach(x => x.setAttribute('aria-pressed', 'false'));
    b.setAttribute('aria-pressed', 'true'); tool = b.dataset.tool;
  }));
  document.querySelectorAll('[data-color]').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('[data-color]').forEach(x => x.setAttribute('aria-pressed', 'false'));
    b.setAttribute('aria-pressed', 'true'); color = b.dataset.color;
  }));
  $('#undo').addEventListener('click', undo);
  $('#clear').addEventListener('click', () => clearAll(true));
  $('#autoclear').addEventListener('click', e => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', String(on)); });

  /* ---------- keyboard (laptop) ---------- */
  const toolKeys = { '1': 'pen', '2': 'ring', '3': 'spot' };
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault(); if (!hasClip) return; video.pause();
      const step = (e.shiftKey ? 1 : FRAME) * (e.key === 'ArrowRight' ? 1 : -1);
      seekTo((target ?? video.currentTime) + step);
    }
    else if ((e.key === 'z' && (e.metaKey || e.ctrlKey)) || e.key === 'z' || e.key === 'Backspace') { e.preventDefault(); undo(); }
    else if (e.key === 'c') clearAll(true);
    else if (toolKeys[e.key]) document.querySelector(`[data-tool="${toolKeys[e.key]}"]`).click();
  });

  setRot(); fit();
})();
