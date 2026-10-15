# 🪙 Penny Pincher

A Claude Code plugin that watches what you spend through a LiteLLM proxy (pay-as-you-go), using the proxy's own
spend bookkeeping. It is active only in sessions that run through LiteLLM (`ANTHROPIC_BASE_URL` +
`ANTHROPIC_AUTH_TOKEN`, optionally `ANTHROPIC_CUSTOM_HEADERS`); anywhere else it stays silent.

![Every skin in every mood](docs/sprites.png)

## What it does

- **Status line:** `🪙 🙂 session ~$1.20/$20.00 · today $22.81/$60.00 · month $585/$800`, refreshed after every turn and
  every 5 minutes. Session spend is the change in the key's total spend since the session started, so with parallel
  sessions on the same key, take the `~` seriously.
- **Budget guard:** a toast at 80% and 100% of each budget (plus a native notification at 100%). In `block` mode, new
  prompts are refused over budget until `/penny allow` lifts it for the day.
- **`/penny`:** monthly report with daily bars, per-model breakdown ($/MTok), cache hit rate and savings.
  `/penny 7` for the last 7 days · `/penny refresh` · `/penny panel` for the dashboard · `/penny help`.
- **Fun mode:** a mood emoji (😇 → 🙂 → 😬 → 🥵 → 🔥 → 💀), a pixel-art mascot on the dashboard whose mood follows your
  budget, quips, and what your spend would have bought (coffees, pizzas, concert tickets…).

All days are UTC days, as LiteLLM counts them.

## Savings tips

Tips arrive as toasts (ordinary ones at most every 30 minutes, urgent ones right away, each only once), in the
dashboard's Tip block, and all at once with `/penny tips`. They speak in the voice of your message pack.

- **During a session:** ⏳ an expired prompt cache (after a 5+ minute break the next turn rewrites the whole context —
  warned before you send, with an estimated price), 🐘 a fat context, 📦 huge Bash/Read outputs, 🔁 the same file read
  over and over, 🤖 subagent-heavy sessions, ✂️ how much a `/compact` saved.
- **From LiteLLM's numbers:** 📈 month-end forecast against the monthly budget, ✍️ output-token cost share,
  ⚠️ failed requests, 📅 your dearest weekday, 🧠 Opus-heavy days, 🧊 a low cache hit rate. Prices come from the proxy's
  `/model/info`.
- **🎯 Daily quest:** e.g. "keep Opus under 50% of the spend"; met on a closed day within budget, it pays +5 coins.

## Coins, ranks and the shop

Every closed (UTC) day on which you worked but stayed within the daily budget earns **coins**:
10 base + up to 10 for the share you didn't spend + a streak bonus (+2 a day, up to +10). Idle days earn nothing but
don't break the streak; a day over budget earns 0 and breaks it. A credited day is frozen, so raising the budget later
pays nothing retroactively.

Ranks: 🪙 Apprentice Saver → 🐷 Penny Pincher (50) → 🧮 Bean Counter (150) → 💼 Treasurer (350) → 🎩 Tycoon (700) →
🏰 Grand Miser (1200).

Spend the coins in Old Penny's shop:

| Skin | Price | | Message pack | Price |
|---|---|---|---|---|
| Old Penny (`miser`) | free | | Old Penny (`miser`) | free |
| Bean Counter (`accountant`) | 150 | | Grandma (`grandma`) | 60 |
| Stash Squirrel (`squirrel`) | 150 | | Bartender (`bartender`) | 60 |
| Captain Thrift (`pirate`) | 200 | | Buccaneer (`buccaneer`) | 90 |
| Hoard Dragon (`dragon`) | 300 | | The Auditor (`auditor`) | 120 |

`/penny xp` · `/penny shop` · `/penny buy <id>` (buys, then wears it) ·
`/penny skin <id>` / `/penny pack <id>` (wear something you own; never buys)

Coins are kept per machine, in the plugin's local store.

## Install

```
/plugin install penny-pincher --marketplace siposzoltan03/penny-pincher
```

Answer `y` to add the marketplace, then pick a scope. Updates: `/plugin update penny-pincher`, then `/reload-plugins`.

For local development from a clone:

```
/plugin marketplace add ~/projects/penny-pincher
/plugin install penny-pincher@penny-pincher
```

With a local folder as the marketplace, `/reload-plugins` picks up edits.

## Settings

`/config` → penny-pincher: session, daily and monthly budgets (USD, 0 = none), `warn`/`block` mode, the expensive-turn
threshold, and fun mode.

## Development

```
claude plugin validate .
claude plugin test .
claude -p "/penny" --plugin-dir .   # with the LiteLLM environment variables set
```
