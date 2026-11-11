#!/usr/bin/env node
/**
 * Regenerate every icon and logo from the one source SVG — or, with `--check`,
 * prove the committed copies are still what it would write.
 *
 * `docs/brand/icon.svg` is the source of truth for the app mark, and the only
 * copy of it anybody edits (CLAUDE.md, "Documentation"). The PNGs every app
 * ships (tab and home-screen icon), and the in-app logo SVGs, are exports of
 * it and must be regenerated whenever it
 * changes.
 *
 * Two kinds of export come out of the one SVG:
 *
 * - `TARGETS` — the plate and the mark together, square and full-bleed: the
 *   browser-tab and home-screen icons.
 * - `LOGO_TARGETS` — the plate and the mark as a vector, in the source's own
 *   colours, with the plate's corners rounded the way a launcher rounds the
 *   PNG: the apps' own chrome. The mark is drawn edge to edge on its plate (the
 *   sea runs off both sides), so it is never shown without it, and the one file
 *   serves light and dark themes alike.
 *
 * The SVG must keep its ground as `<rect id="plate" fill="#rrggbb" …></rect>` —
 * that is where the plate colour is read from and the element whose corners
 * the logo rounds.
 *
 * `--check` writes nothing. An SVG must match byte for byte; a PNG must have
 * the size, the alpha and — within `PIXEL_TOLERANCE` — the pixels a fresh
 * render has, because two builds of libvips need not agree on the last bit of
 * an anti-aliased edge, and a stale icon is off by far more than that.
 *
 * Usage:
 *   pnpm assets:icons              # rewrite every target that has drifted
 *   pnpm assets:icons --check      # the gate's step: exit 1 on any drift
 *
 * Requires `sharp` (a root devDependency). Run `pnpm install` first.
 */
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CHECK = process.argv.includes('--check')
/** How many exports a write run actually changed. */
let written = 0

/** The one source file; nothing below names another. */
const SOURCE = 'docs/brand/icon.svg'

/** Mean per-channel difference, out of 255, a PNG may drift under `--check`. */
const PIXEL_TOLERANCE = 1

/**
 * Every Next.js app in the repository gets the same exports, found rather than
 * listed: the open repository has only `apps/*`, and a list naming the closed
 * edition's apps would fail this script's own check there
 * (docs/tech/community-edition.md).
 */
const APP_ROOTS = ['apps', 'premium/apps']
const APPS = APP_ROOTS.flatMap((root) =>
  existsSync(resolve(repoRoot, root))
    ? readdirSync(resolve(repoRoot, root), { withFileTypes: true })
        .filter((d) => d.isDirectory() && existsSync(resolve(repoRoot, root, d.name, 'src/app')))
        .map((d) => `${root}/${d.name}`)
        .sort()
    : [],
)

/** Each target renders the source SVG to a square PNG of the given size. */
const TARGETS = APPS.flatMap((app) => [
  // The browser-tab icon (Next.js serves app/icon.png).
  { src: SOURCE, out: `${app}/src/app/icon.png`, size: 256, flatten: true },
  // The touch icon iOS uses when a page is added to a home screen (Next.js
  // serves app/apple-icon.png).
  { src: SOURCE, out: `${app}/src/app/apple-icon.png`, size: 180, flatten: true },
])

/** The in-app logos, one per app, shown as they are on either theme. */
const LOGO_TARGETS = APPS.map((app) => ({ src: SOURCE, out: `${app}/public/logo.svg` }))

/** The logo's corner radius as a share of its side: an iOS-like squircle's look. */
const LOGO_CORNER = 0.22

/**
 * The plate in the source. Matched by its id rather than by position: a loose
 * `<rect…>` regex would happily eat part of a mark that contains a rectangle,
 * and the failure would only show up as a subtly wrong icon on a device.
 */
const PLATE_ELEMENT = /<rect id="plate"[^>]*><\/rect>\s*/

/** The source, read once, with what every export needs to know about it. */
async function loadSource(src) {
  const svg = await readFile(resolve(repoRoot, src), 'utf8')
  const plate = PLATE_ELEMENT.exec(svg)?.[0]
  if (!plate) throw new Error(`${src}: no <rect id="plate" …></rect> — the exports read and round it`)
  const hex = /fill="(#[0-9a-fA-F]{6})"/.exec(plate)?.[1]
  if (!hex) throw new Error(`${src}: the plate needs a six-digit fill="#rrggbb"`)
  const declaredWidth = Number(/width="(\d+)"/.exec(svg)?.[1])
  if (!declaredWidth) throw new Error(`${src}: the root <svg> has no numeric width`)
  return {
    svg,
    plateHex: hex.toLowerCase(),
    plateColor: {
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16),
    },
    declaredWidth,
  }
}

/**
 * Rasterize an SVG at a density high enough that `size` is a downscale rather
 * than an upscale — the mark carries fine counters, and upscaling softens them.
 */
