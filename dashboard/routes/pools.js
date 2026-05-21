import { Router } from "express";
import { getPoolMemory } from "../../pool-memory.js";

const router = Router();

router.get("/pools/memory/:address", (req, res) => {
  try {
    const memory = getPoolMemory({ pool_address: req.params.address });
    res.json(memory);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
