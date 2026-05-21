// ─── State ──────────────────────────────────────────
const state = {
  token: localStorage.getItem("meridian_token"),
  ws: null,
  wsReconnectTimer: null,
  currentPage: null,
  systemStatus: null,
  portfolioCache: null,
  positionsCache: null,
  refreshTimers: [],
};

// ─── API Helper ─────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${state.token}`,
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) {
    logout();
    throw new Error("Unauthorized");
  }
  return res.json();
}

// ─── Auth ───────────────────────────────────────────
function showLogin() {
  document.getElementById("login-screen").classList.remove("hidden");
  document.getElementById("sidebar").classList.remove("sidebar-visible");
  document.getElementById("bottom-nav").classList.remove("bottomnav-visible");
  document.getElementById("bottom-nav").style.display = "";
  document.getElementById("main-content").classList.add("hidden");
}

function showApp() {
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("sidebar").classList.add("sidebar-visible");
  document.getElementById("bottom-nav").classList.add("bottomnav-visible");
  document.getElementById("main-content").classList.remove("hidden");
}

function logout() {
  state.token = null;
  localStorage.removeItem("meridian_token");
  if (state.ws) state.ws.close();
  showLogin();
}
window._logout = logout;

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pw = document.getElementById("login-password").value;
  const errEl = document.getElementById("login-error");
  errEl.classList.add("hidden");
  try {
    const data = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    }).then((r) => r.json());
    if (data.token) {
      state.token = data.token;
      localStorage.setItem("meridian_token", data.token);
      showApp();
      connectWs();
      route();
    } else {
      errEl.textContent = data.error || "Login failed";
      errEl.classList.remove("hidden");
    }
  } catch {
    errEl.textContent = "Connection error";
    errEl.classList.remove("hidden");
  }
});

// ─── WebSocket ──────────────────────────────────────
function connectWs() {
  if (state.ws && state.ws.readyState <= 1) return;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  state.ws = new WebSocket(`${proto}//${location.host}/ws?token=${state.token}`);

  state.ws.onopen = () => {
    document.getElementById("nav-status").textContent = "Connected";
    document.getElementById("nav-status").className = "text-xs text-[#a6e3a1]";
    const mobWs = document.getElementById("mob-status-ws");
    if (mobWs) { mobWs.textContent = "Live"; mobWs.className = "text-[#a6e3a1]"; }
    state.ws.send(JSON.stringify({ type: "subscribe", payload: { channels: ["positions", "system"] } }));
  };

  state.ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      handleWsMessage(msg);
    } catch {}
  };

  state.ws.onclose = () => {
    document.getElementById("nav-status").textContent = "Disconnected";
    document.getElementById("nav-status").className = "text-xs text-[#f38ba8]";
    const mobWs = document.getElementById("mob-status-ws");
    if (mobWs) { mobWs.textContent = "Off"; mobWs.className = "text-[#f38ba8]"; }
    clearTimeout(state.wsReconnectTimer);
    state.wsReconnectTimer = setTimeout(connectWs, 5000);
  };

  state.ws.onerror = () => state.ws.close();
}

function wsSend(type, payload) {
  if (state.ws?.readyState === 1) {
    state.ws.send(JSON.stringify({ type, payload }));
  }
}

function handleWsMessage(msg) {
  if (msg.type === "positions_update") {
    state.positionsCache = msg.payload;
    if (state.currentPage === "positions") renderPositions(msg.payload);
    updateStatusBar();
  }
  if (msg.type === "system_ping") {
    updateStatusBar();
  }
  if (msg.type === "command_output" || msg.type === "tool_start" || msg.type === "tool_finish" || msg.type === "agent_response") {
    window.dispatchEvent(new CustomEvent("terminal-msg", { detail: msg }));
  }
}

// ─── Router ─────────────────────────────────────────
const routes = {
  "/": pageDashboard,
  "/positions": pagePositions,
  "/terminal": pageTerminal,
  "/performance": pagePerformance,
  "/lessons": pageLessons,
  "/config": pageConfig,
  "/decisions": pageDecisions,
  "/pools": pagePools,
  "/strategies": pageStrategies,
};

function route() {
  const hash = location.hash.slice(1) || "/";
  state.currentPage = hash.slice(1) || "dashboard";
  state.refreshTimers.forEach(clearInterval);
  state.refreshTimers = [];

  document.querySelectorAll(".nav-link").forEach((el) => {
    const href = el.getAttribute("href");
    el.classList.toggle("active", href === `#${hash}`);
  });

  // Update mobile bottom nav active state
  const mobActiveMap = { "/": 0, "/positions": 1, "/terminal": 2, "/performance": 3 };
  const mobIdx = mobActiveMap[hash];
  document.querySelectorAll(".mob-nav-link").forEach((el, i) => {
    el.classList.toggle("active", i === mobIdx);
  });

  const handler = routes[hash];
  if (handler) {
    document.getElementById("app").innerHTML = "";
    handler();
  }
}

