import { isValidToken } from "./auth.js";

export class WsManager {
  constructor() {
    this.clients = new Set();
    this.subscriptions = new Map();
  }

  handleUpgrade(wss, server) {
    server.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname !== "/ws") return socket.destroy();

      const token = url.searchParams.get("token");
      if (!isValidToken(token)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        return socket.destroy();
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    });
  }

  addClient(ws) {
    this.clients.add(ws);
    this.subscriptions.set(ws, new Set(["system"]));

    ws.on("close", () => {
      this.clients.delete(ws);
      this.subscriptions.delete(ws);
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === "subscribe" && Array.isArray(msg.payload?.channels)) {
          const subs = this.subscriptions.get(ws);
          msg.payload.channels.forEach((ch) => subs.add(ch));
        }
        if (msg.type === "unsubscribe" && Array.isArray(msg.payload?.channels)) {
          const subs = this.subscriptions.get(ws);
          msg.payload.channels.forEach((ch) => subs.delete(ch));
        }
      } catch {}
    });
  }

  broadcast(channel, type, payload) {
    const data = JSON.stringify({ type, payload, ts: Date.now() });
    for (const ws of this.clients) {
      const subs = this.subscriptions.get(ws);
      if (subs?.has(channel) && ws.readyState === 1) {
        ws.send(data);
      }
    }
  }

  send(ws, type, payload) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type, payload, ts: Date.now() }));
    }
  }

  get clientCount() {
    return this.clients.size;
  }
}
