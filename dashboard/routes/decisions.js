import { Router } from "express";
import { getRecentDecisions } from "../../decision-log.js";

const router = Router();

router.get("/decisions", (req, res) => {
  try {
    const limit = Number(req.query.limit) || 20;
    const decisions = getRecentDecisions(limit);
    res.json({ total: decisions.length, decisions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
