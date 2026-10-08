#!/usr/bin/env node
/**
 * Rebuild the Android adaptive-icon layers so the artwork lands inside the
 * area the launcher mask actually shows.
 *
 * WHY
 * `tauri icon` ships a *full-bleed* foreground: the artwork covers 100% of the
 * 108dp canvas, corners included. An adaptive icon only reveals the central
 * 72dp (a circle of radius 33.3% of the canvas, or at best the 72dp square),
 * while the *guaranteed* safe region — the one no mask shape clips — is the
 * 66dp inscribed circle (radius 30.6%). Our artwork's mark reaches ~44% of the
 * canvas, so a round mask slices the leaf off the top and the ribbon's ends
 * off: the launcher showed a cropped logo.
 *
 * WHAT
 * foreground — the artwork scaled to 64% of the canvas, centred, with its rim
 *   faded out by a radial ramp (82% -> 100%) so it melts into the background
 *   instead of showing a hard square seam. A hard edge was tried first (both as
 *   a plain <inset> drawable and over flat/gradient backgrounds); every variant
 *   read as a visible square inside a round mask, which is why the ramp is
 *   required.
 * background — a diagonal gradient sampled from the artwork's own corner
 *   colours, so the faded rim lands on the same colour field. It is NOT enough
 *   to write the bitmap: `tauri icon` wires the adaptive icon to
 *   `@color/ic_launcher_background`, which its template defines as flat white
 *   (res/values/ic_launcher_background.xml) — a PNG dropped into a mipmap
 *   density dir is dead weight and the icon would sit on white. So this script
 *   also repoints
 *   `mipmap-anydpi-v26/*.xml` at `@mipmap/ic_launcher_background` and rewrites
 *   the colour resource as a fallback.
 *
 * USAGE
 *   node scripts/make-android-icons.mjs <tauri-icon-out-dir> <android-res-dir>
 *   e.g. node scripts/make-android-icons.mjs /tmp/tauri-icons \
 *          src-tauri/gen/android/app/src/main/res
 *
 * Locally, regenerate with:
 *   pnpm exec tauri icon apps/web-spa/public/icon-512.png -o /tmp/tauri-icons
 *   node scripts/make-android-icons.mjs /tmp/tauri-icons \
 *     src-tauri/gen/android/app/src/main/res
 *
 * `src-tauri/gen/android/` is not tracked (CI runs `cargo tauri android init`
 * on every build), so this has to run in CI right after the icon copy — see
 * .github/workflows/release.yml.
 *
 * The script verifies its own output, because every failure mode here is
 * silent in the artifact:
 *
 *   - the corner colour sampling must find opaque pixels, otherwise a
 *     transparent rounded corner yields #000000 and the background ships as
 *     plain black;
 *   - the mark's detail must stay inside the mask's visible circle (72dp);
 *   - the visible artwork must stay inside the safe circle (66dp);
 *   - the adaptive XML must actually reference the background this script
 *     wrote, and that background must be opaque and match the sampled field.
 */
import fs from 'node:fs';
import path from 'node:path';

const SAFE_CONTENT = 0.64; // artwork side as a fraction of the canvas
const FEATHER_FROM = 0.82; // start fading at 82% of the artwork's half-size
const DENSITIES = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];

// Canvas geometry, in dp (Android's adaptive-icon spec).
const CANVAS_DP = 108;
const VISIBLE_DP = 72; // what the mask shows
const SAFE_DP = 66; // inscribed circle: never clipped by any mask
const SAFE_RADIUS_PCT = (SAFE_DP / 2 / CANVAS_DP) * 100; // 30.6%
const VISIBLE_RADIUS_PCT = (VISIBLE_DP / 2 / CANVAS_DP) * 100; // 33.3%

// High-pass threshold for "this pixel is detail, not gradient". 20 is too low:
// the faded rim of a feathered layer trips it on resampling noise (measured),
// while the artwork's real edges sit at 100+.
const EDGE = 40;

// How many opaque pixels to average per corner when sampling the colour field.
const CORNER_SAMPLES = 64;

let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.error(
    'FATAL: the `sharp` package is required (root devDependency).\n' +
      '       Run `pnpm install` first.',
  );
  process.exit(1);
}

