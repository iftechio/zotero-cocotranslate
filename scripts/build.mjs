// Builds the plugin into build/addon (loaded in place by `npm start`) and, unless --dev, packs it
// for release: build/release/ mirrors the download bucket, so uploading that folder as is publishes
// the version (the versioned .xpi first, updates.json last).
//
//   node scripts/build.mjs [--dev] [--env prod|beta]     (prod by default)
//
// Installed plugins check updates.json and update themselves. Beta builds have their own, so they
// never update to a prod build or the other way round.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const dev = args.includes('--dev')
const envName = args.includes('--env') ? args[args.indexOf('--env') + 1] : 'prod'

const SITES = {
  beta: 'https://www-beta.cocotranslate.com',
  prod: 'https://cocotranslate.com',
}
if (!(envName in SITES)) throw new Error(`unknown --env ${envName}; expected ${Object.keys(SITES).join(' | ')}`)

// Where releases are downloaded from; installed plugins poll updates.json there.
const DOWNLOADS = 'https://coco-download.cocotranslate.com'
const releasePath = envName === 'prod' ? 'zotero-release' : `zotero-release/${envName}`
const ADDON_ID = 'cocotranslate@cocotranslate.com'

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const out = join(root, 'build', 'addon')

rmSync(join(root, 'build'), { recursive: true, force: true })
mkdirSync(out, { recursive: true })
cpSync(join(root, 'addon'), out, { recursive: true })

const manifestPath = join(out, 'manifest.json')
const updateURL = `${DOWNLOADS}/${releasePath}/updates.json`
writeFileSync(
  manifestPath,
  readFileSync(manifestPath, 'utf8').replace('__VERSION__', pkg.version).replace('__UPDATE_URL__', updateURL),
)

await esbuild.build({
  entryPoints: [join(root, 'src', 'index.ts')],
  outfile: join(out, 'content', 'scripts', 'index.js'),
  bundle: true,
  format: 'iife',
  // Zotero 7 runs on Firefox 115 ESR, Zotero 8+ on 140.
  target: 'firefox115',
  charset: 'utf8',
  sourcemap: dev ? 'inline' : false,
  minify: false,
  define: {
    __DEV__: JSON.stringify(dev),
    __SITE_URL__: JSON.stringify(SITES[envName]),
    __VERSION__: JSON.stringify(pkg.version),
  },
  // images the reader's frame shows: it cannot load chrome:// URLs
  loader: { '.png': 'dataurl' },
  logLevel: 'warning',
})

if (!dev) {
  const name = `cocotranslate-${pkg.version}${envName === 'prod' ? '' : `-${envName}`}.xpi`
  const dir = join(root, 'build', 'release', releasePath)
  mkdirSync(join(dir, pkg.version), { recursive: true })
  const xpi = join(dir, pkg.version, name)
  execFileSync('zip', ['-qr', '-X', xpi, '.'], { cwd: out })
  const hash = createHash('sha256').update(readFileSync(xpi)).digest('hex')
  const { strict_min_version, strict_max_version } = JSON.parse(readFileSync(manifestPath, 'utf8')).applications.zotero
  const update = {
    version: pkg.version,
    update_link: `${DOWNLOADS}/${releasePath}/${pkg.version}/${name}`,
    update_hash: `sha256:${hash}`,
    applications: { zotero: { strict_min_version, strict_max_version } },
  }
  writeFileSync(join(dir, 'updates.json'), `${JSON.stringify({ addons: { [ADDON_ID]: { updates: [update] } } }, null, 2)}\n`)
  console.log(xpi)
  console.log(join(dir, 'updates.json'))
} else {
  console.log(`${out} (dev, ${envName})`)
}
