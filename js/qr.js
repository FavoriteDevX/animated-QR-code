/*!
 * QRFuse — dependency-free QR Code encoder (ISO/IEC 18004, byte mode, versions 1–40).
 * Exposes window.QR.encode(text, ecl, { minVersion }).
 */
(function (global) {
  'use strict';

  // Index 0 is padding. Rows: L, M, Q, H.
  const ECC_CODEWORDS_PER_BLOCK = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
  ];
  const NUM_ERROR_CORRECTION_BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
  ];
  const ECL = {
    L: { ord: 0, bits: 1, recovery: 7 },
    M: { ord: 1, bits: 0, recovery: 15 },
    Q: { ord: 2, bits: 3, recovery: 25 },
    H: { ord: 3, bits: 2, recovery: 30 }
  };

  function utf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(str));
    const out = [];
    const s = unescape(encodeURIComponent(str));
    for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return out;
  }

  function numRawDataModules(ver) {
    let result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const numAlign = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  }

  function numDataCodewords(ver, ecl) {
    return Math.floor(numRawDataModules(ver) / 8) -
      ECC_CODEWORDS_PER_BLOCK[ecl.ord][ver] * NUM_ERROR_CORRECTION_BLOCKS[ecl.ord][ver];
  }

  function byteCapacity(ver, ecl) {
    const ccBits = ver < 10 ? 8 : 16;
    return Math.floor((numDataCodewords(ver, ecl) * 8 - 4 - ccBits) / 8);
  }

  // ---- Reed–Solomon over GF(2^8) with polynomial 0x11D ----
  function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xFF;
  }

  function rsDivisor(degree) {
    const result = new Array(degree).fill(0);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < result.length; j++) {
        result[j] = gfMul(result[j], root);
        if (j + 1 < result.length) result[j] ^= result[j + 1];
      }
      root = gfMul(root, 0x02);
    }
    return result;
  }

  function rsRemainder(data, divisor) {
    const result = divisor.map(() => 0);
    for (const b of data) {
      const factor = b ^ result.shift();
      result.push(0);
      divisor.forEach((coef, i) => { result[i] ^= gfMul(coef, factor); });
    }
    return result;
  }

  function alignmentPositions(ver, size) {
    if (ver === 1) return [];
    const numAlign = Math.floor(ver / 7) + 2;
    const step = Math.floor((ver * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2;
    const result = [6];
    for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
    return result;
  }

  function getBit(x, i) { return ((x >>> i) & 1) !== 0; }

  function encode(text, eclName, options) {
    const opts = options || {};
    const ecl = ECL[eclName] || ECL.H;
    const bytes = utf8Bytes(String(text));
    const minVersion = Math.max(1, Math.min(40, opts.minVersion | 0 || 1));

    let ver = minVersion;
    const skip = opts.skipVersions || [];
    for (; ver <= 40; ver++) {
      if (skip.indexOf(ver) !== -1) continue;
      const ccBits = ver < 10 ? 8 : 16;
      if (4 + ccBits + bytes.length * 8 <= numDataCodewords(ver, ecl) * 8) break;
    }
    if (ver > 40) {
      const err = new Error('Content is too long for a QR code at ECC level ' + eclName +
        ' (max ' + byteCapacity(40, ecl) + ' bytes).');
      err.code = 'TOO_LONG';
      throw err;
    }

    // ---- Bit stream ----
    const bits = [];
    const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    push(0x4, 4);
    push(bytes.length, ver < 10 ? 8 : 16);
    for (const b of bytes) push(b, 8);
    const capBits = numDataCodewords(ver, ecl) * 8;
    push(0, Math.min(4, capBits - bits.length));
    push(0, (8 - bits.length % 8) % 8);
    for (let pad = 0xEC; bits.length < capBits; pad ^= 0xEC ^ 0x11) push(pad, 8);

    const dataCodewords = [];
    for (let i = 0; i < bits.length; i += 8) {
      let v = 0;
      for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
      dataCodewords.push(v);
    }

    // ---- ECC + interleave ----
    const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecl.ord][ver];
    const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecl.ord][ver];
    const rawCodewords = Math.floor(numRawDataModules(ver) / 8);
    const numShortBlocks = numBlocks - rawCodewords % numBlocks;
    const shortBlockLen = Math.floor(rawCodewords / numBlocks);
    const divisor = rsDivisor(blockEccLen);
    const blocks = [];
    for (let i = 0, k = 0; i < numBlocks; i++) {
      const dat = dataCodewords.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
      k += dat.length;
      const ecc = rsRemainder(dat, divisor);
      if (i < numShortBlocks) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    const allCodewords = [];
    for (let i = 0; i < blocks[0].length; i++) {
      blocks.forEach((block, j) => {
        if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) allCodewords.push(block[i]);
      });
    }

    // ---- Matrix ----
    const size = ver * 4 + 17;
    const modules = [];
    const isFunction = [];
    for (let i = 0; i < size; i++) {
      modules.push(new Array(size).fill(false));
      isFunction.push(new Array(size).fill(false));
    }
    const setFn = (x, y, dark) => { modules[y][x] = dark; isFunction[y][x] = true; };

    // Timing patterns
    for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
    // Finder patterns
    const drawFinder = (x, y) => {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const dist = Math.max(Math.abs(dx), Math.abs(dy));
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && xx < size && yy >= 0 && yy < size) setFn(xx, yy, dist !== 2 && dist !== 4);
        }
      }
    };
    drawFinder(3, 3); drawFinder(size - 4, 3); drawFinder(3, size - 4);
    // Alignment patterns
    const alignPos = alignmentPositions(ver, size);
    const alignCenters = [];
    const na = alignPos.length;
    for (let i = 0; i < na; i++) {
      for (let j = 0; j < na; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;
        const cx = alignPos[i], cy = alignPos[j];
        alignCenters.push([cx, cy]);
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++)
            setFn(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }

    const drawFormatBits = (mask) => {
      const data = (ecl.bits << 3) | mask;
      let rem = data;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const b = ((data << 10) | rem) ^ 0x5412;
      for (let i = 0; i <= 5; i++) setFn(8, i, getBit(b, i));
      setFn(8, 7, getBit(b, 6));
      setFn(8, 8, getBit(b, 7));
      setFn(7, 8, getBit(b, 8));
      for (let i = 9; i < 15; i++) setFn(14 - i, 8, getBit(b, i));
      for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, getBit(b, i));
      for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, getBit(b, i));
      setFn(8, size - 8, true);
    };
    drawFormatBits(0);

    if (ver >= 7) {
      let rem = ver;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      const b = (ver << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const bit = getBit(b, i);
        const a = size - 11 + i % 3, c = Math.floor(i / 3);
        setFn(a, c, bit); setFn(c, a, bit);
      }
    }

    // Codewords (zig-zag)
    let bi = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vert : vert;
          if (!isFunction[y][x] && bi < allCodewords.length * 8) {
            modules[y][x] = getBit(allCodewords[bi >>> 3], 7 - (bi & 7));
            bi++;
          }
        }
      }
    }

    const maskFn = [
      (x, y) => (x + y) % 2 === 0,
      (x, y) => y % 2 === 0,
      (x) => x % 3 === 0,
      (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
      (x, y) => x * y % 2 + x * y % 3 === 0,
      (x, y) => (x * y % 2 + x * y % 3) % 2 === 0,
      (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0
    ];
    const applyMask = (m) => {
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++)
          if (!isFunction[y][x] && maskFn[m](x, y)) modules[y][x] = !modules[y][x];
    };

    const penalty = () => {
      let score = 0;
      const finderLike = (arr, i) => {
        // 1:1:3:1:1 dark pattern with 4 light modules on one side
        if (!(arr[i] && !arr[i + 1] && arr[i + 2] && arr[i + 3] && arr[i + 4] && !arr[i + 5] && arr[i + 6])) return false;
        const before = i - 4 < 0 || (!arr[i - 1] && !arr[i - 2] && !arr[i - 3] && !arr[i - 4]);
        const after = i + 10 >= arr.length || (!arr[i + 7] && !arr[i + 8] && !arr[i + 9] && !arr[i + 10]);
        return before || after;
      };
      const line = (get) => {
        const arr = [];
        for (let i = 0; i < size; i++) arr.push(get(i));
        let runColor = arr[0], run = 1;
        for (let i = 1; i <= size; i++) {
          if (i < size && arr[i] === runColor) { run++; continue; }
          if (run >= 5) score += 3 + (run - 5);
          if (i < size) { runColor = arr[i]; run = 1; }
        }
        for (let i = 0; i + 6 < size; i++) if (finderLike(arr, i)) score += 40;
      };
      for (let y = 0; y < size; y++) line((x) => modules[y][x]);
      for (let x = 0; x < size; x++) line((y) => modules[y][x]);
      let dark = 0;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const c = modules[y][x];
          if (c) dark++;
          if (x < size - 1 && y < size - 1 &&
              c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) score += 3;
        }
      }
      const total = size * size;
      score += Math.floor(Math.abs(dark * 100 / total - 50) / 5) * 10;
      return score;
    };

    let bestMask = 0, best = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(m);
      drawFormatBits(m);
      const p = penalty();
      if (p < best) { best = p; bestMask = m; }
      applyMask(m); // undo (XOR)
    }
    applyMask(bestMask);
    drawFormatBits(bestMask);

    return {
      version: ver,
      size,
      ecl: eclName in ECL ? eclName : 'H',
      mask: bestMask,
      modules,
      isFunction,
      alignCenters,
      byteLength: bytes.length,
      capacity: byteCapacity(ver, ecl),
      maxCapacity: byteCapacity(40, ecl),
      recovery: ecl.recovery
    };
  }

  global.QR = { encode, byteCapacity: (v, e) => byteCapacity(v, ECL[e]), ECL };
})(typeof window !== 'undefined' ? window : globalThis);
