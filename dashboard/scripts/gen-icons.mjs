#!/usr/bin/env node
/**
 * Generates the PWA / favicon PNGs under public/icons/ with no image tooling:
 * the glyph (a shield with radar arcs) is rasterised with supersampled coverage and
 * encoded as PNG with the built-in zlib.
 *
 *   node scripts/gen-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const BG = [0x0b, 0x10, 0x17];          // app background
const SHIELD_FILL = [0x10, 0x26, 0x1b]; // green-tinted dark
const ACCENT = [0x22, 0xc5, 0x5e];      // brand green
const DOT = [0xf0, 0xfd, 0xf4];

// ---- geometry (24-unit design box, y down) -------------------------------------------
const cubic = (p0, p1, p2, p3, n) => {
  const pts = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    pts.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]
    ]);
  }
  return pts;
};

function shieldPolygon() {
  const top = [12, 2.4];
  const right = [[12, 2.4], ...cubic([12, 2.4], [13.9, 4.0], [16.6, 5.0], [19.6, 5.0], 24), [19.6, 12.4], ...cubic([19.6, 12.4], [19.6, 17.6], [16.1, 20.6], [12, 22.1], 32)];
  const left = right.slice(0, -1).reverse().map(([x, y]) => [24 - x, y]);
  return [top, ...right.slice(1), ...left.slice(0, -1)];
}
const SHIELD = shieldPolygon();
const RADAR = { c: [12, 15.6], radii: [2.9, 5.3, 7.6], halfAngle: Math.PI / 4, width: 1.35 };
const SHIELD_STROKE = 1.55;
const DOT_R = 1.35;

const pointInPoly = (x, y, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const segDist = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  const ex = ax + t * dx - px, ey = ay + t * dy - py;
  return Math.sqrt(ex * ex + ey * ey);
};
const polyDist = (x, y, poly) => {
  let m = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) m = Math.min(m, segDist(x, y, poly[j][0], poly[j][1], poly[i][0], poly[i][1]));
  return m;
};
const arcDist = (x, y, r) => {
  const [cx, cy] = RADAR.c;
  const dx = x - cx, dy = cy - y;              // dy positive = up
  const theta = Math.atan2(dx, dy);            // 0 = straight up
  if (Math.abs(theta) <= RADAR.halfAngle) return Math.abs(Math.hypot(dx, dy) - r);
  const a = Math.sign(theta) * RADAR.halfAngle; // nearest end cap
  const ex = cx + r * Math.sin(a), ey = cy - r * Math.cos(a);
  return Math.hypot(x - ex, y - ey);
};

/** Coverage of each glyph layer at a design-space point. */
function layers(x, y) {
  const inShield = pointInPoly(x, y, SHIELD);
  const nearEdge = x > 2.5 && x < 21.5 && y > 1 && y < 23.5 ? polyDist(x, y, SHIELD) : Infinity;
  const stroke = nearEdge <= SHIELD_STROKE / 2;
  let arc = false;
  if (inShield) for (const r of RADAR.radii) if (arcDist(x, y, r) <= RADAR.width / 2) { arc = true; break; }
  const dot = Math.hypot(x - RADAR.c[0], y - RADAR.c[1]) <= DOT_R;
  return { fill: inShield, stroke, arc, dot };
}

/**
 * @param size      output px
 * @param glyph     fraction of the canvas the 24-unit design box occupies
 * @param shape     'rounded' (transparent corners) | 'full' (opaque square)
 */
function render(size, { glyph, shape, radius = 0.22 }) {
  const ss = size <= 64 ? 6 : size <= 192 ? 4 : 3;
  const px = new Uint8Array(size * size * 4);
  const box = size * glyph;
  const off = (size - box) / 2;
  const rad = radius * size;
  const inRounded = (x, y) => {
    if (shape === 'full') return true;
    const cx = Math.min(Math.max(x, rad), size - rad), cy = Math.min(Math.max(y, rad), size - rad);
    return Math.hypot(x - cx, y - cy) <= rad;
  };
  for (let py = 0; py < size; py++) {
    for (let pxl = 0; pxl < size; pxl++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const X = pxl + (sx + 0.5) / ss, Y = py + (sy + 0.5) / ss;
          if (!inRounded(X, Y)) continue;
          const dx = ((X - off) / box) * 24, dy = ((Y - off) / box) * 24;
          let c = BG;
          if (dx >= 0 && dx <= 24 && dy >= 0 && dy <= 24) {
            const l = layers(dx, dy);
            if (l.fill) c = SHIELD_FILL;
            if (l.arc || l.stroke) c = ACCENT;
            if (l.dot) c = DOT;
          }
          r += c[0]; g += c[1]; b += c[2]; a += 255;
        }
      }
      const n = ss * ss;
      const i = (py * size + pxl) * 4;
      // un-premultiply colour so partially covered corner pixels keep the right hue
      const cov = a / 255;
      px[i] = cov ? Math.round(r / cov) : 0;
      px[i + 1] = cov ? Math.round(g / cov) : 0;
      px[i + 2] = cov ? Math.round(b / cov) : 0;
      px[i + 3] = Math.round(a / n);
    }
  }
  return encodePng(size, size, px);
}

// ---- PNG encoder ----------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ---- outputs --------------------------------------------------------------------------
const TARGETS = [
  ['icon-192.png', 192, { glyph: 0.78, shape: 'rounded' }],
  ['icon-512.png', 512, { glyph: 0.78, shape: 'rounded' }],
  ['icon-maskable-512.png', 512, { glyph: 0.58, shape: 'full' }],
  ['apple-touch-icon.png', 180, { glyph: 0.7, shape: 'full' }],
  ['favicon-32.png', 32, { glyph: 1.02, shape: 'rounded', radius: 0.2 }],
  ['favicon-16.png', 16, { glyph: 1.08, shape: 'rounded', radius: 0.18 }]
];

mkdirSync(OUT, { recursive: true });
for (const [name, size, opts] of TARGETS) {
  const png = render(size, opts);
  writeFileSync(join(OUT, name), png);
  console.log(`${name.padEnd(24)} ${size}x${size}  ${png.length} bytes`);
}
