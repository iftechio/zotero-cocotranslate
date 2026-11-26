// The 椰子 button in the items toolbar: the way back to a closed popup. Its badge counts the
// translations running, or shows ! for a failure nobody has seen. The first time someone closes the
// popup while translations run, a tip under the button says where they went.
import { pref, setPref } from '../env.ts'
import { t } from '../i18n/index.ts'
import { h, xul } from './dom.ts'
import { onPopupClose, onPopupRender, popupSummary, togglePopup } from './popup.ts'

const ID = 'cocotranslate-tb'
const TIP_ID = 'cocotranslate-tip'
const TIP_MS = 9000

function update(btn: Element): void {
  const { running, unseenFailure } = popupSummary()
  const tip = running ? t.toolbarRunning(running) : unseenFailure ? t.toolbarFailed : t.brand
  btn.setAttribute('tooltiptext', tip)
  btn.setAttribute('aria-label', tip)
  btn.setAttribute('badge', running ? String(running) : unseenFailure ? '!' : '')
  btn.toggleAttribute('data-failed', !running && unseenFailure)
}

function updateAll(): void {
  for (const win of Zotero.getMainWindows()) {
    const btn = win.document.getElementById(ID)
    if (btn) update(btn)
  }
}

function removeTip(doc: Document): void {
  doc.getElementById(TIP_ID)?.remove()
}

function showTip(win: Window): void {
  const doc = win.document
  const btn = doc.getElementById(ID)
  const rect = btn?.getBoundingClientRect()
  if (!rect || rect.width === 0) return
  removeTip(doc)
  const tip = h(
    doc,
    'div',
    { id: TIP_ID, role: 'status', style: `left:${Math.max(8, rect.left - 10)}px;top:${rect.bottom + 8}px` },
    t.closeTip,
    h(doc, 'button', { onclick: () => tip.remove() }, t.gotIt),
  )
  doc.documentElement.append(tip)
  setTimeout(() => tip.remove(), TIP_MS)
}

export function addToolbarButton(win: Window): void {
  const doc = win.document
  const bar = doc.getElementById('zotero-items-toolbar')
  if (!bar || doc.getElementById(ID)) return
  // badged must be there before the button is inserted: the element picks its markup then
  const btn = xul(doc, 'toolbarbutton', {
    id: ID,
    class: 'zotero-tb-button',
    badged: 'true',
    tabindex: '-1',
    image: 'chrome://cocotranslate/content/icons/coco-32.png',
  })
  btn.addEventListener('command', () => {
    removeTip(doc)
    togglePopup()
  })
  const after = doc.getElementById('zotero-tb-note-add')
  if (after) after.after(btn)
  else bar.append(btn)
  update(btn)
}

export function removeToolbarButton(win: Window): void {
  win.document.getElementById(ID)?.remove()
  removeTip(win.document)
}

export function watchToolbar(): () => void {
  const offRender = onPopupRender(updateAll)
  const offClose = onPopupClose((byUser, running) => {
    if (!byUser || !running || pref('closeTipShown', false)) return
    const win = Zotero.getMainWindow()
    if (!win) return
    setPref('closeTipShown', true)
    showTip(win)
  })
  return () => {
    offRender()
    offClose()
  }
}
