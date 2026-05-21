import { Router } from "express";
import { getWalletBalances } from "../../tools/wallet.js";
import { config, computeDeployAmount } from "../../config.js";

const router = Router();

router.get("/portfolio", async (_req, res) => {
  try {
    const balance = await getWalletBalances();
    const deployCapacity = computeDeployAmount(balance.sol ?? 0);
    res.json({
      ...balance,
      deploy_capacity_sol: deployCapacity,
      gas_reserve: config.management.gasReserve,
      max_positions: config.risk.maxPositions,
      sol_mode: config.management.solMode,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
