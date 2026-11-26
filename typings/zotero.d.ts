// The slice of Zotero / Firefox chrome APIs this plugin uses. Hand-written instead of
// `zotero-types`, which pulls two unpinned GitHub dependencies into the install.

declare const __DEV__: boolean
declare const __SITE_URL__: string
declare const __VERSION__: string

/** Set by bootstrap.js on the plugin's script scope. */
declare const rootURI: string

interface ZoteroItem {
  id: number
  key: string
  libraryID: number
  parentItemID: number | false
  parentID: number | false
  itemType: string
  attachmentContentType: string
  attachmentFilename: string
  deleted: boolean
  isRegularItem(): boolean
  isNote(): boolean
  isAttachment(): boolean
  isPDFAttachment(): boolean
  isFileAttachment(): boolean
  getField(field: string): string
  getDisplayTitle(): string
  getAttachments(includeTrashed?: boolean): number[]
  getCollections(): number[]
  getFilePathAsync(): Promise<string | false>
  getTags(): { tag: string; type?: number }[]
  addTag(tag: string, type?: number): boolean
  setField(field: string, value: string): void
  saveTx(): Promise<unknown>
  getBestAttachments(): Promise<ZoteroItem[]>
}

interface ZoteroServerRequest {
  method: string
  pathname: string
  searchParams: URLSearchParams
  headers: Record<string, string>
  data: unknown
}

type ZoteroServerResult = number | [number, string, string]

interface ZoteroServerEndpointClass {
  new (): {
    supportedMethods?: string[]
    supportedDataTypes?: string[] | '*'
    allowRequestsFromUnsafeWebContent?: boolean
    init(request: ZoteroServerRequest): Promise<ZoteroServerResult> | ZoteroServerResult
  }
}

interface ZoteroPane {
  getSelectedItems(): ZoteroItem[]
  selectItem(itemID: number): Promise<boolean>
}

interface ZoteroMainWindow extends Window {
  ZoteroPane: ZoteroPane
}

interface ZoteroGlobal {
  CocoTranslate?: unknown
  version: string
  locale: string
  initializationPromise: Promise<void>
  debug(message: string, level?: number): void
  logError(error: unknown): void
  launchURL(url: string): void
  getMainWindow(): ZoteroMainWindow | null
  getMainWindows(): ZoteroMainWindow[]
  Prefs: {
    get(pref: string, global?: boolean): unknown
    set(pref: string, value: unknown, global?: boolean): void
    clear(pref: string, global?: boolean): void
    registerObserver(name: string, handler: (value: unknown) => void, global?: boolean): symbol
    unregisterObserver(id: symbol): void
  }
  Items: {
    get(id: number): ZoteroItem | false
    getAsync(id: number): Promise<ZoteroItem | false>
    getByLibraryAndKey(libraryID: number, key: string): ZoteroItem | false
  }
  Attachments: {
    importFromFile(options: {
      file: string
      parentItemID?: number
      libraryID?: number
      collections?: number[]
      title?: string
      contentType?: string
    }): Promise<ZoteroItem>
  }
  Libraries: {
    isEditable(libraryID: number): boolean
  }
  Reader: {
    open(itemID: number, location?: unknown, options?: { openInWindow?: boolean; allowDuplicate?: boolean }): Promise<unknown>
    registerEventListener(type: 'renderToolbar', handler: (event: ReaderToolbarEvent) => void, pluginID?: string): void
    unregisterEventListener(type: 'renderToolbar', handler: (event: ReaderToolbarEvent) => void): void
    _readers: ZoteroReader[]
  }
  PDFWorker: {
    getFullText(itemID: number, maxPages: number | null, isPriority?: boolean): Promise<{ totalPages?: number }>
  }
  ItemPaneManager: {
    registerSection(options: ItemPaneSectionOptions): string | false
    unregisterSection(paneID: string): boolean
  }
  Server: {
    Endpoints: Record<string, ZoteroServerEndpointClass>
  }
  Notifier: {
    registerObserver(
      observer: { notify(event: string, type: string, ids: (number | string)[], extraData: Record<string, unknown>): void },
      types: string[],
      id?: string,
    ): string
    unregisterObserver(id: string): void
  }
  Utilities: {
    Internal: {
      activate(win?: Window): void
      openPreferences(paneID?: string, options?: { scrollTo?: string }): Window
      copyTextToClipboard(text: string): void
    }
  }
  PreferencePanes: {
    register(options: {
      pluginID: string
      src: string
      id?: string
      label?: string
      image?: string
      scripts?: string[]
      stylesheets?: string[]
    }): Promise<string>
    unregister(id: string): void
  }
  OSKeyStore?: {
    encrypt(plain: string): Promise<string>
    decrypt(stored: string): Promise<string>
    isEncrypted(stored: string): boolean
  }
  getTempDirectory(): { path: string }
}

