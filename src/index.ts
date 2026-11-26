// Entry point, loaded by addon/bootstrap.js into the plugin's script scope.
import './globals.ts'
import { watchAccount } from './account.ts'
import { registerCallbackEndpoint, unregisterCallbackEndpoint, startLogin } from './auth/login.ts'
import { isSignedIn, loadSession, signOut } from './auth/session.ts'
import { log, webLocale } from './env.ts'
import { setLocale } from './i18n/index.ts'
import { loadPlans } from './settings.ts'
import * as jobs from './translate/jobs.ts'
import { registerItemPane } from './ui/item-pane.ts'
import { addMenu, removeMenu } from './ui/menu.ts'
import { addStyles, removeFrom, render, showPopup, watchJobs } from './ui/popup.ts'
import { openLogin } from './ui/login-dialog.ts'
import { registerReaderButton } from './ui/reader-button.ts'
import { mount, openSettings, registerSettingsPane, unmount } from './ui/settings-pane.ts'
import { addToolbarButton, removeToolbarButton, watchToolbar } from './ui/toolbar.ts'

const cleanups: (() => void)[] = []

const hooks = {
  async onStartup(): Promise<void> {
    setLocale(webLocale())
    log(`starting ${__VERSION__}${__DEV__ ? ' (dev)' : ''} in ${webLocale()}`)
    registerCallbackEndpoint()
    await loadSession()
    cleanups.push(watchJobs(), watchToolbar(), watchAccount())
    void loadPlans()
    try {
      await registerSettingsPane()
    } catch (e) {
      Zotero.logError(e)
    }
    for (const register of [registerItemPane, registerReaderButton]) {
      try {
        cleanups.push(register())
      } catch (e) {
        Zotero.logError(e)
      }
    }
    for (const win of Zotero.getMainWindows()) hooks.onMainWindowLoad(win)
    jobs.resumeSavedJobs()
    if (jobs.allJobs().length) showPopup()
  },

  onMainWindowLoad(win: Window): void {
    // the item pane section's title
    ;(win as Window & { MozXULElement: { insertFTLIfNeeded(name: string): void } }).MozXULElement.insertFTLIfNeeded('cocotranslate.ftl')
    addStyles(win)
    addMenu(win as ZoteroMainWindow)
    addToolbarButton(win)
    render()
  },

  onMainWindowUnload(win: Window): void {
    removeMenu(win as ZoteroMainWindow)
    removeToolbarButton(win)
    removeFrom(win)
  },

  onShutdown(): void {
    jobs.stopAll()
    for (const off of cleanups.splice(0)) off()
    for (const win of Zotero.getMainWindows()) hooks.onMainWindowUnload(win)
    unregisterCallbackEndpoint()
    delete Zotero.CocoTranslate
  },
}

Zotero.CocoTranslate = {
  hooks,
  // called from addon/content/settings.xhtml
  settings: { mount, unmount },
  // for Zotero's Run JavaScript window while developing
  api: { jobs, startLogin, openLogin, signOut, isSignedIn, showPopup, openSettings },
}
