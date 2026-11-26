// Progress wording, kept the same as the web site's task list.
import { t } from '../i18n/index.ts'

export function formatWait(seconds: number): string {
  if (seconds < 60) return t.seconds(Math.round(seconds))
  const totalMinutes = Math.ceil(seconds / 60)
  if (totalMinutes < 60) return t.minutes(totalMinutes)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes === 0 ? t.hours(hours) : t.hoursMinutes(hours, minutes)
}

export function queueText(ahead: number | undefined, waitSec: number | undefined, priority: boolean): string {
  if (!ahead || ahead <= 0) return t.waitingToStart
  const head = t.queued(ahead, priority)
  return waitSec && waitSec > 0 ? `${head}${t.dot}${t.expectedWait(formatWait(waitSec))}` : head
}
