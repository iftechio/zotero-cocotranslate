// The plugin scope is a sandbox that Zotero builds with only some web globals (fetch, crypto,
// XMLHttpRequest, URL…). Add the others the plugin uses before any module needs them.
const scope = globalThis as unknown as Record<string, unknown>
if (typeof scope.AbortController === 'undefined') {
  ;(Components as unknown as { utils: { importGlobalProperties(names: string[]): void } }).utils.importGlobalProperties([
    'AbortController',
  ])
}
