import { Router } from "express";
import { getMyPositions, getPositionPnl } from "../../tools/dlmm.js";
import { getTrackedPositions } from "../../state.js";

const router = Router();

router.get("/positions", async (_req, res) => {
  try {
    const onChain = await getMyPositions({ force: true, silent: true });
    const tracked = getTrackedPositions(true);

    const trackedMap = new Map();
    for (const t of tracked) trackedMap.set(t.position, t);

    const positions = (onChain.positions || []).map((p) => {
      const meta = trackedMap.get(p.position) || {};
      return {
        ...p,
        strategy: meta.strategy || null,
        deployed_at: meta.deployed_at || null,
        out_of_range_since: meta.out_of_range_since || null,
        notes: meta.notes || [],
        instruction: meta.instruction || null,
        peak_pnl_pct: meta.peak_pnl_pct || 0,
        trailing_active: meta.trailing_active || false,
        rebalance_count: meta.rebalance_count || 0,
        total_fees_claimed_usd: meta.total_fees_claimed_usd || 0,
      };
    });

    res.json({
      wallet: onChain.wallet,
      total_positions: positions.length,
      positions,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/positions/:address/pnl", async (req, res) => {
  try {
    const result = await getPositionPnl({
      position_address: req.params.address,
    });
    if (result.error) return res.status(404).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
