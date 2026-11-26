// Publishes the release built by `node scripts/build.mjs --env prod|beta` to the coco-download R2
// bucket, which serves https://coco-download.cocotranslate.com.
//
//   CLOUDFLARE_ACCOUNT_ID=<account> node scripts/publish.mjs [--env prod|beta]
//
// Needs a logged-in wrangler (`wrangler login`); WRANGLER overrides the path to it. Steps: refuse if
// this version is already up; upload the .xpi; download it from the public URL and compare hashes;
// only then upload updates.json, which installed plugins poll, and check it the same way.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const BUCKET = 'coco-download'
const PUBLIC = 'https://coco-download.cocotranslate.com'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const envName = args.includes('--env') ? args[args.indexOf('--env') + 1] : 'prod'
const prefix = envName === 'prod' ? 'zotero-release' : `zotero-release/${envName}`
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const name = `cocotranslate-${version}${envName === 'prod' ? '' : `-${envName}`}.xpi`
const dir = join(root, 'build', 'release', prefix)
const xpiPath = join(dir, version, name)
const updatesPath = join(dir, 'updates.json')
const wrangler = process.env.WRANGLER || 'wrangler'
if (!process.env.CLOUDFLARE_ACCOUNT_ID) throw new Error('set CLOUDFLARE_ACCOUNT_ID to the account that owns the bucket')

for (const f of [xpiPath, updatesPath]) {
  if (!existsSync(f)) throw new Error(`missing ${f}`)
}
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const xpiHash = sha256(readFileSync(xpiPath))
if (!readFileSync(updatesPath, 'utf8').includes(`sha256:${xpiHash}`)) {
  throw new Error('updates.json does not describe this .xpi; rebuild')
}

const r2 = (...a) =>
  execFileSync(wrangler, ['r2', 'object', ...a, '--remote'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
// wrangler's fetch sometimes drops the TLS handshake; retry those.
function put(key, file, contentType, cacheControl) {
  for (let i = 1; ; i++) {
    try {
      r2('put', `${BUCKET}/${key}`, '--file', file, '--content-type', contentType, '--cache-control', cacheControl)
      return
    } catch (e) {
      if (i === 3) throw e
    }
  }
}
function exists(key) {
  try {
    r2('get', `${BUCKET}/${key}`, '--pipe')
    return true
  } catch (e) {
    if (String(e.stderr).includes('does not exist')) return false
    throw e
  }
}
async function publicCopy(key) {
  const res = await fetch(`${PUBLIC}/${key}?t=${Date.now()}`)
  if (!res.ok) throw new Error(`${PUBLIC}/${key}: HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

const xpiKey = `${prefix}/${version}/${name}`
if (exists(xpiKey)) throw new Error(`${xpiKey} is already published; bump the version`)

put(xpiKey, xpiPath, 'application/x-xpinstall', 'public, max-age=31536000, immutable')
if (sha256(await publicCopy(xpiKey)) !== xpiHash) throw new Error(`${PUBLIC}/${xpiKey} differs from the build`)
console.log(`${PUBLIC}/${xpiKey}`)

const updatesKey = `${prefix}/updates.json`
put(updatesKey, updatesPath, 'application/json', 'no-cache, max-age=0')
if (!(await publicCopy(updatesKey)).equals(readFileSync(updatesPath))) {
  throw new Error(`${PUBLIC}/${updatesKey} differs from the build`)
}
console.log(`${PUBLIC}/${updatesKey}`)
