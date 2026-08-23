// Generates the extension icons (public/icons/icon{16,32,48,128}.png) without
// any image dependencies: shapes are rasterized with supersampling and encoded
// as PNGs by hand. Run with `node scripts/make-icons.mjs`.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
const SIZES = [16, 32, 48, 128];

// Design space is 128x128; every size samples the same shapes.
const BG = { x: 0, y: 0, w: 128, h: 128, r: 28, color: [23, 24, 28] };
const BASELINE = 104;
const BLUE = [61, 139, 253]; // matches --fin-you
const ORANGE = [255, 85, 0]; // matches --fin-them
const BARS = [
  { x: 23, h: 52, color: BLUE },
  { x: 43, h: 34, color: ORANGE },
  { x: 71, h: 40, color: BLUE },
  { x: 91, h: 62, color: ORANGE },
];
const BAR_W = 14;
const BAR_R = 4;

function insideRounded(u, v, x, y, w, h, r, topOnly = false) {
  if (u < x || u > x + w || v < y || v > y + h) return false;
  const cx = u < x + r ? x + r : u > x + w - r ? x + w - r : null;
  const cy = v < y + r ? y + r : !topOnly && v > y + h - r ? y + h - r : null;
  if (cx == null || cy == null) return true;
  return (u - cx) ** 2 + (v - cy) ** 2 <= r ** 2;
}

function sample(u, v) {
  if (!insideRounded(u, v, BG.x, BG.y, BG.w, BG.h, BG.r)) return undefined;
  for (const bar of BARS) {
    if (insideRounded(u, v, bar.x, BASELINE - bar.h, BAR_W, bar.h, BAR_R, true)) {
      return bar.color;
    }
  }
  return BG.color;
}

function rasterize(size) {
  const N = 4; // subsamples per axis
  const pixels = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let hits = 0;
      for (let sy = 0; sy < N; sy += 1) {
        for (let sx = 0; sx < N; sx += 1) {
          const u = ((px + (sx + 0.5) / N) * 128) / size;
          const v = ((py + (sy + 0.5) / N) * 128) / size;
          const color = sample(u, v);
          if (!color) continue;
          r += color[0];
          g += color[1];
          b += color[2];
          hits += 1;
        }
      }
      const i = (py * size + px) * 4;
      if (hits > 0) {
        pixels[i] = Math.round(r / hits);
        pixels[i + 1] = Math.round(g / hits);
        pixels[i + 2] = Math.round(b / hits);
        pixels[i + 3] = Math.round((hits / (N * N)) * 255);
      }
    }
  }
  return pixels;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = join(OUT_DIR, `icon${size}.png`);
  writeFileSync(file, encodePng(size, rasterize(size)));
  console.log(`wrote ${file}`);
}