window.addEventListener("hashchange", route);

// ─── Boot ───────────────────────────────────────────
if (state.token) {
  api("/system/status")
    .then(() => { showApp(); connectWs(); route(); })
    .catch(() => showLogin());
} else {
  showLogin();
}

// ─── Status Bar Updates ─────────────────────────────
async function updateStatusBar() {
  try {
    const sys = await api("/system/status");
    state.systemStatus = sys;
    const posText = `${sys.open_positions}/${sys.max_positions}`;
    document.getElementById("status-positions").textContent = posText;
    document.getElementById("status-mgmt").textContent = sys.next_management_seconds != null
      ? formatCountdown(sys.next_management_seconds) + (sys.management_busy ? " (busy)" : "")
      : "N/A";
    document.getElementById("status-screen").textContent = sys.next_screening_seconds != null
      ? formatCountdown(sys.next_screening_seconds) + (sys.screening_busy ? " (busy)" : "")
      : "N/A";
    const mobPos = document.getElementById("mob-status-positions");
    if (mobPos) mobPos.textContent = posText;
  } catch {}
  try {
    if (!state.portfolioCache || Date.now() - state.portfolioCache._ts > 30000) {
      const p = await api("/portfolio");
      p._ts = Date.now();
      state.portfolioCache = p;
    }
    const solText = `${(state.portfolioCache.sol || 0).toFixed(3)} SOL`;
    document.getElementById("status-sol").textContent = solText;
    const mobSol = document.getElementById("mob-status-sol");
    if (mobSol) mobSol.textContent = solText;
  } catch {}
}

// ─── Helpers ────────────────────────────────────────
function $(tag, cls, html) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html) el.innerHTML = html;
  return el;
}

function formatCountdown(sec) {
  if (sec == null || sec <= 0) return "now";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatUsd(v) {
  if (v == null) return "--";
  return "$" + Number(v).toFixed(2);
}

function formatPct(v) {
  if (v == null) return "--";
  const n = Number(v);
  const sign = n >= 0 ? "+" : "";
  return sign + n.toFixed(2) + "%";
}

function pctColor(v) {
  if (v == null) return "";
  return Number(v) >= 0 ? "text-[#a6e3a1]" : "text-[#f38ba8]";
}

function formatAge(minutes) {
  if (!minutes) return "--";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 1440) return `${(minutes / 60).toFixed(1)}h`;
  return `${(minutes / 1440).toFixed(1)}d`;
}

function timeAgo(isoStr) {
  if (!isoStr) return "--";
  const diff = (Date.now() - new Date(isoStr).getTime()) / 60000;
  return formatAge(diff) + " ago";
}

function rangeBar(lower, upper, active, inRange) {
  const range = upper - lower || 1;
  const pct = Math.max(0, Math.min(100, ((active - lower) / range) * 100));
  const fillColor = inRange ? "#a6e3a1" : "#f38ba8";
  return `<div class="range-bar w-full">
    <div class="range-fill" style="width:100%;background:${inRange ? '#1e3a2f' : '#3e1a1a'}"></div>
    <div class="range-marker" style="left:${pct}%;background:${fillColor}"></div>
  </div>`;
}

