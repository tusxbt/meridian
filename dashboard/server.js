import "../envcrypt.js";

import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

import { validateSetup, login, rateLimitLogin, authMiddleware } from "./auth.js";
import { WsManager } from "./ws-manager.js";
import { handleTerminalMessage } from "./routes/terminal.js";

import portfolioRoutes from "./routes/portfolio.js";
import positionsRoutes from "./routes/positions.js";
import performanceRoutes from "./routes/performance.js";
import lessonsRoutes from "./routes/lessons.js";
import configRoutes from "./routes/config.js";
import decisionsRoutes from "./routes/decisions.js";
import poolsRoutes from "./routes/pools.js";
import strategiesRoutes from "./routes/strategies.js";
import systemRoutes from "./routes/system.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.DASHBOARD_PORT) || 3456;
const HOST = process.env.DASHBOARD_HOST || "0.0.0.0";

validateSetup();

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });
const wsManager = new WsManager();

app.use(express.json());
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  next();
});

app.use(authMiddleware);

app.post("/api/auth/login", (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (!rateLimitLogin(ip)) {
    return res.status(429).json({ error: "Too many login attempts. Try again in 1 minute." });
  }
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: "password required" });
  const token = login(password);
  if (!token) return res.status(401).json({ error: "Invalid password" });
  res.json({ token });
});

app.use("/api", portfolioRoutes);
app.use("/api", positionsRoutes);
app.use("/api", performanceRoutes);
app.use("/api", lessonsRoutes);
app.use("/api", configRoutes);
app.use("/api", decisionsRoutes);
app.use("/api", poolsRoutes);
app.use("/api", strategiesRoutes);
app.use("/api", systemRoutes);

app.use(express.static(path.join(__dirname, "public")));
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

wsManager.handleUpgrade(wss, server);

wss.on("connection", (ws) => {
  wsManager.addClient(ws);

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === "command" || msg.type === "agent_message") {
        handleTerminalMessage(ws, msg, wsManager);
      }
    } catch {}
  });
});

let positionCache = null;
setInterval(async () => {
  if (wsManager.clientCount === 0) return;
  try {
    const { getMyPositions } = await import("../tools/dlmm.js");
    const data = await getMyPositions({ force: true, silent: true });
    const key = JSON.stringify(data.positions?.map((p) => `${p.position}:${p.pnl_pct}:${p.in_range}`));
    if (key !== positionCache) {
      positionCache = key;
      wsManager.broadcast("positions", "positions_update", {
        positions: data.positions || [],
        total: data.total_positions || 0,
      });
    }
  } catch {}
}, 30_000);

setInterval(() => {
  if (wsManager.clientCount === 0) return;
  import("./routes/system.js").then(() => {
    // system status is read fresh on each WS broadcast
  }).catch(() => {});
  // Broadcast a lightweight status ping
  wsManager.broadcast("system", "system_ping", { ts: Date.now() });
}, 10_000);

server.listen(PORT, HOST, () => {
  const nets = getNetworkAddresses();
  console.log(`\n  Meridian Dashboard`);
  console.log(`  Local:   http://localhost:${PORT}`);
  for (const addr of nets) {
    console.log(`  Network: http://${addr}:${PORT}`);
  }
  console.log(`  WebSocket: ws://localhost:${PORT}/ws?token=<TOKEN>\n`);
});

function getNetworkAddresses() {
  try {
    const interfaces = os.networkInterfaces();
    const addresses = [];
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === "IPv4" && !iface.internal) {
          addresses.push(iface.address);
        }
      }
    }
    return addresses;
  } catch {
    return [];
  }
}
