export const HTML_NS = 'http://www.w3.org/1999/xhtml'
export const XUL_NS = 'http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul'

type Child = Node | string | null | undefined | false | Child[]
type Attrs = Record<string, string | number | boolean | null | undefined | ((e: Event) => void)>

/** Builds an HTML element in `doc` (a XUL window document needs the namespace spelled out). */
export function h(doc: Document, tag: string, attrs: Attrs = {}, ...children: Child[]): HTMLElement {
  const el = doc.createElementNS(HTML_NS, tag) as HTMLElement
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v)
    else el.setAttribute(k, v === true ? '' : String(v))
  }
  append(doc, el, children)
  return el
}

function append(doc: Document, el: Element, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue
    if (Array.isArray(c)) append(doc, el, c)
    else el.append(typeof c === 'string' ? doc.createTextNode(c) : c)
  }
}

export function xul(doc: Document, tag: string, attrs: Record<string, string> = {}): Element {
  const el = doc.createElementNS(XUL_NS, tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  return el
}
