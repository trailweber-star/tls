/* ------------------------------------------------------------------ *
 * A QR code, in about three hundred lines and no dependencies
 *
 * This exists for one screen: the two-factor setup panel, where a
 * person points their phone at a square instead of typing a
 * thirty-two-character secret by hand. Manual entry is kept as well —
 * it always works and some people prefer it — but a setup flow whose
 * only option is "type this string correctly" loses people, and the
 * ones it loses are the ones who then have no second factor.
 *
 * WHY NOT A LIBRARY
 *
 * The rest of this project's auth is built on node:crypto rather than
 * bcrypt and jsonwebtoken, on the principle that the security-critical
 * path should not grow dependencies that have to be watched and
 * patched. A QR encoder is not security-critical, but it is the same
 * trade in miniature: one npm package, pulled into the server that
 * issues sessions, to draw a square. The algorithm is a published
 * standard and it does not change.
 *
 * WHAT IS IMPLEMENTED
 *
 * Byte mode, error correction level M, versions 1 to 14 — up to 365
 * bytes, where the longest URI this ever encodes is under 200. Every
 * mask is scored by the standard's four penalty rules and the best one
 * wins, which is what makes the result scan reliably on a cheap camera
 * rather than merely being valid.
 *
 * Verified against a reference encoder: for the same input the module
 * produces a bit-for-bit identical matrix (see scripts/qr-test.mjs).
 * ------------------------------------------------------------------ */

/* Error correction level M: 15% recovery. L would fit more in a smaller
   square, but the square is going to be photographed off a screen at an
   angle in bad light, and that is what the extra correction is for. */
const EC_LEVEL_BITS = 0b00; // M, as it appears in the format information

/*
 * Per version: total codewords, EC codewords per block, and the block
 * layout as [count, dataCodewords] groups. Straight from the standard's
 * table; the assertion in `blockPlan` checks each row adds up, so a
 * typo here cannot quietly produce a code that will not scan.
 */
const VERSIONS = [
  /* v1  */ { total: 26, ecPerBlock: 10, groups: [[1, 16]] },
  /* v2  */ { total: 44, ecPerBlock: 16, groups: [[1, 28]] },
  /* v3  */ { total: 70, ecPerBlock: 26, groups: [[1, 44]] },
  /* v4  */ { total: 100, ecPerBlock: 18, groups: [[2, 32]] },
  /* v5  */ { total: 134, ecPerBlock: 24, groups: [[2, 43]] },
  /* v6  */ { total: 172, ecPerBlock: 16, groups: [[4, 27]] },
  /* v7  */ { total: 196, ecPerBlock: 18, groups: [[4, 31]] },
  /* v8  */ { total: 242, ecPerBlock: 22, groups: [[2, 38], [2, 39]] },
  /* v9  */ { total: 292, ecPerBlock: 22, groups: [[3, 36], [2, 37]] },
  /* v10 */ { total: 346, ecPerBlock: 26, groups: [[4, 43], [1, 44]] },
  /* v11 */ { total: 404, ecPerBlock: 30, groups: [[1, 50], [4, 51]] },
  /* v12 */ { total: 466, ecPerBlock: 22, groups: [[6, 36], [2, 37]] },
  /* v13 */ { total: 532, ecPerBlock: 22, groups: [[8, 37], [1, 38]] },
  /* v14 */ { total: 581, ecPerBlock: 24, groups: [[4, 40], [5, 41]] },
];

/** Where the alignment squares go, by version. Empty for version 1. */
const ALIGNMENT = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
  [6, 30, 54],
  [6, 32, 58],
  [6, 34, 62],
  [6, 26, 46, 66],
];

/* ------------------------------------------------------------ GF(256) */

/* The field the Reed-Solomon coding lives in, built once at load. */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d; // the primitive polynomial QR uses
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
}

const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** The generator polynomial for `degree` error-correction codewords. */
function generator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** Polynomial division; the remainder is the error correction. */
function ecCodewords(data, count) {
  const gen = generator(count);
  const remainder = new Array(count).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    for (let i = 0; i < count; i += 1) remainder[i] ^= mul(gen[i + 1], factor);
  }
  return remainder;
}

/* --------------------------------------------------------- encoding */

