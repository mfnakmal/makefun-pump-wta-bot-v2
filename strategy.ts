// BreakoutSniper v1 — launch sniper + confirmed-breakout leg (rebuild).
//
// The book holds at most five open positions and earns its edge from two
// entry legs that share one exit rule set:
//
//   Sniper leg   — a fresh launch in its create slot (age 0) that passes
//                   the rug screen: real SOL between 0.3 and 30, creator
//                   buy at most 0.5 SOL, at most 2 outsider buyers, the
//                   creator has not sold, and no single outsider sale
//                   above 50% of the real reserve. Stake 0.2 SOL.
//   Breakout leg — a coin aged 1-10 slots that has already run up at
//                   least +80% from creation with EXACTLY 3 buyers. That
//                   combination (runup size plus holder count) is the
//                   confirmed-runner signal; momentum on its own loses.
//                   Stake 0.3 SOL.
//
// Exits (both legs): stop -2%, take-profit +25%, max hold 20 slots, and
// an immediate exit when the creator sells. Buys are capped at 1% of the
// coin's real reserve (harness cap) and never below 0.01 SOL, so every
// round trip counts toward the 20-coin minimum.
//
// What the dev window showed: raw momentum loses badly (the pilot lost
// -9.47 SOL). Only the tight breakout — runup +75-81%, exactly 3 buyers,
// age at most 10 slots — adds winners; it produced 2 of the 3 biggest
// winners in the dev run. Looser filters add small wins and destroy the
// net. A round trip costs roughly 2.5% in curve fees plus 0.00021 SOL in
// tx fees, and order splitting only burns more tx fees, so orders are
// never split.
//
// Deterministic: every decision is a pure function of the batches seen.
// No randomness, no clock, no network. Client ids come from the SDK
// counter.

import type { Batch, BotState, Order } from './vendor/makefun-bot.ts';

export interface Params {
  // --- entry window and rug screen ---
  minAgeSlots: number;
  maxAgeSlots: number;
  minRealSol: bigint;
  maxRealSol: bigint;
  maxDevBuy: bigint;
  minDevBuy: bigint;
  minBuyers: number;
  maxBuyers: number;
  maxSellRatioBps: number;
  maxBigSellBps: number;
  minRunupBps: number;
  maxRunupBps: number;
  flowWindowSlots: number;
  minFlow: bigint;
  skipDevSold: boolean;
  // --- sizing ---
  stake: bigint;
  addSize: bigint;
  minBuy: bigint;
  buySlippageBps: number;
  sellSlippageBps: number;
  // --- exits ---
  tpBps: number;
  slBps: number;
  trailArmBps: number;
  trailGiveBps: number;
  maxHoldSlots: number;
  staleSlots: number;
  exitOnDevSell: boolean;
  // --- partial take-profit: at tp1Bps sell tp1PartBps of the position,
  // then the stop moves to slAfterTp1Bps (0 = breakeven) ---
  tp1Bps: number;
  tp1PartBps: number;
  slAfterTp1Bps: number;
  // --- pyramid ---
  maxAdds: number;
  addStepBps: number;
  addDelaySlots: number;
  // --- breakout leg (WTA research): a second entry leg for coins that
  // have already run up after launch. It reuses the rug checks (dev buy,
  // dev sold, big sell, sell ratio, real reserve window, flow) with its
  // own age / runup / buyer limits and its own stake. Buying later also
  // means a bigger real reserve, so the 1%-of-real-reserve order cap
  // binds less and size can be larger.
  momEnabled: boolean;
  momMinAgeSlots: number;
  momMaxAgeSlots: number;
  momMinRunupBps: number;
  momMaxRunupBps: number;
  momMaxBuyers: number;
  momMinBuyers: number;
  momMinFlow: bigint;
  momStake: bigint;
}