function toast(text, type = "info") {
  const colors = { info: "#89b4fa", success: "#a6e3a1", error: "#f38ba8" };
  const el = $("div", "px-4 py-2 rounded-lg text-sm mb-2 fade-in", text);
  el.style.background = "#1e1e2e";
  el.style.border = `1px solid ${colors[type] || colors.info}`;
  el.style.color = colors[type] || colors.info;
  document.getElementById("toast-container").appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ═══════════════════════════════════════════════════
//  PAGES
// ═══════════════════════════════════════════════════

// ─── Dashboard ──────────────────────────────────────
async function pageDashboard() {
  const app = document.getElementById("app");
  app.innerHTML = `<div class="fade-in">
    <h2 class="text-xl font-bold mb-4">Dashboard</h2>
    <div id="dash-stats" class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6"></div>
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div id="dash-positions" class="card p-4"><p class="text-[#6c7086]">Loading positions...</p></div>
      <div id="dash-activity" class="card p-4"><p class="text-[#6c7086]">Loading activity...</p></div>
    </div>
  </div>`;

  const [portfolio, positions, perf, sys] = await Promise.all([
    api("/portfolio").catch(() => null),
    api("/positions").catch(() => null),
    api("/performance").catch(() => null),
    api("/system/status").catch(() => null),
  ]);

  state.portfolioCache = portfolio ? { ...portfolio, _ts: Date.now() } : null;
  updateStatusBar();

  const statsEl = document.getElementById("dash-stats");
  statsEl.innerHTML = `
    <div class="card p-4">
      <p class="text-xs text-[#6c7086] mb-1">Portfolio Value</p>
      <p class="stat-value text-[#cdd6f4]">${formatUsd(portfolio?.total_usd)}</p>
      <p class="text-xs text-[#6c7086] mt-1">${(portfolio?.sol || 0).toFixed(3)} SOL</p>
    </div>
    <div class="card p-4">
      <p class="text-xs text-[#6c7086] mb-1">Open Positions</p>
      <p class="stat-value text-[#cdd6f4]">${positions?.total_positions ?? "--"}</p>
      <p class="text-xs text-[#6c7086] mt-1">max ${sys?.max_positions || "--"}</p>
    </div>
    <div class="card p-4">
      <p class="text-xs text-[#6c7086] mb-1">Total PnL</p>
      <p class="stat-value ${pctColor(perf?.total_pnl_usd)}">${formatUsd(perf?.total_pnl_usd)}</p>
      <p class="text-xs text-[#6c7086] mt-1">${perf?.total_positions_closed || 0} closed</p>
    </div>
    <div class="card p-4">
      <p class="text-xs text-[#6c7086] mb-1">Win Rate</p>
      <p class="stat-value text-[#cba6f7]">${perf?.win_rate_pct != null ? perf.win_rate_pct.toFixed(1) + "%" : "--"}</p>
      <p class="text-xs text-[#6c7086] mt-1">avg ${formatPct(perf?.avg_pnl_pct)}</p>
    </div>`;

  const posEl = document.getElementById("dash-positions");
  if (positions?.positions?.length) {
    posEl.innerHTML = `<h3 class="text-sm font-semibold mb-3 text-[#cba6f7]">Open Positions</h3>` +
      positions.positions.map((p) => `
        <div class="flex items-center justify-between py-2 border-b border-[#313244] last:border-0">
          <div>
            <span class="font-medium text-sm">${p.pair || "Unknown"}</span>
            <span class="badge ${p.in_range ? 'badge-green' : 'badge-red'} ml-2">${p.in_range ? "In Range" : "OOR"}</span>
          </div>
          <div class="text-right">
            <span class="text-sm font-semibold ${pctColor(p.pnl_pct)}">${formatPct(p.pnl_pct)}</span>
            <span class="text-xs text-[#6c7086] ml-2">${formatAge(p.age_minutes)}</span>
          </div>
        </div>`).join("");
  } else {
    posEl.innerHTML = `<h3 class="text-sm font-semibold mb-3 text-[#cba6f7]">Open Positions</h3>
      <p class="text-sm text-[#6c7086]">No open positions</p>`;
  }

  const actEl = document.getElementById("dash-activity");
  try {
    const decisions = await api("/decisions?limit=5");
    actEl.innerHTML = `<h3 class="text-sm font-semibold mb-3 text-[#cba6f7]">Recent Activity</h3>` +
      (decisions.decisions || []).map((d) => `
        <div class="py-2 border-b border-[#313244] last:border-0">
          <div class="flex justify-between items-start">
            <span class="badge badge-${d.type === 'deploy' ? 'green' : d.type === 'close' ? 'red' : 'blue'}">${d.type}</span>
            <span class="text-xs text-[#6c7086]">${timeAgo(d.ts)}</span>
          </div>
          <p class="text-xs mt-1">${d.summary || d.pool_name || "--"}</p>
        </div>`).join("");
  } catch {
    actEl.innerHTML = `<p class="text-sm text-[#6c7086]">Could not load activity</p>`;
  }

  const timer = setInterval(updateStatusBar, 15000);
  state.refreshTimers.push(timer);
}

// ─── Positions ──────────────────────────────────────
async function pagePositions() {
  const app = document.getElementById("app");
  app.innerHTML = `<div class="fade-in">
    <h2 class="text-xl font-bold mb-4">Positions</h2>
    <div id="positions-list" class="space-y-4"><p class="text-[#6c7086]">Loading...</p></div>
  </div>`;

  try {
    const data = await api("/positions");
    renderPositions(data);
  } catch (err) {
    document.getElementById("positions-list").innerHTML = `<p class="text-[#f38ba8]">${err.message}</p>`;
  }
}

function renderPositions(data) {
  const el = document.getElementById("positions-list");
  if (!el) return;
  const positions = data?.positions || [];
  if (!positions.length) {
    el.innerHTML = `<div class="card p-6 text-center text-[#6c7086]">No open positions</div>`;
    return;
  }
  el.innerHTML = positions.map((p) => `
    <div class="card p-4 fade-in">
      <div class="flex items-start justify-between mb-3">
        <div>
          <h3 class="font-semibold">${p.pair || "Unknown"}</h3>
          <p class="text-xs text-[#6c7086]">${p.strategy || ""} &middot; ${formatAge(p.age_minutes)}</p>
        </div>
        <div class="text-right">
          <p class="text-lg font-bold ${pctColor(p.pnl_pct)}">${formatPct(p.pnl_pct)}</p>
          <p class="text-xs text-[#6c7086]">${formatUsd(p.pnl_usd)}</p>
        </div>
      </div>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3 text-xs">
        <div>
          <span class="text-[#6c7086]">Value</span>
          <p class="font-medium">${formatUsd(p.total_value_usd)}</p>
        </div>
        <div>
          <span class="text-[#6c7086]">Fees</span>
          <p class="font-medium">${formatUsd(p.unclaimed_fees_usd)}</p>
        </div>
        <div>
          <span class="text-[#6c7086]">Fee/TVL 24h</span>
          <p class="font-medium">${p.fee_per_tvl_24h != null ? p.fee_per_tvl_24h.toFixed(1) + "%" : "--"}</p>
        </div>
        <div>
          <span class="text-[#6c7086]">Status</span>
          <p><span class="badge ${p.in_range ? 'badge-green' : 'badge-red'}">${p.in_range ? "In Range" : "Out of Range"}</span></p>
        </div>
      </div>
      <div class="mb-2">
        <div class="flex justify-between text-xs text-[#6c7086] mb-1">
          <span>Bin ${p.lower_bin}</span>
          <span>Active: ${p.active_bin}</span>
          <span>Bin ${p.upper_bin}</span>
        </div>
        ${rangeBar(p.lower_bin, p.upper_bin, p.active_bin, p.in_range)}
      </div>
      ${p.trailing_active ? '<p class="text-xs text-[#f9e2af] mt-1">Trailing TP active (peak: ' + formatPct(p.peak_pnl_pct) + ')</p>' : ''}
      ${p.instruction ? '<p class="text-xs text-[#89b4fa] mt-1">Note: ' + escHtml(p.instruction) + '</p>' : ''}
      <p class="text-xs text-[#45475a] mt-2 truncate">${p.position}</p>
    </div>`).join("");
}

function escHtml(s) {
  return s?.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") || "";
}

// ─── Terminal ───────────────────────────────────────
function pageTerminal() {
  const app = document.getElementById("app");
  app.innerHTML = `<div class="fade-in flex flex-col h-[calc(100vh-3rem)]">
    <h2 class="text-xl font-bold mb-4">Terminal</h2>
    <div id="terminal-output" class="terminal-output flex-1 overflow-y-auto card p-4 mb-3 whitespace-pre-wrap"></div>
    <form id="terminal-form" class="flex gap-2">
      <span class="text-[#cba6f7] self-center font-mono">&gt;</span>
      <input type="text" id="terminal-input"
        class="terminal-input flex-1 bg-[#313244] border border-[#45475a] rounded-lg px-3 py-2 text-sm text-[#cdd6f4] focus:outline-none focus:border-[#cba6f7]"
        placeholder="balance, positions, or ask the agent anything..."
        autocomplete="off">
      <button type="submit" class="px-4 py-2 bg-[#cba6f7] text-[#11111b] rounded-lg font-medium text-sm hover:bg-[#b4befe]">Send</button>
    </form>
  </div>`;

  const output = document.getElementById("terminal-output");
  const input = document.getElementById("terminal-input");
  const history = [];
  let historyIdx = -1;

  output.innerHTML = `<span class="text-[#6c7086]">Meridian Terminal. Type CLI commands (balance, positions, config get) or natural language.\n\n</span>`;

  function appendOutput(text, cls = "") {
    const span = document.createElement("span");
    if (cls) span.className = cls;
    span.textContent = text;
    output.appendChild(span);
    output.scrollTop = output.scrollHeight;
  }

  function onTerminalMsg(e) {
    const msg = e.detail;
    if (msg.type === "command_output") {
      appendOutput(msg.payload.text);
    } else if (msg.type === "tool_start") {
      appendOutput(`  [${msg.payload.name}] `, "text-[#89b4fa]");
    } else if (msg.type === "tool_finish") {
      appendOutput(msg.payload.success ? "done\n" : "failed\n", msg.payload.success ? "text-[#a6e3a1]" : "text-[#f38ba8]");
    } else if (msg.type === "agent_response") {
      appendOutput("\n");
    }
  }

  window.addEventListener("terminal-msg", onTerminalMsg);
  const cleanup = () => window.removeEventListener("terminal-msg", onTerminalMsg);
  state.refreshTimers.push({ clear: cleanup, [Symbol.toPrimitive]: () => 0 });

  document.getElementById("terminal-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    history.unshift(text);
    historyIdx = -1;
    input.value = "";
    wsSend("command", { text });
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (historyIdx < history.length - 1) {
        historyIdx++;
        input.value = history[historyIdx];
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIdx > 0) {
        historyIdx--;
        input.value = history[historyIdx];
      } else {
        historyIdx = -1;
        input.value = "";
      }
    }
  });

  input.focus();
}