function blockPlan(version) {
  const spec = VERSIONS[version - 1];
  const blocks = [];
  for (const [count, dataLength] of spec.groups) {
    for (let i = 0; i < count; i += 1) blocks.push(dataLength);
  }
  const dataTotal = blocks.reduce((a, b) => a + b, 0);
  /* The standard's own arithmetic, checked rather than trusted: data
     codewords plus error-correction codewords must be exactly the
     version's capacity. A mistyped row in the table above would
     otherwise show up as a code that simply will not scan. */
  if (dataTotal + blocks.length * spec.ecPerBlock !== spec.total) {
    throw new Error(`QR version ${version} block table is inconsistent`);
  }
  return { ...spec, blocks, dataTotal };
}

/** How many bytes a version can carry in byte mode. */
function capacity(version) {
  const { dataTotal } = blockPlan(version);
  const headerBits = 4 + (version >= 10 ? 16 : 8);
  return Math.floor((dataTotal * 8 - headerBits) / 8);
}

function chooseVersion(byteLength) {
  for (let v = 1; v <= VERSIONS.length; v += 1) {
    if (capacity(v) >= byteLength) return v;
  }
  throw new Error(`${byteLength} bytes is more than this encoder handles`);
}

/** Mode indicator, length, payload, terminator, padding — as a bit list. */
function bitStream(bytes, version) {
  const plan = blockPlan(version);
  const bits = [];
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
  };

  push(0b0100, 4); // byte mode
  push(bytes.length, version >= 10 ? 16 : 8);
  for (const byte of bytes) push(byte, 8);

  const capacityBits = plan.dataTotal * 8;
  /* Up to four zero bits to say "no more data", then zeros to the next
     byte boundary. */
  for (let i = 0; i < 4 && bits.length < capacityBits; i += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  /* The standard's two alternating pad bytes fill whatever is left. */
  const pad = [0xec, 0x11];
  for (let i = 0; bits.length < capacityBits; i += 1) push(pad[i % 2], 8);

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }
  return codewords;
}

/** Split into blocks, add error correction, then interleave both. */
function finalCodewords(dataCodewords, version) {
  const plan = blockPlan(version);
  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  for (const length of plan.blocks) {
    const block = dataCodewords.slice(offset, offset + length);
    offset += length;
    dataBlocks.push(block);
    ecBlocks.push(ecCodewords(block, plan.ecPerBlock));
  }

  /* Interleaved, so that physical damage to one part of the square is
     spread across every block rather than destroying one of them. */
  const out = [];
  const longest = Math.max(...plan.blocks);
  for (let i = 0; i < longest; i += 1) {
    for (const block of dataBlocks) if (i < block.length) out.push(block[i]);
  }
  for (let i = 0; i < plan.ecPerBlock; i += 1) {
    for (const block of ecBlocks) out.push(block[i]);
  }
  return out;
}

/* ------------------------------------------------------ the matrix */

const FINDER = [
  [1, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 1, 1],
];

function blankMatrix(size) {
  return {
    size,
    /* 0 or 1 once set. */
    bits: Array.from({ length: size }, () => new Array(size).fill(0)),
    /* Modules the patterns own, which data must skip and masking must
       leave alone. */
    fixed: Array.from({ length: size }, () => new Array(size).fill(false)),
  };
}

function place(m, row, col, value) {
  m.bits[row][col] = value;
  m.fixed[row][col] = true;
}

