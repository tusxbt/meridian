import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_CONFIG_PATH = path.join(__dirname, "..", "user-config.json");

const loginAttempts = new Map();
const RATE_LIMIT_WINDOW = 60_000;
const MAX_ATTEMPTS = 5;

function getPassword() {
  try {
    const cfg = JSON.parse(fs.readFileSync(USER_CONFIG_PATH, "utf8"));
    return cfg.dashboardPassword || null;
  } catch {
    return null;
  }
}

function hashToken(password) {
  return crypto.createHash("sha256").update(`meridian:${password}`).digest("hex");
}

export function validateSetup() {
  const pw = getPassword();
  if (!pw) {
    console.error("[dashboard] dashboardPassword not set in user-config.json");
    console.error('[dashboard] Add "dashboardPassword": "your-password" and restart.');
    process.exit(1);
  }
  return pw;
}

export function login(password) {
  const expected = getPassword();
  if (!expected) return null;
  if (password === expected) return hashToken(password);
  return null;
}

export function isValidToken(token) {
  const expected = getPassword();
  if (!expected) return false;
  return token === hashToken(expected);
}

export function rateLimitLogin(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (record && now - record.firstAttempt < RATE_LIMIT_WINDOW) {
    if (record.count >= MAX_ATTEMPTS) return false;
    record.count++;
    return true;
  }
  loginAttempts.set(ip, { firstAttempt: now, count: 1 });
  return true;
}

export function authMiddleware(req, res, next) {
  if (req.path === "/api/auth/login") return next();
  if (req.path === "/" || !req.path.startsWith("/api/")) return next();

  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const token = header.slice(7);
  if (!isValidToken(token)) {
    return res.status(401).json({ error: "Invalid token" });
  }
  next();
}