// ─── Performance ────────────────────────────────────
async function pagePerformance() {
  const app = document.getElementById("app");
  app.innerHTML = `<div class="fade-in">
    <h2 class="text-xl font-bold mb-4">Performance</h2>
    <div id="perf-stats" class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6"></div>
    <div class="card p-4 mb-4">
      <canvas id="perf-chart" height="200"></canvas>
    </div>
    <div id="perf-history" class="card p-4"></div>
  </div>`;

  const [summary, history] = await Promise.all([
    api("/performance").catch(() => ({})),
    api("/performance/history?hours=168&limit=100").catch(() => ({ positions: [] })),
  ]);

  document.getElementById("perf-stats").innerHTML = `
    <div class="card p-4">
      <p class="text-xs text-[#6c7086] mb-1">Total PnL</p>
      <p class="stat-value ${pctColor(summary.total_pnl_usd)}">${formatUsd(summary.total_pnl_usd)}</p>
    </div>
    <div class="card p-4">
      <p class="text-xs text-[#6c7086] mb-1">Win Rate</p>
      <p class="stat-value text-[#cba6f7]">${summary.win_rate_pct != null ? summary.win_rate_pct.toFixed(1) + "%" : "--"}</p>
    </div>
    <div class="card p-4">
      <p class="text-xs text-[#6c7086] mb-1">Avg PnL</p>
      <p class="stat-value ${pctColor(summary.avg_pnl_pct)}">${formatPct(summary.avg_pnl_pct)}</p>
    </div>
    <div class="card p-4">
      <p class="text-xs text-[#6c7086] mb-1">Avg Efficiency</p>
      <p class="stat-value text-[#89b4fa]">${summary.avg_range_efficiency_pct != null ? summary.avg_range_efficiency_pct.toFixed(1) + "%" : "--"}</p>
    </div>`;

  // Chart
  const positions = (history.positions || []).slice().reverse();
  if (positions.length && typeof Chart !== "undefined") {
    let cumPnl = 0;
    const labels = [];
    const data = [];
    for (const p of positions) {
      cumPnl += p.pnl_usd || 0;
      labels.push(p.pool_name || p.pool?.slice(0, 8) || "");
      data.push(Number(cumPnl.toFixed(2)));
    }

    new Chart(document.getElementById("perf-chart"), {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: "Cumulative PnL (USD)",
          data,
          borderColor: "#cba6f7",
          backgroundColor: "rgba(203,166,247,0.1)",
          fill: true,
          tension: 0.3,
          pointRadius: 3,
          pointBackgroundColor: data.map((v) => v >= 0 ? "#a6e3a1" : "#f38ba8"),
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { labels: { color: "#6c7086" } } },
        scales: {
          x: { ticks: { color: "#6c7086", maxRotation: 45 }, grid: { color: "#31324422" } },
          y: { ticks: { color: "#6c7086" }, grid: { color: "#31324422" } },
        },
      },
    });
  }

  // History table
  const histEl = document.getElementById("perf-history");
  if (positions.length) {
    histEl.innerHTML = `<h3 class="text-sm font-semibold mb-3 text-[#cba6f7]">Recent Closes</h3>
      <div class="overflow-x-auto">
      <table class="w-full text-xs">
        <thead><tr class="text-[#6c7086] border-b border-[#313244]">
          <th class="text-left py-2">Pool</th>
          <th class="text-right">PnL</th>
          <th class="text-right">Fees</th>
          <th class="text-right">Efficiency</th>
          <th class="text-right">Held</th>
          <th class="text-left pl-3">Reason</th>
        </tr></thead>
        <tbody>${positions.slice().reverse().slice(0, 30).map((p) => `
          <tr class="border-b border-[#313244] hover:bg-[#313244]">
            <td class="py-2">${p.pool_name || "--"}</td>
            <td class="text-right ${pctColor(p.pnl_pct)}"><span class="font-medium">${formatPct(p.pnl_pct)}</span> <span class="text-[#6c7086]">(${formatUsd(p.pnl_usd)})</span></td>
            <td class="text-right text-[#a6e3a1]">${formatUsd(p.fees_earned_usd)}</td>
            <td class="text-right">${p.range_efficiency != null ? p.range_efficiency.toFixed(0) + "%" : "--"}</td>
            <td class="text-right">${formatAge(p.minutes_held)}</td>
            <td class="pl-3"><span class="badge badge-blue">${p.close_reason || "--"}</span></td>
          </tr>`).join("")}
        </tbody>
      </table></div>`;
  } else {
    histEl.innerHTML = `<p class="text-sm text-[#6c7086]">No closed positions yet</p>`;
  }
}

