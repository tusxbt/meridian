import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "../../config.js";
import { getTrackedPositions } from "../../state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_STATE_PATH = path.join(__dirname, "..", "..", "dashboard-state.json");

const startedAt = Date.now();

const router = Router();

function readDashboardState() {
  try {
    if (!fs.existsSync(DASHBOARD_STATE_PATH)) return null;
    return JSON.parse(fs.readFileSync(DASHBOARD_STATE_PATH, "utf8"));
  } catch {
    return null;
  }
}

router.get("/system/status", (_req, res) => {
  try {
    const agentState = readDashboardState();
    const openPositions = getTrackedPositions(true);

    const now = Date.now();
    let nextManagement = null;
    let nextScreening = null;

    if (agentState) {
      const mgmtInterval = (config.schedule.managementIntervalMin || 10) * 60_000;
      const scrInterval = (config.schedule.screeningIntervalMin || 30) * 60_000;

      if (agentState.managementLastRun) {
        nextManagement = Math.max(0, (agentState.managementLastRun + mgmtInterval - now) / 1000);
      }
      if (agentState.screeningLastRun) {
        nextScreening = Math.max(0, (agentState.screeningLastRun + scrInterval - now) / 1000);
      }
    }

    res.json({
      mode: process.env.DRY_RUN === "true" ? "dry_run" : "live",
      agent_connected: !!agentState,
      management_busy: agentState?.managementBusy || false,
      screening_busy: agentState?.screeningBusy || false,
      next_management_seconds: nextManagement,
      next_screening_seconds: nextScreening,
      management_interval_min: config.schedule.managementIntervalMin,
      screening_interval_min: config.schedule.screeningIntervalMin,
      open_positions: openPositions.length,
      max_positions: config.risk.maxPositions,
      model: config.llm.managementModel,
      screening_model: config.llm.screeningModel,
      uptime_seconds: Math.floor((now - startedAt) / 1000),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
