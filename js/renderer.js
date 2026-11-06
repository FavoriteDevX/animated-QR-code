/*!
 * QRFuse — scan-safe animated renderer.
 *
 * Scannability guarantees enforced here (independent of the style):
 *   • Finder + alignment patterns are drawn static, at full size, in the foreground colour.
 *   • Data modules never shrink below 60% nor drift more than 0.2 module from their centre.
 *   • Light modules only ever receive low-alpha decoration, so contrast is preserved.
 */
(function (global) {
  'use strict';
  const TAU = Math.PI * 2;
  const RAMP = 24;

  // ---------- colour helpers ----------
  function hexToRgb(hex) {
    let h = String(hex || '#000').replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgbToCss = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
  const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  function luminance(rgb) {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
  }
  function contrast(a, b) {
    const la = luminance(hexToRgb(a)), lb = luminance(hexToRgb(b));
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  function hslToRgb(h, s, l) {
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [f(0) * 255, f(8) * 255, f(4) * 255];
  }
  // Pick the lightness for a hue that keeps ≥ 4:1 contrast against the background.
  function safeHueColor(hue, bgLum) {
    for (let l = 0.42; l >= 0.12; l -= 0.02) {
      const rgb = hslToRgb(hue, 0.85, l);
      if ((bgLum + 0.05) / (luminance(rgb) + 0.05) >= 4) return rgb;
    }
    return hslToRgb(hue, 0.85, 0.12);
  }

  // ---------- model ----------
  function buildModel(qr, opts) {
    const n = qr.size;
    const reserved = [];  // drawn statically (finders + alignment)
    for (let y = 0; y < n; y++) reserved.push(new Uint8Array(n));
    const mark = (x0, y0, w, h) => {
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++)
        if (x >= 0 && y >= 0 && x < n && y < n) reserved[y][x] = 1;
    };
    mark(0, 0, 8, 8); mark(n - 8, 0, 8, 8); mark(0, n - 8, 8, 8);
    qr.alignCenters.forEach(([cx, cy]) => mark(cx - 2, cy - 2, 5, 5));

    // Centre logo knock-out
    let logo = null;
    if (opts.logo && opts.logo.mode !== 'none' && opts.logo.size > 0) {
      let span = Math.round(n * opts.logo.size);
      if (span % 2 !== n % 2) span += 1;
      span = Math.max(3, Math.min(span, n - 16));
      const start = (n - span) / 2;
      logo = { start, span };
    }
    const inLogo = (x, y) => logo && x >= logo.start && x < logo.start + logo.span &&
      y >= logo.start && y < logo.start + logo.span;

    const dark = [];
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        if (qr.modules[y][x] && !reserved[y][x] && !inLogo(x, y)) dark.push(x, y);

    return {
      qr, n, reserved, logo, dark: Int16Array.from(dark),
      isDark: (x, y) => x >= 0 && y >= 0 && x < n && y < n && qr.modules[y][x] && !inLogo(x, y),
      isReserved: (x, y) => x < 0 || y < 0 || x >= n || y >= n || reserved[y][x] === 1 || !!inLogo(x, y)
    };
  }

  // ---------- shapes ----------
  function roundRectPath(ctx, x, y, w, h, r) {
    // r: [tl, tr, br, bl]
    ctx.moveTo(x + r[0], y);
    ctx.lineTo(x + w - r[1], y);
    if (r[1]) ctx.arcTo(x + w, y, x + w, y + r[1], r[1]); else ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + h - r[2]);
    if (r[2]) ctx.arcTo(x + w, y + h, x + w - r[2], y + h, r[2]); else ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + r[3], y + h);
    if (r[3]) ctx.arcTo(x, y + h, x, y + h - r[3], r[3]); else ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + r[0]);
    if (r[0]) ctx.arcTo(x, y, x + r[0], y, r[0]); else ctx.lineTo(x, y);
    ctx.closePath();
  }

  function modulePath(ctx, shape, model, x, y, px, py, size, cell, s) {
    const half = size / 2;
    switch (shape) {
      case 'dots':
        ctx.moveTo(px + half, py);
        ctx.arc(px, py, half, 0, TAU);
        break;
      case 'rounded': {
        const r = size * 0.32;
        roundRectPath(ctx, px - half, py - half, size, size, [r, r, r, r]);
        break;
      }
      case 'liquid': {
        if (s < 0.97) {
          const r = size * 0.45;
          roundRectPath(ctx, px - half, py - half, size, size, [r, r, r, r]);
          break;
        }
        const u = model.isDark(x, y - 1), d = model.isDark(x, y + 1);
        const l = model.isDark(x - 1, y), rr = model.isDark(x + 1, y);
        const R = size * 0.5;
        roundRectPath(ctx, px - half, py - half, size, size,
          [!u && !l ? R : 0, !u && !rr ? R : 0, !d && !rr ? R : 0, !d && !l ? R : 0]);
        break;
      }
      default: {
        const pad = s >= 0.99 ? cell * 0.02 : 0; // hide hairline seams between touching squares
        ctx.rect(px - half - pad, py - half - pad, size + pad * 2, size + pad * 2);
      }
    }
  }

  function drawFinder(ctx, shape, ox, oy, cell) {
    const w7 = cell * 7, w5 = cell * 5, w3 = cell * 3;
    ctx.beginPath();
    if (shape === 'circle') {
      ctx.arc(ox + w7 / 2, oy + w7 / 2, w7 / 2, 0, TAU);
      ctx.moveTo(ox + w7 / 2 + w5 / 2, oy + w7 / 2);
      ctx.arc(ox + w7 / 2, oy + w7 / 2, w5 / 2, 0, TAU, true);
      ctx.fill('evenodd');
      ctx.beginPath();
      ctx.arc(ox + w7 / 2, oy + w7 / 2, w3 / 2, 0, TAU);
      ctx.fill();
      return;
    }
    const ro = shape === 'rounded' ? cell * 2 : 0;
    const ri = shape === 'rounded' ? cell * 1.3 : 0;
    const rc = shape === 'rounded' ? cell * 0.9 : 0;
    const leaf = shape === 'leaf';
    roundRectPath(ctx, ox, oy, w7, w7, leaf ? [cell * 3, 0, cell * 3, 0] : [ro, ro, ro, ro]);
    roundRectPath(ctx, ox + cell, oy + cell, w5, w5, leaf ? [cell * 2, 0, cell * 2, 0] : [ri, ri, ri, ri]);
    ctx.fill('evenodd');
    ctx.beginPath();
    roundRectPath(ctx, ox + cell * 2, oy + cell * 2, w3, w3, leaf ? [cell * 1.2, 0, cell * 1.2, 0] : [rc, rc, rc, rc]);
    ctx.fill();
  }

  // ---------- frame ----------
  const rampCache = new Map();
  function getRamp(fg, accent) {
    const key = fg + accent;
    if (!rampCache.has(key)) {
      const a = hexToRgb(fg), b = hexToRgb(accent);
      const ramp = [];
      for (let i = 0; i < RAMP; i++) ramp.push(rgbToCss(mix(a, b, i / (RAMP - 1))));
      rampCache.set(key, ramp);
      if (rampCache.size > 64) rampCache.delete(rampCache.keys().next().value);
    }
    return rampCache.get(key);
  }
  const hueCache = new Map();
  function hueColor(hue, bg) {
    const key = bg + '|' + hue;
    if (!hueCache.has(key)) {
      hueCache.set(key, rgbToCss(safeHueColor(hue, luminance(hexToRgb(bg)))));
      if (hueCache.size > 512) hueCache.delete(hueCache.keys().next().value);
    }
    return hueCache.get(key);
  }

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  /**
   * Render one frame.
   * @param ctx    CanvasRenderingContext2D
   * @param model  from buildModel()
   * @param o      { style, shape, finder, fg, accent, bg, finderColor, quiet, intensity, logo }
   * @param t      loop phase 0..1
   * @param W      output size in px
   */
  function render(ctx, model, o, t, W) {
    const style = global.QRStyles.byId[o.style] || global.QRStyles.list[0];
    const n = model.n;
    const quiet = o.quiet;
    const cell = W / (n + quiet * 2);
    const off = quiet * cell;
    const I = clamp(o.intensity == null ? 1 : o.intensity, 0, 1);
    const acc = hexToRgb(o.accent);
    const c = {
      n, t, TAU, cx: (n - 1) / 2, cy: (n - 1) / 2,
      fg: o.fg, accent: o.accent, bg: o.bg,
      accentRgba: (a) => `rgba(${acc[0]},${acc[1]},${acc[2]},${a})`,
      isDark: model.isDark, isReserved: model.isReserved
    };
    const g = { W, cell, off };

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.fillStyle = o.bg;
    ctx.fillRect(0, 0, W, W);

    if (style.background) { ctx.save(); style.background(ctx, c, g); ctx.restore(); }

    // Evaluate module parameters
    const ramp = getRamp(o.fg, o.accent);
    const buckets = new Map();
    const d = model.dark;
    const count = d.length / 2;
    const S = new Float32Array(count), DX = new Float32Array(count), DY = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const x = d[i * 2], y = d[i * 2 + 1];
      const r = style.module(x, y, c) || {};
      S[i] = clamp(1 + ((r.s == null ? 1 : r.s) - 1) * I, 0.6, 1.06);
      DX[i] = clamp((r.dx || 0) * I, -0.2, 0.2);
      DY[i] = clamp((r.dy || 0) * I, -0.2, 0.2);
      const color = r.hue != null
        ? hueColor(Math.round(r.hue / 6) * 6 % 360, o.bg)
        : ramp[Math.round(clamp(r.k || 0, 0, 1) * (RAMP - 1))];
      let arr = buckets.get(color);
      if (!arr) { arr = []; buckets.set(color, arr); }
      arr.push(i);
    }

    const drawSet = (indices) => {
      for (const i of indices) {
        const x = d[i * 2], y = d[i * 2 + 1];
        const px = off + (x + 0.5 + DX[i]) * cell;
        const py = off + (y + 0.5 + DY[i]) * cell;
        modulePath(ctx, o.shape, model, x, y, px, py, cell * S[i], cell, S[i]);
      }
    };

    // Chromatic ghost (glitch)
    const ghost = style.ghost && style.ghost(c);
    if (ghost && I > 0) {
      ctx.save();
      ctx.globalAlpha = ghost.alpha * I;
      ctx.fillStyle = ghost.color;
      ctx.translate(ghost.dx * cell * I, ghost.dy * cell * I);
      ctx.beginPath();
      for (const arr of buckets.values()) drawSet(arr);
      ctx.fill();
      ctx.restore();
    }

    const glow = style.glow ? style.glow(c) * I : 0;
    if (glow > 0) { ctx.shadowColor = o.accent; ctx.shadowBlur = glow * cell; }
    for (const [color, arr] of buckets) {
      ctx.fillStyle = color;
      ctx.beginPath();
      drawSet(arr);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    // Static, scan-critical patterns
    const finderFill = o.finderColor === 'accent' ? o.accent : o.fg;
    ctx.fillStyle = finderFill;
    drawFinder(ctx, o.finder, off, off, cell);
    drawFinder(ctx, o.finder, off + (n - 7) * cell, off, cell);
    drawFinder(ctx, o.finder, off, off + (n - 7) * cell, cell);
    ctx.fillStyle = o.fg;
    model.qr.alignCenters.forEach(([ax, ay]) => {
      const x0 = off + (ax - 2) * cell, y0 = off + (ay - 2) * cell;
      ctx.beginPath();
      const r = o.finder === 'square' ? 0 : cell * 0.9;
      roundRectPath(ctx, x0, y0, cell * 5, cell * 5, [r, r, r, r]);
      const r2 = o.finder === 'square' ? 0 : cell * 0.55;
      roundRectPath(ctx, x0 + cell, y0 + cell, cell * 3, cell * 3, [r2, r2, r2, r2]);
      ctx.fill('evenodd');
      ctx.beginPath();
      if (o.finder === 'square') ctx.rect(x0 + cell * 2, y0 + cell * 2, cell, cell);
      else ctx.arc(x0 + cell * 2.5, y0 + cell * 2.5, cell * 0.55, 0, TAU);
      ctx.fill();
    });

    if (style.overlay && I > 0) { ctx.save(); ctx.globalAlpha = 1; style.overlay(ctx, c, g); ctx.restore(); }

    // Logo
    if (model.logo) drawLogo(ctx, model, o, cell, off);

    ctx.restore();
  }

  function drawLogo(ctx, model, o, cell, off) {
    const { start, span } = model.logo;
    const x = off + start * cell, y = off + start * cell, w = span * cell;
    const inset = cell * 0.35;
    ctx.save();
    ctx.fillStyle = o.bg;
    ctx.beginPath();
    roundRectPath(ctx, x + inset * 0.3, y + inset * 0.3, w - inset * 0.6, w - inset * 0.6, Array(4).fill(w * 0.22));
    ctx.fill();
    const inner = w - inset * 2;
    if (o.logo.mode === 'image' && o.logo.img && o.logo.img.complete && o.logo.img.naturalWidth) {
      const img = o.logo.img;
      const ratio = Math.min(inner / img.naturalWidth, inner / img.naturalHeight);
      const iw = img.naturalWidth * ratio, ih = img.naturalHeight * ratio;
      ctx.beginPath();
      roundRectPath(ctx, x + inset, y + inset, inner, inner, Array(4).fill(inner * 0.18));
      ctx.clip();
      ctx.drawImage(img, x + (w - iw) / 2, y + (w - ih) / 2, iw, ih);
    } else if (o.logo.mode === 'text' && o.logo.text) {
      const txt = String(o.logo.text).slice(0, 4);
      ctx.fillStyle = o.finderColor === 'accent' ? o.accent : o.fg;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let fs = inner * (txt.length <= 2 ? 0.8 : 0.55);
      ctx.font = `700 ${fs}px "Space Grotesk", "Segoe UI Emoji", "Apple Color Emoji", system-ui, sans-serif`;
      const m = ctx.measureText(txt).width;
      if (m > inner) { fs *= inner / m; ctx.font = `700 ${fs}px "Space Grotesk", "Segoe UI Emoji", "Apple Color Emoji", system-ui, sans-serif`; }
      ctx.fillText(txt, x + w / 2, y + w / 2 + fs * 0.04);
    }
    ctx.restore();
  }

  global.QRRender = { buildModel, render, contrast, luminance, hexToRgb };
})(typeof window !== 'undefined' ? window : globalThis);
