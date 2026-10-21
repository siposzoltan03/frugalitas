// The /frugal report and tips as plain text, for the TUI plugin's dialogs.
import { QUEST_XP, failedTip, forecastTip, outputTip, questFor, weekdayTip } from '../hooks/advice'
import { addDays, report, streak, tips, utcDate } from '../hooks/format'
import type { Budgets, Spend } from '../hooks/format'
import { fetchActivity } from '../hooks/litellm'
import type { Activity, Conn, Day, Prices } from '../hooks/litellm'
import { tr } from '../hooks/mode'
import { voice } from '../hooks/packs'
import type { Pack } from '../hooks/packs'
import { fetchLite } from './shared'

type Common = { conn: Conn; budgets: Budgets; spend: Spend; fun: boolean; hufRate: number }

/** `days` 0 = this month, otherwise the last `days` days (1..92). */
export async function reportText(c: Common & { days: number }): Promise<string> {
  const date = utcDate(Date.now())
  const days = Math.min(92, Math.max(0, Math.floor(c.days)))
  const start = days > 0 ? addDays(date, -(days - 1)) : `${date.slice(0, 7)}-01`
  const [activity, history] = await Promise.all([
    fetchActivity(fetchLite, c.conn, start, date),
    c.budgets.daily > 0 ? fetchActivity(fetchLite, c.conn, addDays(date, -60), date) : undefined,
  ])
  return report({
    title: days > 0 ? tr(`🪙 Frugalitas – last ${days} days (${start} → ${date}, UTC)`, `🪙 Fukarléc – utolsó ${days} nap (${start} → ${date}, UTC)`) : tr(`🪙 Frugalitas – ${date.slice(0, 7)}`, `🪙 Fukarléc – ${date.slice(0, 7)}`),
    activity,
    spend: c.spend,
    budgets: c.budgets,
    todayDate: date,
    fun: c.fun,
    hufRate: c.hufRate,
    streakDays: history ? streak(history.days, date, c.budgets.daily) : 0,
  })
}

export type Advice = { tips: string[]; quest: string | null }

/** The tips and the quest line from already-fetched numbers (this month's activity, ~8 weeks of history). */
export function adviceFrom(o: {
  month: Activity
  history: readonly Day[] | undefined
  date: string
  budgets: Budgets
  priceOf: (model: string) => Prices | undefined
  fun: boolean
  pack: Pack
}): Advice {
  const today = o.month.days.find(d => d.date === o.date)
  const lastActive = today ?? o.month.days.filter(d => d.metrics.spend > 0).at(-1)
  const list = [
    ...tips(today, 0),
    forecastTip(o.month.total.spend, o.date, o.budgets.monthly),
    outputTip(lastActive, o.priceOf),
    failedTip(lastActive),
    o.history ? weekdayTip(o.history) : undefined,
  ].filter((t): t is string => t !== undefined)
  const seed = Number(o.date.slice(8))
  let quest: string | null = null
  if (o.budgets.daily > 0) {
    const q = questFor(o.date)
    const done = today ? q.done(today, o.budgets.daily) : false
    const sofar = today ? tr(` · so far ${q.progress(today)} ${done ? '✅' : '❌'}`, ` · eddig ${q.progress(today)} ${done ? '✅' : '❌'}`) : ''
    quest = tr(`🎯 Today's quest: ${q.text} (+${QUEST_XP} coins)${sofar}`, `🎯 Mai küldetés: ${q.text} (+${QUEST_XP} garas)${sofar}`)
  }
  return { tips: o.fun ? list.map((t, i) => voice(t, o.pack, seed + i)) : list, quest }
}

/** Every current savings tip and today's quest (the parts of Claude Code's advice that need no session). */
export async function tipsText(c: Common & { priceOf: (model: string) => Prices | undefined; pack: Pack }): Promise<string> {
  const date = utcDate(Date.now())
  const [month, history] = await Promise.all([
    fetchActivity(fetchLite, c.conn, `${date.slice(0, 7)}-01`, date),
    fetchActivity(fetchLite, c.conn, addDays(date, -56), date).catch(() => undefined),
  ])
  const advice = adviceFrom({ month, history: history?.days, date, budgets: c.budgets, priceOf: c.priceOf, fun: c.fun, pack: c.pack })
  const lines = [tr('🪙 Savings tips', '🪙 Megtakarítási tippek'), '']
  if (advice.tips.length === 0) lines.push(tr('Nothing to flag right now. Carry on.', 'Most nincs mit szóvá tenni. Hajrá.'))
  for (const t of advice.tips) lines.push(t, '')
  if (advice.quest) lines.push(advice.quest)
  return lines.join('\n').trimEnd()
}
