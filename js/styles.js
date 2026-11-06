/*!
 * QRFuse — animation styles.
 * Every style is a pure function of (module x, y, loop phase t ∈ [0,1)).
 * Phase-based maths keeps every animation a perfect, seamless loop.
 *
 * module() may return:
 *   s   – module scale (clamped to a scan-safe range by the renderer)
 *   k   – 0..1 blend from the foreground colour to the accent colour
 *   dx, dy – sub-module offsets (clamped to ±0.2 module)
 *   hue – optional hue override (rendered as a dark, high-contrast colour)
 */
(function (global) {
  'use strict';
  const TAU = Math.PI * 2;

  function hash(a, b, c) {
    let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul((c | 0) + 0x9e37, 0x9e3779b1);
    h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  const bump = (p, m, w) => {
    let d = Math.abs(p - m); d = Math.min(d, 1 - d);
    return Math.exp(-(d / w) * (d / w));
  };
  const MATRIX_GLYPHS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789ﾊﾋﾌﾍﾎ';

  const STYLES = [
    {
      id: 'pulse', name: 'Retro Pulse', icon: '👾',
      tagline: 'Chunky 8-bit pixels breathing in diagonal waves.',
      palette: { fg: '#1a1033', accent: '#7c3aed', bg: '#ffffff' }, shape: 'square',
      module(x, y, c) {
        const d = (x + y) / (2 * c.n);
        const w = 0.5 + 0.5 * Math.sin(TAU * (c.t * 2 - d * 2));
        const q = Math.round(w * 4) / 4;
        return { s: 0.62 + 0.38 * q, k: q >= 0.75 ? 1 : 0 };
      }
    },
    {
      id: 'matrix', name: 'Matrix Rain', icon: '🟢',
      tagline: 'Cyberpunk digital rain falling through the code.',
      palette: { fg: '#062b12', accent: '#0a8f3c', bg: '#effff3' }, shape: 'square',
      _head(x, c) {
        const o = hash(x, 7, 1), sp = 1 + Math.floor(hash(x, 3, 2) * 2);
        return ((c.t * sp + o) % 1) * (c.n + 14) - 7;
      },
      module(x, y, c) {
        const dist = this._head(x, c) - y;
        if (dist >= 0 && dist < 7) return { k: 1 - dist / 7, s: dist < 1 ? 1.05 : 0.94 };
        return { k: 0, s: 0.86 };
      },
      background(ctx, c, g) {
        ctx.font = `${Math.max(6, g.cell * 0.72)}px monospace`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = c.accent;
        for (let x = 0; x < c.n; x++) {
          const head = this._head(x, c);
          for (let y = Math.max(0, Math.floor(head) - 7); y <= Math.min(c.n - 1, Math.ceil(head)); y++) {
            const dist = head - y;
            if (dist < 0 || dist >= 7 || c.isDark(x, y) || c.isReserved(x, y)) continue;
            ctx.globalAlpha = 0.16 * (1 - dist / 7);
            const gi = Math.floor(hash(x, y, Math.floor(c.t * 12)) * MATRIX_GLYPHS.length);
            ctx.fillText(MATRIX_GLYPHS[gi], g.off + (x + 0.5) * g.cell, g.off + (y + 0.5) * g.cell);
          }
        }
        ctx.globalAlpha = 1;
      }
    },
    {
      id: 'wave', name: 'Sine Wave', icon: '🌊',
      tagline: 'Smooth ocean swell rolling across every column.',
      palette: { fg: '#04293a', accent: '#0077b6', bg: '#f4fbff' }, shape: 'dots',
      module(x, y, c) {
        const ph = TAU * (c.t + x / c.n);
        const w = Math.sin(ph);
        return { dy: 0.18 * w, s: 0.84 + 0.16 * Math.cos(ph), k: 0.5 + 0.5 * w };
      }
    },
    {
      id: 'neon', name: 'Neon Glow', icon: '💜',
      tagline: 'Electric magenta glow pulsing like a club sign.',
      palette: { fg: '#2a0a5e', accent: '#c2187a', bg: '#fff5fb' }, shape: 'rounded',
      module(x, y, c) {
        const k = 0.5 + 0.5 * Math.sin(TAU * (c.t + (x - y) / c.n * 0.8));
        return { k, s: 0.9 + 0.1 * k };
      },
      glow(c) { return 0.18 + 0.22 * (0.5 + 0.5 * Math.sin(TAU * c.t * 2)); }
    },
    {
      id: 'liquid', name: 'Liquid Gradient', icon: '🫧',
      tagline: 'Fluid blobby modules with a rotating colour flow.',
      palette: { fg: '#1e1b4b', accent: '#db2777', bg: '#ffffff' }, shape: 'liquid',
      module(x, y, c) {
        const a = TAU * c.t;
        const proj = ((x - c.cx) * Math.cos(a) + (y - c.cy) * Math.sin(a)) / (c.n * 0.6);
        return { k: Math.max(0, Math.min(1, 0.5 + 0.5 * proj)), s: 1 };
      }
    },
    {
      id: 'radar', name: 'Radar Sweep', icon: '📡',
      tagline: 'A sonar beam scanning and lighting up the grid.',
      palette: { fg: '#0b2e24', accent: '#059669', bg: '#f0fdf8' }, shape: 'dots',
      module(x, y, c) {
        const ang = Math.atan2(y - c.cy, x - c.cx);
        const delta = (((TAU * c.t - ang) % TAU) + TAU) % TAU;
        const k = Math.exp(-delta * 1.4);
        return { k, s: 0.74 + 0.3 * k };
      },
      overlay(ctx, c, g) {
        const cx = g.off + (c.cx + 0.5) * g.cell, cy = g.off + (c.cy + 0.5) * g.cell;
        const R = c.n * g.cell * 0.75, a = TAU * c.t;
        ctx.save();
        ctx.globalAlpha = 0.10;
        ctx.fillStyle = c.accent;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a - 0.55, a); ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 0.07; ctx.strokeStyle = c.accent; ctx.lineWidth = Math.max(1, g.cell * 0.08);
        for (let r = 1; r <= 3; r++) { ctx.beginPath(); ctx.arc(cx, cy, R * r / 3.4, 0, TAU); ctx.stroke(); }
        ctx.restore();
      }
    },
    {
      id: 'glitch', name: 'Glitch', icon: '📺',
      tagline: 'Datamoshed row shifts with chromatic aberration.',
      palette: { fg: '#111111', accent: '#e11d48', bg: '#ffffff' }, shape: 'square',
      _frame(c) { return Math.floor(c.t * 20); },
      _burst(c) { return hash(this._frame(c), 0, 13) < 0.35; },
      module(x, y, c) {
        const g = this._frame(c);
        let dx = 0;
        if (this._burst(c) && hash(y, g, 11) < 0.12) dx = (hash(y, g, 12) - 0.5) * 0.45;
        return { dx, k: hash(x, y, g) < 0.07 ? 1 : 0 };
      },
      ghost(c) { return this._burst(c) ? { color: '#06b6d4', dx: 0.22, dy: 0, alpha: 0.28 } : null; }
    },
    {
      id: 'heartbeat', name: 'Heartbeat', icon: '❤️',
      tagline: 'Lub-dub double beat pumping out from the centre.',
      palette: { fg: '#3b0a14', accent: '#dc2626', bg: '#fff5f5' }, shape: 'rounded',
      module(x, y, c) {
        const r = Math.hypot(x - c.cx, y - c.cy) / (c.n * 0.7);
        const p = (c.t - r * 0.18 + 1) % 1;
        const beat = bump(p, 0.08, 0.06) + 0.7 * bump(p, 0.26, 0.07);
        return { s: 0.8 + 0.25 * beat, k: Math.min(1, beat) };
      }
    },
    {
      id: 'ripple', name: 'Ripple', icon: '💧',
      tagline: 'Concentric water rings radiating outward.',
      palette: { fg: '#082f49', accent: '#0369a1', bg: '#f0f9ff' }, shape: 'dots',
      module(x, y, c) {
        const r = Math.hypot(x - c.cx, y - c.cy) / (c.n / 2);
        const w = 0.5 + 0.5 * Math.sin(TAU * (r * 2.5 - c.t * 2));
        return { s: 0.74 + 0.28 * w, k: w };
      }
    },
    {
      id: 'orbit', name: 'Orbit', icon: '🪐',
      tagline: 'Every dot spins in its own tiny planetary orbit.',
      palette: { fg: '#1c1917', accent: '#b45309', bg: '#fffbeb' }, shape: 'dots',
      module(x, y, c) {
        const ph = TAU * (c.t + hash(x, y, 3));
        return { dx: 0.16 * Math.cos(ph), dy: 0.16 * Math.sin(ph), s: 0.84, k: 0.5 + 0.5 * Math.sin(ph) };
      }
    },
    {
      id: 'rainbow', name: 'Prism', icon: '🌈',
      tagline: 'A full-spectrum hue flow — tuned dark enough to scan.',
      palette: { fg: '#111827', accent: '#4338ca', bg: '#ffffff' }, shape: 'rounded',
      module(x, y, c) {
        return { hue: (((x + y) / (2 * c.n) + c.t) % 1) * 360, s: 0.92 + 0.08 * Math.sin(TAU * (c.t * 2 + x / c.n)) };
      }
    },
    {
      id: 'scan', name: 'CRT Scanline', icon: '🖥️',
      tagline: 'Retro monitor beam with phosphor jitter.',
      palette: { fg: '#0f172a', accent: '#2563eb', bg: '#f8fafc' }, shape: 'square',
      _band(c) { return c.t * (c.n + 10) - 5; },
      module(x, y, c) {
        const dist = Math.abs(y - this._band(c));
        const k = Math.max(0, 1 - dist / 3);
        return { k, s: 0.86 + 0.16 * k, dx: k > 0.6 ? 0.08 * Math.sin(TAU * (y * 0.7 + c.t * 6)) : 0 };
      },
      overlay(ctx, c, g) {
        ctx.save();
        const by = g.off + (this._band(c) + 0.5) * g.cell;
        const grad = ctx.createLinearGradient(0, by - g.cell * 3, 0, by + g.cell * 3);
        grad.addColorStop(0, 'rgba(37,99,235,0)');
        grad.addColorStop(0.5, c.accentRgba(0.12));
        grad.addColorStop(1, 'rgba(37,99,235,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, by - g.cell * 3, g.W, g.cell * 6);
        ctx.fillStyle = 'rgba(0,0,0,0.045)';
        const step = Math.max(2, g.cell / 3);
        for (let y = 0; y < g.W; y += step * 2) ctx.fillRect(0, y, g.W, step * 0.6);
        ctx.restore();
      }
    },
    {
      id: 'sparkle', name: 'Stardust', icon: '✨',
      tagline: 'Twinkling modules and golden stars between pixels.',
      palette: { fg: '#2e1065', accent: '#a21caf', bg: '#fdf4ff' }, shape: 'rounded',
      module(x, y, c) {
        const tw = Math.pow(Math.max(0, Math.sin(TAU * (c.t * 2 + hash(x, y, 5)))), 6);
        return { s: 0.84 + 0.18 * tw, k: tw };
      },
      overlay(ctx, c, g) {
        // Stars sit on grid intersections — scanners sample module centres, so they never flip a bit.
        ctx.save();
        ctx.fillStyle = '#f59e0b';
        const count = Math.round(c.n * 0.9);
        for (let i = 0; i < count; i++) {
          const gx = 1 + Math.floor(hash(i, 1, 21) * (c.n - 1));
          const gy = 1 + Math.floor(hash(i, 2, 22) * (c.n - 1));
          if (c.isReserved(gx, gy) || c.isReserved(gx - 1, gy - 1)) continue;
          const tw = Math.pow(Math.max(0, Math.sin(TAU * (c.t * 2 + hash(i, 3, 23)))), 4);
          if (tw < 0.05) continue;
          const px = g.off + gx * g.cell, py = g.off + gy * g.cell, r = g.cell * 0.42 * tw;
          ctx.globalAlpha = 0.85 * tw;
          ctx.beginPath();
          ctx.moveTo(px, py - r);
          ctx.quadraticCurveTo(px, py, px + r, py);
          ctx.quadraticCurveTo(px, py, px, py + r);
          ctx.quadraticCurveTo(px, py, px - r, py);
          ctx.quadraticCurveTo(px, py, px, py - r);
          ctx.fill();
        }
        ctx.restore();
      }
    },
    {
      id: 'static', name: 'Static', icon: '⬛',
      tagline: 'No motion — a crisp classic code with your styling.',
      palette: { fg: '#0f172a', accent: '#334155', bg: '#ffffff' }, shape: 'rounded',
      module() { return { s: 1, k: 0 }; }
    }
  ];

  global.QRStyles = { list: STYLES, byId: Object.fromEntries(STYLES.map((s) => [s.id, s])), hash };
})(typeof window !== 'undefined' ? window : globalThis);
