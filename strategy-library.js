/**
 * Strategy Library — persistent store of LP strategies.
 *
 * Users paste a tweet or description via Telegram.
 * The agent extracts structured criteria and saves it here.
 * During screening, the active strategy's criteria guide token selection and position config.
 */

import fs from "fs";
import { log } from "./logger.js";

const STRATEGY_FILE = "./strategy-library.json";

const DEFAULT_STRATEGIES = {
  tuski_bidask: {
    id: "tuski_bidask",
    name: "Tuski BidAsk",
    author: "tuski",
    lp_strategy: "bid_ask",
    token_criteria: {
      min_mcap: 150_000,
      max_mcap: 10_000_000,
      min_holders: 500,
      min_age_hours: 2,
      min_organic: 60,
      max_bundlers_pct: 30,
      max_top10_pct: 60,
      quote_tokens: ["SOL", "USDC", "USDT"],
      notes: "Degen volatile meme tokens only. Quote must be correlated (SOL/USDC/USDT). Avoid fresh launches < 2h. Smart wallet presence is a strong positive signal. Token must show real trading activity — fee income must come from swap volume, not farming rewards.",
    },
    entry: {
      condition: "Deploy when price is at/below BB lower band AND RSI(2) ≤ 25 — oversold mean-reversion dip entry on 5m or 15m chart",
      single_side: "sol",
      bins_above: 0,
      amount_x: 0,
      indicator_preset: "tuski_bidask",
      preferred_fee_tier: "2-5%",
      notes: "Single-sided SOL bid-ask, all bins below current price (bins_above=0, amount_x=0). Dynamic bins_below scales with volatility. Prefer pools with fee tier 2-5%.",
    },
    range: {
      type: "bid_ask",
      bins_above: 0,
      bins_below_min: 35,
      bins_below_max: 45,
      notes: "Tight bid-ask range — concentrates liquidity close to current price for maximum fee density per swap. At bin_step=80 and 45 bins, covers approximately -24% downside. Goes OOR faster — rely on fast OOR exit (10 min) and redeploy cycle.",
    },
    exit: {
      trailing_tp_trigger_pct: 2,
      trailing_drop_pct: 1.5,
      stop_loss_pct: -50,
      min_yield_fee_tvl_24h: 7,
      oor_wait_minutes: 10,
      notes: "Trailing TP activates at +2% peak PnL, exits when drops 1.5% from peak. Close if OOR for 10+ consecutive minutes. Close if yield < 7% fee/TVL per 24h after 25 min age.",
    },
    best_for: "Degen volatile meme tokens. Tight range = high fee density when in range. Fast OOR exit + redeploy cycle.",
  },
};

function load() {
  let db;
  if (!fs.existsSync(STRATEGY_FILE)) {
    db = { active: "tuski_bidask", strategies: {} };
  } else {
    try {
      db = JSON.parse(fs.readFileSync(STRATEGY_FILE, "utf8"));
    } catch {
      db = { active: "tuski_bidask", strategies: {} };
    }
  }
  // Merge default strategies in (user entries take precedence)
  db.strategies = { ...DEFAULT_STRATEGIES, ...db.strategies };
  // Set default active if none set
  if (!db.active) db.active = "tuski_bidask";
  return db;
}

function save(data) {
  fs.writeFileSync(STRATEGY_FILE, JSON.stringify(data, null, 2));
}

// ─── Tool Handlers ─────────────────────────────────────────────

/**
 * Add or update a strategy.
 * The agent parses the raw tweet/text and fills in the structured fields.
 */
export function addStrategy({
  id,
  name,
  author = "unknown",
  lp_strategy = "bid_ask",       // "bid_ask" | "spot" | "curve"
  token_criteria = {},           // { min_mcap, min_age_days, requires_kol, notes }
  entry = {},                    // { condition, price_change_threshold_pct, single_side }
  range = {},                    // { type, bins_below_pct, notes }
  exit = {},                     // { take_profit_pct, notes }
  best_for = "",                 // short description of ideal conditions
  raw = "",                      // original tweet/text
}) {
  if (!id || !name) return { error: "id and name are required" };

  const db = load();

  // Slugify id
  const slug = id.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");

  db.strategies[slug] = {
    id: slug,
    name,
    author,
    lp_strategy,
    token_criteria,
    entry,
    range,
    exit,
    best_for,
    raw,
    added_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Auto-set as active if it's the first strategy
  if (!db.active) db.active = slug;

  save(db);
  log("strategy", `Strategy saved: ${name} (${slug})`);
  return { saved: true, id: slug, name, active: db.active === slug };
}

/**
 * List all strategies with a summary.
 */
export function listStrategies() {
  const db = load();
  const strategies = Object.values(db.strategies).map((s) => ({
    id: s.id,
    name: s.name,
    author: s.author,
    lp_strategy: s.lp_strategy,
    best_for: s.best_for,
    active: db.active === s.id,
    added_at: s.added_at?.slice(0, 10),
  }));
  return { active: db.active, count: strategies.length, strategies };
}

/**
 * Get full details of a strategy including raw text and all criteria.
 */
export function getStrategy({ id }) {
  if (!id) return { error: "id required" };
  const db = load();
  const strategy = db.strategies[id];
  if (!strategy) return { error: `Strategy "${id}" not found`, available: Object.keys(db.strategies) };
  return { ...strategy, is_active: db.active === id };
}

/**
 * Set the active strategy used during screening cycles.
 */
export function setActiveStrategy({ id }) {
  if (!id) return { error: "id required" };
  const db = load();
  if (!db.strategies[id]) return { error: `Strategy "${id}" not found`, available: Object.keys(db.strategies) };
  db.active = id;
  save(db);
  log("strategy", `Active strategy set to: ${db.strategies[id].name}`);
  return { active: id, name: db.strategies[id].name };
}

/**
 * Remove a strategy.
 */
export function removeStrategy({ id }) {
  if (!id) return { error: "id required" };
  const db = load();
  if (!db.strategies[id]) return { error: `Strategy "${id}" not found` };
  const name = db.strategies[id].name;
  delete db.strategies[id];
  if (db.active === id) db.active = Object.keys(db.strategies)[0] || null;
  save(db);
  log("strategy", `Strategy removed: ${name}`);
  return { removed: true, id, name, new_active: db.active };
}

/**
 * Get the currently active strategy — used by screening cycle.
 */
export function getActiveStrategy() {
  const db = load();
  if (!db.active || !db.strategies[db.active]) return null;
  return db.strategies[db.active];
}