function drawPatterns(m, version) {
  const size = m.size;

  /* Three finders, each with its separator of light modules. */
  for (const [rowBase, colBase] of [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ]) {
    for (let r = -1; r <= 7; r += 1) {
      for (let c = -1; c <= 7; c += 1) {
        const row = rowBase + r;
        const col = colBase + c;
        if (row < 0 || col < 0 || row >= size || col >= size) continue;
        const inside = r >= 0 && r < 7 && c >= 0 && c < 7;
        place(m, row, col, inside ? FINDER[r][c] : 0);
      }
    }
  }

  /* Timing: the alternating line each scanner uses to find the grid. */
  for (let i = 8; i < size - 8; i += 1) {
    const bit = i % 2 === 0 ? 1 : 0;
    place(m, 6, i, bit);
    place(m, i, 6, bit);
  }

  /* Alignment squares, except where one would sit on a finder. */
  const centres = ALIGNMENT[version - 1];
  for (const row of centres) {
    for (const col of centres) {
      const onFinder =
        (row <= 8 && col <= 8) || (row <= 8 && col >= size - 9) || (row >= size - 9 && col <= 8);
      if (onFinder) continue;
      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          const ring = Math.max(Math.abs(r), Math.abs(c));
          place(m, row + r, col + c, ring === 1 ? 0 : 1);
        }
      }
    }
  }

  /* Always dark, for no reason anybody has ever explained well. */
  place(m, size - 8, 8, 1);

  /* Reserve the format areas; the real bits go in once a mask is chosen. */
  for (let i = 0; i < 9; i += 1) {
    if (!m.fixed[8][i]) place(m, 8, i, 0);
    if (!m.fixed[i][8]) place(m, i, 8, 0);
  }
  for (let i = 0; i < 8; i += 1) {
    if (!m.fixed[8][size - 1 - i]) place(m, 8, size - 1 - i, 0);
    if (!m.fixed[size - 1 - i][8]) place(m, size - 1 - i, 8, 0);
  }

  /* Version information, from version 7 up: an 18-bit BCH word in two
     corners. */
  if (version >= 7) {
    let remainder = version;
    for (let i = 0; i < 12; i += 1) {
      remainder = (remainder << 1) ^ ((remainder >> 11) * 0x1f25);
    }
    const info = (version << 12) | remainder;
    for (let i = 0; i < 18; i += 1) {
      const bit = (info >> i) & 1;
      const a = Math.floor(i / 3);
      const b = (i % 3) + size - 11;
      place(m, a, b, bit);
      place(m, b, a, bit);
    }
  }
}

/** Data snakes up and down in two-module columns, skipping column 6. */
function placeData(m, codewords) {
  const size = m.size;
  let bitIndex = 0;
  const nextBit = () => {
    const byte = codewords[bitIndex >> 3];
    const bit = byte === undefined ? 0 : (byte >> (7 - (bitIndex & 7))) & 1;
    bitIndex += 1;
    return bit;
  };

  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // the vertical timing line is not a data column
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (m.fixed[row][col]) continue;
        m.bits[row][col] = nextBit();
      }
    }
    upward = !upward;
  }
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function applyMask(m, maskIndex) {
  const out = {
    size: m.size,
    bits: m.bits.map((row) => row.slice()),
    fixed: m.fixed,
  };
  const mask = MASKS[maskIndex];
  for (let r = 0; r < m.size; r += 1) {
    for (let c = 0; c < m.size; c += 1) {
      if (m.fixed[r][c]) continue;
      if (mask(r, c)) out.bits[r][c] ^= 1;
    }
  }
  return out;
}

function writeFormat(m, maskIndex) {
  const data = (EC_LEVEL_BITS << 3) | maskIndex;
  let remainder = data;
  for (let i = 0; i < 10; i += 1) {
    remainder = (remainder << 1) ^ ((remainder >> 9) * 0x537);
  }
  const info = (((data << 10) | remainder) ^ 0x5412) & 0x7fff;
  const size = m.size;
  const bit = (index) => (info >> index) & 1;

  /* Written twice, in two corners, so that damage to one corner does
     not make the whole code unreadable.
     Both copies run from the most significant bit to the least, and
     both are written out position by position rather than by a clever
     formula — this mapping is the one part of the standard with no
     pattern to it, and the arithmetic version of it was wrong in a way
     that produced a square which looked perfect and scanned as
     nothing. */

  // Copy one: along the top of row 8, then up column 8.
  for (let i = 0; i <= 5; i += 1) m.bits[8][i] = bit(14 - i);
  m.bits[8][7] = bit(8);
  m.bits[8][8] = bit(7);
  m.bits[7][8] = bit(6);
  for (let i = 0; i <= 5; i += 1) m.bits[5 - i][8] = bit(5 - i);

  // Copy two: up the bottom of column 8, then along the end of row 8.
  for (let i = 0; i <= 6; i += 1) m.bits[size - 1 - i][8] = bit(14 - i);
  for (let i = 0; i <= 7; i += 1) m.bits[8][size - 8 + i] = bit(7 - i);

  /* Overwrites whatever copy two would have put here. Always dark, and
     it is the standard that says so. */
  m.bits[size - 8][8] = 1;
}

/* The four penalty rules. Lower is better; they exist to steer away
   from patterns a scanner would misread — long runs, solid blocks, and
   anything that looks like a finder. */