const [iconsArg, resArg] = process.argv.slice(2);
if (!iconsArg || !resArg) {
  console.error('usage: node scripts/make-android-icons.mjs <tauri-icon-out-dir> <android-res-dir>');
  process.exit(1);
}
// `tauri icon -o DIR` writes DIR/android/...; accept either DIR or DIR/android.
const ICONS = fs.existsSync(path.join(iconsArg, 'android')) ? path.join(iconsArg, 'android') : iconsArg;
const RES = resArg;

const featherMask = (size, from) =>
  Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">` +
      `<defs><radialGradient id="g" cx="50%" cy="50%" r="50%">` +
      `<stop offset="${from * 100}%" stop-color="#fff" stop-opacity="1"/>` +
      `<stop offset="100%" stop-color="#fff" stop-opacity="0"/>` +
      `</radialGradient></defs>` +
      `<rect width="${size}" height="${size}" fill="url(#g)"/></svg>`,
  );

const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

// NOTE: stop-color must be a hex string. Passing an RGB triple
// (`stop-color="15,114,114"`) makes librsvg paint plain black without
// complaining, and the icon ships as a black disc.
const gradientSvg = (size, { from, mid, to }) =>
  Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0%" stop-color="${hex(from)}"/>` +
      `<stop offset="50%" stop-color="${hex(mid)}"/>` +
      `<stop offset="100%" stop-color="${hex(to)}"/>` +
      `</linearGradient></defs>` +
      `<rect width="${size}" height="${size}" fill="url(#g)"/></svg>`,
  );

/**
 * Average the colour of the artwork's field next to one corner.
 *
 * Walks inwards along the diagonal and averages the first CORNER_SAMPLES
 * *opaque* pixels. Our artwork is a rounded square, so the outermost pixels are
 * transparent (RGB reads as 0) — sampling fixed coordinates there yields
 * #000000 and the background comes out black. Counting the opaque pixels also
 * gives the guard something to assert on.
 */
async function sampleCorner(art, dx, dy) {
  const { data, info } = await sharp(art)
    .resize(256, 256, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const acc = [0, 0, 0];
  let n = 0;
  for (let t = 0; t < w + h && n < CORNER_SAMPLES; t++) {
    const x = dx > 0 ? w - 1 - t : t;
    const y = dy > 0 ? h - 1 - t : t;
    if (x < 0 || y < 0 || x >= w || y >= h) break;
    const i = (y * w + x) * 4;
    if (data[i + 3] < 250) continue;
    acc[0] += data[i];
    acc[1] += data[i + 1];
    acc[2] += data[i + 2];
    n++;
  }
  return { rgb: n ? acc.map((v) => Math.round(v / n)) : [0, 0, 0], n };
}

/** Sample the artwork's four corners (the field behind the mark). */
async function sampleField(art) {
  const corners = [
    ['tl', await sampleCorner(art, 0, 0)],
    ['tr', await sampleCorner(art, 1, 0)],
    ['bl', await sampleCorner(art, 0, 1)],
    ['br', await sampleCorner(art, 1, 1)],
  ];
  const thin = corners.filter(([, c]) => c.n < CORNER_SAMPLES);
  if (thin.length) {
    console.error(
      `FATAL: only found ${thin.map(([k, c]) => `${k}=${c.n}`).join(', ')} opaque pixels at the ` +
        `artwork's corners (need ${CORNER_SAMPLES} each) — is the artwork's corner transparent?`,
    );
    process.exit(1);
  }
  const [tl, tr, bl, br] = corners.map(([, c]) => c.rgb);
  const mid = [0, 1, 2].map((c) => Math.round((tl[c] + tr[c] + bl[c] + br[c]) / 4));
  return { from: tl, mid, to: br };
}

/**
 * Two radii, as a % of the canvas:
 *
 *   mark    — how far the artwork's *detail* reaches. Measured as the distance
 *             against a heavily blurred copy of the same layer, on premultiplied
 *             luminance (premultiplication is what makes the faded rim read as
 *             "smooth" instead of as an edge).
 *   opaque  — how far the visible artwork reaches at all (alpha >= 50%).
 */
async function radiiPct(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const blurred = await sharp(file)
    .ensureAlpha()
    .blur(Math.max(1, Math.round(w * 0.03)))
    .raw()
    .toBuffer();
  const luma = (buf, i) => {
    const a = buf[i + 3] / 255;
    return (0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]) * a;
  };
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  let mark = 0;
  let opaque = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = Math.hypot(x - cx, y - cy);
      if (data[i + 3] >= 128 && r > opaque) opaque = r;
      if (Math.abs(luma(data, i) - luma(blurred, i)) >= EDGE && r > mark) mark = r;
    }
  }
  return { mark: (mark / w) * 100, opaque: (opaque / w) * 100 };
}