function rasterize(svg, declaredWidth, size) {
  const density = Math.max(96, Math.round((96 * size) / declaredWidth))
  return sharp(Buffer.from(svg), { density }).resize(size, size, { fit: 'fill' })
}

async function render(source, { size, flatten = false }) {
  let pipeline = rasterize(source.svg, source.declaredWidth, size)
  // The artboard is already an opaque square, so flattening only drops the
  // channel — it changes no pixel.
  if (flatten) pipeline = pipeline.flatten({ background: source.plateColor })
  return {
    data: await pipeline.png({ compressionLevel: 9 }).toBuffer(),
    note: `${size}\u00d7${size}${flatten ? ', opaque' : ''}`,
  }
}

/**
 * The logo as a vector: the whole artboard in its own colours, the plate's
 * corners rounded. The mark is clipped to the plate's rounded outline too, so
 * nothing drawn to the artboard's edge can show past a corner.
 */
async function renderLogo(source, { src }) {
  const side = source.declaredWidth
  const radius = Math.round(side * LOGO_CORNER)
  const outline = `<rect width="${side}" height="${side}" rx="${radius}"/>`
  const plate = PLATE_ELEMENT.exec(source.svg)[0].trim().replace('<rect id="plate"', `<rect id="plate" rx="${radius}"`)
  const mark = source.svg
    .replace(/<svg\b[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(PLATE_ELEMENT, '')
    .trim()
  const logo =
    `<!-- Generated from ${src} by \`pnpm assets:icons\`; edit the source, not this file. -->\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}">\n` +
    `<defs><clipPath id="logo-plate">${outline}</clipPath></defs>\n` +
    `${plate}\n<g clip-path="url(#logo-plate)">\n${mark}\n</g>\n</svg>\n`
  return { data: Buffer.from(logo), note: `vector, rounded r=${radius}` }
}

/** How far a committed PNG is from a fresh render, or why it cannot be compared. */
async function pngDrift(committed, fresh) {
  const [a, b] = await Promise.all([sharp(committed).metadata(), sharp(fresh).metadata()])
  if (a.width !== b.width || a.height !== b.height) {
    return `is ${a.width}\u00d7${a.height}, expected ${b.width}\u00d7${b.height}`
  }
  if (Boolean(a.hasAlpha) !== Boolean(b.hasAlpha)) {
    return b.hasAlpha ? 'has lost its alpha channel' : 'carries an alpha channel it must not'
  }
  const raw = (buf) => sharp(buf).ensureAlpha().raw().toBuffer()
  const [x, y] = await Promise.all([raw(committed), raw(fresh)])
  let sum = 0
  for (let i = 0; i < x.length; i += 1) sum += Math.abs(x[i] - y[i])
  const mean = sum / x.length
  return mean > PIXEL_TOLERANCE ? `differs from a fresh render (mean ${mean.toFixed(2)}/255)` : null
}

/**
 * Write one export, or under `--check` say how the committed copy differs.
 *
 * A committed copy that already passes the check is left untouched even when
 * writing: two builds of libvips can encode the same pixels as different
 * bytes, and rewriting a file whose image has not changed would churn every
 * served copy on every machine that runs this.
 */
async function emit(out, { data, note }) {
  const outPath = resolve(repoRoot, out)
  let drift = 'is missing'
  if (existsSync(outPath)) {
    const committed = await readFile(outPath)
    drift = out.endsWith('.png')
      ? await pngDrift(committed, data)
      : committed.equals(data)
        ? null
        : 'differs from what the source generates'
  }
  if (CHECK) return drift && `${out} ${drift}`
  if (!drift) {
    console.log(`  same  ${out}`)
    return null
  }
  written += 1
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, data)
  console.log(`  ok    ${out}  (${note})`)
  return null
}

async function main() {
  console.log(CHECK ? 'Checking icons against their SVG source…' : 'Generating icons from SVG sources…')
  const sources = new Map()
  const load = async (src) => {
    if (!sources.has(src)) sources.set(src, await loadSource(src))
    return sources.get(src)
  }
  const jobs = [
    ...TARGETS.map((t) => [t, render]),
    ...LOGO_TARGETS.map((t) => [t, renderLogo]),
  ]
  const problems = []
  for (const [target, renderer] of jobs) {
    // Sequential keeps the log readable; the work is trivial.
    // eslint-disable-next-line no-await-in-loop
    const problem = await emit(target.out, await renderer(await load(target.src), target))
    if (problem) problems.push(problem)
  }
  if (!CHECK) {
    console.log(`Done — ${written} of ${jobs.length} written; the rest already matched.`)
    return
  }
  if (problems.length) {
    for (const p of problems) console.error(`  \u2717  ${p}`)
    console.error(`\n${problems.length} of ${jobs.length} out of step with ${SOURCE}. Run \`pnpm assets:icons\` and commit.`)
    process.exit(1)
  }
  console.log(`Icons OK — ${jobs.length} exports match ${SOURCE}.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
