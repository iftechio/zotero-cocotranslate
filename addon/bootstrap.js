/* global Zotero, Services, Components, APP_SHUTDOWN */
/* Zotero 7+ bootstrap entry. The plugin code lives in content/scripts/index.js and installs
   itself as Zotero.CocoTranslate. Pattern from https://www.zotero.org/support/dev/zotero_7_for_developers */

var chromeHandle;

function install() {}

async function startup({ rootURI }) {
  await Zotero.initializationPromise;

  const aomStartup = Components.classes['@mozilla.org/addons/addon-manager-startup;1'].getService(
    Components.interfaces.amIAddonManagerStartup,
  );
  const manifestURI = Services.io.newURI(rootURI + 'manifest.json');
  chromeHandle = aomStartup.registerChrome(manifestURI, [['content', 'cocotranslate', rootURI + 'content/']]);

  const ctx = { rootURI };
  ctx._globalThis = ctx;
  Services.scriptloader.loadSubScript(`${rootURI}content/scripts/index.js`, ctx);
  await Zotero.CocoTranslate.hooks.onStartup();
}

async function onMainWindowLoad({ window }) {
  Zotero.CocoTranslate?.hooks.onMainWindowLoad(window);
}

async function onMainWindowUnload({ window }) {
  Zotero.CocoTranslate?.hooks.onMainWindowUnload(window);
}

function shutdown(_data, reason) {
  if (reason === APP_SHUTDOWN) return;
  Zotero.CocoTranslate?.hooks.onShutdown();
  // index.js was loaded with loadSubScript, so there is no module to unload. (Cu.unload no longer
  // exists in Zotero 10; calling it threw here and left the old chrome:// registration behind.)
  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
}

function uninstall() {}
