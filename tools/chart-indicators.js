import { config } from "../config.js";
import { log } from "../logger.js";

const DEFAULT_INTERVALS = ["5_MINUTE"];
const DEFAULT_CANDLES = 298;

function getApiBase() {
  return String(config.api.url || "https://api.agentmeridian.xyz/api").replace(/\/+$/, "");
}

function getHeaders() {
  const headers = {};
  if (config.api.publicApiKey) headers["x-api-key"] = config.api.publicApiKey;
  return headers;
}

function normalizeIntervals(intervals) {
  const list = Array.isArray(intervals) ? intervals : DEFAULT_INTERVALS;
  return list
    .map((value) => String(value || "").trim().toUpperCase())
    .filter((value) => value === "5_MINUTE" || value === "15_MINUTE");
}

function safeNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildSignalSummary(payload) {
  const latest = payload?.latest || {};
  const candle = latest?.candle || {};
  const previousCandle = latest?.previousCandle || {};
  const rsi = safeNum(latest?.rsi?.value);
  const bollinger = latest?.bollinger || {};
  const supertrend = latest?.supertrend || {};
  const fibonacciLevels = latest?.fibonacci?.levels || {};
  const macd = latest?.macd || {};
  return {
    close: safeNum(candle.close),
    previousClose: safeNum(previousCandle.close),
    rsi,
    lowerBand: safeNum(bollinger.lower),
    middleBand: safeNum(bollinger.middle),
    upperBand: safeNum(bollinger.upper),
    supertrendValue: safeNum(supertrend.value),
    supertrendDirection: String(supertrend.direction || "unknown"),
    supertrendBreakUp: !!latest?.states?.supertrendBreakUp,
    supertrendBreakDown: !!latest?.states?.supertrendBreakDown,
    fib50: safeNum(fibonacciLevels["0.500"]),
    fib618: safeNum(fibonacciLevels["0.618"]),
    fib786: safeNum(fibonacciLevels["0.786"]),
    macdLine: safeNum(macd.macd ?? macd.line ?? macd.value),
    macdSignal: safeNum(macd.signal),
    macdHistogram: safeNum(macd.histogram ?? macd.hist),
    macdBullish: !!latest?.states?.macdBullish,
    macdCross: !!latest?.states?.macdCross,
  };
}

