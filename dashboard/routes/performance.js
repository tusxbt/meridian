import { Router } from "express";
import { getPerformanceSummary, getPerformanceHistory } from "../../lessons.js";

const router = Router();

router.get("/performance", (_req, res) => {
  try {
    const summary = getPerformanceSummary();
    res.json(summary || { total_positions_closed: 0, total_pnl_usd: 0, win_rate_pct: 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/performance/history", (req, res) => {
  try {
    const hours = Number(req.query.hours) || 24;
    const limit = Number(req.query.limit) || 50;
    const history = getPerformanceHistory({ hours, limit });
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
