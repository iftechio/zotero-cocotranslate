// The PDF reader's toolbar: 「椰子翻译 ▾」 with the same menu as the item's context menu, or on a
// translation 「打开原文」.
import logoURL from '../../addon/content/icons/coco-32.png'
import { t } from '../i18n/index.ts'
import { isOutput, sourceOf } from '../translate/outputs.ts'
import { h, xul } from './dom.ts'
import { fillMenu, openSource } from './menu.ts'

const MARK = 'data-cocotranslate'
const CSS_ID = 'cocotranslate-reader-css'

// The reader's toolbar buttons are 28px icon squares; ours carries a label.
const CSS = `
.cocotranslate-rb.toolbar-button { width: auto; gap: 4px; padding: 0 6px; font: inherit; font-size: 12px; white-space: nowrap; color: var(--fill-primary); }
.cocotranslate-rb img { width: 16px; height: 16px; }
.cocotranslate-rb svg { color: var(--fill-secondary); }
`

const SVG_NS = 'http://www.w3.org/2000/svg'

function caret(doc: Document): Element {
  const svg = doc.createElementNS(SVG_NS, 'svg')
  for (const [k, v] of Object.entries({ width: '8', height: '8', viewBox: '0 0 8 8', 'aria-hidden': 'true' })) svg.setAttribute(k, v)
  const path = doc.createElementNS(SVG_NS, 'path')
  for (const [k, v] of Object.entries({ d: 'M1 2.5l3 3 3-3', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.2' })) path.setAttribute(k, v)
  svg.append(path)
  return svg
}

function onToolbar({ reader, doc, append }: ReaderToolbarEvent): void {
  try {
    const item = Zotero.Items.get(reader.itemID)
    if (!item || !item.isPDFAttachment()) return
    if (!doc.getElementById(CSS_ID)) doc.head.append(h(doc, 'style', { id: CSS_ID }, CSS))
    const logo = h(doc, 'img', { src: logoURL, alt: '' })
    if (isOutput(item)) {
      if (!sourceOf(item)) return
      append(h(doc, 'button', { class: 'toolbar-button cocotranslate-rb', [MARK]: true, onclick: () => openSource(item) }, logo, t.openOriginal))
      return
    }
    const button = h(
      doc,
      'button',
      { class: 'toolbar-button cocotranslate-rb', [MARK]: true, 'aria-haspopup': 'menu', onclick: () => openMenu(reader, button, item) },
      logo,
      t.brand,
      caret(doc),
    )
    append(button)
  } catch (e) {
    Zotero.logError(e)
  }
}

function openMenu(reader: ZoteroReader, button: HTMLElement, item: ZoteroItem): void {
  const chromeDoc = reader._window.document
  chromeDoc.getElementById('cocotranslate-reader-menu')?.remove()
  const popup = xul(chromeDoc, 'menupopup', { id: 'cocotranslate-reader-menu' }) as Element & {
    openPopupAtScreen(x: number, y: number, isContextMenu: boolean): void
  }
  fillMenu(popup, [item])
  popup.addEventListener('popuphidden', () => popup.remove(), { once: true })
  ;(chromeDoc.querySelector('popupset') ?? chromeDoc.documentElement).append(popup)
  // The toolbar lives in the reader's frame; place the menu under the button in screen pixels.
  const view = button.ownerDocument.defaultView as unknown as { mozInnerScreenX: number; mozInnerScreenY: number }
  const r = button.getBoundingClientRect()
  popup.openPopupAtScreen(view.mozInnerScreenX + r.left, view.mozInnerScreenY + r.bottom + 2, false)
}

export function registerReaderButton(): () => void {
  Zotero.Reader.registerEventListener('renderToolbar', onToolbar, 'cocotranslate@cocotranslate.com')
  return () => {
    Zotero.Reader.unregisterEventListener('renderToolbar', onToolbar)
    for (const reader of Zotero.Reader._readers ?? []) {
      const doc = reader._iframeWindow?.document
      doc?.querySelectorAll(`[${MARK}]`).forEach((el) => el.remove())
      doc?.getElementById(CSS_ID)?.remove()
    }
  }
}
