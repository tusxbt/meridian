import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_PATH = path.join(__dirname, "dashboard-state.json");

export function writeDashboardState(data) {
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify({ ...data, ts: Date.now() }));
  } catch {}
}
