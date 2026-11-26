// Pages of the web site opened from the plugin. When signed in, the link carries a one-time code
// (`?auth_code=`) that the site exchanges for a session of the same user, so the subscription and
// usage pages open signed in, like the Chrome extension's. Without one the page opens as usual.
import { generateAuthCode } from './api/account.ts'
import { isSignedIn } from './auth/session.ts'
import { log, webURL } from './env.ts'

export async function openWebPage(path: string): Promise<void> {
  const url = new URL(webURL(path))
  if (isSignedIn()) {
    try {
      url.searchParams.set('auth_code', (await generateAuthCode()).code)
    } catch (e) {
      log(`no auth code for ${path}: ${String(e)}`)
    }
  }
  Zotero.launchURL(url.href)
}
