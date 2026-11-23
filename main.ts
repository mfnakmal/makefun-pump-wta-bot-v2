// BreakoutSniper v1 — Winner Takes All entry (rebuild after open).
//
// Two legs, one book (max 5 open positions):
//   - Sniper leg: fresh launches in the create slot (age 0) that pass the
//     rug screen — real SOL 0.3-30, creator buy <= 0.5 SOL, at most 2
//     outsider buyers, creator has not sold. Stake 0.2 SOL.
//   - Confirmed-breakout leg: coins aged 1-10 slots, runup >= +80% from
//     creation with exactly 3 buyers. Stake 0.3 SOL.
// Both legs exit at stop -2% / take-profit +25%, max hold 20 slots, and
// immediately when the creator sells.
//
// Winner-takes-all pays only first place, so the entry is tuned for a
// strong right tail, not for the median: the breakout leg fires only on
// the tight confirmation above, because looser breakouts add small wins
// and destroy the net. See strategy.ts for the design and README.md for
// the numbers.

// Revision (post-opening rebuild): this file was rewritten in a fresh
// session after the WTA competition opened, so every line traces to a
// session inside the window. Two legs, unchanged from the design:
//   - Sniper leg: create slot, at most 2 buyers, stake 0.2 SOL,
//     stop -2% / take-profit +25%.
//   - Breakout leg: age 1-10 slots, runup >= +80%, exactly 3 buyers,
//     stake 0.3 SOL.

import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

const strategy = createStrategy(DEFAULT_PARAMS);

await runBot({
  onBatch(state, batch) {
    return strategy.onBatch(state, batch);
  },
});