/** Alpha at the four corners — must be 0, i.e. the artwork must not touch them. */
async function cornerAlphas(file, px = 2) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const at = (x, y) => data[(y * w + x) * 4 + 3];
  return [at(px, px), at(w - 1 - px, px), at(px, h - 1 - px), at(w - 1 - px, h - 1 - px)];
}

/**
 * The background must be an opaque gradient running from the artwork's top-left
 * corner colour to its bottom-right one. Worth checking: an invalid SVG colour
 * (e.g. `stop-color="15,114,114"`) makes librsvg paint plain black without
 * complaining, and the icon ships as a black disc.
 */
async function checkBackground(file, { from, to }, tolerance = 20) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const at = (x, y) => {
    const i = (y * w + x) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  };
  const near = (a, b) => a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= tolerance);
  const tl = at(2, 2);
  const br = at(w - 3, h - 3);
  const mid = at(Math.floor(w / 2), Math.floor(h / 2));
  return {
    ok: at(0, 0)[3] === 255 && at(w - 1, h - 1)[3] === 255 && near(tl, from) && near(br, to),
    detail: `tl ${tl.slice(0, 3)} br ${br.slice(0, 3)} mid ${mid.slice(0, 3)}`,
  };
}

/**
 * Point the adaptive icon at the background this script wrote, and set the
 * colour resource to the same field as a fallback. Without this the layers are
 * ignored: tauri's template declares `@color/ic_launcher_background` (flat
 * #fff), so a mipmap ic_launcher_background.png is never drawn.
 */
function repointAdaptiveBackground(field) {
  const anydpi = path.join(RES, 'mipmap-anydpi-v26');
  const files = fs.existsSync(anydpi) ? fs.readdirSync(anydpi).filter((f) => f.endsWith('.xml')) : [];
  if (!files.length) {
    console.error(`FATAL: ${anydpi} has no adaptive-icon XML — did \`tauri icon\` change its output layout?`);
    process.exit(1);
  }
  for (const f of files) {
    const p = path.join(anydpi, f);
    const src = fs.readFileSync(p, 'utf8');
    const next = src.replace(
      // Global on purpose: the CLI binary also carries an
      // `<adaptive-icon>` variant with a second `<background/>`, and the
      // platform keeps the last one it parses — leaving a stale `@color/…`
      // behind would silently put the icon back on flat white.
      /<background[^>]*\/>/g,
      '<background android:drawable="@mipmap/ic_launcher_background"/>',
    );
    if (!next.includes('@mipmap/ic_launcher_background')) {
      console.error(`FATAL: could not repoint the background in ${p} — no <background .../> element?`);
      process.exit(1);
    }
    fs.writeFileSync(p, next);
    console.log(`mipmap-anydpi-v26/${f}: background -> @mipmap/ic_launcher_background`);
  }

  const colors = path.join(RES, 'values', 'ic_launcher_background.xml');
  if (fs.existsSync(colors)) {
    const src = fs.readFileSync(colors, 'utf8');
    const next = src.replace(/<color name="ic_launcher_background">[^<]*<\/color>/, `<color name="ic_launcher_background">${hex(field.mid)}</color>`);
    if (!next.includes(hex(field.mid))) {
      console.error(`FATAL: could not rewrite the colour fallback in ${colors}`);
      process.exit(1);
    }
    fs.writeFileSync(colors, next);
    console.log(`values/ic_launcher_background.xml: fallback colour -> ${hex(field.mid)}`);
  }
}