// ─── Lessons ────────────────────────────────────────
async function pageLessons() {
  const app = document.getElementById("app");
  app.innerHTML = `<div class="fade-in">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-xl font-bold">Lessons</h2>
      <button id="add-lesson-btn" class="px-3 py-1.5 bg-[#cba6f7] text-[#11111b] rounded-lg text-xs font-medium hover:bg-[#b4befe]">+ Add Lesson</button>
    </div>
    <div id="lesson-filters" class="flex gap-2 mb-4 flex-wrap"></div>
    <div id="lessons-list" class="space-y-2"><p class="text-[#6c7086]">Loading...</p></div>
    <div id="add-lesson-modal" class="hidden fixed inset-0 bg-black/50 z-50 flex items-center justify-center"></div>
  </div>`;

  let filter = {};
  await loadLessons();

  document.getElementById("add-lesson-btn").addEventListener("click", showAddLessonModal);

  async function loadLessons() {
    const qs = new URLSearchParams();
    if (filter.role) qs.set("role", filter.role);
    if (filter.pinned) qs.set("pinned", "true");
    if (filter.tag) qs.set("tag", filter.tag);
    const data = await api(`/lessons?${qs}`);
    renderLessonFilters(data);
    renderLessons(data);
  }

  function renderLessonFilters(data) {
    const tags = new Set();
    (data.lessons || []).forEach((l) => (l.tags || []).forEach((t) => tags.add(t)));

    document.getElementById("lesson-filters").innerHTML = `
      <button class="badge ${!filter.pinned ? 'badge-purple' : 'bg-[#313244] text-[#6c7086]'}" data-filter="all">All (${data.total})</button>
      <button class="badge ${filter.pinned ? 'badge-purple' : 'bg-[#313244] text-[#6c7086]'}" data-filter="pinned">Pinned</button>
      ${[...tags].slice(0, 6).map((t) => `<button class="badge ${filter.tag === t ? 'badge-purple' : 'bg-[#313244] text-[#6c7086]'}" data-filter="tag:${t}">${t}</button>`).join("")}`;

    document.getElementById("lesson-filters").addEventListener("click", (e) => {
      const f = e.target.dataset.filter;
      if (!f) return;
      if (f === "all") filter = {};
      else if (f === "pinned") filter = { pinned: true };
      else if (f.startsWith("tag:")) filter = { tag: f.slice(4) };
      loadLessons();
    });
  }

  function renderLessons(data) {
    const el = document.getElementById("lessons-list");
    if (!data.lessons?.length) {
      el.innerHTML = `<p class="text-sm text-[#6c7086]">No lessons found</p>`;
      return;
    }
    el.innerHTML = data.lessons.map((l) => `
      <div class="card p-3 fade-in">
        <div class="flex items-start justify-between gap-3">
          <div class="flex-1">
            <p class="text-sm">${escHtml(l.rule)}</p>
            <div class="flex gap-1 mt-2 flex-wrap">
              ${(l.tags || []).map((t) => `<span class="badge bg-[#313244] text-[#6c7086]">${t}</span>`).join("")}
              <span class="badge badge-${l.outcome === 'good' ? 'green' : l.outcome === 'bad' ? 'red' : 'blue'}">${l.outcome}</span>
              ${l.role ? `<span class="badge badge-purple">${l.role}</span>` : ""}
              ${l.pinned ? '<span class="badge badge-yellow">pinned</span>' : ""}
            </div>
          </div>
          <div class="flex gap-1 flex-shrink-0">
            <button class="text-xs px-2 py-1 rounded bg-[#313244] hover:bg-[#45475a]" data-pin="${l.id}" data-pinned="${l.pinned}">${l.pinned ? "Unpin" : "Pin"}</button>
            <button class="text-xs px-2 py-1 rounded bg-[#3e1a1a] text-[#f38ba8] hover:bg-[#5e2a2a]" data-delete="${l.id}">Del</button>
          </div>
        </div>
      </div>`).join("");

    el.addEventListener("click", async (e) => {
      const pinId = e.target.dataset.pin;
      const delId = e.target.dataset.delete;
      if (pinId) {
        const isPinned = e.target.dataset.pinned === "true";
        await api(`/lessons/${pinId}/pin`, { method: isPinned ? "DELETE" : "POST" });
        loadLessons();
      }
      if (delId) {
        await api(`/lessons/${delId}`, { method: "DELETE" });
        loadLessons();
      }
    });
  }

  function showAddLessonModal() {
    const modal = document.getElementById("add-lesson-modal");
    modal.classList.remove("hidden");
    modal.innerHTML = `<div class="card p-6 w-full max-w-md">
      <h3 class="text-lg font-bold mb-4">Add Lesson</h3>
      <textarea id="new-lesson-rule" rows="3" placeholder="Lesson rule..."
        class="w-full bg-[#313244] border border-[#45475a] rounded-lg p-3 text-sm text-[#cdd6f4] mb-3"></textarea>
      <input id="new-lesson-tags" placeholder="Tags (comma-separated)"
        class="w-full bg-[#313244] border border-[#45475a] rounded-lg px-3 py-2 text-sm text-[#cdd6f4] mb-3">
      <div class="flex gap-2">
        <button id="save-lesson" class="px-4 py-2 bg-[#cba6f7] text-[#11111b] rounded-lg text-sm font-medium">Save</button>
        <button id="cancel-lesson" class="px-4 py-2 bg-[#313244] rounded-lg text-sm">Cancel</button>
      </div>
    </div>`;
    document.getElementById("cancel-lesson").addEventListener("click", () => modal.classList.add("hidden"));
    document.getElementById("save-lesson").addEventListener("click", async () => {
      const rule = document.getElementById("new-lesson-rule").value.trim();
      const tags = document.getElementById("new-lesson-tags").value.split(",").map((s) => s.trim()).filter(Boolean);
      if (!rule) return;
      await api("/lessons", { method: "POST", body: { rule, tags, pinned: false } });
      modal.classList.add("hidden");
      loadLessons();
      toast("Lesson added", "success");
    });
  }
}