export const DEFAULT_PARAMS: Params = {
  minAgeSlots: 0,
  maxAgeSlots: 0,
  minRealSol: 300_000_000n,
  maxRealSol: 30_000_000_000n,
  maxDevBuy: 500_000_000n,
  minDevBuy: 0n,
  minBuyers: 0,
  maxBuyers: 2,
  maxSellRatioBps: 10000,
  maxBigSellBps: 5000,
  minRunupBps: 0,
  maxRunupBps: 1000000,
  flowWindowSlots: 10,
  minFlow: -1_000_000_000_000n,
  skipDevSold: true,
  stake: 200000000n,
  addSize: 50_000_000n,
  minBuy: 10_000_000n,
  buySlippageBps: 2000,
  sellSlippageBps: 2000,
  tpBps: 2500,
  slBps: 200,
  trailArmBps: 100000,
  trailGiveBps: 1000,
  maxHoldSlots: 20,
  staleSlots: 1000000,
  exitOnDevSell: true,
  tp1Bps: 100000,
  tp1PartBps: 5000,
  slAfterTp1Bps: 0,
  maxAdds: 0,
  addStepBps: 1500,
  addDelaySlots: 2,
  momEnabled: true,
  momMinAgeSlots: 1,
  momMaxAgeSlots: 10,
  momMinRunupBps: 8000,
  momMaxRunupBps: 1000000,
  momMaxBuyers: 3,
  momMinBuyers: 3,
  momMinFlow: -1_000_000_000_000n,
  momStake: 300000000n,
};

const BPS = 10000n;

interface Tick {
  slot: number;
  signedSol: bigint;
}

interface CoinBook {
  createdSlot: number;
  creator: string;
  vq0: bigint;
  vt0: bigint;
  devBuy: bigint;
  devSold: boolean;
  buyers: Set<string>;
  soldByOthers: bigint;
  boughtByOthers: bigint;
  bigSell: boolean;
  lastTradeSlot: number;
  lastTradeFeeBps: number;
  lastTradeCreatorFeeBps: number;
  ticks: Tick[];
  done: boolean;
}

interface HeldBook {
  openedSlot: number;
  cost: bigint;
  best: bigint;
  adds: number;
  lastBuySlot: number;
  lastBuyVq: bigint;
  lastBuyVt: bigint;
  exiting: boolean;
  tookTp1: boolean;
  lastSellTokens: bigint;
}

