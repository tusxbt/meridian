import { Router } from "express";
import { config } from "../../config.js";
import { executeTool } from "../../tools/executor.js";

const router = Router();

const REDACTED_KEYS = ["walletKey", "llmApiKey", "hiveMindApiKey", "gmgnApiKey"];

function redactConfig(obj) {
  const copy = JSON.parse(JSON.stringify(obj));
  for (const key of REDACTED_KEYS) {
    if (copy[key]) copy[key] = "***";
  }
  if (copy.hiveMind?.apiKey) copy.hiveMind.apiKey = "***";
  if (copy.gmgn?.apiKey) copy.gmgn.apiKey = "***";
  if (copy.jupiter?.apiKey) copy.jupiter.apiKey = "***";
  return copy;
}

router.get("/config", (_req, res) => {
  try {
    res.json(redactConfig(config));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/config", async (req, res) => {
  try {
    const { changes, reason } = req.body;
    if (!changes || typeof changes !== "object") {
      return res.status(400).json({ error: "changes object required" });
    }
    const result = await executeTool("update_config", {
      changes,
      reason: reason || "Updated via dashboard",
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
