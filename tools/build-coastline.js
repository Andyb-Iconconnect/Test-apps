/* -----------------------------------------------------------------------------
 * Regenerates data/world-land.js from Natural Earth coastlines.
 *
 * The board draws its chart straight onto a canvas, so it needs land polygons
 * rather than map tiles. Natural Earth 1:50m is the right scale for a display
 * that never zooms past regional context.
 *
 * Run from the repository root:
 *
 *   npm pack world-atlas@2 topojson-client
 *   tar xzf world-atlas-*.tgz                       # -> package/land-10m.json
 *   tar xzf topojson-client-*.tgz --one-top-level=tjc
 *   node tools/build-coastline.js
 *
 * Output is '|'-separated rings of delta-encoded zigzag base-64 varints, which
 * takes the payload from about 900 KB of plain coordinates down to 218 KB.
 * js/geo.js has the matching decoder.
 * -------------------------------------------------------------------------- */

const fs = require('fs');
const path = require('path');

const SOURCE = process.env.LAND_JSON || 'package/land-10m.json';
const TOPOJSON = process.env.TOPOJSON_CLIENT || 'tjc/package/dist/topojson-client.js';
const OUTPUT = path.join(__dirname, '..', 'data', 'world-land.js');

const EPS = +(process.env.EPS || 0.003);        // Douglas-Peucker tolerance, degrees
const SCALE = +(process.env.SCALE || 1000);     // coordinate quantisation (~110 m)
const MIN_AREA_DEG2 = +(process.env.MIN_AREA || 0.0003);

for (const [label, file] of [['land', SOURCE], ['topojson-client', TOPOJSON]]) {
  if (!fs.existsSync(file)) {
    console.error(`Missing ${label} input: ${file}\nSee the header of this file for the two tar commands.`);
    process.exit(1);
  }
}

const topojson = require(path.resolve(TOPOJSON));

function ringArea(c) {
  let a = 0;
  for (let i = 0, n = c.length; i < n; i++) {
    const [x1, y1] = c[i], [x2, y2] = c[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a / 2);
}

// Douglas-Peucker, iterative so a long coastline cannot blow the stack.
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    const [sx, sy] = pts[s], [ex, ey] = pts[e];
    const dx = ex - sx, dy = ey - sy, len2 = dx * dx + dy * dy;
    let best = -1, bestDist = eps;
    for (let i = s + 1; i < e; i++) {
      const [px, py] = pts[i];
      let d;
      if (len2 === 0) {
        d = Math.hypot(px - sx, py - sy);
      } else {
        let t = ((px - sx) * dx + (py - sy) * dy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        d = Math.hypot(px - (sx + t * dx), py - (sy + t * dy));
      }
      if (d > bestDist) { bestDist = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([s, best], [best, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function encodeVarint(n) {
  let zigzag = n < 0 ? -2 * n - 1 : 2 * n;
  let out = '';
  do {
    let digit = zigzag & 31;
    zigzag >>>= 5;
    if (zigzag > 0) digit |= 32;      // high bit: more to follow
    out += B64[digit];
  } while (zigzag > 0);
  return out;
}

const topo = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
const geo = topojson.feature(topo, topo.objects.land);

// A ring that crosses the antimeridian arrives with its longitudes wrapping
// from +180 to -180 mid-path. Drawn literally, that single step spans the whole
// world and paints a horizontal bar across the chart — which is exactly what
// Eurasia, Antarctica, a Russian island at 71 N and Fiji were doing. Unwrapping
// makes each ring's longitudes continuous, running past +/-180 where it has to;
// the renderer already draws the world repeatedly, so the overspill lands in the
// neighbouring copy where it belongs.
function unwrapLongitudes(ring) {
  const out = [];
  let offset = 0;
  for (let i = 0; i < ring.length; i++) {
    if (i > 0) {
      const step = ring[i][0] - ring[i - 1][0];
      if (step > 180) offset -= 360;
      else if (step < -180) offset += 360;
    }
    out.push([ring[i][0] + offset, ring[i][1]]);
  }
  return out;
}

const rings = [];
let droppedSpecks = 0;
let unwrapped = 0;
for (const feature of geo.features) {
  const polygons = feature.geometry.type === 'Polygon'
    ? [feature.geometry.coordinates]
    : feature.geometry.coordinates;

  for (const polygon of polygons) {
    for (let i = 0; i < polygon.length; i++) {
      // Ring 0 is the outline; the rest are holes. If the outline is too small
      // to see, skip the whole polygon rather than leaving orphan holes behind.
      if (i === 0 && ringArea(polygon[i]) < MIN_AREA_DEG2) { droppedSpecks++; break; }

      const raw = unwrapLongitudes(polygon[i]);
      if (raw.some(([x]) => x < -180.001 || x > 180.001)) unwrapped++;

      const points = [];
      let px = null, py = null;
      for (const [x, y] of simplify(raw, EPS)) {
        const rx = Math.round(x * SCALE), ry = Math.round(y * SCALE);
        if (rx === px && ry === py) continue;    // rounding can collapse neighbours
        points.push([rx, ry]);
        px = rx; py = ry;
      }
      if (points.length >= 4) rings.push(points);
    }
  }
}

// Largest first, so the renderer's early culling rejects the specks fastest.
rings.sort((a, b) => b.length - a.length);

const encoded = rings.map((points) => {
  let out = '', lastX = 0, lastY = 0;
  for (const [x, y] of points) {
    out += encodeVarint(x - lastX) + encodeVarint(y - lastY);
    lastX = x; lastY = y;
  }
  return out;
}).join('|');

fs.writeFileSync(OUTPUT,
`// Natural Earth 1:50m land polygons (public domain) via the world-atlas npm package.
// Generated by tools/build-coastline.js — do not edit by hand.
// Douglas-Peucker simplified at ${EPS} deg; coordinates quantised to 1/${SCALE} deg (~110 m).
// Rings are '|'-separated, delta-encoded as zigzag base-64 varints; js/geo.js decodes
// this once at startup into flat [lon,lat,...] Float64Arrays. Fill with the even-odd
// rule so interior rings (lakes, inland seas) punch through the land.
window.WORLD_LAND_ENCODED = ${JSON.stringify(encoded)};
window.WORLD_LAND_SCALE = ${SCALE};
`);

const points = rings.reduce((sum, r) => sum + r.length, 0);
console.log(`rings ${rings.length} · points ${points} · dropped specks ${droppedSpecks} · ` +
            `unwrapped ${unwrapped} · ` +
            `${Math.round(fs.statSync(OUTPUT).size / 1024)} KB -> ${path.relative(process.cwd(), OUTPUT)}`);