let failed = 0;
console.log(`adaptive-icon layers — artwork at ${(SAFE_CONTENT * 100).toFixed(0)}% of the canvas`);
console.log(
  `mask geometry: shows ${VISIBLE_DP}/${CANVAS_DP}dp (radius ${VISIBLE_RADIUS_PCT.toFixed(1)}% of the canvas), ` +
    `guaranteed-safe ${SAFE_DP}dp (radius ${SAFE_RADIUS_PCT.toFixed(1)}%)\n`,
);

const reference = path.join(ICONS, `mipmap-${DENSITIES[DENSITIES.length - 1]}`, 'ic_launcher_foreground.png');
if (!fs.existsSync(reference)) {
  console.error(`FATAL: ${reference} is missing — did \`tauri icon\` change its output layout?`);
  process.exit(1);
}
const field = await sampleField(reference);
console.log(`background field sampled from the artwork: ${hex(field.from)} -> ${hex(field.mid)} -> ${hex(field.to)}\n`);

for (const density of DENSITIES) {
  const src = path.join(ICONS, `mipmap-${density}`, 'ic_launcher_foreground.png');
  const dstDir = path.join(RES, `mipmap-${density}`);
  if (!fs.existsSync(src)) {
    console.error(`FATAL: ${src} is missing — did \`tauri icon\` change its output layout?`);
    failed++;
    continue;
  }
  const meta = await sharp(src).metadata();
  const size = meta.width;
  if (!size || meta.width !== meta.height) {
    console.error(`FATAL: ${src} is not a square bitmap (${meta.width}x${meta.height})`);
    failed++;
    continue;
  }

  const before = await radiiPct(src);

  const inner = Math.round(size * SAFE_CONTENT);
  const art = await sharp(src).resize(inner, inner, { fit: 'fill' }).png().toBuffer();
  const feathered = await sharp(art)
    .composite([{ input: featherMask(inner, FEATHER_FROM), blend: 'dest-in' }])
    .png()
    .toBuffer();
  const offset = Math.round((size - inner) / 2);
  fs.mkdirSync(dstDir, { recursive: true });
  const out = path.join(dstDir, 'ic_launcher_foreground.png');
  await sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: feathered, left: offset, top: offset }])
    .png()
    .toFile(out);
  const bgPath = path.join(dstDir, 'ic_launcher_background.png');
  await sharp(gradientSvg(size, field))
    .flatten({ background: hex(field.mid) })
    .png()
    .toFile(bgPath);

  const after = await radiiPct(out);
  const corners = await cornerAlphas(out);
  const cornerOk = corners.every((a) => a === 0);
  const markOk = after.mark <= VISIBLE_RADIUS_PCT;
  const opaqueOk = after.opaque <= SAFE_RADIUS_PCT;
  const bg = await checkBackground(bgPath, field);
  const ok = cornerOk && markOk && opaqueOk && bg.ok;
  if (!ok) failed++;

  console.log(
    `mipmap-${density.padEnd(7)} canvas ${String(size).padStart(3)}px · art ${String(inner).padStart(3)}px · ` +
      `detail ${before.mark.toFixed(1)}%->${after.mark.toFixed(1)}% (limit ${VISIBLE_RADIUS_PCT.toFixed(1)}%) · ` +
      `opaque ${before.opaque.toFixed(1)}%->${after.opaque.toFixed(1)}% (limit ${SAFE_RADIUS_PCT.toFixed(1)}%) · ` +
      `corners ${cornerOk ? 'clear' : 'NOT CLEAR'} · bg ${bg.ok ? 'gradient' : `WRONG (${bg.detail})`} ` +
      `${ok ? 'OK' : 'FAIL'}`,
  );
}

repointAdaptiveBackground(field);

if (failed) {
  console.error(
    `\nFATAL: ${failed} layer(s) failed the mask check — the artwork does not fit the launcher mask.\n` +
      `       Lower SAFE_CONTENT (currently ${SAFE_CONTENT}) / tighten FEATHER_FROM ` +
      `(currently ${FEATHER_FROM}), or use artwork with more padding.`,
  );
  process.exit(1);
}
console.log('\nall densities rebuilt inside the safe area');
