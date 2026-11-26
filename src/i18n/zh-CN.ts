// Every string the plugin shows, in Simplified Chinese. The other languages (en.ts, zh-TW.ts, …)
// translate these keys; where the web site says the same thing, they use
// the web's wording, so a user reads the same terms in Zotero and on the site.
import type { Mode } from '../api/pdf.ts'

const MODE: Record<Mode, string> = { dual: '双语对照', mono: '纯译文' }

export const zhCN = {
  /** BCP 47 tag for numbers and dates */
  intl: 'zh-CN',
  brand: '椰子翻译',
  /** tag put on translations (Zotero tag selector) */
  outputTag: '椰子译文',

  /* ---------- shared ---------- */
  /** 双语对照 / 纯译文 */
  modeName: (m: Mode) => MODE[m],
  /** menu items and buttons: 双语对照版 / 纯译文版 */
  modeVersion: (m: Mode) => `${MODE[m]}版`,
  open: '打开',
  openOriginal: '打开原文',
  openTranslation: '打开译文',
  cancel: '取消',
  retry: '重试',
  close: '关闭',
  logIn: '登录',
  settings: '设置',
  gotIt: '知道了',
  /** target language, e.g. 译成简体中文 */
  translateTo: (lang: string) => `译成${lang}`,
  /** a thing and the next one in a line: a · b */
  dot: ' · ',

  /* ---------- item context menu, reader toolbar menu ---------- */
  /** the submenu's label when several items are selected */
  menuCount: (n: number) => `椰子翻译（${n} 篇）`,
  menuIsOutput: '这是椰子译文，不能再翻译',
  menuOpenSourcePdf: '打开原文 PDF',
  menuNoPdfItem: '这个条目没有 PDF 附件',
  menuNotPdf: '这不是 PDF',
  menuNoPdfAll: '选中的条目都没有可翻译的 PDF',
  /** shown right of 双语对照版 when that translation exists; clicking opens it */
  menuOpenExisting: '打开已有',

  /* ---------- why a selected item was left out ---------- */
  skipNoPdf: '没有 PDF 附件',
  skipIsOutput: '是椰子译文',
  skipNotPdf: '不是 PDF',
  skipExists: '已有译文',
  skipped: '已跳过',
  /** a row in the list of several: <reason>，已跳过 */
  skippedRow: (why: string) => `${why}，已跳过`,

  /* ---------- progress (same wording as the web's task list) ---------- */
  uploading: (pct: number) => `正在上传… ${pct}%`,
  offline: '网络断开了，恢复后自动继续',
  translating: (pct: number) => `翻译进度 ${pct}%`,
  downloading: (m: Mode) => `正在下载${MODE[m]}版…`,
  saving: '正在保存到 Zotero…',
  /** queued with nobody ahead */
  waitingToStart: '等待处理…',
  queued: (ahead: number, priority: boolean) => `${priority ? '会员优先排队中' : '排队中'}，前方还有 ${ahead} 个任务`,
  expectedWait: (wait: string) => `预计等待 ${wait}`,
  seconds: (n: number) => `${n} 秒`,
  minutes: (n: number) => `${n} 分钟`,
  hours: (n: number) => `${n} 小时`,
  hoursMinutes: (h: number, m: number) => `${h} 小时 ${m} 分钟`,

  /* ---------- progress popup ---------- */
  pleaseLogIn: '请先登录',
  loginOpened: '已在浏览器中打开椰子登录页，登录后会自动回到这里。',
  loginThenStart: '登录后自动开始翻译。',
  reopenLogin: '重新打开登录页',
  translatingPdf: (m: Mode) => `正在翻译${MODE[m]} PDF`,
  /** asked of subscribers before cancelling */
  cancelNoRefund: '取消后，已经用掉的额度不退。',
  keepTranslating: '继续翻译',
  cancelTranslation: '取消翻译',
  done: '翻译完成',
  /** the translation of a PDF without a parent item */
  addedToLibrary: (m: Mode) => `${MODE[m]} PDF 已添加到文库`,
  addedUnderItem: (m: Mode) => `${MODE[m]} PDF 已添加至原条目下`,
  showInLibrary: '在文库中显示',
  noChargeAfterRetries: (n: number) => `已重试 ${n} 次。这次失败不扣额度。`,
  noCharge: '这次失败不扣额度。',
  cancelled: '已取消',
  restart: '重新开始',
  waitingLogin: '等待登录',
  /** status of a finished row in the list */
  finished: '完成',
  /** a failed row in the list: <title>：<text> */
  failedRow: (title: string, text: string) => `${title}：${text}`,
  /** the popup opened from the toolbar with nothing running */
  nothingRunning: '没有进行中的翻译。右击条目 →「椰子翻译」即可开始。',
  /** header count while some run */
  countRunning: (n: number) => `${n} 篇进行中`,
  /** header count when none run */
  countAll: (n: number) => `${n} 篇`,
  goSubscribe: '去订阅',
  upgradePlan: '升级套餐',
  logInAgain: '重新登录',

  /* ---------- toolbar button ---------- */
  toolbarRunning: (n: number) => `椰子翻译：${n} 篇进行中`,
  toolbarFailed: '椰子翻译：有翻译失败',
  /** under the toolbar button, the first time the popup is closed while translations run */
  closeTip: '翻译在后台继续，点这里查看进度。',

  /* ---------- item pane section ---------- */
  paneNoPdf: '这个条目没有 PDF 附件。',
  /** on a translation: 这是双语对照版 · 译成简体中文 · model · time */
  paneThisIs: (m: Mode) => `这是${MODE[m]}版`,
  paneThisIsOutput: '这是椰子译文',
  /** on a translation, fetches the other mode of the same task */
  paneAlso: (m: Mode) => `也要${MODE[m]}版`,
  paneTranslate: (m: Mode) => `翻译${MODE[m]}版`,
  /** link after 译成… · model, opens the settings */
  change: '改',

  /* ---------- failures ---------- */
  cannotStart: '无法开始翻译',
  failed: '翻译失败',
  failNetwork: '暂时无法连接到翻译服务，请稍后重试。',
  failPages: (pages: string, max: number) => `文件共 ${pages} 页，超过 ${max} 页上限，请拆分后再翻译。`,
  failSize: (maxMB: number) => `文件超过 ${maxMB}MB 上限。`,
  failMissing: '本机找不到这个 PDF，可能还没从 Zotero 云端下载。先双击打开一次，再翻译。',
  failParse: '这份 PDF 无法解析，可能已损坏或设置了密码。可以用其他工具重新导出后再试。',
  /** tier: 高级模型 / 顶级模型 */
  failQuotaTitle: (tier: string) => `${tier}本期剩余额度不足`,
  failQuota: '本周期剩余额度不足以翻译完这篇，可升级套餐，或等待下个周期重置后再试。',
  failQuotaEmptyTitle: (tier: string) => `${tier}本期额度已用完`,
  failQuotaEmpty: '本周期额度已用完，可升级套餐，或等待下个周期重置。',
  failNoAccessTitle: '订阅后可用',
  failNoAccess: '免费体验额度已用完。订阅椰子 Pro / Max 后可以继续翻译。',
  failModelTitle: '需要更高套餐',
  failModel: (model: string) => `当前套餐无法使用「${model}」，升级到 Max 后即可使用。`,
  /** stands in for a model name nobody told us */
  selectedModel: '所选模型',
  failScan: '未能从文档中提取到文字。它可能是扫描件或纯图片 PDF，需要先用 OCR 工具转成可选中文字的 PDF 再翻译。',
  failUndecodable: '文档字体无法解码，提取出的文字是乱码。请尝试用其他工具重新导出这份 PDF。',
  failAlready: '这份文件已经是翻译结果了，无需重复翻译。',
  failAuth: '登录状态已失效，请重新登录后重试。',
  failUnavailable: '翻译服务暂时不可用，请稍后重试。',
  failInternal: '翻译失败，请重试；若持续失败请联系客服。',
  /** quota detail line: 14 页 · 约需 14.4万 token · 剩 3万 */
  quotaPages: (n: number) => `${n} 页`,
  quotaNeeds: (tokens: string) => `约需 ${tokens} token`,
  quotaLeft: (tokens: string) => `剩 ${tokens}`,
  tierAdvanced: '高级模型',
  tierTop: '顶级模型',

  /* ---------- WeChat login window (Simplified Chinese only, but kept in every language) ---------- */
  loginTitle: '登录椰子',
  loginScan: '扫码快速登录',
  loginOther: '其他登录方式',
  loginGoogle: '使用 Google 账号登录',
  qrReload: '重新加载二维码',
  qrLoading: '正在加载二维码…',
  qrSigningIn: '正在登录…',
  qrLoadFailed: '二维码加载失败，请检查网络。',
  qrCancelled: '已在手机上取消登录。',
  qrFailed: '登录没有成功，请重新扫码。',
  qrOffline: '暂时无法连接到椰子，请检查网络。',

  /* ---------- page the browser shows after the web login hands back to Zotero ---------- */
  backOkTitle: '登录成功',
  backOk: '可以回到 Zotero 了，翻译会自动开始。',
  backDeniedTitle: '已取消登录',
  backDenied: '可以关掉这个页面。',
  backExpiredTitle: '登录链接已失效',
  backFailedTitle: '登录没有完成',
  backAgain: '请回到 Zotero 重新点「登录」。',

  /* ---------- settings pane ---------- */
  planFree: '免费',
  memberCenter: '会员中心',
  upgradeMembership: '升级会员',
  logOut: '退出登录',
  accountID: (short: string) => `账号 ID ${short}…`,
  copyAccountID: '复制完整账号 ID',
  accountIDCopied: '账号 ID 已复制',
  unlimited: '不限量',
  usedOf: (used: string, quota: string) => `已用 ${used} / ${quota}`,
  usageTitle: '本期用量',
  /** date like 12月3日 */
  resetsIn: (days: number, date: string) => `${days} 天后重置（${date}）`,
  firstWeekNote: '首周为体验额度（约月额度的 1/4），转正后将恢复完整月额度并按月重置。',
  usageDetails: '用量明细',
  usageUnavailable: '用量暂时获取不到。',
  loginWaiting: '已打开浏览器，等待登录…',
  loginWechatCTA: '微信登录 使用全部功能',
  loginCTA: '登录 使用全部功能',
  communityTitle: '加入用户交流群',
  communityDesc: '参与产品共建，抢先体验新功能',
  communityJoin: '立即加入',
  communityQrAlt: '用户交流群二维码',
  communityQrHint: '微信扫一扫 · 添加助理进群',
  targetQuestion: '你想翻译成什么语言？',
  targetLang: '目标语言',
  modelLabel: '翻译模型',
  /** an entry of the model list; needs is Pro or Max */
  modelOption: (name: string, isDefault: boolean, maintenance: boolean, needs: string | null) =>
    `${name}${isDefault ? '（默认）' : ''}${maintenance ? ' · 维护中' : ''}${needs ? ` · 需 ${needs}` : ''}`,
  modelAfterLogin: '登录后可选',
  modelNeedsPlan: (plan: string) => `当前模型需 ${plan} 套餐`,
  modelMaintenance: '当前模型维护中，请切换其他模型',
  outputsTitle: '译文',
  autoOpen: '完成后自动打开',
  tagOutputs: (tag: string) => `给译文加标签「${tag}」`,
  version: (v: string) => `椰子翻译 ${v}`,
  privacy: '隐私说明',
}

type Widen<T> = { [K in keyof T]: T[K] extends (...args: infer A) => string ? (...args: A) => string : string }
export type Messages = Widen<typeof zhCN>