export function createStrategy(p0: Params) {
  // Normalise bigint params: JSON-passed overrides arrive as numbers.
  const asBig = (v: bigint | number): bigint => (typeof v === 'bigint' ? v : BigInt(v));
  const p: Params = {
    ...p0,
    minRealSol: asBig(p0.minRealSol),
    maxRealSol: asBig(p0.maxRealSol),
    maxDevBuy: asBig(p0.maxDevBuy),
    minDevBuy: asBig(p0.minDevBuy),
    minFlow: asBig(p0.minFlow),
    stake: asBig(p0.stake),
    addSize: asBig(p0.addSize),
    minBuy: asBig(p0.minBuy),
    momMinFlow: asBig(p0.momMinFlow),
    momStake: asBig(p0.momStake),
  };
  const coins = new Map<string, CoinBook>();
  const held = new Map<string, HeldBook>();

  function foldEvents(batch: Batch): void {
    for (const e of batch.events) {
      if (e.event === 'CreateEvent') {
        coins.set(e.mint, {
          createdSlot: e.slot,
          creator: e.creator,
          vq0: BigInt(e.virtual_quote_reserves),
          vt0: BigInt(e.virtual_token_reserves),
          devBuy: 0n,
          devSold: false,
          buyers: new Set<string>(),
          soldByOthers: 0n,
          boughtByOthers: 0n,
          bigSell: false,
          lastTradeSlot: e.slot,
          lastTradeFeeBps: 95,
          lastTradeCreatorFeeBps: 30,
          ticks: [],
          done: false,
        });
      } else if (e.event === 'TradeEvent') {
        const c = coins.get(e.mint);
        if (c === undefined) continue;
        const sol = BigInt(e.sol_amount);
        if (e.is_buy) {
          if (e.user === c.creator) c.devBuy += sol;
          else {
            c.buyers.add(e.user);
            c.boughtByOthers += sol;
          }
          c.ticks.push({ slot: e.slot, signedSol: sol });
        } else {
          if (e.user === c.creator) {
            c.devSold = true;
          } else {
            c.soldByOthers += sol;
            // A single outsider dump larger than maxBigSellBps of the
            // real reserve at the time is a rug tell.
            const rq = BigInt(e.real_quote_reserves);
            if (sol * BPS > rq * BigInt(p.maxBigSellBps)) c.bigSell = true;
          }
          c.ticks.push({ slot: e.slot, signedSol: -sol });
        }
        c.lastTradeSlot = e.slot;
        const fb = BigInt(e.fee_basis_points);
        if (fb > 0n) {
          c.lastTradeFeeBps = Number(fb);
          c.lastTradeCreatorFeeBps = Number(BigInt(e.creator_fee_basis_points));
        }
      } else if (e.event === 'CompleteEvent') {
        const c = coins.get(e.mint);
        if (c !== undefined) c.done = true;
      }
    }
  }

  function flowInWindow(c: CoinBook, nowSlot: number): bigint {
    let f = 0n;
    for (let i = c.ticks.length - 1; i >= 0; i--) {
      const t = c.ticks[i]!;
      if (nowSlot - t.slot > p.flowWindowSlots) break;
      f += t.signedSol;
    }
    return f;
  }

  /** Net SOL back from selling `tokens` now, after curve fees and tx fee. */
  function netSellValue(state: BotState, mint: string, tokens: bigint): bigint {
    const curve = state.curves.get(mint);
    if (curve === undefined || tokens === 0n) return 0n;
    const vq = curve.virtual_quote_reserves;
    const vt = curve.virtual_token_reserves;
    const book = coins.get(mint);
    const feeBps = BigInt(book?.lastTradeFeeBps ?? 95);
    const creatorBps = BigInt(book?.lastTradeCreatorFeeBps ?? 30);
    const gross = (tokens * vq) / (vt + tokens);
    const fee = (gross * feeBps + BPS - 1n) / BPS;
    const cf = (gross * creatorBps + BPS - 1n) / BPS;
    const net = gross - fee - cf - state.txFeeLamports();
    return net > 0n ? net : 0n;
  }

  /** Current price vs creation price, in bps. price = vq / vt. */
  function runupBps(c: CoinBook, vq: bigint, vt: bigint): number {
    if (c.vq0 === 0n || c.vt0 === 0n || vt === 0n) return 0;
    const num = vq * c.vt0 - c.vq0 * vt;
    const den = c.vq0 * vt;
    return Number((num * BPS) / den);
  }

  return {
    onBatch(state: BotState, batch: Batch): Order[] {
      const slot = batch.slot;
      const txFee = state.txFeeLamports();
      foldEvents(batch);
      const orders: Order[] = [];
      const pendingBuy = new Set<string>();
      for (const po of state.pending.values()) {
        if (po.order.side === 'buy') pendingBuy.add(po.order.mint);
      }
      // Cash already spoken for by the orders I am about to send this batch.
      let committedCash = 0n;

      // --- sync the held book with fills: cost basis, adds, exits ---
      for (const f of batch.fills) {
        if (f.side === 'buy') {
          if (f.status !== 'filled') continue;
          const h = held.get(f.mint);
          const paid = BigInt(f.quote_lamports) + BigInt(f.tx_fee_lamports);
          const curve = state.curves.get(f.mint);
          if (h === undefined) {
            held.set(f.mint, {
              openedSlot: slot,
              cost: paid,
              best: 0n,
              adds: 0,
              lastBuySlot: slot,
              lastBuyVq: curve?.virtual_quote_reserves ?? 0n,
              lastBuyVt: curve?.virtual_token_reserves ?? 0n,
              exiting: false,
              tookTp1: false,
              lastSellTokens: 0n,
            });
          } else {
            h.cost += paid;
            h.adds += 1;
            h.lastBuySlot = slot;
            if (curve !== undefined) {
              h.lastBuyVq = curve.virtual_quote_reserves;
              h.lastBuyVt = curve.virtual_token_reserves;
            }
          }
        } else if (f.side === 'sell') {
          const h = held.get(f.mint);
          if (h === undefined) continue;
          if (f.status === 'filled') {
            const pos = state.positions.get(f.mint);
            if (pos === undefined || pos.token_amount === 0n) {
              held.delete(f.mint);
            } else {
              // Partial fill: scale the cost basis down to the tokens left,
              // reset the trailing tracker, re-arm for a retry.
              const sold = BigInt(f.token_amount);
              const total = pos.token_amount + sold;
              if (total > 0n) h.cost = (h.cost * pos.token_amount) / total;
              h.best = 0n;
              h.exiting = false;
              h.lastSellTokens = 0n;
            }
          } else if (f.status === 'rejected' || f.status === 'failed') {
            h.exiting = false; // exit did not go through: retry next batch
            h.lastSellTokens = 0n;
          }
        }
      }

      // --- exits first, so a freed slot can be reused by an entry below ---
      for (const [mint, pos] of state.positions) {
        if (pos.token_amount === 0n) continue;
        const h = held.get(mint);
        if (h === undefined || h.exiting) continue;
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        const book = coins.get(mint);
        const value = netSellValue(state, mint, pos.token_amount);
        if (value > h.best) h.best = value;
        const pnlBps = h.cost > 0n ? Number(((value - h.cost) * BPS) / h.cost) : 0;
        const age = slot - h.openedSlot;
        const stale = book === undefined ? 0 : slot - book.lastTradeSlot;
        const armed = pnlBps >= p.trailArmBps;
        const trailHit = armed && value * BPS <= (h.best * (BPS - BigInt(p.trailGiveBps))) / 1n;
        const devDumped = p.exitOnDevSell && book !== undefined && book.devSold;
        // Partial take-profit first: bank half at tp1Bps, then the stop
        // moves to breakeven and the rest rides the trailing stop.
        if (!h.tookTp1 && pnlBps >= p.tp1Bps) {
          const part = (pos.token_amount * BigInt(p.tp1PartBps)) / BPS;
          if (part > 0n) {
            orders.push({
              side: 'sell',
              mint,
              token_amount: part.toString(),
              max_slippage_bps: p.sellSlippageBps,
              client_id: state.clientId(),
            });
            h.tookTp1 = true;
            h.exiting = true;
            h.lastSellTokens = part;
            continue;
          }
        }
        const effSl = h.tookTp1 ? p.slAfterTp1Bps : p.slBps;
        if (
          pnlBps <= -effSl ||
          pnlBps >= p.tpBps ||
          trailHit ||
          age >= p.maxHoldSlots || // max hold: a position that has hit neither stop nor TP by slot 20 is closed, so a stalled coin cannot sit in the book and bleed the tail
          stale >= p.staleSlots ||
          devDumped
        ) {
          orders.push({
            side: 'sell',
            mint,
            token_amount: pos.token_amount.toString(),
            max_slippage_bps: p.sellSlippageBps,
            client_id: state.clientId(),
          });
          h.exiting = true;
        }
      }

      // --- pyramid adds on strength ---
      for (const [mint, pos] of state.positions) {
        if (pos.token_amount === 0n) continue;
        const h = held.get(mint);
        if (h === undefined || h.exiting || h.adds >= p.maxAdds) continue;
        if (pendingBuy.has(mint)) continue;
        const curve = state.curves.get(mint);
        const book = coins.get(mint);
        if (curve === undefined || curve.complete || book === undefined) continue;
        if (slot - h.lastBuySlot < p.addDelaySlots) continue;
        // Price must be at least addStepBps above the last buy price:
        // vq/vt now >= vq_buy/vt_buy * (1 + step).
        const stepOk =
          h.lastBuyVt > 0n &&
          curve.virtual_token_reserves * h.lastBuyVt * BPS >=
            h.lastBuyVq * curve.virtual_token_reserves * (BPS + BigInt(p.addStepBps));
        if (!stepOk) continue;
        if (flowInWindow(book, slot) < 0n) continue;
        const cap = state.maxBuyLamports(mint);
        let size = p.addSize;
        if (size > cap) size = cap;
        if (size < p.minBuy) continue;
        if (size + txFee > state.freeCashLamports() - committedCash) continue;
        orders.push({
          side: 'buy',
          mint,
          quote_lamports: size.toString(),
          max_slippage_bps: p.buySlippageBps,
          client_id: state.clientId(),
        });
        committedCash += size + txFee;
        pendingBuy.add(mint);
      }

      // --- new entries: fresh launches that pass the rug filter ---
      // Two legs: the age-0 sniper leg, and (if enabled) the breakout leg
      // for coins that have already run up after launch.
      let newBuys = 0;
      for (const [mint, book] of coins) {
        if (state.committedPositionCount() + newBuys >= 5) break;
        if (book.done) continue;
        const age = slot - book.createdSlot;
        if (state.positions.has(mint) || pendingBuy.has(mint)) continue;
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        const rq = curve.real_quote_reserves;
        if (rq < p.minRealSol || rq > p.maxRealSol) continue;
        if (book.devBuy > p.maxDevBuy) continue;
        if (book.devBuy < p.minDevBuy) continue;
        if (p.skipDevSold && book.devSold) continue;
        if (book.bigSell) continue;
        // Sell pressure: outsiders must not have dumped more than
        // maxSellRatioBps of what outsiders bought in.
        if (book.soldByOthers * BPS > book.boughtByOthers * BigInt(p.maxSellRatioBps)) continue;
        const runup = runupBps(book, curve.virtual_quote_reserves, curve.virtual_token_reserves);
        const flow = flowInWindow(book, slot);
        if (flow < p.minFlow) continue;
        // Sniper leg: age window + tight buyer cap + runup window.
        const sniperLeg =
          age >= p.minAgeSlots &&
          age <= p.maxAgeSlots &&
          book.buyers.size >= p.minBuyers &&
          book.buyers.size <= p.maxBuyers &&
          runup >= p.minRunupBps &&
          runup <= p.maxRunupBps;
        // Breakout leg: older coin, already run up, exactly 3 buyers —
        // holder breadth plus a minimum recent net inflow confirm it.
        const momLeg =
          p.momEnabled &&
          age >= p.momMinAgeSlots &&
          age <= p.momMaxAgeSlots &&
          book.buyers.size >= p.momMinBuyers &&
          book.buyers.size <= p.momMaxBuyers &&
          runup >= p.momMinRunupBps &&
          runup <= p.momMaxRunupBps &&
          flow >= p.momMinFlow;
        if (!sniperLeg && !momLeg) continue;
        const cap = state.maxBuyLamports(mint);
        let size = momLeg && !sniperLeg ? p.momStake : p.stake;
        if (size > cap) size = cap;
        if (size < p.minBuy) continue;
        if (size + txFee > state.freeCashLamports() - committedCash) continue;
        orders.push({
          side: 'buy',
          mint,
          quote_lamports: size.toString(),
          max_slippage_bps: p.buySlippageBps,
          client_id: state.clientId(),
        });
        committedCash += size + txFee;
        pendingBuy.add(mint);
        newBuys += 1;
      }

      return orders;
    },
  };
}
