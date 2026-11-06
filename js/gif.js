/*!
 * QRFuse — tiny animated GIF89a encoder (global palette, LZW, infinite loop).
 */
(function (global) {
  'use strict';

  class ByteWriter {
    constructor(cap) { this.buf = new Uint8Array(cap || 1 << 20); this.len = 0; }
    ensure(n) {
      if (this.len + n <= this.buf.length) return;
      let cap = this.buf.length * 2;
      while (cap < this.len + n) cap *= 2;
      const nb = new Uint8Array(cap); nb.set(this.buf.subarray(0, this.len)); this.buf = nb;
    }
    byte(b) { this.ensure(1); this.buf[this.len++] = b; }
    u16(v) { this.byte(v & 255); this.byte((v >> 8) & 255); }
    bytes(arr) { this.ensure(arr.length); this.buf.set(arr, this.len); this.len += arr.length; }
    str(s) { for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i)); }
    result() { return this.buf.subarray(0, this.len); }
  }

  /** Build a ≤256-colour palette from RGBA frames (15-bit histogram, most frequent buckets). */
  function buildPalette(frames) {
    const cnt = new Uint32Array(32768), sr = new Float64Array(32768), sg = new Float64Array(32768), sb = new Float64Array(32768);
    for (const px of frames) {
      for (let i = 0; i < px.length; i += 8) { // sample every 2nd pixel
        const r = px[i], g = px[i + 1], b = px[i + 2];
        const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
        cnt[k]++; sr[k] += r; sg[k] += g; sb[k] += b;
      }
    }
    const keys = [];
    for (let k = 0; k < 32768; k++) if (cnt[k]) keys.push(k);
    keys.sort((a, b) => cnt[b] - cnt[a]);
    const top = keys.slice(0, 256);
    const palette = new Uint8Array(768);
    const colors = top.map((k) => [Math.round(sr[k] / cnt[k]), Math.round(sg[k] / cnt[k]), Math.round(sb[k] / cnt[k])]);
    colors.forEach((c, i) => { palette[i * 3] = c[0]; palette[i * 3 + 1] = c[1]; palette[i * 3 + 2] = c[2]; });
    const lut = new Int16Array(32768).fill(-1);
    const lookup = (r, g, b) => {
      const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      let v = lut[k];
      if (v >= 0) return v;
      let best = 0, bd = Infinity;
      for (let i = 0; i < colors.length; i++) {
        const c = colors[i];
        const dr = c[0] - r, dg = c[1] - g, db = c[2] - b;
        const dist = dr * dr * 3 + dg * dg * 4 + db * db * 2;
        if (dist < bd) { bd = dist; best = i; }
      }
      lut[k] = best;
      return best;
    };
    return { palette, lookup };
  }

  function lzw(out, indices, minCodeSize) {
    const clear = 1 << minCodeSize, eoi = clear + 1;
    let codeSize = minCodeSize + 1, next = eoi + 1;
    let dict = new Map();
    const block = new Uint8Array(255);
    let blen = 0, cur = 0, curBits = 0;
    const flushBlock = () => { if (blen) { out.byte(blen); out.bytes(block.subarray(0, blen)); blen = 0; } };
    const emit = (code) => {
      cur |= code << curBits; curBits += codeSize;
      while (curBits >= 8) {
        block[blen++] = cur & 255;
        if (blen === 255) flushBlock();
        cur >>>= 8; curBits -= 8;
      }
    };
    out.byte(minCodeSize);
    emit(clear);
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const k = indices[i];
      const key = prefix * 256 + k;
      const found = dict.get(key);
      if (found !== undefined) { prefix = found; continue; }
      emit(prefix);
      if (next < 4096) {
        if (next > (1 << codeSize) - 1) codeSize++;
        dict.set(key, next++);
      } else {
        emit(clear);
        dict = new Map();
        codeSize = minCodeSize + 1;
        next = eoi + 1;
      }
      prefix = k;
    }
    emit(prefix);
    if (next > (1 << codeSize) - 1 && codeSize < 12) codeSize++;
    emit(eoi);
    if (curBits > 0) { block[blen++] = cur & 255; if (blen === 255) flushBlock(); }
    flushBlock();
    out.byte(0);
  }

  /**
   * Encode an animation to GIF without holding every frame in memory.
   * @param {object} o
   * @param {number} o.width
   * @param {number} o.height
   * @param {number} o.delayCs        delay per frame in 1/100 s
   * @param {number} o.frameCount
   * @param {(i:number)=>Uint8ClampedArray} o.getFrame  RGBA pixels of frame i
   * @param {(p:number)=>void} [o.onProgress]
   * @returns {Promise<Blob>}
   */
  async function encode(o) {
    const { width: w, height: h, delayCs, frameCount, getFrame, onProgress } = o;
    const yieldUI = () => new Promise((r) => setTimeout(r, 0));
    // 1) palette from a sample of frames
    const sampleStep = Math.max(1, Math.floor(frameCount / 12));
    const samples = [];
    for (let i = 0; i < frameCount; i += sampleStep) samples.push(new Uint8ClampedArray(getFrame(i)));
    const { palette, lookup } = buildPalette(samples);
    samples.length = 0;
    if (onProgress) onProgress(0.05);
    await yieldUI();

    // 2) frames
    const out = new ByteWriter(Math.max(1 << 16, (w * h * frameCount) >> 3));
    out.str('GIF89a');
    out.u16(w); out.u16(h);
    out.byte(0xF7); out.byte(0); out.byte(0);
    out.bytes(palette);
    out.byte(0x21); out.byte(0xFF); out.byte(11); out.str('NETSCAPE2.0');
    out.byte(3); out.byte(1); out.u16(0); out.byte(0);
    const idx = new Uint8Array(w * h);
    for (let f = 0; f < frameCount; f++) {
      const px = getFrame(f);
      for (let i = 0, p = 0; i < idx.length; i++, p += 4) idx[i] = lookup(px[p], px[p + 1], px[p + 2]);
      out.byte(0x21); out.byte(0xF9); out.byte(4); out.byte(0x04); out.u16(delayCs); out.byte(0); out.byte(0);
      out.byte(0x2C); out.u16(0); out.u16(0); out.u16(w); out.u16(h); out.byte(0);
      lzw(out, idx, 8);
      if (onProgress) onProgress(0.05 + 0.95 * (f + 1) / frameCount);
      await yieldUI();
    }
    out.byte(0x3B);
    return new Blob([out.result()], { type: 'image/gif' });
  }

  global.GIFEncoder = { encode, _lzw: lzw, _ByteWriter: ByteWriter };
})(typeof window !== 'undefined' ? window : globalThis);
