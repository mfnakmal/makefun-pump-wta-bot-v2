# BreakoutSniper — Winner Takes All: $5 Pump.fun Replay Sprint

[![make.fun · u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3](https://make.fun/badge/u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3.svg)](https://make.fun/bounty/u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3?utm_source=github&utm_medium=readme&utm_campaign=u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3)
[![rank](https://make.fun/badge/u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3/mfnakmal/makefun-pump-wta-bot/rank.svg)](https://make.fun/bounty/u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3)
[![reward](https://make.fun/badge/u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3/mfnakmal/makefun-pump-wta-bot/reward.svg)](https://make.fun/bounty/u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3?utm_source=github&utm_medium=readme&utm_campaign=u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3)

A launch sniper plus a confirmed-breakout leg for the make.fun pump.fun
replay competition. Winner-takes-all means only first place is paid, so
this entry is tuned for a strong right tail, not for the median.

Bounty: https://make.fun/bounty/u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3

## Strategy

Two legs, one book (max 5 open positions):

1. **Sniper leg — buy launches in the create slot (age 0)** passing a
   loosened rug filter: real SOL 0.3–30, creator bought ≤ 0.5 SOL, at
   most 2 outsider buyers, creator has not sold, no single outsider dump
   over 50% of the real reserve, outsider sells do not exceed outsider
   buys. Stake 0.2 SOL, stop −2%, take-profit +25%, max hold 20 slots,
   immediate exit if the creator sells.
2. **Breakout leg — buy confirmed runners aged 1–10 slots**: runup
   ≥ +80% from creation with **exactly 3 buyers**. Stake 0.3 SOL, same
   exits as the sniper leg. The confirmation that matters is runup
   magnitude plus holder count — raw momentum loses badly on dev (pilot
   −9.47 SOL); only the tight breakout (runup ≥ +75–81%, exactly 3
   buyers, age ≤ 10 slots) adds winners. It contributed 2 of the 3
   biggest winners here.
3. **Size — capped at 1% of the coin's real reserve** (the harness cap),
   minimum buy 0.01 SOL so every round trip counts toward the 20-coin
   minimum bar.
4. **No order splitting** (it only burns extra tx fees). No trailing stop,
   no partial take-profit, no pyramid adds on this book — all swept, all
   lose more on dev. Higher take-profits (+50%/+100%) and longer holds
   (75–150 slots) also lose and erase the coins above +0.02 SOL.

What did NOT work (swept, all lose more on dev): looser filters beyond
maxBuyers 2 (buyers 3/5 raise the tail but collapse the net to −0.10 /
−0.41 SOL), bigger stakes at age 0 (the 1% reserve cap binds — 0.1/0.2/
0.3/0.5 SOL are identical there), raw momentum (runup +5–20%, age ≤ 30:
−0.36 to −1.07 SOL), and loose-filter momentum (more small wins, zero
coins above +0.05 SOL).

Deterministic: every decision is a function of the batches seen — no
randomness, no clock, no network. Client ids come from the SDK counter.

## Results (dev window, `grade-local --driver process`)

- **Net PnL +0.1083 SOL** (+1.08%), 74 round trips / 74 distinct mints,
  148 fills, win rate 13.5%, max drawdown 0.68%.
- **Guardrails: all pass** — 74 ≥ 20 coins, drawdown 0.68% ≤ 50%.
- **Deterministic**: the two graded runs produce byte-identical action
  logs (`l1.reproduced: true`).
- 90% bootstrap interval over coins: **[−0.053, +0.299] SOL**.
- Fees: 0.0824 SOL curve fees + 0.0158 SOL tx fees; **at 2x fees net PnL
  is still +0.0097 SOL** — the only candidate that stays positive.
- Sim (`tools/sim.ts`, same window): net **+0.1055 SOL**, halves
  [+0.069/+0.037] (both positive), 72 mints.
- Per-coin: 9 winners / 72 mints. Best: +0.0755, +0.0510 (breakout leg),
  +0.0397 (breakout leg), +0.0347. 4 coins above +0.02 SOL, 2 above
  +0.05 SOL. Top 3 make 72% of the gains; without the best coin net is
  still +0.030 SOL, without the top 3 it is −0.061 SOL.
- **Stress test (`grade-local --stress 20`, all 20 known)**:
  median **−0.08 SOL**, p10 −0.25, p90 +0.02, **3/20 windows positive**,
  best +0.20 SOL, worst −0.26 SOL. Dev PnL beats 19/20 stress windows.
  Honest read: P(>0) on a fresh window is ≈ 15% — this is a
  high-variance lottery shot at #1, not a robustly profitable bot.
  The final window is only 6h (≈ 1/4 of the dev coins), so the lottery
  is even thinner there.
- Comparison on the same dev window: the v1 sniper core (−0.0457 SOL
  grade-local, 44 round trips, stress median −0.041, 5/20 positive)
  has the better stress median but a negative dev PnL, so it is not
  prize-eligible; BreakoutSniper flips the dev sign and owns the
  strongest right tail (tail sum 0.201 SOL vs 0.035 for v1).

## Layout

- `main.ts` — entrypoint.
- `strategy.ts` — the whole strategy (sniper leg + breakout leg).
- `vendor/makefun-bot.ts` — the kit SDK, vendored (excluded from authorship
  counts by the make.fun transcript gate).
- `.makefun/owner.json` — payout wallet claim.

## License

MIT — see `LICENSE`.