// ─── Config ─────────────────────────────────────────
async function pageConfig() {
  const app = document.getElementById("app");
  app.innerHTML = `<div class="fade-in">
    <h2 class="text-xl font-bold mb-4">Configuration</h2>
    <div id="config-sections" class="space-y-4"><p class="text-[#6c7086]">Loading...</p></div>
  </div>`;

  const cfg = await api("/config");
  const sections = Object.entries(cfg).filter(([, v]) => typeof v === "object" && v !== null && !Array.isArray(v));
  const el = document.getElementById("config-sections");

  el.innerHTML = sections.map(([section, values]) => `
    <div class="card p-4">
      <h3 class="text-sm font-semibold text-[#cba6f7] mb-3 uppercase tracking-wider">${section}</h3>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
        ${Object.entries(values).map(([key, val]) => `
          <div class="flex items-center justify-between py-1.5 px-2 rounded hover:bg-[#313244] group">
            <span class="text-xs text-[#6c7086]">${key}</span>
            <span class="text-xs font-mono ${typeof val === 'boolean' ? (val ? 'text-[#a6e3a1]' : 'text-[#f38ba8]') : 'text-[#cdd6f4]'}"
              title="Click to edit" data-section="${section}" data-key="${key}" data-val="${escHtml(JSON.stringify(val))}"
              style="cursor:pointer">${formatConfigValue(val)}</span>
          </div>`).join("")}
      </div>
    </div>`).join("");

  el.addEventListener("click", (e) => {
    const t = e.target.closest("[data-key]");
    if (!t) return;
    const key = t.dataset.key;
    const current = t.dataset.val;
    if (current === '"***"') return toast("Cannot edit redacted values", "error");
    const newVal = prompt(`Edit ${key}:`, JSON.parse(current));
    if (newVal === null) return;
    let parsed;
    try { parsed = JSON.parse(newVal); } catch { parsed = newVal; }
    api("/config", { method: "POST", body: { changes: { [key]: parsed }, reason: "Dashboard edit" } })
      .then(() => { toast(`${key} updated`, "success"); pageConfig(); })
      .catch((err) => toast(err.message, "error"));
  });
}