function evaluatePreset(side, preset, payload) {
  const summary = buildSignalSummary(payload);
  const oversold = Number(config.indicators.rsiOversold ?? 30);
  const overbought = Number(config.indicators.rsiOverbought ?? 80);
  const close = summary.close;
  const previousClose = summary.previousClose;
  const lowerBand = summary.lowerBand;
  const upperBand = summary.upperBand;
  const rsi = summary.rsi;
  const isBullish = summary.supertrendDirection === "bullish";
  const isBearish = summary.supertrendDirection === "bearish";
  const crossedUp = (level) =>
    level != null &&
    close != null &&
    previousClose != null &&
    previousClose < level &&
    close >= level;
  const crossedDown = (level) =>
    level != null &&
    close != null &&
    previousClose != null &&
    previousClose > level &&
    close <= level;

  switch (preset) {
    case "supertrend_break":
      return side === "entry"
        ? {
            confirmed: summary.supertrendBreakUp || (isBullish && close != null && summary.supertrendValue != null && close >= summary.supertrendValue),
            reason: summary.supertrendBreakUp ? "Supertrend flipped bullish" : "Price is above bullish Supertrend",
            signal: summary,
          }
        : {
            confirmed: summary.supertrendBreakDown || (isBearish && close != null && summary.supertrendValue != null && close <= summary.supertrendValue),
            reason: summary.supertrendBreakDown ? "Supertrend flipped bearish" : "Price is below bearish Supertrend",
            signal: summary,
          };
    case "rsi_reversal":
      return side === "entry"
        ? {
            confirmed: rsi != null && rsi <= oversold,
            reason: `RSI ${rsi ?? "n/a"} <= oversold ${oversold}`,
            signal: summary,
          }
        : {
            confirmed: rsi != null && rsi >= overbought,
            reason: `RSI ${rsi ?? "n/a"} >= overbought ${overbought}`,
            signal: summary,
          };
    case "bollinger_reversion":
      return side === "entry"
        ? {
            confirmed: close != null && lowerBand != null && close <= lowerBand,
            reason: `Close ${close ?? "n/a"} <= lower band ${lowerBand ?? "n/a"}`,
            signal: summary,
          }
        : {
            confirmed: close != null && upperBand != null && close >= upperBand,
            reason: `Close ${close ?? "n/a"} >= upper band ${upperBand ?? "n/a"}`,
            signal: summary,
          };
    case "rsi_plus_supertrend":
      return side === "entry"
        ? {
            confirmed:
              (rsi != null && rsi <= oversold) &&
              (summary.supertrendBreakUp || isBullish),
            reason: `RSI oversold with bullish Supertrend context`,
            signal: summary,
          }
        : {
            confirmed:
              (rsi != null && rsi >= overbought) &&
              (summary.supertrendBreakDown || isBearish),
            reason: `RSI overbought with bearish Supertrend context`,
            signal: summary,
          };
    case "supertrend_or_rsi":
      return side === "entry"
        ? {
            confirmed:
              summary.supertrendBreakUp ||
              (isBullish && close != null && summary.supertrendValue != null && close >= summary.supertrendValue) ||
              (rsi != null && rsi <= oversold),
            reason: "Supertrend bullish confirmation or RSI oversold",
            signal: summary,
          }
        : {
            confirmed:
              summary.supertrendBreakDown ||
              (isBearish && close != null && summary.supertrendValue != null && close <= summary.supertrendValue) ||
              (rsi != null && rsi >= overbought),
            reason: "Supertrend bearish confirmation or RSI overbought",
            signal: summary,
          };
    case "bb_plus_rsi":
      return side === "entry"
        ? {
            confirmed:
              close != null &&
              lowerBand != null &&
              close <= lowerBand &&
              rsi != null &&
              rsi <= oversold,
            reason: "Close at/below lower band with RSI oversold",
            signal: summary,
          }
        : {
            confirmed:
              close != null &&
              upperBand != null &&
              close >= upperBand &&
              rsi != null &&
              rsi >= overbought,
            reason: "Close at/above upper band with RSI overbought",
            signal: summary,
          };
    case "fibo_reclaim":
      return side === "entry"
        ? {
            confirmed:
              crossedUp(summary.fib618) ||
              crossedUp(summary.fib50) ||
              crossedUp(summary.fib786),
            reason: "Price reclaimed a key Fibonacci level",
            signal: summary,
          }
        : {
            confirmed:
              crossedUp(summary.fib618) ||
              crossedUp(summary.fib50),
            reason: "Price reclaimed a key Fibonacci level upward",
            signal: summary,
          };
    case "fibo_reject":
      return side === "entry"
        ? {
            confirmed:
              crossedDown(summary.fib618) ||
              crossedDown(summary.fib50),
            reason: "Price rejected from a key Fibonacci level",
            signal: summary,
          }
        : {
            confirmed:
              crossedDown(summary.fib618) ||
              crossedDown(summary.fib50) ||
              crossedDown(summary.fib786),
            reason: "Price rejected below a key Fibonacci level",
            signal: summary,
          };
    case "tuski_bidask": {
      const bbTouched = close != null && lowerBand != null && close <= lowerBand;
      const rsiOversoldHit = rsi != null && rsi <= oversold;
      const macdOk = summary.macdHistogram == null || summary.macdHistogram >= 0 || summary.macdBullish;
      const macdNote = summary.macdHistogram != null ? (macdOk ? " + MACD bullish" : " (MACD caution)") : "";
      return side === "entry"
        ? {
            confirmed: bbTouched && rsiOversoldHit,
            reason: bbTouched && rsiOversoldHit
              ? `BB lower touch + RSI(2) ${rsi?.toFixed(1) ?? "n/a"} ≤ ${oversold}${macdNote}`
              : !bbTouched
                ? `Price ${close ?? "n/a"} above lower band ${lowerBand ?? "n/a"}`
                : `RSI(2) ${rsi ?? "n/a"} not oversold (need ≤ ${oversold})`,
            signal: summary,
          }
        : {
            confirmed: (close != null && upperBand != null && close >= upperBand) || (rsi != null && rsi >= overbought),
            reason: "Tuski BidAsk exit: BB upper band touch or RSI overbought",
            signal: summary,
          };
    }
    case "bb_rsi_macd": {
      // Entry: BB lower touch + RSI(2) oversold + MACD histogram turning positive
      // Exit:  BB middle band reclaimed + RSI(2) >= 50 + MACD histogram positive
      const middleBand = summary.middleBand;
      const bbLower = close != null && lowerBand != null && close <= lowerBand;
      const rsiOversoldOk = rsi != null && rsi <= oversold;
      // MACD turning: histogram just crossed zero (>= 0) or bullish cross state
      const macdTurning = summary.macdHistogram != null
        ? summary.macdHistogram >= 0
        : (summary.macdBullish || summary.macdCross);
      const macdPositive = summary.macdHistogram != null
        ? summary.macdHistogram > 0
        : summary.macdBullish;
      const middleCrossed = crossedUp(middleBand);
      const rsiRecovered = rsi != null && rsi >= 50;
      // 2-of-3 voting: confirmed if at least 2 conditions are met
      const entryHits = [bbLower, rsiOversoldOk, macdTurning];
      const entryScore = entryHits.filter(Boolean).length;
      const exitHits = [middleCrossed, rsiRecovered, macdPositive];
      const exitScore = exitHits.filter(Boolean).length;
      return side === "entry"
        ? {
            confirmed: entryScore >= 2,
            reason: entryScore >= 2
              ? `bb_rsi_macd entry: ${entryScore}/3 — BB:${bbLower ? "✓" : "✗"} RSI(2)${rsi?.toFixed(1) ?? "n/a"}:${rsiOversoldOk ? "✓" : "✗"} MACD:${macdTurning ? "✓" : "✗"}`
              : `bb_rsi_macd entry: only ${entryScore}/3 — BB:${bbLower ? "✓" : "✗"} RSI(2)${rsi?.toFixed(1) ?? "n/a"}:${rsiOversoldOk ? "✓" : "✗"} MACD:${macdTurning ? "✓" : "✗"}`,
            signal: summary,
          }
        : {
            confirmed: exitScore >= 2,
            reason: exitScore >= 2
              ? `bb_rsi_macd exit: ${exitScore}/3 — Middle:${middleCrossed ? "✓" : "✗"} RSI(2)${rsi?.toFixed(1) ?? "n/a"}:${rsiRecovered ? "✓" : "✗"} MACD:${macdPositive ? "✓" : "✗"}`
              : `bb_rsi_macd exit: only ${exitScore}/3 — Middle:${middleCrossed ? "✓" : "✗"} RSI(2)${rsi?.toFixed(1) ?? "n/a"}:${rsiRecovered ? "✓" : "✗"} MACD:${macdPositive ? "✓" : "✗"}`,
            signal: summary,
          };
    }
    default:
      return {
        confirmed: false,
        reason: `Unknown preset ${preset}`,
        signal: summary,
      };
  }
}

