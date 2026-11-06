/*!
 * QRFuse — application controller.
 */
(function () {
  'use strict';
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const { buildModel, render, contrast, luminance, hexToRgb } = window.QRRender;
  const STYLES = window.QRStyles.list;
  const SKIP_VERSIONS = [23]; // jsQR mis-tables v23 alignment; skipping keeps live verification honest.
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ------------------------------------------------------------------ data
  const PALETTES = [
    { name: 'Midnight', fg: '#1a1033', accent: '#7c3aed', bg: '#ffffff' },
    { name: 'Ocean', fg: '#04293a', accent: '#0077b6', bg: '#f4fbff' },
    { name: 'Forest', fg: '#062b12', accent: '#0a8f3c', bg: '#effff3' },
    { name: 'Sunset', fg: '#431407', accent: '#c2410c', bg: '#fff7ed' },
    { name: 'Candy', fg: '#500724', accent: '#db2777', bg: '#fdf2f8' },
    { name: 'Ink & Gold', fg: '#111111', accent: '#92400e', bg: '#fffbeb' },
    { name: 'Mono', fg: '#0a0a0a', accent: '#404040', bg: '#ffffff' },
    { name: 'Grape', fg: '#2e1065', accent: '#a21caf', bg: '#fdf4ff' }
  ];

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const wifiEsc = (s) => String(s || '').replace(/([\\;,:"])/g, '\\$1');

  const CONTENT_TYPES = {
    url: {
      fields: [{ id: 'url', label: 'Website URL', type: 'url', placeholder: 'https://your-site.com' }],
      build: (f) => {
        const v = (f.url || '').trim();
        if (!v) return '';
        return /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : 'https://' + v;
      },
      label: (f) => (f.url || '').replace(/^https?:\/\//, '')
    },
    text: {
      fields: [{ id: 'text', label: 'Text', type: 'textarea', placeholder: 'Any message, code or note…' }],
      build: (f) => f.text || '',
      label: (f) => f.text || ''
    },
    wifi: {
      fields: [
        { id: 'ssid', label: 'Network name (SSID)', placeholder: 'MyHomeWiFi' },
        { id: 'password', label: 'Password', type: 'password', placeholder: '••••••••' },
        [{ id: 'enc', label: 'Security', type: 'select', options: [['WPA', 'WPA / WPA2 / WPA3'], ['WEP', 'WEP'], ['nopass', 'None (open)']] },
          { id: 'hidden', label: 'Hidden network', type: 'select', options: [['no', 'No'], ['yes', 'Yes']] }]
      ],
      build: (f) => f.ssid ? `WIFI:T:${f.enc || 'WPA'};S:${wifiEsc(f.ssid)};${f.enc === 'nopass' ? '' : 'P:' + wifiEsc(f.password) + ';'}${f.hidden === 'yes' ? 'H:true;' : ''};` : '',
      label: (f) => 'Wi-Fi · ' + (f.ssid || '')
    },
    email: {
      fields: [
        { id: 'to', label: 'Email address', type: 'email', placeholder: 'hello@example.com' },
        { id: 'subject', label: 'Subject', placeholder: 'Optional' },
        { id: 'body', label: 'Message', type: 'textarea', placeholder: 'Optional' }
      ],
      build: (f) => {
        if (!f.to) return '';
        const q = [];
        if (f.subject) q.push('subject=' + encodeURIComponent(f.subject));
        if (f.body) q.push('body=' + encodeURIComponent(f.body));
        return 'mailto:' + f.to.trim() + (q.length ? '?' + q.join('&') : '');
      },
      label: (f) => 'Email · ' + (f.to || '')
    },
    phone: {
      fields: [{ id: 'tel', label: 'Phone number', type: 'tel', placeholder: '+1 555 123 4567' }],
      build: (f) => f.tel ? 'tel:' + f.tel.replace(/[^\d+*#]/g, '') : '',
      label: (f) => 'Call · ' + (f.tel || '')
    },
    sms: {
      fields: [
        { id: 'smsTo', label: 'Phone number', type: 'tel', placeholder: '+1 555 123 4567' },
        { id: 'smsBody', label: 'Message', type: 'textarea', placeholder: 'Pre-filled text' }
      ],
      build: (f) => f.smsTo ? `SMSTO:${f.smsTo.replace(/[^\d+]/g, '')}:${f.smsBody || ''}` : '',
      label: (f) => 'SMS · ' + (f.smsTo || '')
    },
    vcard: {
      fields: [
        [{ id: 'first', label: 'First name', placeholder: 'Ada' }, { id: 'last', label: 'Last name', placeholder: 'Lovelace' }],
        [{ id: 'org', label: 'Company', placeholder: 'Analytical Engines' }, { id: 'title', label: 'Job title', placeholder: 'Engineer' }],
        [{ id: 'vtel', label: 'Phone', type: 'tel', placeholder: '+1 555 123 4567' }, { id: 'vemail', label: 'Email', type: 'email', placeholder: 'ada@example.com' }],
        { id: 'vurl', label: 'Website', type: 'url', placeholder: 'https://…' }
      ],
      build: (f) => {
        if (!f.first && !f.last && !f.org) return '';
        const L = ['BEGIN:VCARD', 'VERSION:3.0', `N:${f.last || ''};${f.first || ''};;;`, `FN:${[f.first, f.last].filter(Boolean).join(' ')}`];
        if (f.org) L.push('ORG:' + f.org);
        if (f.title) L.push('TITLE:' + f.title);
        if (f.vtel) L.push('TEL;TYPE=CELL:' + f.vtel);
        if (f.vemail) L.push('EMAIL:' + f.vemail);
        if (f.vurl) L.push('URL:' + f.vurl);
        L.push('END:VCARD');
        return L.join('\n');
      },
      label: (f) => 'Contact · ' + [f.first, f.last].filter(Boolean).join(' ')
    }
  };

  // ------------------------------------------------------------------ state
  const DEFAULT_STATE = {
    type: 'url',
    fields: { url: 'https://github.com/FavoriteDevX/animated-QR-code', enc: 'WPA', hidden: 'no' },
    style: 'pulse', shape: 'square', finder: 'rounded',
    fg: '#1a1033', accent: '#7c3aed', bg: '#ffffff', finderColor: 'fg',
    autoPreset: true, ecl: 'H', minVersion: 1, quiet: 4, loop: 3, intensity: 0.8,
    logo: { mode: 'none', text: '⚡', size: 0.2, img: null, imgSrc: null }
  };
  let state = JSON.parse(JSON.stringify(DEFAULT_STATE));
  let model = null;
  let payload = '';
  let playing = !reduceMotion;
  let phase = 0;
  let lastTs = 0;

  function renderOpts(s) {
    s = s || state;
    return { style: s.style, shape: s.shape, finder: s.finder, fg: s.fg, accent: s.accent, bg: s.bg,
      finderColor: s.finderColor, quiet: s.quiet, intensity: s.intensity, logo: s.logo };
  }

  // ------------------------------------------------------------------ share link
  function encodeState() {
    const s = Object.assign({}, state, { logo: Object.assign({}, state.logo, { img: null, imgSrc: null }) });
    if (s.logo.mode === 'image') s.logo.mode = 'none';
    return btoa(unescape(encodeURIComponent(JSON.stringify(s)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function loadFromHash() {
    const m = location.hash.match(/[#&]d=([\w-]+)/);
    if (!m) return;
    try {
      const json = decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))));
      const s = JSON.parse(json);
      state = Object.assign({}, DEFAULT_STATE, s, {
        fields: Object.assign({}, DEFAULT_STATE.fields, s.fields || {}),
        logo: Object.assign({}, DEFAULT_STATE.logo, s.logo || {}, { img: null, imgSrc: null })
      });
      if (!CONTENT_TYPES[state.type]) state.type = 'url';
      if (!window.QRStyles.byId[state.style]) state.style = 'pulse';
    } catch (e) { /* ignore malformed links */ }
  }

  // ------------------------------------------------------------------ toast
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ------------------------------------------------------------------ content fields
  function fieldHtml(f) {
    const v = state.fields[f.id] == null ? '' : state.fields[f.id];
    let input;
    if (f.type === 'textarea') input = `<textarea class="input" data-field="${f.id}" placeholder="${esc(f.placeholder || '')}" rows="3">${esc(v)}</textarea>`;
    else if (f.type === 'select') input = `<select class="input" data-field="${f.id}">${f.options.map(([val, lab]) => `<option value="${val}"${v === val ? ' selected' : ''}>${lab}</option>`).join('')}</select>`;
    else input = `<input class="input" data-field="${f.id}" type="${f.type || 'text'}" value="${esc(v)}" placeholder="${esc(f.placeholder || '')}" autocomplete="off" spellcheck="false" />`;
    return `<label>${f.label}${input}</label>`;
  }
  function renderFields() {
    const def = CONTENT_TYPES[state.type];
    $('#fields').innerHTML = def.fields.map((f) => Array.isArray(f)
      ? `<div class="row-2">${f.map(fieldHtml).join('')}</div>` : fieldHtml(f)).join('');
    $$('#typeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.type === state.type));
  }

  // ------------------------------------------------------------------ encoding
  function encodeFor(s) {
    const p = CONTENT_TYPES[s.type].build(s.fields);
    if (!p) return { payload: '', qr: null };
    const qr = window.QR.encode(p, s.ecl, { minVersion: s.minVersion, skipVersions: SKIP_VERSIONS });
    return { payload: p, qr };
  }

  function regenerate() {
    const err = $('#errorMsg');
    let res;
    try {
      res = encodeFor(state);
    } catch (e) {
      err.textContent = e.message; err.hidden = false;
      updateCapacity(null, CONTENT_TYPES[state.type].build(state.fields));
      return false;
    }
    if (!res.qr) {
      err.textContent = 'Add some content to generate your code.'; err.hidden = false;
      updateCapacity(null, '');
      return false;
    }
    err.hidden = true;
    payload = res.payload;
    model = buildModel(res.qr, renderOpts());
    $('#mVersion').textContent = res.qr.version;
    $('#mSize').textContent = res.qr.size + '²';
    $('#mEcl').textContent = res.qr.ecl;
    $('#mMask').textContent = res.qr.mask;
    updateCapacity(res.qr, payload);
    resetVerifier();
    galleryDirty = true;
    return true;
  }

  function updateCapacity(qr, p) {
    const bytes = new TextEncoder().encode(p || '').length;
    const max = window.QR.byteCapacity(40, state.ecl);
    $('#capText').textContent = `${bytes} / ${max} bytes`;
    const bar = $('#capBar');
    bar.style.width = Math.min(100, Math.max(bytes ? 2 : 0, bytes / max * 100)) + '%';
    bar.classList.toggle('warn', bytes > max * 0.6);
  }

  // ------------------------------------------------------------------ canvases
  const qrCanvas = $('#qrCanvas');
  const qrCtx = qrCanvas.getContext('2d');
  function sizeMainCanvas() {
    const w = Math.round(Math.min(qrCanvas.clientWidth || 480, 900) * DPR);
    if (qrCanvas.width !== w) { qrCanvas.width = w; qrCanvas.height = w; }
  }

  // hero
  const heroCanvas = $('#heroCanvas');
  const heroCtx = heroCanvas.getContext('2d');
  const heroModel = buildModel(window.QR.encode('https://github.com/FavoriteDevX/animated-QR-code', 'H', { skipVersions: SKIP_VERSIONS }), {});
  const HERO_STYLES = ['pulse', 'liquid', 'neon', 'matrix', 'ripple', 'rainbow', 'sparkle', 'wave'];
  heroCanvas.width = heroCanvas.height = Math.round(360 * DPR);

  // gallery
  const galleryCards = [];
  let galleryDirty = true;
  function buildGallery() {
    const g = $('#gallery');
    g.innerHTML = '';
    STYLES.forEach((st) => {
      const card = document.createElement('button');
      card.className = 'g-card';
      card.type = 'button';
      card.dataset.style = st.id;
      card.innerHTML = `<canvas width="${Math.round(220 * DPR)}" height="${Math.round(220 * DPR)}"></canvas><h3><span aria-hidden="true">${st.icon}</span> ${st.name}</h3><p>${st.tagline}</p>`;
      card.addEventListener('click', () => {
        selectStyle(st.id);
        document.getElementById('generator').scrollIntoView({ behavior: 'smooth' });
      });
      g.appendChild(card);
      const cv = card.querySelector('canvas');
      galleryCards.push({ el: card, cv, ctx: cv.getContext('2d'), style: st, visible: false });
    });
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => entries.forEach((e) => {
        const c = galleryCards.find((x) => x.el === e.target);
        if (c) c.visible = e.isIntersecting;
      }), { rootMargin: '100px' });
      galleryCards.forEach((c) => io.observe(c.el));
    } else galleryCards.forEach((c) => { c.visible = true; });
  }
  function galleryOpts(st) {
    const o = renderOpts();
    o.style = st.id;
    o.logo = { mode: 'none' };
    if (state.autoPreset) Object.assign(o, st.palette, { shape: st.shape });
    o.quiet = 2;
    return o;
  }
  let galleryModel = null;

  // ------------------------------------------------------------------ main loop
  let lastGallery = 0;
  let heroIndex = 0, heroSwitch = 0;
  function frame(ts) {
    const dt = lastTs ? (ts - lastTs) / 1000 : 0;
    lastTs = ts;
    if (playing) {
      phase = (phase + dt / state.loop) % 1;
      $('#scrub').value = phase;
    }
    if (model) {
      sizeMainCanvas();
      render(qrCtx, model, renderOpts(), phase, qrCanvas.width);
    }

    // hero: cycles through signature styles
    const heroT = (ts / 1000 / 3) % 1;
    if (ts - heroSwitch > 4500) {
      heroSwitch = ts; heroIndex = (heroIndex + 1) % HERO_STYLES.length;
      $('#heroStyleName').textContent = window.QRStyles.byId[HERO_STYLES[heroIndex]].name;
    }
    const hs = window.QRStyles.byId[HERO_STYLES[heroIndex]];
    render(heroCtx, heroModel, Object.assign({ style: hs.id, shape: hs.shape, finder: 'rounded', finderColor: 'fg', quiet: 2, intensity: 0.9, logo: { mode: 'none' } }, hs.palette),
      reduceMotion ? 0 : heroT, heroCanvas.width);

    // gallery at ~30fps
    if (ts - lastGallery > 33 && model) {
      lastGallery = ts;
      if (galleryDirty) { galleryModel = buildModel(model.qr, { logo: { mode: 'none' } }); galleryDirty = false; galleryCards.forEach((c) => { c.stale = true; }); }
      const gt = reduceMotion ? 0.25 : (ts / 1000 / 3) % 1;
      galleryCards.forEach((c) => {
        if (c.visible || c.stale) { render(c.ctx, galleryModel, galleryOpts(c.style), gt, c.cv.width); c.stale = false; }
      });
    }
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------------ verification
  const verifyCanvas = document.createElement('canvas');
  verifyCanvas.width = verifyCanvas.height = 360;
  const verifyCtx = verifyCanvas.getContext('2d', { willReadFrequently: true });
  let history = [];
  let verifierMissingSince = performance.now();
  let barcodeDetector = null;
  try { if ('BarcodeDetector' in window) barcodeDetector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { barcodeDetector = null; }

  function decoderAvailable() { return typeof window.jsQR === 'function' || !!barcodeDetector; }

  async function decodeCanvas(cv, ctx, bg, fg) {
    if (typeof window.jsQR === 'function') {
      const img = ctx.getImageData(0, 0, cv.width, cv.height);
      const inverted = luminance(hexToRgb(bg)) < luminance(hexToRgb(fg));
      const r = window.jsQR(img.data, cv.width, cv.height, { inversionAttempts: inverted ? 'onlyInvert' : 'dontInvert' });
      return r ? r.data : null;
    }
    if (barcodeDetector) {
      try {
        const res = await barcodeDetector.detect(cv);
        return res[0] ? res[0].rawValue : null;
      } catch (e) { return null; }
    }
    return undefined;
  }

  // ~6px per module keeps decoding faithful to what a phone camera resolves.
  function verifySize() { return Math.min(1100, Math.max(360, (model.n + state.quiet * 2) * 6)); }

  function resetVerifier() {
    history = [];
    setBadge('pending', 'Verifying…');
  }
  function setBadge(st, text) {
    const b = $('#scanBadge');
    b.dataset.state = st;
    $('#scanText').textContent = text;
  }

  let verifying = false;
  let auditing = false;
  let verifyCost = 0;
  async function verifyTick() {
    if (verifying || !model || busy || auditing || document.hidden) return;
    if (!decoderAvailable()) {
      if (performance.now() - verifierMissingSince > 6000) setBadge('pending', 'Verifier offline');
      return;
    }
    verifying = true;
    try {
      const vs = verifySize();
      if (verifyCanvas.width !== vs) { verifyCanvas.width = verifyCanvas.height = vs; }
      render(verifyCtx, model, renderOpts(), phase, verifyCanvas.width);
      const t0 = performance.now();
      const data = await decodeCanvas(verifyCanvas, verifyCtx, state.bg, state.fg);
      verifyCost = performance.now() - t0;
      history.push(data === payload);
      if (history.length > 14) history.shift();
      const rate = history.filter(Boolean).length / history.length;
      const pct = Math.round(rate * 100);
      if (history.length < 3) setBadge('pending', 'Verifying…');
      else if (rate >= 0.85) setBadge('ok', `Scannable · ${pct}%`);
      else if (rate >= 0.45) setBadge('weak', `Weak · ${pct}%`);
      else setBadge('bad', `Hard to scan · ${pct}%`);
    } finally { verifying = false; }
  }

  async function runAudit() {
    if (!model) return;
    const btn = $('#auditBtn');
    const strip = $('#auditStrip');
    const out = $('#auditResult');
    if (!decoderAvailable()) { out.textContent = 'Decoder unavailable (offline?) — audit needs jsQR or a browser with BarcodeDetector.'; out.className = 'micro bad'; return; }
    btn.disabled = true;
    auditing = true;
    strip.innerHTML = '';
    out.className = 'micro'; out.textContent = 'Decoding frames…';
    const N = 32, cv = document.createElement('canvas');
    cv.width = cv.height = verifySize();
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    let ok = 0;
    for (let i = 0; i < N; i++) {
      render(ctx, model, renderOpts(), i / N, cv.width);
      const good = (await decodeCanvas(cv, ctx, state.bg, state.fg)) === payload;
      if (good) ok++;
      const cell = document.createElement('i');
      cell.className = good ? 'ok' : 'no';
      cell.title = `Frame at ${(i / N * state.loop).toFixed(2)}s — ${good ? 'decoded' : 'not decoded'}`;
      strip.appendChild(cell);
      await new Promise((r) => setTimeout(r, 12));
    }
    const pct = Math.round(ok / N * 100);
    out.textContent = `${ok}/${N} frames decoded (${pct}%). ` + (pct === 100 ? 'Rock-solid — every moment of the loop scans.'
      : pct >= 80 ? 'Good — phones retry many times per second, so this scans reliably.'
        : 'Try lowering intensity, using ECC H or increasing contrast.');
    out.className = 'micro ' + (pct >= 95 ? 'good' : pct >= 80 ? 'mid' : 'bad');
    btn.disabled = false;
    auditing = false;
  }

  // ------------------------------------------------------------------ export
  function slug() {
    return 'qrfuse-' + state.style + '-' + new Date().toISOString().slice(0, 10);
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  function showProgress(p, text) {
    $('#progress').hidden = false;
    $('#progressFill').style.width = Math.round(p * 100) + '%';
    $('#progressText').textContent = text;
  }
  function hideProgress() { setTimeout(() => { $('#progress').hidden = true; }, 900); }

  // Each export takes a "job" — a model + options snapshot — so library items can be exported too.
  function currentJob() {
    return { model, opts: renderOpts(), loop: state.loop, name: slug() };
  }

  function exportPNG(job) {
    const size = +$('#exportSize').value;
    const cv = document.createElement('canvas');
    cv.width = cv.height = Math.max(size, 1024);
    render(cv.getContext('2d'), job.model, job.opts, job.t || 0, cv.width);
    return new Promise((res) => cv.toBlob((b) => { download(b, job.name + '.png'); res(); }, 'image/png'));
  }

  function exportSVG(job) {
    const m = job.model, o = job.opts, n = m.n, q = o.quiet, N = n + q * 2;
    const parts = [];
    const isFinder = (x, y) => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
    const finderFill = o.finderColor === 'accent' ? o.accent : o.fg;
    const r = o.shape === 'rounded' ? 0.3 : o.shape === 'liquid' ? 0.45 : 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (!m.qr.modules[y][x] || isFinder(x, y)) continue;
        if (m.logo && x >= m.logo.start && x < m.logo.start + m.logo.span && y >= m.logo.start && y < m.logo.start + m.logo.span) continue;
        const X = x + q, Y = y + q;
        if (o.shape === 'dots' && !m.reserved[y][x]) parts.push(`<circle cx="${X + 0.5}" cy="${Y + 0.5}" r="0.46"/>`);
        else parts.push(r && !m.reserved[y][x] ? `<rect x="${X}" y="${Y}" width="1" height="1" rx="${r}"/>` : `<rect x="${X}" y="${Y}" width="1.02" height="1.02"/>`);
      }
    }
    const fr = o.finder === 'rounded' ? [2, 1.3, 0.9] : o.finder === 'circle' ? [3.5, 2.5, 1.5] : [0, 0, 0];
    const eye = (ox, oy) => `<path fill-rule="evenodd" d="${rrPath(ox, oy, 7, fr[0])} ${rrPath(ox + 1, oy + 1, 5, fr[1])}"/><path d="${rrPath(ox + 2, oy + 2, 3, fr[2])}"/>`;
    let logo = '';
    if (m.logo && o.logo.mode === 'text' && o.logo.text) {
      const s = m.logo.span, x0 = m.logo.start + q;
      logo = `<rect x="${x0 + 0.1}" y="${x0 + 0.1}" width="${s - 0.2}" height="${s - 0.2}" rx="${s * 0.22}" fill="${o.bg}"/>` +
        `<text x="${x0 + s / 2}" y="${x0 + s / 2}" font-size="${s * 0.6}" text-anchor="middle" dominant-baseline="central" font-family="system-ui, sans-serif" font-weight="700" fill="${finderFill}">${esc(o.logo.text)}</text>`;
    } else if (m.logo && o.logo.mode === 'image' && o.logo.imgSrc) {
      const s = m.logo.span, x0 = m.logo.start + q;
      logo = `<rect x="${x0 + 0.1}" y="${x0 + 0.1}" width="${s - 0.2}" height="${s - 0.2}" rx="${s * 0.22}" fill="${o.bg}"/>` +
        `<image href="${o.logo.imgSrc}" x="${x0 + 0.35}" y="${x0 + 0.35}" width="${s - 0.7}" height="${s - 0.7}" preserveAspectRatio="xMidYMid meet"/>`;
    }
    const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${N} ${N}" width="1024" height="1024" shape-rendering="${r || o.shape === 'dots' ? 'geometricPrecision' : 'crispEdges'}">` +
      `<rect width="${N}" height="${N}" fill="${o.bg}"/><g fill="${o.fg}">${parts.join('')}</g>` +
      `<g fill="${finderFill}">${eye(q, q)}${eye(q + n - 7, q)}${eye(q, q + n - 7)}</g>${logo}</svg>`;
    download(new Blob([svg], { type: 'image/svg+xml' }), job.name + '.svg');
  }
  function rrPath(x, y, w, r) {
    if (!r) return `M${x} ${y}h${w}v${w}h${-w}z`;
    r = Math.min(r, w / 2);
    return `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${w - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(w - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`;
  }

  let busy = false;
  async function exportGIF(job, onProgress) {
    const size = Math.min(+$('#exportSize').value, 800);
    const fps = 20;
    const frames = Math.round(job.loop * fps);
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const blob = await window.GIFEncoder.encode({
      width: size, height: size, delayCs: Math.round(100 / fps), frameCount: frames,
      getFrame: (i) => { render(ctx, job.model, job.opts, i / frames, size); return ctx.getImageData(0, 0, size, size).data; },
      onProgress
    });
    download(blob, job.name + '.gif');
    return blob;
  }

  function pickMime() {
    if (!window.MediaRecorder) return null;
    const c = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4;codecs=avc1', 'video/mp4'];
    return c.find((m) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || null;
  }

  function exportVideo(job, onProgress) {
    return new Promise((resolve, reject) => {
      const mime = pickMime();
      const cv = document.createElement('canvas');
      if (!mime || !cv.captureStream) { reject(new Error('Video recording isn\'t supported in this browser — try the GIF export instead.')); return; }
      const size = +$('#exportSize').value;
      cv.width = cv.height = size;
      const ctx = cv.getContext('2d');
      render(ctx, job.model, job.opts, 0, size);
      const stream = cv.captureStream(30);
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: mime.split(';')[0] });
        download(blob, job.name + (mime.includes('mp4') ? '.mp4' : '.webm'));
        resolve(blob);
      };
      rec.onerror = (e) => reject(e.error || new Error('Recording failed'));
      rec.start(250);
      const start = performance.now();
      const dur = job.loop * 1000;
      const step = () => {
        const el = performance.now() - start;
        render(ctx, job.model, job.opts, Math.min(el / dur, 0.9999), size);
        if (onProgress) onProgress(Math.min(1, el / dur));
        if (el < dur) requestAnimationFrame(step);
        else setTimeout(() => rec.stop(), 60);
      };
      requestAnimationFrame(step);
    });
  }

  async function runExport(kind, job, label) {
    if (busy) { toast('Hang on — an export is already running.'); return; }
    if (!job || !job.model) { toast('Generate a code first.'); return; }
    busy = true;
    $$('.export-btns button, .lib-actions button').forEach((b) => { b.disabled = true; });
    try {
      if (kind === 'png') { await exportPNG(job); toast('📸 PNG downloaded'); }
      else if (kind === 'svg') { exportSVG(job); toast('✒️ SVG downloaded (static, print-ready)'); }
      else if (kind === 'gif') {
        showProgress(0, 'Encoding GIF…');
        const blob = await exportGIF(job, (p) => showProgress(p, `Encoding GIF… ${Math.round(p * 100)}%`));
        showProgress(1, `Done · ${(blob.size / 1024).toFixed(0)} KB`); hideProgress();
        toast('🖼️ GIF downloaded' + (label ? ' — ' + label : ''));
      } else if (kind === 'webm') {
        showProgress(0, 'Recording loop…');
        const blob = await exportVideo(job, (p) => showProgress(p, `Recording loop… ${Math.round(p * 100)}%`));
        showProgress(1, `Done · ${(blob.size / 1024).toFixed(0)} KB`); hideProgress();
        toast('🎬 Video downloaded');
      }
    } catch (e) {
      toast(e.message || 'Export failed');
      $('#progress').hidden = true;
    } finally {
      busy = false;
      $$('.export-btns button, .lib-actions button').forEach((b) => { b.disabled = false; });
    }
  }

  // ------------------------------------------------------------------ library (saved codes)
  const LIB_KEY = 'qrfuse.library.v1';
  const LIB_MAX = 24;
  let library = [];
  function loadLibrary() {
    try { library = JSON.parse(localStorage.getItem(LIB_KEY) || '[]'); } catch (e) { library = []; }
    if (!Array.isArray(library)) library = [];
  }
  function persistLibrary() {
    try { localStorage.setItem(LIB_KEY, JSON.stringify(library)); }
    catch (e) {
      // Storage full (large logo images) — drop the oldest entries until it fits.
      while (library.length > 1) {
        library.pop();
        try { localStorage.setItem(LIB_KEY, JSON.stringify(library)); return; } catch (e2) { /* keep trimming */ }
      }
    }
  }
  function snapshotState() {
    const s = JSON.parse(JSON.stringify(Object.assign({}, state, { logo: Object.assign({}, state.logo, { img: null }) })));
    return s;
  }
  function saveToLibrary(silent) {
    if (!model) return;
    const snap = snapshotState();
    const key = JSON.stringify(Object.assign({}, snap, { logo: Object.assign({}, snap.logo, { imgSrc: snap.logo.imgSrc ? snap.logo.imgSrc.length : 0 }) }));
    const existing = library.findIndex((e) => e.key === key);
    if (existing !== -1) library.splice(existing, 1);
    const cv = document.createElement('canvas');
    cv.width = cv.height = 240;
    render(cv.getContext('2d'), model, renderOpts(), 0.1, 240);
    const label = (CONTENT_TYPES[state.type].label(state.fields) || payload).slice(0, 80);
    library.unshift({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), key, label, created: Date.now(), state: snap, thumb: cv.toDataURL('image/jpeg', 0.85) });
    if (library.length > LIB_MAX) library.length = LIB_MAX;
    persistLibrary();
    renderLibrary();
    if (!silent) toast('💾 Saved to your library');
  }

  function jobFromEntry(entry) {
    return new Promise((resolve) => {
      const s = entry.state;
      const { qr } = encodeFor(s);
      const logo = Object.assign({}, s.logo, { img: null });
      const finish = () => resolve({ model: buildModel(qr, { logo }), opts: renderOpts(Object.assign({}, s, { logo })), loop: s.loop,
        name: 'qrfuse-' + s.style + '-' + new Date(entry.created).toISOString().slice(0, 10) });
      if (logo.mode === 'image' && logo.imgSrc) {
        const img = new Image();
        img.onload = () => { logo.img = img; finish(); };
        img.onerror = finish;
        img.src = logo.imgSrc;
      } else finish();
    });
  }

  function renderLibrary() {
    const grid = $('#library-grid');
    $('#emptyLib').hidden = library.length > 0;
    $('#clearLib').hidden = library.length === 0;
    grid.innerHTML = library.map((e) => {
      const st = window.QRStyles.byId[e.state.style] || STYLES[0];
      const date = new Date(e.created).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      return `<article class="lib-card" data-id="${e.id}">
        <img src="${e.thumb}" alt="QR code: ${esc(e.label)}" loading="lazy" />
        <div class="lib-title" title="${esc(e.label)}">${esc(e.label) || 'Untitled'}</div>
        <div class="lib-sub">${st.icon} ${st.name} · ${date}</div>
        <div class="lib-actions">
          <button data-act="webm" title="Download animated WebM video">WebM</button>
          <button data-act="gif" title="Download animated GIF">GIF</button>
          <button data-act="png" title="Download PNG image">PNG</button>
          <button data-act="svg" title="Download vector SVG">SVG</button>
        </div>
        <div class="lib-row">
          <button data-act="load">Open in studio</button>
          <button data-act="del" class="del" title="Remove from library" aria-label="Remove">✕</button>
        </div>
      </article>`;
    }).join('');
  }

  $('#library-grid').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-act]');
    if (!btn) return;
    const card = btn.closest('.lib-card');
    const entry = library.find((e) => e.id === card.dataset.id);
    if (!entry) return;
    const act = btn.dataset.act;
    if (act === 'del') {
      library = library.filter((e) => e !== entry);
      persistLibrary(); renderLibrary();
      return;
    }
    if (act === 'load') {
      applyState(entry.state);
      document.getElementById('generator').scrollIntoView({ behavior: 'smooth' });
      toast('Loaded into the studio');
      return;
    }
    if (act !== 'png' && act !== 'svg') toast('Preparing ' + act.toUpperCase() + ' — progress is shown in the studio');
    runExport(act, await jobFromEntry(entry), entry.label);
  });
  $('#clearLib').addEventListener('click', () => {
    if (!confirm('Remove all saved codes from this device?')) return;
    library = []; persistLibrary(); renderLibrary();
  });

  // ------------------------------------------------------------------ UI sync
  function syncUI() {
    const st = window.QRStyles.byId[state.style];
    $('#styleTitle').textContent = `${st.icon} ${st.name}`;
    $$('.style-chip').forEach((b) => b.classList.toggle('active', b.dataset.style === state.style));
    galleryCards.forEach((c) => c.el.classList.toggle('active', c.style.id === state.style));
    $$('#shapeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.shape === state.shape));
    $$('#finderSeg button').forEach((b) => b.classList.toggle('active', b.dataset.finder === state.finder));
    $$('#finderColorSeg button').forEach((b) => b.classList.toggle('active', b.dataset.fc === state.finderColor));
    $$('#eclSeg button').forEach((b) => b.classList.toggle('active', b.dataset.ecl === state.ecl));
    $$('#logoSeg button').forEach((b) => b.classList.toggle('active', b.dataset.logo === state.logo.mode));
    $('#autoPreset').checked = state.autoPreset;
    $('#loopRange').value = state.loop; $('#loopOut').textContent = (+state.loop).toFixed(1) + 's';
    $('#intensityRange').value = state.intensity; $('#intensityOut').textContent = Math.round(state.intensity * 100) + '%';
    $('#versionRange').value = state.minVersion; $('#versionOut').textContent = state.minVersion <= 1 ? 'Auto' : 'v' + state.minVersion + '+';
    $('#quietRange').value = state.quiet; $('#quietOut').textContent = state.quiet;
    $('#fgColor').value = state.fg; $('#accentColor').value = state.accent; $('#bgColor').value = state.bg;
    $('#fgHex').textContent = state.fg; $('#accentHex').textContent = state.accent; $('#bgHex').textContent = state.bg;
    $('#logoOpts').hidden = state.logo.mode === 'none';
    $('#logoTextWrap').hidden = state.logo.mode !== 'text';
    $('#logoImageWrap').hidden = state.logo.mode !== 'image';
    $('#logoText').value = state.logo.text;
    $('#logoSize').value = state.logo.size; $('#logoSizeOut').textContent = Math.round(state.logo.size * 100) + '%';
    const maxLogo = { L: 0.12, M: 0.17, Q: 0.22, H: 0.28 }[state.ecl];
    $('#logoSize').max = maxLogo;
    if (state.logo.size > maxLogo) { state.logo.size = maxLogo; $('#logoSize').value = maxLogo; $('#logoSizeOut').textContent = Math.round(maxLogo * 100) + '%'; }
    $('#logoHint').textContent = state.ecl === 'H' ? 'Logos hide part of the code — ECC H gives you the most headroom.'
      : `ECC ${state.ecl} limits the logo to ${Math.round(maxLogo * 100)}%. Switch to H for bigger logos.`;
    updateContrast();
  }

  function updateContrast() {
    const cf = contrast(state.fg, state.bg), ca = contrast(state.accent, state.bg);
    const set = (el, v) => { el.textContent = v.toFixed(1) + ':1'; el.className = v >= 4.5 ? 'good' : v >= 3 ? 'mid' : 'bad'; };
    set($('#cFg'), cf); set($('#cAcc'), ca);
    const inverted = luminance(hexToRgb(state.bg)) < luminance(hexToRgb(state.fg));
    $('#contrastHint').textContent = inverted ? '⚠️ Light-on-dark (inverted) codes are not supported by every scanner app.'
      : Math.min(cf, ca) < 3 ? '⚠️ Low contrast — scanners may struggle. Aim for at least 4.5:1.'
        : '✓ Great contrast. Dark modules on a light background scan best.';
  }

  function selectStyle(id) {
    state.style = id;
    if (state.autoPreset) {
      const st = window.QRStyles.byId[id];
      Object.assign(state, st.palette);
      state.shape = st.shape;
    }
    syncUI();
    resetVerifier();
  }

  function applyState(s) {
    state = Object.assign({}, DEFAULT_STATE, JSON.parse(JSON.stringify(s)));
    state.logo = Object.assign({}, DEFAULT_STATE.logo, s.logo || {}, { img: null });
    if (state.logo.mode === 'image' && state.logo.imgSrc) {
      const img = new Image();
      img.onload = () => { state.logo.img = img; regenerate(); };
      img.src = state.logo.imgSrc;
    }
    renderFields();
    syncUI();
    regenerate();
  }

  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const regenSoon = debounce(regenerate, 180);

  function bind() {
    // tabs
    $$('.tab').forEach((tab) => tab.addEventListener('click', () => {
      $$('.tab').forEach((t) => { t.classList.toggle('active', t === tab); t.setAttribute('aria-selected', t === tab); });
      $$('.tab-panel').forEach((p) => { const on = p.dataset.panel === tab.dataset.tab; p.hidden = !on; p.classList.toggle('active', on); });
    }));

    // content
    $('#typeSeg').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      state.type = b.dataset.type; renderFields(); regenerate();
    });
    $('#fields').addEventListener('input', (e) => {
      const f = e.target.dataset.field; if (!f) return;
      state.fields[f] = e.target.value; regenSoon();
    });
    $('#generateBtn').addEventListener('click', () => {
      if (regenerate()) {
        saveToLibrary(true);
        toast('⚡ Code generated & saved to your library');
        if (window.innerWidth < 920) $('.preview').scrollIntoView({ behavior: 'smooth' });
      }
    });

    // style picker
    $('#stylePicker').innerHTML = STYLES.map((s) => `<button type="button" class="style-chip" data-style="${s.id}" title="${esc(s.tagline)}"><span class="ico">${s.icon}</span>${s.name}</button>`).join('');
    $('#stylePicker').addEventListener('click', (e) => { const b = e.target.closest('.style-chip'); if (b) selectStyle(b.dataset.style); });

    const segBind = (sel, attr, apply) => $(sel).addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return; apply(b.dataset[attr]); syncUI(); resetVerifier();
    });
    segBind('#shapeSeg', 'shape', (v) => { state.shape = v; });
    segBind('#finderSeg', 'finder', (v) => { state.finder = v; });
    segBind('#finderColorSeg', 'fc', (v) => { state.finderColor = v; });
    segBind('#eclSeg', 'ecl', (v) => { state.ecl = v; regenerate(); });
    segBind('#logoSeg', 'logo', (v) => { state.logo.mode = v; regenerate(); });

    $('#autoPreset').addEventListener('change', (e) => { state.autoPreset = e.target.checked; if (state.autoPreset) selectStyle(state.style); });
    $('#loopRange').addEventListener('input', (e) => { state.loop = +e.target.value; syncUI(); });
    $('#intensityRange').addEventListener('input', (e) => { state.intensity = +e.target.value; syncUI(); resetVerifier(); });
    $('#versionRange').addEventListener('input', (e) => { state.minVersion = +e.target.value; syncUI(); regenSoon(); });
    $('#quietRange').addEventListener('input', (e) => { state.quiet = +e.target.value; syncUI(); resetVerifier(); });

    // colours
    $('#palettes').innerHTML = PALETTES.map((p, i) => `<button type="button" class="palette" data-i="${i}"><div class="sw"><i style="background:${p.fg}"></i><i style="background:${p.accent}"></i><i style="background:${p.bg}"></i></div><span>${p.name}</span></button>`).join('');
    $('#palettes').addEventListener('click', (e) => {
      const b = e.target.closest('.palette'); if (!b) return;
      const p = PALETTES[+b.dataset.i];
      Object.assign(state, { fg: p.fg, accent: p.accent, bg: p.bg, autoPreset: false });
      syncUI(); resetVerifier();
    });
    [['#fgColor', 'fg'], ['#accentColor', 'accent'], ['#bgColor', 'bg']].forEach(([sel, key]) => {
      $(sel).addEventListener('input', (e) => { state[key] = e.target.value; state.autoPreset = false; syncUI(); resetVerifier(); });
    });

    // logo
    $('#logoText').addEventListener('input', (e) => { state.logo.text = e.target.value; });
    $('#logoSize').addEventListener('input', (e) => { state.logo.size = +e.target.value; syncUI(); regenSoon(); });
    const loadLogoFile = (file) => {
      if (!file || !/^image\//.test(file.type)) return;
      if (file.size > 2 * 1024 * 1024) { toast('Please use an image under 2 MB.'); return; }
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          // downscale to keep exports and saved library entries light
          const c = document.createElement('canvas');
          const k = Math.min(1, 256 / Math.max(img.naturalWidth, img.naturalHeight));
          c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          const src = c.toDataURL('image/png');
          const small = new Image();
          small.onload = () => { state.logo.img = small; state.logo.imgSrc = src; state.logo.mode = 'image'; syncUI(); regenerate(); };
          small.src = src;
          $('#logoFileName').textContent = '✓ ' + file.name;
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    };
    $('#logoFile').addEventListener('change', (e) => loadLogoFile(e.target.files[0]));
    const drop = $('.file-drop');
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
    drop.addEventListener('drop', (e) => loadLogoFile(e.dataTransfer.files[0]));

    // transport
    const setPlaying = (p) => {
      playing = p;
      $('#icoPause').hidden = !p; $('#icoPlay').hidden = p;
      $('#playBtn').setAttribute('aria-label', p ? 'Pause animation' : 'Play animation');
    };
    setPlaying(playing);
    $('#playBtn').addEventListener('click', () => setPlaying(!playing));
    $('#scrub').addEventListener('input', (e) => { setPlaying(false); phase = +e.target.value; });
    $('#randomBtn').addEventListener('click', randomize);
    $('#shareBtn').addEventListener('click', async () => {
      const url = location.href.split('#')[0] + '#d=' + encodeState();
      history_replace(url);
      try { await navigator.clipboard.writeText(url); toast('🔗 Share link copied to clipboard'); }
      catch (e) { toast('Link ready in the address bar'); }
    });

    // export
    $('#pngBtn').addEventListener('click', () => runExport('png', Object.assign(currentJob(), { t: phase })));
    $('#svgBtn').addEventListener('click', () => runExport('svg', currentJob()));
    $('#gifBtn').addEventListener('click', () => { saveToLibrary(true); runExport('gif', currentJob()); });
    $('#webmBtn').addEventListener('click', () => { saveToLibrary(true); runExport('webm', currentJob()); });
    $('#saveBtn').addEventListener('click', () => saveToLibrary(false));
    $('#auditBtn').addEventListener('click', runAudit);

    // keyboard
    document.addEventListener('keydown', (e) => {
      if (e.target.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'Space') { e.preventDefault(); setPlaying(!playing); }
      else if (e.key === 'r' || e.key === 'R') randomize();
    });
  }

  function history_replace(url) { try { window.history.replaceState(null, '', url); } catch (e) { /* file:// */ } }

  function randomize() {
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const st = pick(STYLES.filter((s) => s.id !== state.style && s.id !== 'static'));
    state.style = st.id;
    if (Math.random() < 0.5) { Object.assign(state, st.palette); state.shape = st.shape; }
    else { const p = pick(PALETTES); Object.assign(state, { fg: p.fg, accent: p.accent, bg: p.bg }); state.shape = pick(['square', 'rounded', 'dots', 'liquid']); }
    state.finder = pick(['square', 'rounded', 'circle', 'leaf']);
    state.intensity = Math.round((0.6 + Math.random() * 0.4) * 20) / 20;
    state.autoPreset = false;
    syncUI(); resetVerifier();
    toast(`🎲 ${st.icon} ${st.name}`);
  }

  // ------------------------------------------------------------------ boot
  loadFromHash();
  loadLibrary();
  buildGallery();
  bind();
  renderFields();
  syncUI();
  regenerate();
  renderLibrary();
  requestAnimationFrame(frame);
  // Adaptive verifier: never spend more than ~25% of the main thread decoding.
  (function scheduleVerify() {
    setTimeout(() => { verifyTick().finally(scheduleVerify); }, Math.max(450, verifyCost * 4));
  })();
  window.addEventListener('resize', debounce(sizeMainCanvas, 100));

  // test hook
  window.QRFuse = { get state() { return state; }, get payload() { return payload; }, get model() { return model; }, selectStyle, runAudit, saveToLibrary, applyState };
})();