function penalty(m) {
  const size = m.size;
  const at = (r, c) => m.bits[r][c];
  let score = 0;

  // Rule 1: runs of five or more of the same colour, each way.
  for (let i = 0; i < size; i += 1) {
    for (const read of [(j) => at(i, j), (j) => at(j, i)]) {
      let run = 1;
      for (let j = 1; j < size; j += 1) {
        if (read(j) === read(j - 1)) {
          run += 1;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else run = 1;
      }
    }
  }

  // Rule 2: every 2x2 block of one colour.
  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const v = at(r, c);
      if (v === at(r, c + 1) && v === at(r + 1, c) && v === at(r + 1, c + 1)) score += 3;
    }
  }

  /* Rule 3: the finder-like 1:1:3:1:1 run with four light modules beside
     it — the sequence a scanner uses to locate the code, appearing where
     no finder is.

     Each line is padded with four light modules at both ends before
     scanning, because the standard counts the pattern even when its
     light run falls outside the symbol: the quiet zone IS light, so a
     scanner sees the full sequence there just as clearly. Leaving the
     padding out undercounts, and the mask that gets chosen as a result
     is one with extra finder-alikes in it. */
  const A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const pad = [0, 0, 0, 0];
  for (let i = 0; i < size; i += 1) {
    const row = [...pad];
    const col = [...pad];
    for (let j = 0; j < size; j += 1) {
      row.push(at(i, j));
      col.push(at(j, i));
    }
    row.push(...pad);
    col.push(...pad);
    for (const line of [row, col]) {
      for (let j = 0; j + 11 <= line.length; j += 1) {
        let matchesA = true;
        let matchesB = true;
        for (let k = 0; k < 11; k += 1) {
          if (line[j + k] !== A[k]) matchesA = false;
          if (line[j + k] !== B[k]) matchesB = false;
        }
        if (matchesA || matchesB) score += 40;
      }
    }
  }

  // Rule 4: how far the dark/light balance is from even.
  let dark = 0;
  for (let r = 0; r < size; r += 1) for (let c = 0; c < size; c += 1) dark += at(r, c);
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

/* ------------------------------------------------------------ public */

/**
 * The finished module grid for `text`, as an array of rows of 0/1.
 * No quiet zone — `toSvg` adds it, because the margin is a property of
 * the rendering rather than of the code.
 */
export function encode(text, { mask = null } = {}) {
  const bytes = [...Buffer.from(String(text), "utf8")];
  const version = chooseVersion(bytes.length);
  const size = 17 + version * 4;

  const base = blankMatrix(size);
  drawPatterns(base, version);
  placeData(base, finalCodewords(bitStream(bytes, version), version));

  /* All eight masks are built and scored. This is the step that decides
     whether the square reads first time on a cheap phone camera. */
  let best = null;
  /* `mask` is only ever passed by the test that compares this module
     against a reference encoder mask by mask. Left to itself it scores
     all eight, which is the part that decides whether the square reads
     first time on a cheap phone camera. */
  const candidates = mask === null ? [0, 1, 2, 3, 4, 5, 6, 7] : [mask];
  for (const i of candidates) {
    const candidate = applyMask(base, i);
    writeFormat(candidate, i);
    const score = penalty(candidate);
    if (!best || score < best.score) best = { matrix: candidate, score, mask: i };
  }

  return { modules: best.matrix.bits, size, version, mask: best.mask };
}

/**
 * An SVG of the code, as a string.
 *
 * One path for every dark module rather than one rect each: a version
 * 8 code is 2,500 modules, and 2,500 elements is a page that scrolls
 * badly on a phone. The four-module quiet zone is part of the standard,
 * not decoration — a code printed hard against other content does not
 * reliably scan.
 */
export function toSvg(text, { scale = 8, margin = 4, dark = "#0f172a", light = "#ffffff" } = {}) {
  const { modules, size } = encode(text);
  const dimension = (size + margin * 2) * scale;

  let path = "";
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (!modules[r][c]) continue;
      path += `M${(c + margin) * scale} ${(r + margin) * scale}h${scale}v${scale}h-${scale}z`;
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${dimension}" height="${dimension}" ` +
    `viewBox="0 0 ${dimension} ${dimension}" shape-rendering="crispEdges" role="img" ` +
    `aria-label="QR code">` +
    `<rect width="${dimension}" height="${dimension}" fill="${light}"/>` +
    `<path d="${path}" fill="${dark}"/>` +
    `</svg>`
  );
}

/** The SVG as a data URI, ready for an <img src>. */
export function toDataUri(text, options) {
  return `data:image/svg+xml;base64,${Buffer.from(toSvg(text, options), "utf8").toString("base64")}`;
}
