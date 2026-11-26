// Translated PDFs saved back into Zotero, and which attachment came from which source.
//
// The source of each translation is kept in a plugin pref keyed by library and item key. It does not
// sync between computers yet; the 椰子译文 tag and the -dual / -mono file name still mark them.
import { OUTPUT_TAGS, t } from '../i18n/index.ts'
import type { Mode } from '../api/pdf.ts'
import { pref, setPref } from '../env.ts'
import { randomToken } from '../auth/pkce.ts'
import { safeFilename } from './filename.ts'


export interface OutputMeta {
  /** `<libraryID>/<key>` of the source PDF attachment */
  src: string
  mode: Mode
  lang: string
  model: string
  taskId: string
  at: string
}

const ref = (item: ZoteroItem) => `${item.libraryID}/${item.key}`

// Parsed once per change: menus ask about every selected item.
let cache: { raw: string; all: Readonly<Record<string, OutputMeta>> } | null = null

function readAll(): Readonly<Record<string, OutputMeta>> {
  const raw = pref('outputs', '{}')
  if (cache?.raw !== raw) {
    let all: Record<string, OutputMeta> = {}
    try {
      all = JSON.parse(raw) as Record<string, OutputMeta>
    } catch {}
    cache = { raw, all }
  }
  return cache.all
}

function writeAll(all: Record<string, OutputMeta>): void {
  setPref('outputs', JSON.stringify(all))
}

export function outputMeta(item: ZoteroItem): OutputMeta | null {
  return readAll()[ref(item)] ?? null
}

export function isOutput(item: ZoteroItem): boolean {
  return outputMeta(item) !== null || item.getTags().some((tag) => OUTPUT_TAGS.has(tag.tag))
}

function byRef(key: string): ZoteroItem | null {
  const [libraryID, itemKey] = key.split('/')
  const item = Zotero.Items.getByLibraryAndKey(Number(libraryID), itemKey ?? '')
  return item && !item.deleted ? item : null
}

/** Translations of `pdf` still in the library, oldest first. */
export function outputsOf(pdf: ZoteroItem): { item: ZoteroItem; meta: OutputMeta }[] {
  const src = ref(pdf)
  const out: { item: ZoteroItem; meta: OutputMeta }[] = []
  for (const [key, meta] of Object.entries(readAll())) {
    if (meta.src !== src) continue
    const item = byRef(key)
    if (item) out.push({ item, meta })
  }
  return out.sort((a, b) => a.meta.at.localeCompare(b.meta.at))
}

/** An earlier translation of `pdf` in this mode and language that is still in the library. */
export function existingOutput(pdf: ZoteroItem, mode: Mode, lang: string): ZoteroItem | null {
  return outputsOf(pdf).findLast((o) => o.meta.mode === mode && o.meta.lang === lang)?.item ?? null
}

/**
 * The task behind a translation of `pdf` in the other mode, which already rendered this one too:
 * every task makes both. Only once per task and mode, so deleting the fetched copy and asking again
 * translates afresh.
 */
export function reusableTask(pdf: ZoteroItem, mode: Mode, lang: string, model: string): string | null {
  const all = Object.values(readAll())
  const other = outputsOf(pdf).findLast(
    (o) => o.meta.mode !== mode && o.meta.lang === lang && o.meta.model === model && o.meta.taskId,
  )
  if (!other) return null
  const taskId = other.meta.taskId
  return all.some((m) => m.taskId === taskId && m.mode === mode) ? null : taskId
}

/** The PDF a translation was made from: as recorded, else the first other PDF under the same parent. */
export function sourceOf(output: ZoteroItem): ZoteroItem | null {
  const meta = outputMeta(output)
  const recorded = meta ? byRef(meta.src) : null
  if (recorded) return recorded
  if (!output.parentItemID) return null
  const parent = Zotero.Items.get(output.parentItemID)
  if (!parent) return null
  for (const id of parent.getAttachments()) {
    const att = Zotero.Items.get(id)
    if (att && att.id !== output.id && att.isPDFAttachment() && !isOutput(att)) return att
  }
  return null
}

/** Saves the downloaded translation next to its source: a child of the same parent, or a standalone item in the same collections. */
export async function saveOutput(
  pdf: ZoteroItem,
  filename: string,
  bytes: Uint8Array,
  meta: Omit<OutputMeta, 'src' | 'at'>,
): Promise<ZoteroItem> {
  const dir = PathUtils.join(PathUtils.tempDir, `cocotranslate-${randomToken(6)}`)
  await IOUtils.makeDirectory(dir, { createAncestors: true, ignoreExisting: true })
  const name = safeFilename(filename)
  const path = PathUtils.join(dir, name)
  try {
    await IOUtils.write(path, bytes)
    const parentID = pdf.parentItemID
    const att = await Zotero.Attachments.importFromFile(
      parentID
        ? { file: path, parentItemID: parentID, title: name, contentType: 'application/pdf' }
        : { file: path, libraryID: pdf.libraryID, collections: pdf.getCollections(), title: name, contentType: 'application/pdf' },
    )
    if (pref('tagOutputs', true)) {
      att.addTag(t.outputTag)
      await att.saveTx()
    }
    writeAll({ ...readAll(), [ref(att)]: { ...meta, src: ref(pdf), at: new Date().toISOString() } })
    return att
  } finally {
    await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true })
  }
}
