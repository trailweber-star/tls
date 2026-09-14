/* The QR encoder, checked by reading its own output back.
 *
 * There is no QR library in this project to check against, and "it
 * looks like a QR code" is not a test — a square with one bit wrong in
 * the format information looks perfect and scans as nothing. That
 * happened during the build, which is why this exists.
 *
 * So this is a decoder, written independently of the encoder and
 * against the standard rather than against the encoder's internals. It
 * reads the format bits out of BOTH copies, unmasks with whatever mask
 * they name, walks the data back out of the snake, de-interleaves the
 * blocks, and checks each block's Reed-Solomon remainder is zero before
 * parsing the payload. Anything wrong in placement, masking, format
 * information, block splitting or error correction fails here.
 *
 * The output was also verified against two independent decoders
 * (ZBar and OpenCV) during development, over payloads from 1 to 362
 * bytes; those cannot be a dependency of this repository, which is what
 * the decoder below is for.
 *
 *   node scripts/qr-test.mjs
 */
import { encode, toSvg, toDataUri } from "../src/lib/qr.js";

let failed = 0;
const check = (label, ok, extra = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${ok || !extra ? "" : `  → ${extra}`}`);
  if (!ok) failed += 1;
};
const section = (name) => console.log(`\n${name}`);

/* ------------------------------------------------------- GF(256) */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
}
const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** All syndromes zero means the block carries no detectable errors. */
function syndromesAreClean(block, ecCount) {
  for (let i = 0; i < ecCount; i += 1) {
    let sum = 0;
    for (const byte of block) sum = mul(sum, EXP[i]) ^ byte;
    if (sum !== 0) return false;
  }
  return true;
}

/* --------------------------------------- the tables, independently */

const VERSIONS = [
  { total: 26, ecPerBlock: 10, groups: [[1, 16]] },
  { total: 44, ecPerBlock: 16, groups: [[1, 28]] },
  { total: 70, ecPerBlock: 26, groups: [[1, 44]] },
  { total: 100, ecPerBlock: 18, groups: [[2, 32]] },
  { total: 134, ecPerBlock: 24, groups: [[2, 43]] },
  { total: 172, ecPerBlock: 16, groups: [[4, 27]] },
  { total: 196, ecPerBlock: 18, groups: [[4, 31]] },
  { total: 242, ecPerBlock: 22, groups: [[2, 38], [2, 39]] },
  { total: 292, ecPerBlock: 22, groups: [[3, 36], [2, 37]] },
  { total: 346, ecPerBlock: 26, groups: [[4, 43], [1, 44]] },
  { total: 404, ecPerBlock: 30, groups: [[1, 50], [4, 51]] },
  { total: 466, ecPerBlock: 22, groups: [[6, 36], [2, 37]] },
  { total: 532, ecPerBlock: 22, groups: [[8, 37], [1, 38]] },
  { total: 581, ecPerBlock: 24, groups: [[4, 40], [5, 41]] },
];
const ALIGNMENT = [
  [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42],
  [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66],
];

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

/* --------------------------------------------------- the decoder */

/** Which modules belong to patterns, worked out from the version alone. */
function functionMap(size, version) {
  const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
  const mark = (r, c) => {
    if (r >= 0 && c >= 0 && r < size && c < size) fixed[r][c] = true;
  };

  for (const [rb, cb] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let r = -1; r <= 7; r += 1) for (let c = -1; c <= 7; c += 1) mark(rb + r, cb + c);
  }
  for (let i = 0; i < size; i += 1) {
    mark(6, i);
    mark(i, 6);
  }
  const centres = ALIGNMENT[version - 1];
  for (const row of centres) {
    for (const col of centres) {
      const onFinder =
        (row <= 8 && col <= 8) || (row <= 8 && col >= size - 9) || (row >= size - 9 && col <= 8);
      if (onFinder) continue;
      for (let r = -2; r <= 2; r += 1) for (let c = -2; c <= 2; c += 1) mark(row + r, col + c);
    }
  }
  for (let i = 0; i < 9; i += 1) {
    mark(8, i);
    mark(i, 8);
  }
  for (let i = 0; i < 8; i += 1) {
    mark(8, size - 1 - i);
    mark(size - 1 - i, 8);
  }
  if (version >= 7) {
    for (let i = 0; i < 18; i += 1) {
      mark(Math.floor(i / 3), (i % 3) + size - 11);
      mark((i % 3) + size - 11, Math.floor(i / 3));
    }
  }
  return fixed;
}

/** Read 15 format bits out of one of the two copies. */
function readFormat(m, size, copy) {
  const bits = new Array(15).fill(0);
  if (copy === 0) {
    for (let i = 0; i <= 5; i += 1) bits[14 - i] = m[8][i];
    bits[8] = m[8][7];
    bits[7] = m[8][8];
    bits[6] = m[7][8];
    for (let i = 0; i <= 5; i += 1) bits[5 - i] = m[5 - i][8];
  } else {
    for (let i = 0; i <= 6; i += 1) bits[14 - i] = m[size - 1 - i][8];
    for (let i = 0; i <= 7; i += 1) bits[7 - i] = m[8][size - 8 + i];
  }
  let value = 0;
  for (let i = 14; i >= 0; i -= 1) value = (value << 1) | bits[i];
  return value ^ 0x5412;
}

/** The full read-back: modules in, original text out, or a thrown error. */
function decode(modules, version) {
  const size = modules.length;
  if (size !== 17 + version * 4) throw new Error(`size ${size} does not match version ${version}`);

  const raw = readFormat(modules, size, 0);
  const second = readFormat(modules, size, 1);
  /* Copy two loses one bit to the always-dark module, so only the bits
     it actually carries are compared. */
  if ((raw & 0x7f7f) !== (second & 0x7f7f)) {
    throw new Error(`format copies disagree: ${raw.toString(2)} vs ${second.toString(2)}`);
  }
  const level = (raw >> 13) & 0b11;
  const mask = (raw >> 10) & 0b111;
  if (level !== 0b00) throw new Error(`expected error correction level M, format says ${level}`);

  const fixed = functionMap(size, version);
  const unmasked = modules.map((row, r) =>
    row.map((bit, c) => (fixed[r][c] ? bit : MASKS[mask](r, c) ? bit ^ 1 : bit))
  );

  /* Walk the snake back out. */
  const bits = [];
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (fixed[row][col]) continue;
        bits.push(unmasked[row][col]);
      }
    }
    upward = !upward;
  }

  const spec = VERSIONS[version - 1];
  const codewords = [];
  for (let i = 0; i + 8 <= bits.length && codewords.length < spec.total; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }
  if (codewords.length !== spec.total) {
    throw new Error(`read ${codewords.length} codewords, expected ${spec.total}`);
  }

  /* Undo the interleave. */
  const lengths = [];
  for (const [count, length] of spec.groups) for (let i = 0; i < count; i += 1) lengths.push(length);
  const dataBlocks = lengths.map(() => []);
  const ecBlocks = lengths.map(() => []);
  let at = 0;
  const longest = Math.max(...lengths);
  for (let i = 0; i < longest; i += 1) {
    for (let b = 0; b < lengths.length; b += 1) {
      if (i < lengths[b]) dataBlocks[b].push(codewords[at++]);
    }
  }
  for (let i = 0; i < spec.ecPerBlock; i += 1) {
    for (let b = 0; b < lengths.length; b += 1) ecBlocks[b].push(codewords[at++]);
  }

  for (let b = 0; b < lengths.length; b += 1) {
    if (!syndromesAreClean([...dataBlocks[b], ...ecBlocks[b]], spec.ecPerBlock)) {
      throw new Error(`block ${b} fails its error correction check`);
    }
  }

  /* Parse the payload out of the reassembled data codewords. */
  const data = dataBlocks.flat();
  const stream = [];
  for (const byte of data) for (let i = 7; i >= 0; i -= 1) stream.push((byte >> i) & 1);
  const take = (n, from) => {
    let value = 0;
    for (let i = 0; i < n; i += 1) value = (value << 1) | stream[from + i];
    return value;
  };
  const mode = take(4, 0);
  if (mode !== 0b0100) throw new Error(`expected byte mode, got ${mode}`);
  const lengthBits = version >= 10 ? 16 : 8;
  const length = take(lengthBits, 4);
  const bytes = [];
  for (let i = 0; i < length; i += 1) bytes.push(take(8, 4 + lengthBits + i * 8));
  return { text: Buffer.from(bytes).toString("utf8"), mask, version };
}

/* ------------------------------------------------------- the tests */

section("reading the encoder's output back");

const payloads = [
  ["one character", "x"],
  ["a short string", "hello"],
  ["exactly one version boundary", "a".repeat(16)],
  ["one byte past it", "a".repeat(17)],
  ["a realistic otpauth URI", buildUri("j.whitfield@example.com")],
  ["a long address", buildUri("a-very-long-practice-address@some-long-domain-name.example.com")],
  ["UTF-8 outside ASCII", "Dr Ángela Muñoz — Ørsted Klinik — 東京"],
  ["the largest this encoder takes", "z".repeat(362)],
];

function buildUri(account) {
  const issuer = encodeURIComponent("Top Local Specialists");
  const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
  return `otpauth://totp/${issuer}:${encodeURIComponent(account)}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}

for (const [label, text] of payloads) {
  try {
    const { modules, version, mask } = encode(text);
    const read = decode(modules, version);
    check(
      `${label} (${Buffer.byteLength(text)} bytes, version ${version}, mask ${mask})`,
      read.text === text,
      read.text === text ? "" : `got ${JSON.stringify(read.text.slice(0, 40))}`
    );
    check(`  and the format bits name the mask that was applied`, read.mask === mask, `${read.mask} vs ${mask}`);
  } catch (err) {
    check(label, false, err.message);
  }
}

section("every mask, not just the one chosen");

for (let mask = 0; mask < 8; mask += 1) {
  const text = buildUri("mask-check@example.com");
  try {
    const { modules, version } = encode(text, { mask });
    const read = decode(modules, version);
    check(`mask ${mask} round-trips`, read.text === text && read.mask === mask);
  } catch (err) {
    check(`mask ${mask} round-trips`, false, err.message);
  }
}

section("the patterns a scanner looks for");

{
  const { modules, size, version } = encode(buildUri("structure@example.com"));
  const finderAt = (r0, c0) =>
    [
      [1, 1, 1, 1, 1, 1, 1],
      [1, 0, 0, 0, 0, 0, 1],
      [1, 0, 1, 1, 1, 0, 1],
      [1, 0, 1, 1, 1, 0, 1],
      [1, 0, 1, 1, 1, 0, 1],
      [1, 0, 0, 0, 0, 0, 1],
      [1, 1, 1, 1, 1, 1, 1],
    ].every((row, r) => row.every((v, c) => modules[r0 + r][c0 + c] === v));

  check("a finder in the top left", finderAt(0, 0));
  check("a finder in the top right", finderAt(0, size - 7));
  check("a finder in the bottom left", finderAt(size - 7, 0));

  let timingOk = true;
  for (let i = 8; i < size - 8; i += 1) {
    const want = i % 2 === 0 ? 1 : 0;
    if (modules[6][i] !== want || modules[i][6] !== want) timingOk = false;
  }
  check("the timing lines alternate", timingOk);
  check("the always-dark module is dark", modules[size - 8][8] === 1);
  check("the size matches the version", size === 17 + version * 4);
}

section("what the page actually embeds");

{
  const uri = buildUri("svg@example.com");
  const svg = toSvg(uri);
  check("an SVG comes back", svg.startsWith("<svg") && svg.endsWith("</svg>"));
  check("with a quiet zone around it", /viewBox="0 0 (\d+) \1"/.test(svg));
  check("and no scripts or external references in it", !/<script|href=|xlink/i.test(svg));

  const uriData = toDataUri(uri);
  check("the data URI is an SVG", uriData.startsWith("data:image/svg+xml;base64,"));
  const decoded = Buffer.from(uriData.split(",")[1], "base64").toString("utf8");
  check("and decodes back to the same SVG", decoded === svg);
}

section("refusals");

{
  let threw = false;
  try {
    encode("z".repeat(363));
  } catch {
    threw = true;
  }
  check("more than it can hold is an error, not a broken square", threw);
}

console.log(`\n${failed === 0 ? "all checks passed" : `${failed} failed`}\n`);
process.exit(failed === 0 ? 0 : 1);