export async function fetchChartIndicatorsForMint(
  mint,
  {
    interval,
    candles = config.indicators.candles ?? DEFAULT_CANDLES,
    rsiLength = config.indicators.rsiLength ?? 2,
    refresh = false,
  } = {},
) {
  const normalizedInterval = String(interval || "15_MINUTE").trim().toUpperCase();
  const search = new URLSearchParams({
    interval: normalizedInterval,
    candles: String(candles),
    rsiLength: String(rsiLength),
  });
  if (refresh) search.set("refresh", "1");

  const res = await fetch(`${getApiBase()}/chart-indicators/${mint}?${search.toString()}`, {
    headers: getHeaders(),
  });
  const text = await res.text().catch(() => "");
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  if (!res.ok) {
    throw new Error(payload?.error || `chart indicators ${res.status}`);
  }
  return payload;
}

export async function confirmIndicatorPreset({
  mint,
  side,
  preset = side === "entry" ? config.indicators.entryPreset : config.indicators.exitPreset,
  intervals = config.indicators.intervals,
  refresh = false,
} = {}) {
  if (!config.indicators.enabled || !mint || !preset) {
    return { enabled: false, confirmed: true, reason: "Indicators disabled or not configured", intervals: [] };
  }

  const targets = normalizeIntervals(intervals);
  if (targets.length === 0) {
    return { enabled: false, confirmed: true, reason: "No indicator intervals configured", intervals: [] };
  }

  const results = [];
  for (const interval of targets) {
    try {
      const payload = await fetchChartIndicatorsForMint(mint, { interval, refresh });
      const evaluation = evaluatePreset(side, preset, payload);
      results.push({
        interval,
        ok: true,
        confirmed: !!evaluation.confirmed,
        reason: evaluation.reason,
        signal: evaluation.signal,
        latest: payload?.latest || null,
      });
    } catch (error) {
      log("indicators_warn", `Indicator fetch failed for ${mint.slice(0, 8)} ${interval}: ${error.message}`);
      results.push({
        interval,
        ok: false,
        confirmed: null,
        reason: error.message,
        signal: null,
        latest: null,
      });
    }
  }

  const successful = results.filter((entry) => entry.ok);
  if (successful.length === 0) {
    return {
      enabled: true,
      confirmed: true,
      skipped: true,
      preset,
      side,
      reason: "Indicator API unavailable; falling back to existing logic",
      intervals: results,
    };
  }

  const requireAll = !!config.indicators.requireAllIntervals;
  const confirmed = requireAll
    ? successful.every((entry) => entry.confirmed)
    : successful.some((entry) => entry.confirmed);

  return {
    enabled: true,
    confirmed,
    skipped: false,
    preset,
    side,
    requireAllIntervals: requireAll,
    reason: confirmed
      ? `${preset} confirmed on ${successful.filter((entry) => entry.confirmed).map((entry) => entry.interval).join(", ")}`
      : `${preset} not confirmed on ${successful.map((entry) => entry.interval).join(", ")}`,
    intervals: results,
  };
}
