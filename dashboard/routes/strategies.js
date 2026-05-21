import { Router } from "express";
import { listStrategies } from "../../strategy-library.js";

const router = Router();

router.get("/strategies", (_req, res) => {
  try {
    res.json(listStrategies());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