function formatConfigValue(val) {
  if (val === null) return "null";
  if (typeof val === "boolean") return val ? "true" : "false";
  if (Array.isArray(val)) return `[${val.length}]`;
  if (typeof val === "object") return "{...}";
  const s = String(val);
  return s.length > 30 ? s.slice(0, 30) + "..." : s;
}

// ─── Decisions ──────────────────────────────────────
async function pageDecisions() {
  const app = document.getElementById("app");
  app.innerHTML = `<div class="fade-in">
    <h2 class="text-xl font-bold mb-4">Decision Log</h2>
    <div id="decisions-list" class="space-y-3"><p class="text-[#6c7086]">Loading...</p></div>
  </div>`;

  const data = await api("/decisions?limit=30");
  const el = document.getElementById("decisions-list");

  if (!data.decisions?.length) {
    el.innerHTML = `<p class="text-sm text-[#6c7086]">No decisions recorded</p>`;
    return;
  }

  el.innerHTML = data.decisions.map((d) => `
    <div class="card p-4 fade-in">
      <div class="flex items-start justify-between mb-2">
        <div class="flex items-center gap-2">
          <span class="badge badge-${d.type === 'deploy' ? 'green' : d.type === 'close' ? 'red' : d.type === 'skip' ? 'yellow' : 'blue'}">${d.type}</span>
          <span class="badge badge-purple">${d.actor}</span>
          ${d.pool_name ? `<span class="text-sm font-medium">${escHtml(d.pool_name)}</span>` : ""}
        </div>
        <span class="text-xs text-[#6c7086]">${timeAgo(d.ts)}</span>
      </div>
      ${d.summary ? `<p class="text-sm mb-2">${escHtml(d.summary)}</p>` : ""}
      ${d.reason ? `<p class="text-xs text-[#6c7086] mb-2"><strong>Reason:</strong> ${escHtml(d.reason)}</p>` : ""}
      ${d.risks?.length ? `<div class="text-xs mb-1"><strong class="text-[#f38ba8]">Risks:</strong> ${d.risks.map((r) => escHtml(r)).join(", ")}</div>` : ""}
      ${d.rejected?.length ? `<div class="text-xs text-[#6c7086]"><strong>Rejected:</strong> ${d.rejected.map((r) => escHtml(r)).join("; ")}</div>` : ""}
    </div>`).join("");
}

