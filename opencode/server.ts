// Frugalitas budget guard for opencode: with `overBudget: "block"`, a prompt over budget is refused until
// "Frugalitas: allow prompts over budget today" (the TUI plugin's palette command) is used.
import type { Plugin } from '@opencode-ai/plugin'

import { money, ratios, SCOPE_NAMES, utcDate } from '../hooks/format'
import type { Budgets, Scope } from '../hooks/format'
import { fetchActivity, fetchPrices, priceFor } from '../hooks/litellm'
import type { Prices } from '../hooks/litellm'
import { asMode, setMode, tr } from '../hooks/mode'
import { connFromConfig, fetchLite, isAllowed, loadOptions, noteBlocked, numOption, PROVIDER } from './shared'

const SPEND_TTL_MS = 60_000

const server: Plugin = async ({ client }, entryOptions) => {
  let cfg: any
  let prices: Record<string, Prices> | undefined
  let period: { at: number; today: number; month: number } | undefined

  return {
    config: async c => {
      cfg = c
    },

    'chat.message': async (input, _output) => {
      // Read per prompt, so editing frugalitas.json takes effect without a restart.
      const options = loadOptions(entryOptions)
      if (options.overBudget !== 'block' || input.model?.providerID !== PROVIDER || isAllowed()) return
      const num = (key: string, fallback: number) => numOption(options, key, fallback)
      const budgets: Budgets = { session: num('sessionBudget', 20), daily: num('dailyBudget', 60), monthly: num('monthlyBudget', 800) }
      setMode(asMode(options.mode) ?? 'frugalitas')
      const conn = connFromConfig(cfg)
      if (!conn) return

      const now = Date.now()
      const date = utcDate(now)
      if (!period || now - period.at > SPEND_TTL_MS) {
        const a = await fetchActivity(fetchLite, conn, `${date.slice(0, 7)}-01`, date)
        period = { at: now, today: a.days.find(d => d.date === date)?.metrics.spend ?? 0, month: a.total.spend }
      }

      // Session spend: the session's assistant messages priced token by token, as the TUI plugin does.
      let session = 0
      if (budgets.session > 0) {
        prices ??= await fetchPrices(fetchLite, conn)
        const res = await client.session.messages({ path: { id: input.sessionID } })
        for (const { info } of res.data ?? []) {
          if (info.role !== 'assistant') continue
          const p = priceFor(prices, info.modelID)
          if (p) session += info.tokens.input * p.input + info.tokens.output * p.output + info.tokens.cache.read * p.cacheRead + info.tokens.cache.write * p.cacheWrite
        }
      }

      const spend = { session, today: period.today, month: period.month }
      const spentBy: Record<Scope, number> = { session: spend.session, daily: spend.today, monthly: spend.month }
      for (const [scope, ratio] of Object.entries(ratios(spend, budgets)) as [Scope, number][]) {
        if (ratio < 1) continue
        const message = tr(
          `${SCOPE_NAMES[scope]} budget used up (${money(spentBy[scope])}/${money(budgets[scope])}). Run /frugal-allow to continue today.`,
          `a(z) ${SCOPE_NAMES[scope]} keret elfogyott (${money(spentBy[scope])}/${money(budgets[scope])}). Folytatás ma: /frugal-allow.`,
        )
        // opencode shows a thrown error only as "Unexpected server error": say why in a toast, and via a file for the TUI plugin.
        noteBlocked(message)
        await client.tui.showToast({ body: { title: '🔒 Frugalitas', message, variant: 'error', duration: 15_000 } }).catch(() => {})
        throw new Error(`🔒 Frugalitas: ${message}`)
      }
    },
  }
}

export default { id: 'frugalitas.opencode.server', server }