declare const Zotero: ZoteroGlobal

interface NsILoginInfo {
  origin: string
  httpRealm: string | null
  username: string
  password: string
}

declare const Services: {
  logins: {
    findLogins(origin: string, formActionOrigin: string | null, httpRealm: string): NsILoginInfo[]
    addLoginAsync(login: NsILoginInfo): Promise<NsILoginInfo>
    modifyLogin(oldLogin: NsILoginInfo, newLogin: NsILoginInfo): void
    removeLogin(login: NsILoginInfo): void
  }
  prompt: {
    alert(parent: Window | null, title: string, text: string): void
  }
  obs: {
    addObserver(observer: { observe(subject: XpcomObject, topic: string, data: string | null): void }, topic: string): void
    removeObserver(observer: { observe(subject: XpcomObject, topic: string, data: string | null): void }, topic: string): void
  }
  io: {
    newURI(spec: string): unknown
  }
  scriptSecurityManager: {
    getSystemPrincipal(): unknown
  }
}

interface XpcomObject {
  QueryInterface<T>(iface: unknown): T
}

interface NsIHttpChannel {
  URI: { spec: string }
  cancel(status: number): void
}

/** The XUL <browser> element, as far as the login window uses it. */
interface XulBrowser extends Element {
  loadURI(uri: unknown, options: { triggeringPrincipal: unknown }): void
  addProgressListener(listener: unknown, mask: number): void
  removeProgressListener(listener: unknown): void
}

declare const ChromeUtils: {
  generateQI(interfaces: string[]): unknown
}

declare const Components: {
  Constructor(contractID: string, iface: unknown, init: string): new (...args: unknown[]) => NsILoginInfo
  interfaces: Record<string, unknown> & { nsIWebProgressListener: Record<string, number>; nsIWebProgress: Record<string, number> }
  results: Record<string, number>
}

declare const IOUtils: {
  read(path: string): Promise<Uint8Array>
  write(path: string, data: Uint8Array): Promise<number>
  stat(path: string): Promise<{ size: number }>
  remove(path: string, options?: { ignoreAbsent?: boolean; recursive?: boolean }): Promise<void>
  makeDirectory(path: string, options?: { ignoreExisting?: boolean; createAncestors?: boolean }): Promise<void>
}

declare const PathUtils: {
  join(...parts: string[]): string
  filename(path: string): string
  tempDir: string
}

interface ZoteroReader {
  itemID: number
  /** the window the reader is in: the main window for tabs, its own for reader windows */
  _window: Window
  _iframeWindow?: Window
}

interface ReaderToolbarEvent {
  reader: ZoteroReader
  doc: Document
  append(...nodes: Node[]): void
}

interface ItemPaneSectionProps {
  paneID: string
  doc: Document
  body: HTMLDivElement
  item: ZoteroItem
  tabType: string
  editable: boolean
  setEnabled(enabled: boolean): void
  setSectionSummary(summary: string): void
}

interface ItemPaneSectionOptions {
  paneID: string
  pluginID: string
  header: { l10nID: string; icon: string; darkIcon?: string }
  sidenav: { l10nID: string; icon: string; darkIcon?: string }
  onInit?(props: ItemPaneSectionProps & { refresh(): Promise<void> }): void
  onDestroy?(props: { paneID: string; doc: Document; body: HTMLDivElement }): void
  onItemChange?(props: ItemPaneSectionProps): void
  onRender(props: ItemPaneSectionProps): void
}

/** Inlined as a data: URL by the build (scripts/build.mjs). */
declare module '*.png' {
  const url: string
  export default url
}