// ─── Pools ──────────────────────────────────────────
async function pagePools() {
  const app = document.getElementById("app");
  app.innerHTML = `<div class="fade-in">
    <h2 class="text-xl font-bold mb-4">Pool Memory</h2>
    <form id="pool-search" class="flex gap-2 mb-4">
      <input type="text" id="pool-address" placeholder="Pool address..."
        class="flex-1 bg-[#313244] border border-[#45475a] rounded-lg px-3 py-2 text-sm text-[#cdd6f4] focus:outline-none focus:border-[#cba6f7]">
      <button type="submit" class="px-4 py-2 bg-[#cba6f7] text-[#11111b] rounded-lg text-sm font-medium">Search</button>
    </form>
    <div id="pool-result"></div>
  </div>`;

  document.getElementById("pool-search").addEventListener("submit", async (e) => {
    e.preventDefault();
    const addr = document.getElementById("pool-address").value.trim();
    if (!addr) return;
    const el = document.getElementById("pool-result");
    el.innerHTML = `<p class="text-[#6c7086]">Loading...</p>`;
    try {
      const mem = await api(`/pools/memory/${addr}`);
      if (!mem.known) {
        el.innerHTML = `<div class="card p-4 text-[#6c7086]">No memory for this pool</div>`;
        return;
      }
      el.innerHTML = `
        <div class="card p-4 mb-4">
          <h3 class="font-semibold mb-2">${escHtml(mem.name || addr)}</h3>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div><span class="text-[#6c7086]">Deploys</span><p class="font-medium">${mem.total_deploys}</p></div>
            <div><span class="text-[#6c7086]">Avg PnL</span><p class="font-medium ${pctColor(mem.avg_pnl_pct)}">${formatPct(mem.avg_pnl_pct)}</p></div>
            <div><span class="text-[#6c7086]">Win Rate</span><p class="font-medium">${mem.win_rate != null ? mem.win_rate.toFixed(0) + "%" : "--"}</p></div>
            <div><span class="text-[#6c7086]">Last Outcome</span><p class="font-medium">${mem.last_outcome || "--"}</p></div>
          </div>
          ${mem.cooldown_until ? `<p class="text-xs text-[#f38ba8] mt-2">Cooldown until ${new Date(mem.cooldown_until).toLocaleString()}: ${mem.cooldown_reason}</p>` : ""}
        </div>
        ${(mem.history || []).length ? `
          <div class="card p-4">
            <h4 class="text-sm font-semibold text-[#cba6f7] mb-2">Deploy History</h4>
            ${mem.history.map((h) => `
              <div class="flex items-center justify-between py-2 border-b border-[#313244] last:border-0 text-xs">
                <div>
                  <span class="badge ${(h.pnl_pct || 0) >= 0 ? 'badge-green' : 'badge-red'}">${formatPct(h.pnl_pct)}</span>
                  <span class="ml-2">${h.strategy || "--"}</span>
                </div>
                <div class="text-right text-[#6c7086]">
                  <span>${formatAge(h.minutes_held)}</span>
                  <span class="ml-2">${h.close_reason || "--"}</span>
                </div>
              </div>`).join("")}
          </div>` : ""}`;
    } catch (err) {
      el.innerHTML = `<p class="text-[#f38ba8]">${err.message}</p>`;
    }
  });
}

// ─── Strategies ─────────────────────────────────────
async function pageStrategies() {
  const app = document.getElementById("app");
  app.innerHTML = `<div class="fade-in">
    <h2 class="text-xl font-bold mb-4">Strategy Library</h2>
    <div id="strategies-list" class="space-y-4"><p class="text-[#6c7086]">Loading...</p></div>
  </div>`;

  try {
    const data = await api("/strategies");
    const el = document.getElementById("strategies-list");

    if (!data.strategies?.length) {
      el.innerHTML = `<p class="text-sm text-[#6c7086]">No strategies saved</p>`;
      return;
    }

    el.innerHTML = data.strategies.map((s) => `
      <div class="card p-4 fade-in ${s.active ? 'border-[#cba6f7]' : ''}">
        <div class="flex items-start justify-between mb-2">
          <div>
            <h3 class="font-semibold">${escHtml(s.name)}</h3>
            <p class="text-xs text-[#6c7086]">${escHtml(s.author || "")} &middot; ${s.lp_strategy}</p>
          </div>
          ${s.active ? '<span class="badge badge-purple">Active</span>' : ""}
        </div>
        ${s.best_for ? `<p class="text-sm text-[#6c7086]">${escHtml(s.best_for)}</p>` : ""}
      </div>`).join("");
  } catch (err) {
    document.getElementById("strategies-list").innerHTML = `<p class="text-[#f38ba8]">${err.message}</p>`;
  }
}
