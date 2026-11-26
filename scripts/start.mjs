// Starts Zotero with a throwaway profile and data directory under .dev/, with build/addon
// loaded in place. Your own Zotero profile and library are never touched.
//
//   node scripts/start.mjs            (re)start Zotero with the dev profile
//   node scripts/start.mjs --stop     stop it
//
// ZOTERO_BIN overrides the Zotero executable (default: /Applications/Zotero.app). On Linux,
// run it under scripts/headless.sh, which provides the X display.
// ZOTERO_DARK=1 asks for the dark theme, ZOTERO_LOCALE for an interface language, ZOTERO_PORT for
// another local-server port (to run beside your everyday Zotero).
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, openSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ADDON_ID = 'cocotranslate@cocotranslate.com'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const devDir = join(root, '.dev')
const profile = join(devDir, 'profile')
const dataDir = join(devDir, 'data')
const zoteroBin = process.env.ZOTERO_BIN || '/Applications/Zotero.app/Contents/MacOS/zotero'

function runningPids() {
  try {
    const ps = execFileSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' })
    return ps
      .split('\n')
      .filter((line) => line.includes(zoteroBin) && line.includes(profile))
      .map((line) => Number(line.trim().split(/\s+/)[0]))
  } catch {
    return []
  }
}

async function stop() {
  const pids = runningPids()
  for (const pid of pids) process.kill(pid, 'SIGTERM')
  for (let i = 0; i < 50 && runningPids().length; i++) await new Promise((r) => setTimeout(r, 200))
  for (const pid of runningPids()) process.kill(pid, 'SIGKILL')
}

await stop()
if (process.argv.includes('--stop')) process.exit(0)

if (!existsSync(join(root, 'build', 'addon', 'manifest.json'))) {
  console.error('build/addon is missing; run `npm run build:dev` first')
  process.exit(1)
}

mkdirSync(join(profile, 'extensions'), { recursive: true })
mkdirSync(dataDir, { recursive: true })

// A proxy file points Zotero at the unpacked build instead of an installed .xpi.
writeFileSync(join(profile, 'extensions', ADDON_ID), join(root, 'build', 'addon') + '/')

const prefs = {
  // load the proxied add-on without asking, and rescan on every start
  'extensions.autoDisableScopes': 0,
  'extensions.enabledScopes': 15,
  'extensions.startupScanScopes': 15,
  'xpinstall.signatures.required': false,
  'app.update.enabled': false,
  'app.update.auto': false,
  // the interface language, which also picks the plugin's (ZOTERO_LOCALE=en-US, ja-JP, …)
  'intl.locale.requested': process.env.ZOTERO_LOCALE || 'zh-CN',
  // ZOTERO_PORT runs beside an everyday Zotero, which holds the default 23119
  ...(process.env.ZOTERO_PORT ? { 'extensions.zotero.httpServer.port': Number(process.env.ZOTERO_PORT) } : {}),
  'extensions.zotero.dataDir': dataDir,
  ...(process.env.ZOTERO_DARK ? { 'ui.systemUsesDarkTheme': 1 } : {}),
  // Without a compositor (Xvfb) translucent menus come out black.
  ...(process.platform === 'linux' ? { 'mozilla.widget.use-argb-visuals': false } : {}),
  'extensions.zotero.useDataDir': true,
  'extensions.zotero.firstRun2': false,
  'extensions.zotero.firstRunGuidance': false,
  'extensions.zotero.sync.autoSync': false,
  'extensions.zotero.automaticScraperUpdates': false,
  'extensions.zotero.reportTranslationFailure': false,
  // add-on manager and chrome console messages go to .dev/zotero.log too
  'extensions.logging.enabled': true,
  'devtools.console.stdout.chrome': true,
}
writeFileSync(
  join(profile, 'user.js'),
  Object.entries(prefs)
    .map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`)
    .join('\n') + '\n',
)
// Forget the add-on database so the proxy file is picked up even when the build moved.
for (const f of ['extensions.json', 'addonStartup.json.lz4', 'startupCache']) {
  rmSync(join(profile, f), { recursive: true, force: true })
}

const log = openSync(join(devDir, 'zotero.log'), 'w')
const child = spawn(zoteroBin, ['-profile', profile, '-no-remote', '-purgecaches', '-ZoteroDebugText'], {
  detached: true,
  stdio: ['ignore', log, log],
})
child.unref()
console.log(`Zotero started (pid ${child.pid}); profile ${profile}; log .dev/zotero.log`)
