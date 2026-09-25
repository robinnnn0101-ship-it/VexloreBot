const { Bot, InlineKeyboard, InputFile } = require("grammy");
const fs = require("fs");
const path = require("path");

const bot = new Bot(process.env.BOT_TOKEN);
const ST_KEY = process.env.SOLANA_TRACKER_KEY || "";
const X_BEARER = String(process.env.X_BEARER || "")
  .trim()
  .replace(/^Bearer\s+/i, "")
  .replace(/^["']+|["']+$/g, "");
const GH_TOKEN = process.env.GITHUB_TOKEN || "";
const FOOTER = "\n\n❤️ Made by Robin with Love";
// Prefer Railway volume (or DATA_DIR) so calls survive redeploys.
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, "vexlore-data.json");
const CALL_DEDUPE_MS = 60 * 60 * 1000;
const PEAK_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const ST_CACHE_MS = 75 * 1000;
const WATCH_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const RH_CHAIN_ID = 4663;
const RH_DEX_SLUGS = ["robinhood", "robinhoodchain"];
const RH_EXPLORER = "https://robinhoodchain.blockscout.com";
const RH_BS = "https://robinhoodchain.blockscout.com/api/v2";
const RH_BS_RPC = "https://robinhoodchain.blockscout.com/api";
const RH_BS_PRO = "https://api.blockscout.com/4663/api/v2";
const RH_GECKO = "https://api.geckoterminal.com/api/v2/networks/robinhood";
const RH_ASSETS = "https://api.robinhood.com/rhj/assets";
const RH_PRICE = "https://api.robinhood.com/rhj/prices/";
const RH_PAPRIKA = "https://api.dexpaprika.com/networks/robinhood";
const SF_SOL_API = "https://www.stonkfun.xyz/api/public/v1";
const STONKS_FUN = "https://stonks.fun";
const STONKSFUN_XYZ = "https://www.stonksfun.xyz";
const BASESTONK_API = "https://api.basestonk.io";

const ARC_CHAIN_ID = 5042;
const ARC_DEX_SLUGS = ["arc"];
const ARC_EXPLORER = "https://explorer.arc.io";
const ARC_BS = "https://explorer.arc.io/api/v2";
const ARC_BS_RPC = "https://explorer.arc.io/api";
const ARC_BS_PRO = "https://api.blockscout.com/5042/api/v2";
const ARC_GECKO = "https://api.geckoterminal.com/api/v2/networks/arc";
const ARC_PAPRIKA = "https://api.dexpaprika.com/networks/arc";
const ARC_SCAN_API = "https://api.arc-scan.org/v1";
const ARC_EXPLORER_FALLBACK = "https://www.arcexplorer.org";

/* ───────── helpers ───────── */

function isCa(t) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(t || "").trim());
}

function isEvmCa(t) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(t || "").trim());
}

function isSnsName(t) {
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:sol|sns)$/i.test(
    String(t || "").trim()
  );
}

function extractCa(text) {
  const m = String(text || "").match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
  return m ? m[0] : "";
}

function extractEvmCa(text) {
  const m = String(text || "").match(/0x[a-fA-F0-9]{40}/i);
  return m ? m[0] : "";
}

function extractAnyCa(text) {
  const evm = extractEvmCa(text);
  if (isEvmCa(evm)) return { chain: "rh", ca: evm };
  const sol = extractCa(text);
  if (isCa(sol)) return { chain: "sol", ca: sol };
  return { chain: "", ca: "" };
}

function extractSnsName(text) {
  const m = String(text || "").match(
    /\b([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*)\.(sol|sns)\b/i
  );
  return m ? String(m[1] + "." + m[2]).toLowerCase() : "";
}

function extractStonksLink(text) {
  const raw = String(text || "");
  const sol = raw.match(
    /(?:https?:\/\/)?(?:www\.)?stonkfun\.xyz\/token\/([1-9A-HJ-NP-Za-km-z]{32,44})/i
  );
  if (sol && isCa(sol[1])) return { chain: "sol", ca: sol[1] };
  const evm = raw.match(
    /(?:https?:\/\/)?(?:www\.)?(?:stonks\.fun|stonksfun\.xyz)\/(?:coin|token|stonk|basket)\/(0x[a-fA-F0-9]{40})/i
  );
  if (evm && isEvmCa(evm[1])) return { chain: "rh", ca: evm[1] };
  return null;
}

function toDate(n) {
  if (n == null || n === "") return null;
  if (typeof n === "string" && n.includes("-") && n.length >= 8) {
    const d = new Date(n);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return null;
  return new Date(x < 1e11 ? x * 1000 : x);
}

function utc(d) {
  if (!d || Number.isNaN(d.getTime())) return "unknown";
  const p = (n) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear() +
    "-" + p(d.getUTCMonth() + 1) +
    "-" + p(d.getUTCDate()) +
    " " + p(d.getUTCHours()) +
    ":" + p(d.getUTCMinutes()) +
    ":" + p(d.getUTCSeconds()) +
    " UTC"
  );
}

function money(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "n/a";
  const sign = x < 0 ? "-" : "";
  const a = Math.abs(x);
  if (a >= 1e9) return sign + "$" + (a / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return sign + "$" + (a / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return sign + "$" + (a / 1e3).toFixed(2) + "K";
  return sign + "$" + a.toFixed(2);
}

function moneyMkt(n) {
  const x = num(n);
  return x == null ? "n/a" : money(x);
}

function holdHuman(sec) {
  const s = Number(sec);
  if (!Number.isFinite(s) || s < 0) return "n/a";
  if (s < 60) return Math.round(s) + "s";
  if (s < 3600) return (s / 60).toFixed(1) + "m";
  if (s < 86400) return (s / 3600).toFixed(1) + "h";
  return (s / 86400).toFixed(1) + "d";
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function short(a) {
  a = String(a || "");
  if (a.startsWith("0x") && a.length >= 10) return a.slice(0, 6) + "…" + a.slice(-4);
  return a.slice(0, 4) + "…" + a.slice(-4);
}

function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function rhCleanName(s) {
  return norm(
    String(s || "")
      .replace(/[•·|_]/g, " ")
      .replace(/\brobinhood\s+token\b/gi, " ")
      .replace(/\btokenized\s+(?:stock|equity|share)s?\b/gi, " ")
      .replace(/\bstock\s+token\b/gi, " ")
      .replace(/\brobinhood\b/gi, " ")
      .replace(/\b(?:token|coin|meme)\b/gi, " ")
  );
}

function sameRhName(a, b) {
  if (sameTicker(a, b)) return true;
  const x = rhCleanName(a);
  const y = rhCleanName(b);
  return !!(x && y && x.length >= 3 && y.length >= 3 && x === y);
}

function pct(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "n/a";
  return x.toFixed(2) + "%";
}

function num(n) {
  const x = Number(n);
  return Number.isFinite(x) && x > 0 ? x : null;
}

function countOrZero(n) {
  const x = Number(String(n == null ? "" : n).replace(/,/g, ""));
  return Number.isFinite(x) && x >= 0 ? x : null;
}

function xs(mult) {
  const x = Number(mult);
  if (!Number.isFinite(x) || x <= 0) return "n/a";
  if (x >= 100) return x.toFixed(0) + "x";
  if (x >= 10) return x.toFixed(1) + "x";
  return x.toFixed(2) + "x";
}

function gainPct(mult) {
  const x = Number(mult);
  if (!Number.isFinite(x) || x <= 0) return "n/a";
  const p = (x - 1) * 100;
  const sign = p >= 0 ? "+" : "";
  return sign + p.toFixed(1) + "%";
}

function displayUser(c) {
  if (c.username) return "@" + c.username;
  return c.name || ("id" + c.userId);
}

function isGroupChat(chat) {
  return !!(chat && (chat.type === "group" || chat.type === "supergroup"));
}

async function jget(url, headers = {}) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "VEXLORE-Bot",
      Accept: "application/json",
      ...headers,
    },
    signal: AbortSignal.timeout(18000),
  });
  let data = null;
  try {
    data = await res.json();
  } catch (_) {}
  return { ok: res.ok, status: res.status, data };
}

function soft(p) {
  return Promise.resolve(p).catch(() => null);
}

function pickResolvedPubkey(data) {
  if (!data) return "";
  if (typeof data === "string" && isCa(data) && !isEvmCa(data)) return data.trim();
  if (typeof data !== "object") return "";
  const bag = [
    data.result,
    data.value,
    data.owner,
    data.address,
    data.pubkey,
    data.publicKey,
    data.public_key,
    data.wallet,
    data.resolved,
    data.data,
  ];
  for (const item of bag) {
    if (typeof item === "string" && isCa(item) && !isEvmCa(item)) return item.trim();
    if (item && typeof item === "object") {
      const inner =
        item.result ||
        item.value ||
        item.owner ||
        item.address ||
        item.pubkey ||
        item.publicKey ||
        item.wallet;
      if (typeof inner === "string" && isCa(inner) && !isEvmCa(inner)) return inner.trim();
    }
  }
  return "";
}

function snsNameVariants(name) {
  const raw = String(name || "").trim().toLowerCase().replace(/^@/, "");
  if (!isSnsName(raw)) return [];
  const base = raw.replace(/\.(sol|sns)$/i, "");
  return [...new Set([raw, base + ".sns", base + ".sol"])];
}

async function resolveSnsDomain(name) {
  const variants = snsNameVariants(name);
  if (!variants.length) return "";
  const hosts = [
    "https://sdk-proxy-v2.sns.id/resolve/",
    "https://sdk-proxy.sns.id/resolve/",
    "https://sns-sdk-proxy.bonfida.org/resolve/",
  ];
  for (const domain of variants) {
    for (const host of hosts) {
      const r = await soft(jget(host + encodeURIComponent(domain)));
      const pk = pickResolvedPubkey(r && r.data);
      if (pk) return pk;
    }
  }
  return "";
}

async function resolveWalletTarget(text) {
  const hit = extractAnyCa(text);
  if (hit.chain === "sol" && isCa(hit.ca) && !isEvmCa(hit.ca)) {
    return { ca: hit.ca, domain: "" };
  }
  const domain = extractSnsName(text);
  if (!domain) return { ca: "", domain: "" };
  const ca = await resolveSnsDomain(domain);
  return { ca, domain };
}

function xHeaders() {
  return {
    Authorization: "Bearer " + X_BEARER,
    "User-Agent": "VEXLORE-Bot",
    Accept: "application/json",
  };
}

async function xApi(pathAndQuery) {
  if (!X_BEARER) return { ok: false, status: 0, data: null };
  let last = { ok: false, status: 0, data: null };
  for (const host of ["https://api.x.com", "https://api.twitter.com"]) {
    const r = await jget(host + pathAndQuery, xHeaders());
    last = r;
    if (r.ok && r.data) return r;
    if (r.status && r.status !== 404 && r.status < 500) return r;
  }
  return last;
}

function xApiErr(r) {
  const d = r && r.data;
  const title = d && d.title ? String(d.title) : "";
  const detail = d && d.detail ? String(d.detail) : "";
  if (!r || !r.status) return "X API request failed";
  if (r.status === 401 || r.status === 403) {
    return (
      "X API denied this token (" +
      r.status +
      ")" +
      (detail ? " · " + detail : "") +
      (title ? " · " + title : "")
    );
  }
  if (r.status === 402) return "X API plan cannot use this endpoint";
  if (r.status === 429) {
    return detail && /usage/i.test(detail)
      ? "X API usage cap exceeded"
      : "X API rate limit. Try again in a minute.";
  }
  return (
    "X lookup failed (" +
    r.status +
    ")" +
    (title ? " · " + title : "") +
    (detail ? " · " + detail : "")
  );
}

const stCache = new Map();
const stInflight = new Map();

async function st(path) {
  if (!ST_KEY) return null;
  const hit = stCache.get(path);
  if (hit && Date.now() - hit.at < ST_CACHE_MS) return hit.data;
  if (stInflight.has(path)) return stInflight.get(path);

  const job = (async () => {
    const r = await jget("https://data.solanatracker.io" + path, {
      "x-api-key": ST_KEY,
    });
    const data = r.ok ? r.data : null;
    stCache.set(path, { at: Date.now(), data });
    if (stCache.size > 400) {
      const now = Date.now();
      for (const [k, v] of stCache) {
        if (now - v.at > ST_CACHE_MS * 2) stCache.delete(k);
      }
    }
    return data;
  })();

  stInflight.set(path, job);
  try {
    return await job;
  } finally {
    stInflight.delete(path);
  }
}

/* ───────── persist ───────── */

const store = {
  groups: {},
  calls: [],
  lastGmDay: "",
};

function loadStore() {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    store.groups = raw.groups && typeof raw.groups === "object" ? raw.groups : {};
    store.calls = Array.isArray(raw.calls) ? raw.calls : [];
    store.lastGmDay = raw.lastGmDay || "";
  } catch (e) {
    console.error("load store fail", e.message || e);
  }
}

let saveTimer = null;
function saveStore(now = false) {
  const write = () => {
    try {
      try {
        fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      } catch (_) {}
      fs.writeFileSync(
        DATA_FILE,
        JSON.stringify(
          {
            groups: store.groups,
            calls: store.calls,
            lastGmDay: store.lastGmDay,
          },
          null,
          2
        )
      );
    } catch (e) {
      console.error("save store fail", e.message || e, DATA_FILE);
    }
  };
  if (now) return write();
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(write, 800);
}

function touchGroup(chat) {
  if (!isGroupChat(chat)) return;
  const id = String(chat.id);
  const prev = store.groups[id] || {};
  store.groups[id] = {
    id: chat.id,
    title: chat.title || prev.title || "this group",
    username: chat.username || prev.username || "",
    active: true,
  };
  saveStore();
}

function dropGroup(chat) {
  if (!chat) return;
  const id = String(chat.id);
  if (store.groups[id]) {
    store.groups[id].active = false;
    saveStore();
  }
}

loadStore();

/* ───────── solana data sources (never used for RH) ───────── */

async function pumpCoin(ca) {
  if (isEvmCa(ca)) return null;
  const r = await jget("https://frontend-api-v3.pump.fun/coins/" + ca);
  if (!r.ok || !r.data || !r.data.mint) return null;
  return r.data;
}

async function pumpSearch(params) {
  const q = new URLSearchParams(params);
  const r = await jget("https://frontend-api-v3.pump.fun/coins/search?" + q.toString());
  const list = r.data && (r.data.data || r.data.coins || r.data);
  return Array.isArray(list) ? list : [];
}

function asReplyList(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const nested = data.data && typeof data.data === "object" ? data.data : null;
  const list =
    data.replies ||
    data.comments ||
    data.callouts ||
    data.items ||
    data.results ||
    data.list ||
    (nested && (nested.replies || nested.comments || nested.callouts || nested.items || nested.results)) ||
    data.data;
  return Array.isArray(list) ? list : [];
}

function replyWhen(row) {
  if (!row || typeof row !== "object") return null;
  return (
    toDate(
      row.timestamp ||
        row.created_timestamp ||
        row.created_at ||
        row.createdAt ||
        row.time ||
        row.date ||
        row.created ||
        (row.callout && (row.callout.timestamp || row.callout.createdAt))
    ) || null
  );
}

function replyUser(row) {
  if (!row || typeof row !== "object") return { name: "", addr: "" };
  const u = row.user && typeof row.user === "object" ? row.user : null;
  const caller = row.caller && typeof row.caller === "object" ? row.caller : null;
  const addr = String(
    (typeof row.user === "string" && row.user) ||
      row.address ||
      row.wallet ||
      row.userAddress ||
      row.user_address ||
      row.publicKey ||
      row.public_key ||
      (u && (u.address || u.wallet || u.id || u.publicKey)) ||
      (caller && (caller.address || caller.wallet || caller.id)) ||
      ""
  ).trim();
  const name = String(
    row.username ||
      row.handle ||
      row.displayName ||
      row.display_name ||
      (u && (u.username || u.name || u.handle)) ||
      (caller && (caller.username || caller.name || caller.handle)) ||
      row.name ||
      ""
  ).trim();
  return { name, addr };
}

function replyText(row) {
  if (!row || typeof row !== "object") return "";
  return String(
    row.text ||
      row.comment ||
      row.message ||
      row.content ||
      row.body ||
      row.callout_text ||
      (row.callout && (row.callout.text || row.callout.message || row.callout.comment)) ||
      ""
  ).trim();
}

function sortCalloutRows(rows) {
  return (Array.isArray(rows) ? rows : []).slice().sort((a, b) => {
    const ta = a.when ? a.when.getTime() : Infinity;
    const tb = b.when ? b.when.getTime() : Infinity;
    return ta - tb;
  });
}

async function pumpReplies(ca) {
  if (!isCa(ca) || isEvmCa(ca)) return [];
  const out = [];
  const seen = new Set();
  const limit = 50;

  for (let offset = 0; offset < 250; offset += limit) {
    const urls = [
      "https://frontend-api-v3.pump.fun/replies/" + ca + "?limit=" + limit + "&offset=" + offset + "&reverseOrder=false",
      "https://frontend-api-v3.pump.fun/replies/" + ca + "?limit=" + limit + "&offset=" + offset,
    ];
    let list = [];
    for (const u of urls) {
      const r = await jget(u);
      const next = asReplyList(r.data);
      if (next.length) {
        list = next;
        break;
      }
    }
    if (!list.length) break;

    for (const row of list) {
      if (!row || typeof row !== "object") continue;
      const { name, addr } = replyUser(row);
      const text = replyText(row);
      const when = replyWhen(row);
      if (!name && !addr && !text) continue;
      const key =
        String(row.id || row._id || "") +
        "|" +
        addr +
        "|" +
        (when ? when.getTime() : "") +
        "|" +
        text.slice(0, 48);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, addr, text, when });
    }
    if (list.length < limit) break;
  }

  return sortCalloutRows(out);
}

async function pumpOfficialCallouts(ca) {
  if (!isCa(ca) || isEvmCa(ca)) return [];
  const urls = [
    "https://frontend-api-v3.pump.fun/callout/top/" + ca + "?limit=50&sortBy=TIMESTAMP&sortOrder=ASC",
    "https://frontend-api-v3.pump.fun/callouts?mint=" + encodeURIComponent(ca) + "&limit=50&sortBy=TIMESTAMP&sortOrder=ASC",
    "https://advanced-api-v2.pump.fun/callout/top/" + ca + "?limit=50&sortBy=TIMESTAMP&sortOrder=ASC",
    "https://advanced-api-v2.pump.fun/callout/list/" + ca + "?limit=50&sortBy=TIMESTAMP&sortOrder=ASC",
  ];
  const out = [];
  const seen = new Set();

  for (const u of urls) {
    const r = await jget(u);
    const list = asReplyList(r.data);
    if (!list.length) continue;

    for (const row of list) {
      if (!row || typeof row !== "object") continue;
      const mint = String(
        row.mint ||
          row.coinMint ||
          row.coin_mint ||
          (row.coin && (row.coin.mint || row.coin.address)) ||
          (row.token && (row.token.mint || row.token.address)) ||
          ca
      );
      if (mint && String(mint) !== String(ca)) continue;
      const { name, addr } = replyUser(row);
      const text = replyText(row);
      const when = replyWhen(row);
      if (!name && !addr && !text) continue;
      const key = (addr || name) + "|" + (when ? when.getTime() : "") + "|" + text.slice(0, 48);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, addr, text, when });
    }
    if (out.length) break;
  }

  return sortCalloutRows(out);
}

function pairLiq(p) {
  return num(p && p.liquidity && (p.liquidity.usd ?? p.liquidity));
}

function pairMc(p) {
  return num(p && p.marketCap) || num(p && p.fdv);
}

function pairVol(p) {
  return num(p && p.volume && (p.volume.h24 ?? p.volume.usd));
}

function pairHasMarket(p) {
  return !!(pairLiq(p) || pairMc(p));
}

function pairScore(p) {
  const liq = pairLiq(p) || 0;
  const mc = pairMc(p) || 0;
  const vol = pairVol(p) || 0;
  let score = liq + vol * 0.01;
  if (liq > 0 && mc > 0) score += 1e15;
  else if (liq > 0 || mc > 0) score += 1e12;
  return score;
}

function isSolPair(p) {
  return !p.chainId || String(p.chainId).toLowerCase() === "solana";
}

function isRhPair(p) {
  const id = String((p && p.chainId) || "").toLowerCase();
  return RH_DEX_SLUGS.includes(id) || id === String(RH_CHAIN_ID);
}

function isArcPair(p) {
  const id = String((p && p.chainId) || "").toLowerCase();
  return ARC_DEX_SLUGS.includes(id) || id === String(ARC_CHAIN_ID);
}

function pickBestPair(pairs, chainFilter) {
  const raw = Array.isArray(pairs) ? pairs.filter(Boolean) : [];
  const list = chainFilter ? raw.filter(chainFilter) : raw;
  if (!list.length) return null;
  const good = list.filter(pairHasMarket);
  const pool = good.length ? good : list;
  pool.sort((a, b) => pairScore(b) - pairScore(a));
  return pool[0] || null;
}

function extractPairs(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.pairs)) return data.pairs;
  if (data && data.pair && typeof data.pair === "object") return [data.pair];
  return [];
}

async function dexPair(ca) {
  if (isEvmCa(ca)) return null;
  const urls = [
    "https://api.dexscreener.com/tokens/v1/solana/" + ca,
    "https://api.dexscreener.com/token-pairs/v1/solana/" + ca,
    "https://api.dexscreener.com/latest/dex/tokens/" + ca,
  ];
  let all = [];
  for (const u of urls) {
    const r = await jget(u);
    const next = extractPairs(r.data).filter(isSolPair);
    if (!next.length) continue;
    all = all.concat(next);
    const best = pickBestPair(next, isSolPair);
    if (best && pairLiq(best) && pairMc(best)) return best;
  }
  return pickBestPair(all, isSolPair);
}

async function dexSearch(q) {
  if (!q) return [];
  const r = await jget("https://api.dexscreener.com/latest/dex/search?q=" + encodeURIComponent(q));
  return ((r.data && r.data.pairs) || []).filter(isSolPair);
}

function normalizeOrders(raw) {
  if (Array.isArray(raw)) return raw.filter((o) => o && typeof o === "object");
  if (raw && Array.isArray(raw.orders)) return raw.orders;
  if (raw && typeof raw === "object" && (raw.type || raw.status)) return [raw];
  return [];
}

async function dexPaid(ca) {
  if (isEvmCa(ca)) return { ok: false, orders: [], profilePaid: false, adPaid: false, firstPay: null };
  const r = await jget("https://api.dexscreener.com/orders/v1/solana/" + ca);
  const orders = normalizeOrders(r.data);
  const paidTypes = new Set(["tokenprofile", "tokenad", "communitytakeover", "trendingbarad"]);
  const live = new Set(["approved", "processing"]);
  const dead = new Set(["cancelled", "canceled", "rejected", "on-hold", "onhold", "failed"]);

  const rows = [];
  let profilePaid = false;
  let adPaid = false;
  let firstPay = null;

  for (const o of orders) {
    const type = String(o.type || "order").replace(/[_-\s]/g, "").toLowerCase();
    const status = String(o.status || "").toLowerCase();
    const when = toDate(o.paymentTimestamp);
    const isPaidType = paidTypes.has(type) || type.includes("profile") || type.includes("ad");
    const isLive = live.has(status) || (Boolean(when) && !dead.has(status));

    if (isPaidType && isLive) {
      if (type.includes("profile") || type.includes("takeover")) profilePaid = true;
      if (type.includes("ad")) adPaid = true;
      if (when && (!firstPay || when < firstPay)) firstPay = when;
    }

    rows.push({
      type: o.type || type,
      status: o.status || "n/a",
      when,
      live: isPaidType && isLive,
    });
  }

  return { ok: r.ok, orders: rows, profilePaid, adPaid, firstPay };
}

function stPoolsQuote(tokenInfo) {
  const pools =
    (tokenInfo && Array.isArray(tokenInfo.pools) && tokenInfo.pools) ||
    (tokenInfo && tokenInfo.token && Array.isArray(tokenInfo.token.pools) && tokenInfo.token.pools) ||
    [];
  let mc = null;
  let liq = null;
  let vol = null;
  let fdv = null;
  let best = -1;
  for (const p of pools) {
    if (!p || typeof p !== "object") continue;
    const pLiq =
      num(p.liquidity && (p.liquidity.usd ?? p.liquidity)) ||
      num(p.liquidityUsd);
    const pMc =
      num(p.marketCap && (p.marketCap.usd ?? p.marketCap)) ||
      num(p.marketCapUsd);
    const pFdv = num(p.fdv && (p.fdv.usd ?? p.fdv)) || num(p.fdvUsd);
    const pVol =
      num(p.volume24h) ||
      num(p.volume && (p.volume.h24 ?? p.volume.usd ?? p.volume));
    const score = (pLiq || 0) + (pMc || 0);
    if (score > best) {
      best = score;
      if (pMc) mc = pMc;
      if (pLiq) liq = pLiq;
      if (pVol) vol = pVol;
      if (pFdv) fdv = pFdv;
    }
  }
  return { mc, liq, vol, fdv };
}

function stTokenMeta(tokenInfo) {
  const t =
    (tokenInfo && tokenInfo.token && typeof tokenInfo.token === "object" && tokenInfo.token) ||
    (tokenInfo && typeof tokenInfo === "object" ? tokenInfo : null);
  if (!t) return { name: "", symbol: "", created: null, url: "" };
  const pools =
    (Array.isArray(tokenInfo && tokenInfo.pools) && tokenInfo.pools) ||
    (Array.isArray(t.pools) && t.pools) ||
    [];
  const pool0 = pools[0] || null;
  const created =
    toDate(t.createdAt || t.created_at || t.creation && t.creation.created_time) ||
    toDate(pool0 && (pool0.createdAt || pool0.created_at || pool0.openTime || pool0.open_time)) ||
    null;
  const url =
    (pool0 && (pool0.market && pool0.market.url)) ||
    (t.pools && t.pools[0] && t.pools[0].url) ||
    "";
  return {
    name: String(t.name || t.tokenName || "").trim(),
    symbol: String(t.symbol || t.tokenSymbol || "").trim(),
    created,
    url: String(url || "").trim(),
  };
}

function marketQuote(pump, pair, tokenInfo) {
  const stq = stPoolsQuote(tokenInfo);
  const stm = stTokenMeta(tokenInfo);
  const price =
    num(pair && pair.priceUsd) ||
    num(pump && pump.usd_price) ||
    num(tokenInfo && tokenInfo.token && tokenInfo.token.price) ||
    num(tokenInfo && tokenInfo.price);
  const mc =
    pairMc(pair) ||
    num(pump && (pump.usd_market_cap || pump.market_cap)) ||
    stq.mc;
  const fdv = num(pair && pair.fdv) || stq.fdv || mc;
  const liq = pairLiq(pair) || stq.liq;
  const vol = pairVol(pair) || stq.vol;
  return {
    name:
      (pump && pump.name) ||
      (pair && pair.baseToken && pair.baseToken.name) ||
      stm.name ||
      "Unknown",
    symbol:
      (pump && pump.symbol) ||
      (pair && pair.baseToken && pair.baseToken.symbol) ||
      stm.symbol ||
      "?",
    price,
    mc,
    fdv,
    liq,
    vol,
    url: (pair && pair.url) || stm.url || "",
    created: toDate(pump && pump.created_timestamp) || toDate(pair && pair.pairCreatedAt) || stm.created,
  };
}

function quoteMeta(pump, pair, tokenInfo) {
  return marketQuote(pump, pair, tokenInfo);
}

function tokenRisk(tokenInfo) {
  if (!tokenInfo || typeof tokenInfo !== "object") return {};
  return tokenInfo.risk || (tokenInfo.token && tokenInfo.token.risk) || {};
}

/* ───────── extra pads / bags (additive only) ───────── */

async function bagFmToken(ca) {
  if (!isCa(ca) || isEvmCa(ca)) return null;
  const urls = [
    "https://api.bag.fm/api/v1/tokens/" + encodeURIComponent(ca),
    "https://bag.fm/api/token/" + encodeURIComponent(ca),
  ];
  for (const u of urls) {
    const r = await soft(jget(u));
    if (r && r.ok && r.data) {
      const d = r.data.data || r.data;
      if (d && (d.mint || d.address || d.symbol || d.name)) return d;
    }
  }
  return null;
}

async function moonshotOrOtherPad(ca) {
  if (!isCa(ca) || isEvmCa(ca)) return null;
  const urls = [
    "https://api.moonshot.cc/token/v1/solana/" + encodeURIComponent(ca),
    "https://api.dexscreener.com/token-pairs/v1/solana/" + encodeURIComponent(ca),
  ];
  for (const u of urls) {
    const r = await soft(jget(u));
    if (!r || !r.ok || !r.data) continue;
    if (u.includes("moonshot") && (r.data.baseToken || r.data.mint || r.data.address)) return { source: "moonshot", data: r.data };
    const pairs = extractPairs(r.data).filter(isSolPair);
    if (pairs.length) return { source: "dex", data: pairs[0] };
  }
  return null;
}
/* ───────── ARC-only sources (Circle Arc, chain 5042) ───────── */

async function dexArcPair(ca) {
  if (!isEvmCa(ca)) return null;
  const urls = [];
  for (const slug of ARC_DEX_SLUGS) {
    urls.push("https://api.dexscreener.com/tokens/v1/" + slug + "/" + ca);
    urls.push("https://api.dexscreener.com/token-pairs/v1/" + slug + "/" + ca);
  }
  urls.push("https://api.dexscreener.com/latest/dex/tokens/" + ca);
  let all = [];
  for (const u of urls) {
    const r = await jget(u);
    const next = extractPairs(r.data).filter(isArcPair);
    if (!next.length) continue;
    all = all.concat(next);
    const best = pickBestPair(next, isArcPair);
    if (best && pairLiq(best) && pairMc(best)) return best;
  }
  return pickBestPair(all, isArcPair);
}

async function dexArcSearch(q) {
  if (!q) return [];
  const r = await jget("https://api.dexscreener.com/latest/dex/search?q=" + encodeURIComponent(q));
  return ((r.data && r.data.pairs) || []).filter(isArcPair);
}

async function dexArcPaid(ca) {
  if (!isEvmCa(ca)) return { ok: false, orders: [], profilePaid: false, adPaid: false, firstPay: null };
  const r = await jget("https://api.dexscreener.com/orders/v1/arc/" + ca);
  const raw = r.data;
  const orders = normalizeOrders(Array.isArray(raw) ? raw : raw && raw.orders);
  const paidTypes = new Set(["tokenprofile", "tokenad", "communitytakeover", "trendingbarad"]);
  const live = new Set(["approved", "processing"]);
  const dead = new Set(["cancelled", "canceled", "rejected", "on-hold", "onhold", "failed"]);
  const rows = [];
  let profilePaid = false;
  let adPaid = false;
  let firstPay = null;
  for (const o of orders) {
    const type = String(o.type || "order").replace(/[_-\s]/g, "").toLowerCase();
    const status = String(o.status || "").toLowerCase();
    const when = toDate(o.paymentTimestamp);
    const isPaidType = paidTypes.has(type) || type.includes("profile") || type.includes("ad") || type.includes("takeover");
    const isLive = live.has(status) || (Boolean(when) && !dead.has(status));
    if (isPaidType && isLive) {
      if (type.includes("profile") || type.includes("takeover")) profilePaid = true;
      if (type.includes("ad")) adPaid = true;
      if (when && (!firstPay || when < firstPay)) firstPay = when;
    }
    rows.push({ type: o.type || type, status: o.status || "n/a", when, live: isPaidType && isLive });
  }
  return { ok: r.ok, orders: rows, profilePaid, adPaid, firstPay };
}

async function geckoArcToken(ca) {
  const r = await jget(ARC_GECKO + "/tokens/" + String(ca).toLowerCase());
  return r.ok && r.data && r.data.data ? r.data.data : null;
}

async function geckoArcTokenInfo(ca) {
  const r = await jget(ARC_GECKO + "/tokens/" + String(ca).toLowerCase() + "/info");
  return r.ok && r.data && r.data.data ? r.data.data : null;
}

async function paprikaArcToken(ca) {
  const r = await jget(ARC_PAPRIKA + "/tokens/" + ca);
  return r.ok && r.data ? r.data : null;
}

async function bsArcToken(ca) {
  for (const addr of rhCaVariants(ca)) {
    for (const base of [ARC_BS, ARC_BS_PRO]) {
      const r = await jget(base + "/tokens/" + addr);
      if (r.ok && r.data && (r.data.address || r.data.address_hash || r.data.name || r.data.symbol || r.data.holders_count != null || r.data.holders != null)) {
        return r.data;
      }
    }
    const legacy = await jget(ARC_BS_RPC + "?module=token&action=getToken&contractaddress=" + addr);
    if (legacy.ok && legacy.data && legacy.data.result && typeof legacy.data.result === "object") {
      return legacy.data.result;
    }
    const scan = await jget(ARC_SCAN_API + "/tokens/" + addr);
    if (scan.ok && scan.data && typeof scan.data === "object") return scan.data;
  }
  return null;
}

async function bsArcTokenCounters(ca) {
  for (const addr of rhCaVariants(ca)) {
    for (const base of [ARC_BS, ARC_BS_PRO]) {
      const r = await jget(base + "/tokens/" + addr + "/counters");
      if (r.ok && r.data && typeof r.data === "object") return r.data;
    }
  }
  return null;
}

async function bsArcAddress(ca) {
  for (const addr of rhCaVariants(ca)) {
    const r = await jget(ARC_BS + "/addresses/" + addr);
    if (r.ok && r.data) return r.data;
    const scan = await jget(ARC_SCAN_API + "/address/" + addr);
    if (scan.ok && scan.data) return scan.data;
  }
  return null;
}

async function bsArcTx(hash) {
  if (!hash) return null;
  const r = await jget(ARC_BS + "/transactions/" + hash);
  return r.ok && r.data ? r.data : null;
}

async function bsArcCounters(addr) {
  if (!addr) return null;
  const r = await jget(ARC_BS + "/addresses/" + addr + "/counters");
  return r.ok && r.data ? r.data : null;
}

async function bsArcHolders(ca) {
  const out = [];
  const seen = new Set();
  const pushRows = (list) => {
    for (const row of list || []) {
      const addr = String(rhHolderAddr(row) || "").toLowerCase();
      const key = addr || JSON.stringify(row).slice(0, 80);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
  };
  for (const addr of rhCaVariants(ca)) {
    for (const base of [ARC_BS, ARC_BS_PRO]) {
      let url = base + "/tokens/" + addr + "/holders";
      for (let page = 0; page < 8; page++) {
        const r = await jget(url);
        const list = bsHolderList(r.data);
        if (!list.length) break;
        pushRows(list);
        const n = r.data && r.data.next_page_params;
        if (!n) break;
        const q = new URLSearchParams();
        Object.entries(n).forEach(([k, v]) => {
          if (v != null) q.set(k, String(v));
        });
        url = base + "/tokens/" + addr + "/holders?" + q.toString();
      }
    }
    if (out.length) return out;
    const scan = await jget(ARC_SCAN_API + "/tokens/" + addr + "/holders");
    const scanList = bsHolderList(scan.data);
    if (scanList.length) {
      pushRows(scanList);
      return out;
    }
    for (let page = 1; page <= 6; page++) {
      const legacy = await jget(
        ARC_BS_RPC +
          "?module=token&action=getTokenHolders&contractaddress=" +
          addr +
          "&page=" +
          page +
          "&offset=50"
      );
      const rows = bsHolderList(legacy.data);
      if (!rows.length) break;
      pushRows(rows);
      if (rows.length < 50) break;
    }
    if (out.length) return out;
  }
  return out;
}

async function bsArcTransfers(ca) {
  const all = [];
  const seen = new Set();
  const push = (list) => {
    for (const row of list || []) {
      const key =
        String(row.tx_hash || row.transaction_hash || row.hash || "") +
        "|" +
        String(row.log_index || row.block_number || row.timestamp || all.length);
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(row);
    }
  };
  for (const addr of rhCaVariants(ca)) {
    for (const base of [ARC_BS, ARC_BS_PRO]) {
      let url = base + "/tokens/" + addr + "/transfers";
      for (let page = 0; page < 6; page++) {
        const r = await jget(url);
        const latest = (r.data && (r.data.items || r.data.transfers || r.data.result)) || [];
        if (!Array.isArray(latest) || !latest.length) break;
        push(latest);
        const n = r.data && r.data.next_page_params;
        if (!n) break;
        const q = new URLSearchParams();
        Object.entries(n).forEach(([k, v]) => {
          if (v != null) q.set(k, String(v));
        });
        url = base + "/tokens/" + addr + "/transfers?" + q.toString();
      }
    }
    if (all.length) return all;
  }
  return all;
}

async function bsArcEarlyTransfers(ca) {
  const all = [];
  for (const addr of rhCaVariants(ca)) {
    for (const offset of [150, 200]) {
      const r = await jget(
        ARC_BS_RPC +
          "?module=account&action=tokentx&contractaddress=" +
          addr +
          "&page=1&offset=" +
          offset +
          "&sort=asc"
      );
      const rows = (r.data && r.data.result) || [];
      if (Array.isArray(rows) && rows.length && typeof rows[0] === "object") {
        all.push(...rows);
        break;
      }
    }
    if (all.length) return all;
  }
  return all;
}

async function bsArcTokenPageMeta(ca) {
  for (const addr of rhCaVariants(ca)) {
    try {
      const res = await fetch(ARC_EXPLORER + "/token/" + addr, {
        headers: { "User-Agent": "VEXLORE-Bot", Accept: "text/html" },
        signal: AbortSignal.timeout(18000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      if (!html) continue;
      const holdM =
        html.match(/Holders[^0-9]{0,48}([0-9,]{1,12})/i) ||
        html.match(/"holders_count"\s*:\s*"?([0-9,]{1,12})"?/i);
      const nameM = html.match(/<h1[^>]*>\s*([^<]{1,80})\s*<\/h1>/i);
      return {
        holders: holdM ? Number(String(holdM[1]).replace(/,/g, "")) : null,
        name: nameM ? String(nameM[1]).trim() : "",
      };
    } catch (_) {}
  }
  return null;
}

async function bsArcTokenSearch(q) {
  if (!q) return [];
  const out = [];
  const seen = new Set();
  for (const base of [ARC_BS, ARC_BS_PRO]) {
    const r = await jget(base + "/tokens?q=" + encodeURIComponent(q) + "&type=ERC-20");
    const list = (r.data && r.data.items) || [];
    for (const t of Array.isArray(list) ? list : []) {
      const mint = String(t.address_hash || t.address || t.hash || "").toLowerCase();
      if (!mint || seen.has(mint)) continue;
      seen.add(mint);
      out.push(t);
    }
  }
  return out;
}

async function bsArcCreatedBy(addr) {
  if (!addr) return [];
  const out = [];
  const seen = new Set();
  let url = ARC_BS + "/addresses/" + addr + "/transactions";
  for (let page = 0; page < 4; page++) {
    const r = await jget(url);
    const list = (r.data && r.data.items) || [];
    if (!Array.isArray(list) || !list.length) break;
    for (const tx of list) {
      const created =
        (tx.created_contract && (tx.created_contract.hash || tx.created_contract.address_hash)) ||
        tx.created_contract_hash ||
        "";
      if (!created || seen.has(String(created).toLowerCase())) continue;
      seen.add(String(created).toLowerCase());
      out.push({
        ca: created,
        when: toDate(tx.timestamp),
        hash: tx.hash || "",
      });
    }
    const n = r.data && r.data.next_page_params;
    if (!n) break;
    const q = new URLSearchParams();
    Object.entries(n).forEach(([k, v]) => {
      if (v != null) q.set(k, String(v));
    });
    url = ARC_BS + "/addresses/" + addr + "/transactions?" + q.toString();
  }
  return out;
}

function arcQuote(pair, gecko, bs, paprika) {
  const g = geckoMc(gecko);
  const p24 = paprika && paprika["24h"];
  return {
    name:
      (pair && pair.baseToken && pair.baseToken.name) ||
      g.name ||
      (bs && bs.name) ||
      (paprika && paprika.name) ||
      "Unknown",
    symbol:
      (pair && pair.baseToken && pair.baseToken.symbol) ||
      g.symbol ||
      (bs && bs.symbol) ||
      (paprika && paprika.symbol) ||
      "?",
    price: num(pair && pair.priceUsd) || g.price || num(paprika && paprika.price_usd),
    mc: pairMc(pair) || g.mc || num(paprika && paprika.fdv),
    fdv: num(pair && pair.fdv) || g.fdv || num(paprika && paprika.fdv),
    liq: pairLiq(pair) || g.liq || num(paprika && paprika.liquidity_usd),
    vol: pairVol(pair) || g.vol || num(p24 && (p24.volume_usd || p24.volume)),
    dex: (pair && (pair.dexId || pair.dexName)) || "",
    url:
      (pair && pair.url) ||
      (pair && pair.pairAddress ? "https://dexscreener.com/arc/" + pair.pairAddress : ""),
  };
}

async function findArcFamily(ca, pair, gecko) {
  const g = geckoMc(gecko);
  const name = (pair && pair.baseToken && pair.baseToken.name) || g.name || "";
  const symbol = (pair && pair.baseToken && pair.baseToken.symbol) || g.symbol || "";
  const key = String(ca).toLowerCase();
  const map = new Map();
  const clean = rhCleanName(name);

  upsert(map, key, {
    name,
    symbol,
    created: toDate(pair && pair.pairCreatedAt),
    mc: pairMc(pair) || g.mc,
    url: pair && pair.url,
    tickerMatch: true,
    nameMatch: true,
  });

  const queries = [...new Set([symbol, name, clean].filter((q) => q && String(q).length >= 2))];
  for (const q of queries) {
    const [pairs, tokens] = await Promise.all([soft(dexArcSearch(q)), soft(bsArcTokenSearch(q))]);
    for (const p of pairs || []) {
      const bn = p.baseToken && p.baseToken.name;
      const bs = p.baseToken && p.baseToken.symbol;
      const mint = p.baseToken && p.baseToken.address;
      const tick = sameTicker(bs, symbol);
      const nm = sameRhName(bn, name);
      if ((!tick && !nm) || !mint) continue;
      upsert(map, String(mint).toLowerCase(), {
        name: bn,
        symbol: bs,
        created: toDate(p.pairCreatedAt),
        mc: pairMc(p),
        url: p.url,
        tickerMatch: tick,
        nameMatch: nm,
      });
    }
    for (const t of tokens || []) {
      const mint = t.address_hash || t.address || t.hash;
      const bs = t.symbol;
      const bn = t.name;
      const tick = sameTicker(bs, symbol);
      const nm = sameRhName(bn, name);
      if ((!tick && !nm) || !mint) continue;
      upsert(map, String(mint).toLowerCase(), {
        name: bn,
        symbol: bs,
        created: toDate(t.inserted_at || t.created_at || t.createdAt),
        mc: num(t.circulating_market_cap) || num(t.market_cap),
        tickerMatch: tick,
        nameMatch: nm,
      });
    }
  }

  const missingCreated = [...map.values()].filter((x) => !x.created).slice(0, 8);
  await Promise.all(
    missingCreated.map(async (row) => {
      const tok = await soft(bsArcToken(row.mint));
      const addr = await soft(bsArcAddress(row.mint));
      const created =
        toDate(tok && (tok.inserted_at || tok.created_at || tok.createdAt)) ||
        toDate(addr && (addr.creation_tx_timestamp || addr.created_at || (addr.block && addr.block.timestamp)));
      if (created) row.created = created;
    })
  );

  const all = [...map.values()].sort((a, b) => {
    const ta = a.created ? a.created.getTime() : Infinity;
    const tb = b.created ? b.created.getTime() : Infinity;
    return ta - tb;
  });
  const bothFamily = all.filter((x) => x.tickerMatch && x.nameMatch && x.created);
  const tickerFamily = all.filter((x) => x.tickerMatch && x.created);
  const nameFamily = all.filter((x) => x.nameMatch && x.created);
  const dated = bothFamily.length
    ? bothFamily
    : tickerFamily.length
    ? tickerFamily
    : nameFamily.length
    ? nameFamily
    : all.filter((x) => x.created);
  const og = dated[0] || all[0] || null;
  const you = all.find((x) => String(x.mint).toLowerCase() === key) || null;
  const isOg = !!(og && you && String(og.mint).toLowerCase() === String(you.mint).toLowerCase());
  return { all, og, you, isOg, name, symbol };
}

async function loadArcScan(ca) {
  const [
    pair,
    gecko,
    info,
    bs,
    holders,
    transfers,
    earlyTransfers,
    paprika,
    paid,
    addrInfo,
    pageMeta,
    counters,
  ] = await Promise.all([
    soft(dexArcPair(ca)),
    soft(geckoArcToken(ca)),
    soft(geckoArcTokenInfo(ca)),
    soft(bsArcToken(ca)),
    soft(bsArcHolders(ca)),
    soft(bsArcTransfers(ca)),
    soft(bsArcEarlyTransfers(ca)),
    soft(paprikaArcToken(ca)),
    soft(dexArcPaid(ca)),
    soft(bsArcAddress(ca)),
    soft(bsArcTokenPageMeta(ca)),
    soft(bsArcTokenCounters(ca)),
  ]);
  const q = arcQuote(pair, gecko, bs, paprika);
  const parsedH = parseRhHolders(holders || [], bs, pair, counters);
  if (!parsedH.holderCount && pageMeta && pageMeta.holders != null) {
    parsedH.holderCount = pageMeta.holders;
  }
  const launchRows = (earlyTransfers && earlyTransfers.length ? earlyTransfers : transfers) || [];
  const bundled = analyzeRhBundles(launchRows, parsedH, pair);
  const gSocials = geckoInfoBits(info);
  const pSocials = pairSocials(pair);
  const socials = {
    desc: gSocials.desc,
    twitter: gSocials.twitter || pSocials.twitter,
    telegram: gSocials.telegram || pSocials.telegram,
    website: gSocials.website || pSocials.website,
    discord: gSocials.discord,
    holders: gSocials.holders,
    categories: gSocials.categories,
  };
  if (socials.holders && socials.holders.distribution_percentage) {
    const top10 = Number(socials.holders.distribution_percentage.top_10);
    if (Number.isFinite(top10) && top10 > parsedH.topConc) parsedH.topConc = top10;
  }
  const geckoHoldCount = countOrZero(
    socials.holders && (socials.holders.count || socials.holders.total || socials.holders.holder_count)
  );
  if (geckoHoldCount != null && !parsedH.holderCount) parsedH.holderCount = geckoHoldCount;
  if (!parsedH.holderCount && parsedH.rows.length) parsedH.holderCount = parsedH.rows.length;
  const fam = await findArcFamily(ca, pair, gecko);
  return {
    pair,
    gecko,
    info,
    bs,
    holders,
    transfers,
    earlyTransfers,
    paprika,
    paid,
    addrInfo,
    q,
    parsedH,
    bundled,
    socials,
    fam,
  };
}

function arcLore({ fam, desc, socials, bundleNow, topConc, holderCount, mc, paid }) {
  return rhLore({
    official: false,
    fam,
    desc,
    socials,
    bundleNow,
    topConc,
    holderCount,
    mc,
    paid,
  });
}

async function detectEvmChain(ca) {
  if (!isEvmCa(ca)) return "";
  const [rhPair, arcPair] = await Promise.all([soft(dexRhPair(ca)), soft(dexArcPair(ca))]);
  const rhHit = !!(rhPair && (pairHasMarket(rhPair) || pairLiq(rhPair) || pairMc(rhPair)));
  const arcHit = !!(arcPair && (pairHasMarket(arcPair) || pairLiq(arcPair) || pairMc(arcPair)));
  if (rhHit && !arcHit) return "rh";
  if (arcHit && !rhHit) return "arc";
  if (rhHit && arcHit) {
    const rhScore = (pairLiq(rhPair) || 0) + (pairMc(rhPair) || 0);
    const arcScore = (pairLiq(arcPair) || 0) + (pairMc(arcPair) || 0);
    return arcScore > rhScore ? "arc" : "rh";
  }
  const [rhGecko, arcGecko, rhBs, arcBs] = await Promise.all([
    soft(geckoRhToken(ca)),
    soft(geckoArcToken(ca)),
    soft(bsRhToken(ca)),
    soft(bsArcToken(ca)),
  ]);
  if (arcGecko && !rhGecko) return "arc";
  if (arcBs && !rhBs) return "arc";
  if (rhGecko || rhBs) return "rh";
  if (arcGecko || arcBs) return "arc";
  return "rh";
}

async function resolveArcDev(ca, addrInfo) {
  const info = addrInfo || (await soft(bsArcAddress(ca))) || {};
  const factory = String(info.creator_address_hash || info.creator || "").trim();
  const createHash = String(info.creation_transaction_hash || info.creation_tx_hash || "").trim();
  const createTx = createHash ? await soft(bsArcTx(createHash)) : null;
  const txFrom =
    (createTx && createTx.from && (createTx.from.hash || createTx.from)) ||
    (createTx && createTx.from_address) ||
    "";
  const factoryInfo = factory ? await soft(bsArcAddress(factory)) : null;
  const factoryIsContract = !!(factoryInfo && factoryInfo.is_contract);
  const deployer = String(txFrom || (!factoryIsContract ? factory : "") || factory || "").trim();
  return {
    factory,
    factoryIsContract,
    deployer,
    createHash,
    createdAt: toDate((createTx && createTx.timestamp) || null),
    verified: !!(info.is_verified || info.is_fully_verified),
    contractName: info.name || "",
  };
}

async function buildArcReport(ca) {
  const scan = await loadArcScan(ca);
  const { pair, gecko, bs, q, parsedH, bundled, socials, fam, paid, addrInfo } = scan;
  if (!pair && !gecko && !bs && !scan.paprika) {
    return (
      "❌ No Arc token found.\n" +
      "<code>" + esc(ca) + "</code>\n" +
      "Chain ID " + ARC_CHAIN_ID + " · " + ARC_EXPLORER +
      FOOTER
    );
  }
  const hLines = parsedH.rows.slice(0, 10).map((h, i) => {
    return (
      i + 1 + ". " +
      rhSizeIcon(h.tag) + " " + h.tag + " " +
      short(h.addr) +
      " · " + pct(h.pctn)
    );
  });
  const created =
    toDate(pair && pair.pairCreatedAt) ||
    toDate(bs && (bs.created_at || (bs.block && bs.block.timestamp)));
  const L = arcLore({
    fam,
    desc: socials.desc,
    socials,
    bundleNow: bundled.nowPct,
    topConc: parsedH.topConc,
    holderCount: parsedH.holderCount,
    mc: q.mc,
    paid,
  });
  const badge = L.ogTag === "OG" ? "🟢 OG" : L.ogTag === "VAMP" ? "🟣 VAMP" : "🟠";
  const dev = addrInfo ? await resolveArcDev(ca, addrInfo).catch(() => null) : null;
  return (
    badge + " <b>Arc Chain</b> · id " + ARC_CHAIN_ID + "\n" +
    "<b>" + esc(q.name) + " (" + esc(q.symbol) + ")</b>\n" +
    "<code>" + esc(ca) + "</code>\n\n" +
    "💰 <b>Market (Arc DEX only)</b>\n" +
    "MC " + moneyMkt(q.mc) + " · FDV " + moneyMkt(q.fdv) + "\n" +
    "💧 Liq " + moneyMkt(q.liq) + " · 📊 Vol24 " + moneyMkt(q.vol) + "\n" +
    (q.price != null ? "Px " + money(q.price) + "\n" : "") +
    (q.dex ? "DEX " + esc(q.dex) + "\n" : "") +
    "\n🕐 Pair: " + utc(created) + "\n" +
    (dev && dev.deployer ? "👨‍💻 Dev <code>" + esc(dev.deployer) + "</code>\n" : "") +
    esc(ogLine(fam)) + "\n\n" +
    "📦 <b>Launch clusters</b>  " + bundled.heat + "\n" +
    "same-block window hold " + pct(bundled.nowPct) +
    " · " + bundled.initWallets + " bundler wallets" +
    (bundled.firstBlock ? " · blk " + bundled.firstBlock : "") + "\n\n" +
    "👛 <b>Holders</b>\n" +
    "count " + (parsedH.holderCount == null ? "n/a" : String(parsedH.holderCount)) +
    " · live rows " + String(parsedH.liveHolders || parsedH.rows.length || 0) +
    " · top10 " + pct(parsedH.topConc) + "\n" +
    (hLines.join("\n") || "no holder rows indexed") + "\n\n" +
    "🧾 <b>Dex paid</b>\n" +
    esc(rhPaidBlock(paid)) + "\n" +
    "🚀 Boosts: " + ((pair && pair.boosts && pair.boosts.active) ?? "n/a") + "\n\n" +
    "🧠 <b>Lore " + L.score + "/100</b> " + esc(L.verdict) + "\n" +
    esc(L.desc) + "\n" +
    esc(L.notes.join(" · ")) +
    (socials.twitter || socials.telegram || socials.website
      ? "\n" +
        [socials.twitter && ("X " + socials.twitter), socials.telegram && ("TG " + socials.telegram), socials.website]
          .filter(Boolean)
          .join(" · ")
      : "") +
    "\n\n" +
    (q.url ? q.url + "\n" : "") +
    ARC_EXPLORER + "/token/" + ca +
    "\n" + ARC_EXPLORER_FALLBACK + "/token/" + ca +
    FOOTER
  ).slice(0, 4000);
}

async function buildArcVamp(ca) {
  const [pair, gecko] = await Promise.all([soft(dexArcPair(ca)), soft(geckoArcToken(ca))]);
  const fam = await findArcFamily(ca, pair, gecko);
  if (!fam.all.length) return "❌ No Arc family found.\n<code>" + esc(ca) + "</code>" + FOOTER;
  const buzzMint = vampBuzzMint(fam.all);
  const lines = fam.all.slice(0, 12).map((c) => vampListLine(c, ca, fam, buzzMint, true));
  const verdict = fam.isOg
    ? "🟢 Provided CA is OG on Arc"
    : "🟣 Provided CA is VAMP on Arc\n🟢 OG CA:\n<code>" +
      esc(fam.og && fam.og.mint) + "</code>";
  return (
    "🧛 <b>Arc vamp check</b> · chain " + ARC_CHAIN_ID + "\n" +
    "Name: " + esc(fam.name) + " · Ticker: " + esc(fam.symbol) + "\n" +
    "Matches: " + fam.all.length + "\n\n" +
    verdict + "\n\n" +
    esc(ogLine(fam)) +
    "\n\n" +
    lines.join("\n\n") +
    FOOTER
  ).slice(0, 4000);
}

async function buildArcHolders(ca) {
  const scan = await loadArcScan(ca);
  if (!scan.pair && !scan.gecko && !scan.bs && !scan.paprika) {
    return "❌ No Arc token found.\n<code>" + esc(ca) + "</code>" + FOOTER;
  }
  const { q, parsedH } = scan;
  const lines = parsedH.rows.slice(0, 15).map((h, i) => {
    return (
      i + 1 + ". " + rhSizeIcon(h.tag) + " " + h.tag + " " +
      short(h.addr) + " · " + pct(h.pctn) +
      "\n<code>" + esc(h.addr) + "</code>"
    );
  });
  return (
    "👛 <b>Arc holders</b> · chain " + ARC_CHAIN_ID + "\n" +
    "<b>" + esc(q.name) + " (" + esc(q.symbol) + ")</b>\n" +
    "<code>" + esc(ca) + "</code>\n\n" +
    "live holders " + (parsedH.holderCount == null ? "n/a" : String(parsedH.holderCount)) +
    " · rows shown " + String(parsedH.liveHolders || parsedH.rows.length || 0) +
    " · top10 " + pct(parsedH.topConc) + "\n\n" +
    (lines.join("\n\n") || "no holder rows indexed") +
    FOOTER
  ).slice(0, 4000);
}

async function buildArcBundle(ca) {
  const scan = await loadArcScan(ca);
  if (!scan.pair && !scan.gecko && !scan.bs && !scan.paprika) {
    return "❌ No Arc token found.\n<code>" + esc(ca) + "</code>" + FOOTER;
  }
  const { q, bundled } = scan;
  const clusterLines = (bundled.launch.length ? bundled.launch : bundled.clusters).slice(0, 8).map((c, i) => {
    const top = c.wallets.slice(0, 4).map((w) => short(w)).join(" · ");
    return (
      "#" + (i + 1) + " blk " + c.block +
      " · " + c.wallets.length + " wallets · now " + pct(c.nowPct) +
      " · " + c.txs + " txs\n" +
      "🕐 " + utc(c.when) + "\n" +
      (top || "no wallets")
    );
  });
  return (
    "📦 <b>Arc launch clusters</b>  " + bundled.heat + "\n" +
    "<b>" + esc(q.name) + " (" + esc(q.symbol) + ")</b>\n" +
    "<code>" + esc(ca) + "</code>\n\n" +
    "Arc has no Jito-style bundles. This groups first ~8s / ~80 L2-block buys.\n" +
    "⚡ launch-window hold " + pct(bundled.nowPct) +
    " · bundler wallets " + bundled.initWallets +
    (bundled.firstBlock ? " · first blk " + bundled.firstBlock : "") + "\n\n" +
    "<b>Clusters (same block)</b>\n" +
    (clusterLines.join("\n\n") || "0 clusters indexed") +
    FOOTER
  ).slice(0, 4000);
}

async function buildArcLore(ca) {
  const scan = await loadArcScan(ca);
  if (!scan.pair && !scan.gecko && !scan.bs && !scan.paprika) {
    return "❌ No Arc token found.\n<code>" + esc(ca) + "</code>" + FOOTER;
  }
  const { q, parsedH, bundled, socials, fam, paid } = scan;
  const L = arcLore({
    fam,
    desc: socials.desc,
    socials,
    bundleNow: bundled.nowPct,
    topConc: parsedH.topConc,
    holderCount: parsedH.holderCount,
    mc: q.mc,
    paid,
  });
  return (
    "🧠 <b>Arc lore</b> · chain " + ARC_CHAIN_ID + "\n" +
    "<b>" + esc(q.name) + " (" + esc(q.symbol) + ")</b>\n" +
    "<code>" + esc(ca) + "</code>\n\n" +
    "<b>" + L.score + "/100</b> " + esc(L.verdict) + "\n" +
    esc(L.notes.join(" · ") || "thin sample") + "\n\n" +
    esc(L.desc) + "\n\n" +
    esc(ogLine(fam)) + "\n" +
    esc(rhPaidBlock(paid)) + "\n" +
    (socials.twitter ? "X " + esc(socials.twitter) + "\n" : "") +
    (socials.telegram ? "TG " + esc(socials.telegram) + "\n" : "") +
    (socials.website ? esc(socials.website) + "\n" : "") +
    FOOTER
  ).slice(0, 4000);
}

async function buildArcDev(ca) {
  const scan = await loadArcScan(ca);
  if (!scan.pair && !scan.gecko && !scan.bs && !scan.addrInfo) {
    return "❌ No Arc token found.\n<code>" + esc(ca) + "</code>" + FOOTER;
  }
  const { q, addrInfo, paid } = scan;
  const dev = await resolveArcDev(ca, addrInfo);
  const counters = await soft(bsArcCounters(dev.deployer));
  const created = await soft(bsArcCreatedBy(dev.deployer));
  const extra = [];
  for (const row of (created || []).slice(0, 8)) {
    if (String(row.ca).toLowerCase() === String(ca).toLowerCase()) continue;
    const tok = await soft(bsArcToken(row.ca));
    extra.push({
      ca: row.ca,
      when: row.when,
      name: (tok && tok.name) || "",
      symbol: (tok && tok.symbol) || "",
      holders: tok && (tok.holders_count || tok.holders),
    });
  }
  const txN = counters && counters.transactions_count;
  let score = 45;
  const notes = [];
  if (dev.verified) {
    score += 8;
    notes.push("verified contract");
  }
  if (extra.length >= 8) {
    score -= 12;
    notes.push("serial deployer");
  } else if (extra.length >= 3) {
    score -= 6;
    notes.push("multiple deploys");
  } else if (extra.length === 0) {
    score += 4;
    notes.push("few visible deploys");
  }
  score = Math.max(0, Math.min(100, score));
  const verdict = score >= 70 ? "✅ strong" : score >= 50 ? "⚠️ mixed" : "❌ weak";
  const extraLines = extra.slice(0, 8).map((t, i) => {
    return (
      i + 1 + ". <b>" + esc(t.name || "contract") + (t.symbol ? " (" + esc(t.symbol) + ")" : "") + "</b>\n" +
      "<code>" + esc(t.ca) + "</code>\n" +
      "🕐 " + utc(t.when) +
      (t.holders != null ? " · holders " + t.holders : "")
    );
  });
  return (
    "👨‍💻 <b>Arc dev</b> · chain " + ARC_CHAIN_ID + "\n" +
    "<b>" + esc(q.name) + " (" + esc(q.symbol) + ")</b>\n" +
    "<code>" + esc(ca) + "</code>\n\n" +
    "Deployer: <code>" + esc(dev.deployer || "unknown") + "</code>\n" +
    (dev.factory && String(dev.factory).toLowerCase() !== String(dev.deployer).toLowerCase()
      ? "Factory: <code>" + esc(dev.factory) + "</code>" + (dev.factoryIsContract ? " · contract" : "") + "\n"
      : "") +
    "Verified: " + (dev.verified ? "yes" : "no") + "\n" +
    "Tx count: " + (txN == null ? "n/a" : String(txN)) + "\n" +
    "\n🧾 <b>Dex paid</b>\n" +
    esc(rhPaidBlock(paid)) +
    "\n\n🧠 <b>Dev rating " + score + "/100</b> " + esc(verdict) + "\n" +
    esc(notes.join(" · ") || "on-chain deploy metadata") +
    "\n\n<b>Other contracts from this deployer</b>\n" +
    (extraLines.join("\n\n") || "none indexed on last tx pages") +
    "\n\n" +
    ARC_EXPLORER + "/address/" + (dev.deployer || ca) +
    FOOTER
  ).slice(0, 4000);
}
/* ───────── RH-only sources (never pump / solana tracker) ───────── */

async function dexRhPair(ca) {
  if (!isEvmCa(ca)) return null;
  const urls = [];
  for (const slug of RH_DEX_SLUGS) {
    urls.push("https://api.dexscreener.com/tokens/v1/" + slug + "/" + ca);
    urls.push("https://api.dexscreener.com/token-pairs/v1/" + slug + "/" + ca);
  }
  urls.push("https://api.dexscreener.com/latest/dex/tokens/" + ca);
  let all = [];
  for (const u of urls) {
    const r = await jget(u);
    const next = extractPairs(r.data).filter(isRhPair);
    if (!next.length) continue;
    all = all.concat(next);
    const best = pickBestPair(next, isRhPair);
    if (best && pairLiq(best) && pairMc(best)) return best;
  }
  return pickBestPair(all, isRhPair);
}

async function dexRhSearch(q) {
  if (!q) return [];
  const r = await jget("https://api.dexscreener.com/latest/dex/search?q=" + encodeURIComponent(q));
  return ((r.data && r.data.pairs) || []).filter(isRhPair);
}

async function dexRhPaid(ca) {
  if (!isEvmCa(ca)) return { ok: false, orders: [], profilePaid: false, adPaid: false, firstPay: null };
  const r = await jget("https://api.dexscreener.com/orders/v1/robinhood/" + ca);
  const raw = r.data;
  const orders = normalizeOrders(Array.isArray(raw) ? raw : raw && raw.orders);
  const boosts = Array.isArray(raw && raw.boosts) ? raw.boosts : [];
  const paidTypes = new Set(["tokenprofile", "tokenad", "communitytakeover", "trendingbarad"]);
  const live = new Set(["approved", "processing"]);
  const dead = new Set(["cancelled", "canceled", "rejected", "on-hold", "onhold", "failed"]);

  const rows = [];
  let profilePaid = false;
  let adPaid = false;
  let firstPay = null;

  for (const o of orders) {
    const type = String(o.type || "order").replace(/[_-\s]/g, "").toLowerCase();
    const status = String(o.status || "").toLowerCase();
    const when = toDate(o.paymentTimestamp);
    const isPaidType = paidTypes.has(type) || type.includes("profile") || type.includes("ad") || type.includes("takeover");
    const isLive = live.has(status) || (Boolean(when) && !dead.has(status));
    if (isPaidType && isLive) {
      if (type.includes("profile") || type.includes("takeover")) profilePaid = true;
      if (type.includes("ad")) adPaid = true;
      if (when && (!firstPay || when < firstPay)) firstPay = when;
    }
    rows.push({ type: o.type || type, status: o.status || "n/a", when, live: isPaidType && isLive });
  }

  return { ok: r.ok, orders: rows, boosts, profilePaid, adPaid, firstPay };
}

async function geckoRhToken(ca) {
  const r = await jget(RH_GECKO + "/tokens/" + String(ca).toLowerCase());
  return r.ok && r.data && r.data.data ? r.data.data : null;
}

async function geckoRhTokenInfo(ca) {
  const r = await jget(RH_GECKO + "/tokens/" + String(ca).toLowerCase() + "/info");
  return r.ok && r.data && r.data.data ? r.data.data : null;
}

async function paprikaRhToken(ca) {
  const r = await jget(RH_PAPRIKA + "/tokens/" + ca);
  return r.ok && r.data ? r.data : null;
}

function rhCaVariants(ca) {
  const raw = String(ca || "").trim();
  const low = raw.toLowerCase();
  return [...new Set([raw, low].filter(Boolean))];
}

async function bsRhToken(ca) {
  for (const addr of rhCaVariants(ca)) {
    for (const base of [RH_BS, RH_BS_PRO]) {
      const r = await jget(base + "/tokens/" + addr);
      if (r.ok && r.data && (r.data.address || r.data.address_hash || r.data.name || r.data.symbol || r.data.holders_count != null || r.data.holders != null)) {
        return r.data;
      }
    }
    const legacy = await jget(RH_BS_RPC + "?module=token&action=getToken&contractaddress=" + addr);
    if (legacy.ok && legacy.data && legacy.data.result && typeof legacy.data.result === "object") {
      return legacy.data.result;
    }
  }
  return null;
}

async function bsRhTokenCounters(ca) {
  for (const addr of rhCaVariants(ca)) {
    for (const base of [RH_BS, RH_BS_PRO]) {
      const r = await jget(base + "/tokens/" + addr + "/counters");
      if (r.ok && r.data && typeof r.data === "object") return r.data;
    }
  }
  return null;
}

async function bsRhAddress(ca) {
  for (const addr of rhCaVariants(ca)) {
    const r = await jget(RH_BS + "/addresses/" + addr);
    if (r.ok && r.data) return r.data;
  }
  return null;
}

async function bsRhTx(hash) {
  if (!hash) return null;
  const r = await jget(RH_BS + "/transactions/" + hash);
  return r.ok && r.data ? r.data : null;
}

async function bsRhCounters(addr) {
  if (!addr) return null;
  const r = await jget(RH_BS + "/addresses/" + addr + "/counters");
  return r.ok && r.data ? r.data : null;
}

function bsHolderList(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  const list =
    data.items ||
    data.holders ||
    data.result ||
    data.data ||
    (data.data && (data.data.items || data.data.holders || data.data.result));
  return Array.isArray(list) ? list.filter((row) => row && typeof row === "object") : [];
}

async function bsRhHolders(ca) {
  const out = [];
  const seen = new Set();
  const pushRows = (list) => {
    for (const row of list || []) {
      const addr = String(rhHolderAddr(row) || "").toLowerCase();
      const key = addr || JSON.stringify(row).slice(0, 80);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
  };

  for (const addr of rhCaVariants(ca)) {
    for (const base of [RH_BS, RH_BS_PRO]) {
      let url = base + "/tokens/" + addr + "/holders";
      for (let page = 0; page < 8; page++) {
        const r = await jget(url);
        const list = bsHolderList(r.data);
        if (!list.length) break;
        pushRows(list);
        const n = r.data && r.data.next_page_params;
        if (!n) break;
        const q = new URLSearchParams();
        Object.entries(n).forEach(([k, v]) => {
          if (v != null) q.set(k, String(v));
        });
        url = base + "/tokens/" + addr + "/holders?" + q.toString();
      }
    }
    if (out.length) return out;

    for (let page = 1; page <= 6; page++) {
      const legacy = await jget(
        RH_BS_RPC +
          "?module=token&action=getTokenHolders&contractaddress=" +
          addr +
          "&page=" +
          page +
          "&offset=50"
      );
      const rows = bsHolderList(legacy.data);
      if (!rows.length) break;
      pushRows(rows);
      if (rows.length < 50) break;
    }
    if (out.length) return out;
  }
  return out;
}

async function bsRhTransfers(ca) {
  const all = [];
  const seen = new Set();
  const push = (list) => {
    for (const row of list || []) {
      const key =
        String(row.tx_hash || row.transaction_hash || row.hash || "") +
        "|" +
        String(row.log_index || row.block_number || row.timestamp || all.length);
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(row);
    }
  };

  for (const addr of rhCaVariants(ca)) {
    for (const base of [RH_BS, RH_BS_PRO]) {
      let url = base + "/tokens/" + addr + "/transfers";
      for (let page = 0; page < 6; page++) {
        const r = await jget(url);
        const latest = (r.data && (r.data.items || r.data.transfers || r.data.result)) || [];
        if (!Array.isArray(latest) || !latest.length) break;
        push(latest);
        const n = r.data && r.data.next_page_params;
        if (!n) break;
        const q = new URLSearchParams();
        Object.entries(n).forEach(([k, v]) => {
          if (v != null) q.set(k, String(v));
        });
        url = base + "/tokens/" + addr + "/transfers?" + q.toString();
      }
    }
    if (all.length) return all;
  }
  return all;
}

async function bsRhEarlyTransfers(ca) {
  const all = [];
  for (const addr of rhCaVariants(ca)) {
    for (const offset of [150, 200]) {
      const r = await jget(
        RH_BS_RPC +
          "?module=account&action=tokentx&contractaddress=" +
          addr +
          "&page=1&offset=" +
          offset +
          "&sort=asc"
      );
      const rows = (r.data && r.data.result) || [];
      if (Array.isArray(rows) && rows.length && typeof rows[0] === "object") {
        all.push(...rows);
        break;
      }
    }
    if (all.length) return all;
  }
  return all;
}

async function bsRhTokenPageMeta(ca) {
  for (const addr of rhCaVariants(ca)) {
    try {
      const res = await fetch(RH_EXPLORER + "/token/" + addr, {
        headers: { "User-Agent": "VEXLORE-Bot", Accept: "text/html" },
        signal: AbortSignal.timeout(18000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      if (!html) continue;
      const holdM =
        html.match(/Holders[^0-9]{0,48}([0-9,]{1,12})/i) ||
        html.match(/"holders_count"\s*:\s*"?([0-9,]{1,12})"?/i) ||
        html.match(/token_holders_count"\s*:\s*"?([0-9,]{1,12})"?/i);
      const supplyM = html.match(/Total supply[^0-9]{0,48}([0-9,][0-9,.]{0,40})/i);
      const nameM = html.match(/<h1[^>]*>\s*([^<]{1,80})\s*<\/h1>/i);
      return {
        holders: holdM ? Number(String(holdM[1]).replace(/,/g, "")) : null,
        supplyText: supplyM ? String(supplyM[1]).trim() : "",
        name: nameM ? String(nameM[1]).trim() : "",
      };
    } catch (_) {}
  }
  return null;
}

async function bsRhTokenSearch(q) {
  if (!q) return [];
  const out = [];
  const seen = new Set();
  for (const base of [RH_BS, RH_BS_PRO]) {
    const r = await jget(base + "/tokens?q=" + encodeURIComponent(q) + "&type=ERC-20");
    const list = (r.data && r.data.items) || [];
    for (const t of Array.isArray(list) ? list : []) {
      const mint = String(t.address_hash || t.address || t.hash || "").toLowerCase();
      if (!mint || seen.has(mint)) continue;
      seen.add(mint);
      out.push(t);
    }
  }
  return out;
}

async function bsRhCreatedBy(addr) {
  if (!addr) return [];
  const out = [];
  const seen = new Set();
  let url = RH_BS + "/addresses/" + addr + "/transactions";
  for (let page = 0; page < 4; page++) {
    const r = await jget(url);
    const list = (r.data && r.data.items) || [];
    if (!Array.isArray(list) || !list.length) break;
    for (const tx of list) {
      const created =
        (tx.created_contract && (tx.created_contract.hash || tx.created_contract.address_hash)) ||
        tx.created_contract_hash ||
        "";
      if (!created || seen.has(String(created).toLowerCase())) continue;
      seen.add(String(created).toLowerCase());
      out.push({
        ca: created,
        when: toDate(tx.timestamp),
        hash: tx.hash || "",
      });
    }
    const n = r.data && r.data.next_page_params;
    if (!n) break;
    const q = new URLSearchParams();
    Object.entries(n).forEach(([k, v]) => {
      if (v != null) q.set(k, String(v));
    });
    url = RH_BS + "/addresses/" + addr + "/transactions?" + q.toString();
  }
  return out;
}

let rhAssetCache = { at: 0, list: [] };
async function rhOfficialAssets() {
  if (Date.now() - rhAssetCache.at < 6 * 60 * 60 * 1000 && rhAssetCache.list.length) {
    return rhAssetCache.list;
  }
  const r = await jget(RH_ASSETS);
  const list = Array.isArray(r.data) ? r.data : (r.data && (r.data.assets || r.data.results)) || [];
  rhAssetCache = { at: Date.now(), list: Array.isArray(list) ? list : [] };
  return rhAssetCache.list;
}

function collectRhAddrs(asset) {
  const out = [];
  const push = (x) => {
    if (typeof x === "string" && x.startsWith("0x")) out.push(x.toLowerCase());
  };
  push(asset && asset.contract);
  push(asset && asset.address);
  push(asset && asset.tokenAddress);
  push(asset && asset.contractAddress);
  const bags = [
    asset && asset.deployments,
    asset && asset.chains,
    asset && asset.contracts,
    asset && asset.addresses,
  ];
  for (const bag of bags) {
    if (!bag) continue;
    if (Array.isArray(bag)) {
      for (const d of bag) {
        if (typeof d === "string") push(d);
        else if (d && typeof d === "object") {
          push(d.address);
          push(d.contract);
          push(d.contractAddress);
          push(d.tokenAddress);
        }
      }
    } else if (typeof bag === "object") {
      for (const d of Object.values(bag)) {
        if (typeof d === "string") push(d);
        else if (d && typeof d === "object") {
          push(d.address);
          push(d.contract);
          push(d.contractAddress);
        }
      }
    }
  }
  return out;
}

function rhOfficialMatch(assets, ca, symbol) {
  const addr = String(ca || "").toLowerCase();
  for (const a of assets || []) {
    if (collectRhAddrs(a).includes(addr)) return a;
  }
  const sym = String(symbol || "").toUpperCase();
  if (!sym) return null;
  for (const a of assets || []) {
    const officialSym = String(a.tokenSymbol || a.symbol || "").toUpperCase();
    const officialName = String(a.tokenName || a.name || "").toLowerCase();
    if (officialSym === sym && officialName.includes("robinhood token")) return a;
  }
  return null;
}

async function rhOfficialPrice(symbol) {
  if (!symbol) return null;
  const r = await jget(RH_PRICE + encodeURIComponent(symbol));
  return r.ok ? r.data : null;
}

function geckoMc(tok) {
  const a = tok && tok.attributes;
  if (!a) return {};
  return {
    name: a.name,
    symbol: a.symbol,
    price: num(a.price_usd),
    mc: num(a.market_cap_usd) || num(a.fdv_usd),
    fdv: num(a.fdv_usd),
    vol: num(a.volume_usd && (a.volume_usd.h24 || a.volume_usd)),
    liq: num(a.total_reserve_in_usd),
  };
}

function geckoInfoBits(info) {
  const a = (info && info.attributes) || info || {};
  const sites = Array.isArray(a.websites) ? a.websites : a.website ? [a.website] : [];
  return {
    desc: String(a.description || a.token_description || "").trim(),
    twitter: a.twitter_handle || a.twitter || "",
    telegram: a.telegram_handle || a.telegram || "",
    website: sites[0] || "",
    discord: a.discord_url || a.discord || "",
    holders: a.holders || null,
    categories: Array.isArray(a.categories) ? a.categories : [],
  };
}

function pairSocials(pair) {
  const info = pair && pair.info;
  const out = { twitter: "", telegram: "", website: "", desc: "" };
  if (!info) return out;
  const sites = Array.isArray(info.websites) ? info.websites : [];
  out.website = (sites[0] && (sites[0].url || sites[0])) || "";
  const socials = Array.isArray(info.socials) ? info.socials : [];
  for (const s of socials) {
    const type = String((s && s.type) || "").toLowerCase();
    const url = String((s && (s.url || s.handle)) || "");
    if (type.includes("twitter") || type.includes("x")) out.twitter = url;
    if (type.includes("telegram")) out.telegram = url;
  }
  return out;
}

function rhQuote(pair, gecko, bs, paprika) {
  const g = geckoMc(gecko);
  const p24 = paprika && paprika["24h"];
  return {
    name:
      (pair && pair.baseToken && pair.baseToken.name) ||
      g.name ||
      (bs && bs.name) ||
      (paprika && paprika.name) ||
      "Unknown",
    symbol:
      (pair && pair.baseToken && pair.baseToken.symbol) ||
      g.symbol ||
      (bs && bs.symbol) ||
      (paprika && paprika.symbol) ||
      "?",
    price: num(pair && pair.priceUsd) || g.price || num(paprika && paprika.price_usd),
    mc: pairMc(pair) || g.mc || num(paprika && paprika.fdv),
    fdv: num(pair && pair.fdv) || g.fdv || num(paprika && paprika.fdv),
    liq: pairLiq(pair) || g.liq || num(paprika && paprika.liquidity_usd),
    vol: pairVol(pair) || g.vol || num(p24 && (p24.volume_usd || p24.volume)),
    dex: (pair && (pair.dexId || pair.dexName)) || "",
    url:
      (pair && pair.url) ||
      (pair && pair.pairAddress ? "https://dexscreener.com/robinhood/" + pair.pairAddress : ""),
  };
}

function rhHolderAddr(h) {
  if (!h) return "";
  if (typeof h.address === "string" && h.address) return h.address;
  if (typeof h.address_hash === "string" && h.address_hash) return h.address_hash;
  const bag = h.address || h.address_hash || h.holder || h.account || null;
  if (bag && typeof bag === "object") {
    return (
      bag.hash ||
      bag.address_hash ||
      bag.address ||
      bag.wallet ||
      ""
    );
  }
  return h.hash || h.wallet || h.holderAddress || h.accountAddress || "";
}

function rhHolderIsContract(h) {
  const a = h && (h.address || h.address_hash);
  return !!(a && typeof a === "object" && (a.is_contract || a.isContract));
}

function rhHolderName(h) {
  const a = h && (h.address || h.address_hash);
  return (a && typeof a === "object" && (a.name || a.implementation_name || a.ens_domain_name)) || "";
}

function parseRhHolders(holders, bs, pair, counters) {
  const list = Array.isArray(holders) ? holders : [];
  const supply =
    Number(bs && (bs.total_supply || bs.totalSupply || bs.circulating_supply)) || 0;
  const holderCount =
    countOrZero(counters && (counters.token_holders_count || counters.holders_count || counters.tokenHoldersCount)) ||
    countOrZero(bs && (bs.holders_count || bs.holder_count || bs.holdersCount || bs.holders)) ||
    (list.length ? list.length : null);
  const pairAddr = String((pair && pair.pairAddress) || "").toLowerCase();
  const rows = [];

  for (const h of list) {
    const addr = String(rhHolderAddr(h) || "");
    if (!addr) continue;
    const raw = Number(h.value ?? h.balance ?? (h.token && h.token.value) ?? 0);
    let pctn = Number(h.percentage ?? h.percent ?? h.share);
    if (!Number.isFinite(pctn) || pctn < 0) {
      pctn = supply > 0 && Number.isFinite(raw) ? (raw / supply) * 100 : 0;
    } else if (pctn > 0 && pctn <= 1 && supply > 0) {
      pctn = pctn * 100;
    }
    const name = rhHolderName(h);
    const low = addr.toLowerCase();
    const isDead = /dead$/.test(low) || /^0x0+$/.test(low) || /deadaddress|burn/i.test(name);
    const isLp =
      !!(pairAddr && low === pairAddr) ||
      /pool|pair|lp|uniswap|router|pancake|ramses|lock/i.test(name);
    let tag = "SHRIMP";
    if (isDead) tag = "BURN";
    else if (isLp) tag = "LP";
    else if (rhHolderIsContract(h) && pctn >= 1) tag = "LP";
    else if (pctn >= 5) tag = "WHALE";
    else if (pctn >= 1) tag = "FISH";
    else if (pctn >= 0.2) tag = "CRAB";
    rows.push({
      addr,
      raw: Number.isFinite(raw) ? raw : 0,
      pctn: Number.isFinite(pctn) ? pctn : 0,
      tag,
      name,
      isContract: rhHolderIsContract(h),
    });
  }

  const peopleConc = rows
    .filter((r) => r.tag !== "LP" && r.tag !== "BURN")
    .slice(0, 10)
    .reduce((s, r) => s + r.pctn, 0);
  const topConc = rows.slice(0, 10).reduce((s, r) => s + r.pctn, 0);
  return {
    rows,
    holderCount: holderCount != null ? holderCount : rows.length || null,
    liveHolders: rows.length,
    supply,
    peopleConc,
    topConc,
  };
}

function rhSizeIcon(tag) {
  if (tag === "LP") return "💧";
  if (tag === "BURN") return "🔥";
  if (tag === "WHALE") return "🐳";
  if (tag === "FISH") return "🐟";
  if (tag === "CRAB") return "🦀";
  return "🦐";
}

function parseRhTransfers(transfers) {
  return (Array.isArray(transfers) ? transfers : [])
    .map((t) => {
      const from = String(
        (t.from && (t.from.hash || t.from.address_hash || t.from)) ||
          t.from_address ||
          t.fromAddress ||
          t.from ||
          ""
      ).toLowerCase();
      const to = String(
        (t.to && (t.to.hash || t.to.address_hash || t.to)) ||
          t.to_address ||
          t.toAddress ||
          t.to ||
          ""
      ).toLowerCase();
      const block = Number(t.block_number || t.blockNumber || t.block || 0);
      const when = toDate(t.timestamp || t.block_timestamp || t.timeStamp || t.time);
      const value = Number(t.total && t.total.value != null ? t.total.value : t.value);
      const type = String(t.type || t.method || "").toLowerCase();
      const tx = t.tx_hash || t.transaction_hash || t.hash || "";
      return { from, to, block, when, value, type, tx };
    })
    .filter((t) => t.to);
}

function analyzeRhBundles(transfers, holdersParsed, pair) {
  const rows = parseRhTransfers(transfers);
  const pairAddr = String((pair && pair.pairAddress) || "").toLowerCase();
  const zero = "0x0000000000000000000000000000000000000000";
  const incoming = rows.filter((t) => t.to && t.to !== zero && t.to !== pairAddr);
  const dated = incoming
    .filter((t) => t.block > 0 || t.when)
    .sort((a, b) => {
      if (a.block && b.block && a.block !== b.block) return a.block - b.block;
      const ta = a.when ? a.when.getTime() : 0;
      const tb = b.when ? b.when.getTime() : 0;
      return ta - tb;
    });

  if (!dated.length) {
    return { clusters: [], launch: [], nowPct: 0, initWallets: 0, firstBlock: null, heat: "⚪ 0 indexed" };
  }

  const firstBlock = dated[0].block || 0;
  const firstMs = dated[0].when ? dated[0].when.getTime() : 0;
  const WINDOW_BLOCKS = 200;
  const WINDOW_MS = 20 * 1000;
  const LAUNCH_BLOCKS = 80;
  const LAUNCH_MS = 8 * 1000;

  const groups = new Map();
  for (const t of dated) {
    const blockGap = firstBlock && t.block ? t.block - firstBlock : 0;
    const timeGap = firstMs && t.when ? t.when.getTime() - firstMs : 0;
    if (blockGap > WINDOW_BLOCKS && timeGap > WINDOW_MS) break;
    const key = t.block > 0 ? String(t.block) : t.when ? String(Math.floor(t.when.getTime() / 1000)) : "unk";
    const g = groups.get(key) || { block: t.block, when: t.when, wallets: new Set(), txs: 0 };
    g.wallets.add(t.to);
    g.txs += 1;
    if (!g.when && t.when) g.when = t.when;
    groups.set(key, g);
  }

  const holdMap = new Map(
    ((holdersParsed && holdersParsed.rows) || []).map((h) => [String(h.addr).toLowerCase(), h])
  );

  const clusters = [...groups.values()]
    .map((g) => {
      const addrs = [...g.wallets];
      const nowPct = addrs.reduce((s, a) => s + ((holdMap.get(a) && holdMap.get(a).pctn) || 0), 0);
      return { block: g.block, when: g.when, wallets: addrs, txs: g.txs, nowPct };
    })
    .sort((a, b) => (a.block || 0) - (b.block || 0));

  let launch = clusters.filter((c) => {
    const blockGap = firstBlock && c.block ? c.block - firstBlock : 0;
    const timeGap = firstMs && c.when ? c.when.getTime() - firstMs : 0;
    return blockGap <= LAUNCH_BLOCKS || timeGap <= LAUNCH_MS;
  });
  if (!launch.length) launch = clusters.slice(0, 8);
  const launchWallets = new Set(launch.flatMap((c) => c.wallets));
  const nowPct = [...launchWallets].reduce(
    (s, a) => s + ((holdMap.get(a) && holdMap.get(a).pctn) || 0),
    0
  );

  let heat = "🟢 clean";
  if (nowPct >= 30 || launchWallets.size >= 20) heat = "🔴 heavy";
  else if (nowPct >= 15 || launchWallets.size >= 10) heat = "🟠 fat";
  else if (nowPct >= 5 || launchWallets.size >= 5) heat = "🟡 present";

  return {
    clusters,
    launch,
    nowPct,
    initWallets: launchWallets.size,
    firstBlock,
    heat,
  };
}

function rhPaidBlock(paid) {
  if (!paid || !paid.ok) return "Dex paid: n/a";
  if (paid.profilePaid || paid.adPaid) {
    return (
      (paid.profilePaid ? "✅ Profile paid" : "❌ Profile not paid") +
      " · " +
      (paid.adPaid ? "✅ Ad paid" : "Ad no") +
      (paid.firstPay ? "\n🕒 first pay: " + utc(paid.firstPay) : "")
    );
  }
  if (paid.orders && paid.orders.length) {
    return (
      "❌ no live paid profile/ad\n" +
      paid.orders
        .slice(0, 3)
        .map((o) => "• " + o.type + " · " + o.status + " · " + utc(o.when))
        .join("\n")
    );
  }
  return "❌ Dex profile not paid";
}

function rhLore({ official, fam, desc, socials, bundleNow, topConc, holderCount, mc, paid }) {
  let score = 50;
  const notes = [];
  const ogTag =
    fam && fam.isOg ? "OG" : fam && fam.all && fam.all.length > 1 ? "VAMP" : "UNKNOWN";

  if (official) {
    score += 14;
    notes.push("official RH registry");
  }
  if (ogTag === "OG") {
    score += 12;
    notes.push("OG deploy");
  }
  if (ogTag === "VAMP") {
    score -= 18;
    notes.push("vamp ticker");
  }
  if (desc && desc.length > 40) {
    score += 8;
    notes.push("has story");
  } else {
    score -= 6;
    notes.push("thin lore");
  }
  if (socials && socials.twitter && socials.telegram) {
    score += 8;
    notes.push("socials linked");
  } else if (socials && (socials.twitter || socials.telegram || socials.website)) {
    score += 3;
    notes.push("some socials");
  }
  if (paid && (paid.profilePaid || paid.adPaid)) {
    score += 6;
    notes.push("dex paid");
  }
  if (Number(bundleNow) >= 20) {
    score -= 15;
    notes.push("fat launch cluster");
  }
  if (Number(topConc) >= 60) {
    score -= 10;
    notes.push("top10 concentrated");
  } else if (Number(topConc) >= 40) {
    score -= 4;
    notes.push("top heavy");
  }
  if (holderCount >= 500) {
    score += 6;
    notes.push("wide holders");
  } else if (holderCount != null && holderCount < 30) {
    score -= 6;
    notes.push("thin holders");
  }
  if (Number(mc) >= 100000) score += 6;

  score = Math.max(0, Math.min(100, score));
  let verdict = "❌ weak";
  if (score >= 70) verdict = "✅ watch";
  else if (score >= 50) verdict = "⚠️ mixed";
  return {
    score,
    verdict,
    notes,
    desc: String(desc || "No description.").slice(0, 200),
    ogTag,
  };
}

async function loadRhScan(ca) {
  const [
    pair,
    gecko,
    info,
    bs,
    holders,
    transfers,
    earlyTransfers,
    assets,
    paprika,
    paid,
    addrInfo,
    pageMeta,
    counters,
  ] = await Promise.all([
    soft(dexRhPair(ca)),
    soft(geckoRhToken(ca)),
    soft(geckoRhTokenInfo(ca)),
    soft(bsRhToken(ca)),
    soft(bsRhHolders(ca)),
    soft(bsRhTransfers(ca)),
    soft(bsRhEarlyTransfers(ca)),
    soft(rhOfficialAssets()),
    soft(paprikaRhToken(ca)),
    soft(dexRhPaid(ca)),
    soft(bsRhAddress(ca)),
    soft(bsRhTokenPageMeta(ca)),
    soft(bsRhTokenCounters(ca)),
  ]);
  const q = rhQuote(pair, gecko, bs, paprika);
  const official = rhOfficialMatch(assets || [], ca, q.symbol);
  const parsedH = parseRhHolders(holders || [], bs, pair, counters);
  if (!parsedH.holderCount && pageMeta && pageMeta.holders != null) {
    parsedH.holderCount = pageMeta.holders;
  }
  const launchRows = (earlyTransfers && earlyTransfers.length ? earlyTransfers : transfers) || [];
  const bundled = analyzeRhBundles(launchRows, parsedH, pair);
  const gSocials = geckoInfoBits(info);
  const pSocials = pairSocials(pair);
  const socials = {
    desc: gSocials.desc,
    twitter: gSocials.twitter || pSocials.twitter,
    telegram: gSocials.telegram || pSocials.telegram,
    website: gSocials.website || pSocials.website,
    discord: gSocials.discord,
    holders: gSocials.holders,
    categories: gSocials.categories,
  };
  if (socials.holders && socials.holders.distribution_percentage) {
    const top10 = Number(socials.holders.distribution_percentage.top_10);
    if (Number.isFinite(top10) && top10 > parsedH.topConc) parsedH.topConc = top10;
  }
  const geckoHoldCount = countOrZero(
    socials.holders && (socials.holders.count || socials.holders.total || socials.holders.holder_count)
  );
  if (geckoHoldCount != null && !parsedH.holderCount) parsedH.holderCount = geckoHoldCount;
  if (!parsedH.holderCount && parsedH.rows.length) parsedH.holderCount = parsedH.rows.length;
  const fam = await findRhFamily(ca, pair, gecko);
  return {
    pair,
    gecko,
    info,
    bs,
    holders,
    transfers,
    earlyTransfers,
    assets,
    paprika,
    paid,
    addrInfo,
    q,
    official,
    parsedH,
    bundled,
    socials,
    fam,
  };
}

/* ───────── DexScreener meme + banner (scan photos only) ───────── */

function firstHttpUrl(...vals) {
  for (const v of vals) {
    const s = String(v || "").trim();
    if (/^https?:\/\//i.test(s)) return s;
  }
  return "";
}

function dexCdnImage(ca) {
  if (isEvmCa(ca)) {
    return "https://dd.dexscreener.com/ds-data/tokens/robinhood/" + String(ca).toLowerCase() + ".png";
  }
  if (isCa(ca)) return "https://dd.dexscreener.com/ds-data/tokens/solana/" + ca + ".png";
  return "";
}

function dexCdnBanner(ca) {
  if (isEvmCa(ca)) {
    return "https://dd.dexscreener.com/ds-data/tokens/robinhood/" + String(ca).toLowerCase() + "/header.png";
  }
  if (isCa(ca)) return "https://dd.dexscreener.com/ds-data/tokens/solana/" + ca + "/header.png";
  return "";
}

function pairDexMedia(pair) {
  const info = pair && pair.info;
  return {
    image: firstHttpUrl(info && info.imageUrl, info && info.image, pair && pair.imageUrl),
    banner: firstHttpUrl(info && info.header, info && info.openGraph, info && info.banner),
  };
}

async function loadScanMedia(ca) {
  const out = { image: "", banner: "", name: "", symbol: "" };
  if (isEvmCa(ca)) {
    const chain = await detectEvmChain(ca);
    const [pair, gecko] = await Promise.all([
      chain === "arc" ? soft(dexArcPair(ca)) : soft(dexRhPair(ca)),
      chain === "arc" ? soft(geckoArcToken(ca)) : soft(geckoRhToken(ca)),
    ]);
    const fromPair = pairDexMedia(pair);
    const g = gecko && gecko.attributes;
    const cdnBase =
      chain === "arc"
        ? "https://dd.dexscreener.com/ds-data/tokens/arc/" + String(ca).toLowerCase()
        : "https://dd.dexscreener.com/ds-data/tokens/robinhood/" + String(ca).toLowerCase();
    out.image =
      fromPair.image ||
      firstHttpUrl(g && (g.image_url || g.imageUrl)) ||
      cdnBase + ".png";
    out.banner = fromPair.banner || cdnBase + "/header.png";
    out.name = (pair && pair.baseToken && pair.baseToken.name) || (g && g.name) || "";
    out.symbol = (pair && pair.baseToken && pair.baseToken.symbol) || (g && g.symbol) || "";
    return out;
  }
  if (!isCa(ca)) return out;
  const [pair, pump] = await Promise.all([soft(dexPair(ca)), soft(pumpCoin(ca))]);
  const fromPair = pairDexMedia(pair);
  out.image =
    fromPair.image ||
    firstHttpUrl(
      pump && pump.image_uri,
      pump && pump.imageUri,
      pump && pump.image_url,
      pump && pump.image
    ) ||
    dexCdnImage(ca);
  out.banner = fromPair.banner || dexCdnBanner(ca);
  out.name = (pump && pump.name) || (pair && pair.baseToken && pair.baseToken.name) || "";
  out.symbol = (pump && pump.symbol) || (pair && pair.baseToken && pair.baseToken.symbol) || "";
  return out;
}

async function sendOnePhoto(api, chatId, url, extra) {
  if (!url) return false;
  try {
    await api.sendPhoto(chatId, url, extra || {});
    return true;
  } catch (_) {
    return false;
  }
}

async function sendScanMedia(api, chatId, ca, media) {
  const image = media && media.image;
  const banner = media && media.banner;
  if (!image && !banner) return false;

  const title =
    (media && media.name ? esc(media.name) : "") +
    (media && media.symbol ? " (" + esc(media.symbol) + ")" : "");
  const caption =
    "🖼 <b>DexScreener</b>" +
    (title ? " · " + title : "") +
    "\n<code>" +
    esc(ca) +
    "</code>";

  const urls = [];
  if (image) urls.push(image);
  if (banner && banner !== image) urls.push(banner);
  if (!urls.length) return false;

  if (urls.length >= 2) {
    try {
      await api.sendMediaGroup(chatId, [
        { type: "photo", media: urls[0], caption, parse_mode: "HTML" },
        { type: "photo", media: urls[1] },
      ]);
      return true;
    } catch (_) {}
  }

  const sentImage = await sendOnePhoto(api, chatId, image, {
    caption,
    parse_mode: "HTML",
  });
  const sentBanner = await sendOnePhoto(
    api,
    chatId,
    banner && banner !== image ? banner : "",
    sentImage
      ? { caption: "🖼 DexScreener banner\n<code>" + esc(ca) + "</code>", parse_mode: "HTML" }
      : { caption, parse_mode: "HTML" }
  );
  return sentImage || sentBanner;
}

async function finishScanMessage(ctx, loadingMsg, text, replyMarkup, ca) {
  const chatId = ctx.chat.id;
  let media = { image: "", banner: "" };
  try {
    media = await loadScanMedia(ca);
  } catch (_) {}

  if (loadingMsg && loadingMsg.message_id) {
    try {
      await ctx.api.deleteMessage(chatId, loadingMsg.message_id);
    } catch (_) {}
  }

  await sendScanMedia(ctx.api, chatId, ca, media);

  const sent = await ctx.api.sendMessage(chatId, text, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: replyMarkup,
  });
  rememberOwner(chatId, sent.message_id, ctx.from && ctx.from.id);
  return sent;
}

/* ───────── stonks.fun / StonkFun ───────── */

function unwrapSf(data) {
  if (!data || typeof data !== "object") return null;
  if (data.error || data.message === "404: NOT_FOUND") return null;
  if (data.data && typeof data.data === "object" && !Array.isArray(data.data)) return data.data;
  return data;
}

function sfList(data) {
  const bag = unwrapSf(data) || data;
  if (Array.isArray(bag)) return bag;
  if (!bag || typeof bag !== "object") return [];
  for (const k of ["tokens", "items", "results", "coins", "baskets", "launches", "data"]) {
    if (Array.isArray(bag[k])) return bag[k];
  }
  return [];
}

function sfPickToken(bag) {
  if (!bag || typeof bag !== "object") return null;
  if (bag.token && typeof bag.token === "object") return bag;
  if (bag.coin && typeof bag.coin === "object") return { token: bag.coin, launch: bag.launch || bag.coin.launch || null };
  if (bag.mint || bag.address || bag.symbol || bag.name || bag.status || bag.creator) {
    return { token: bag, launch: bag.launch || null };
  }
  return null;
}

async function stonkFunSol(ca) {
  if (!isCa(ca) || isEvmCa(ca)) return null;
  const direct = await jget(SF_SOL_API + "/tokens/" + encodeURIComponent(ca));
  if (direct.ok && direct.data) {
    const picked = sfPickToken(unwrapSf(direct.data) || direct.data);
    if (picked && picked.token) return { listed: true, token: picked.token, launch: picked.launch };
  }
  const search = await jget(SF_SOL_API + "/tokens?q=" + encodeURIComponent(ca) + "&pageSize=25");
  const rows = sfList(search.data);
  for (const row of rows) {
    const picked = sfPickToken(row) || { token: row };
    const tok = picked.token || {};
    const mint = String(tok.mint || tok.address || row.mint || "");
    if (mint && mint === String(ca)) return { listed: true, token: tok, launch: picked.launch || tok.launch || null };
  }
  return { listed: false, token: null, launch: null };
}

async function stonksFunRhJson(ca) {
  if (!isEvmCa(ca)) return null;
  const urls = [
    STONKSFUN_XYZ + "/api/coins/" + ca,
    STONKSFUN_XYZ + "/api/token/" + ca,
    STONKSFUN_XYZ + "/api/tokens/" + ca,
    STONKSFUN_XYZ + "/api/stonks/" + ca,
    STONKS_FUN + "/api/coins/" + ca,
    STONKS_FUN + "/api/token/" + ca,
    STONKS_FUN + "/api/tokens/" + ca,
    STONKS_FUN + "/api/baskets/" + ca,
    STONKS_FUN + "/api/indexes/" + ca,
    BASESTONK_API + "/api/launchpad/tokens/" + ca + "?chain=robinhood",
  ];
  for (const u of urls) {
    const r = await jget(u);
    if (!r.ok || !r.data) continue;
    const bag = unwrapSf(r.data);
    const picked = sfPickToken(bag);
    if (!picked || !picked.token) continue;
    const tok = picked.token;
    if (!(tok.name || tok.symbol || tok.creator || tok.address || tok.mint || tok.pair || tok.marketCap)) continue;
    const source = u.includes("basestonk") ? "basestonk" : u.includes("stonksfun.xyz") ? "stonksfun.xyz" : "stonks.fun";
    return { listed: true, source, token: tok, launch: picked.launch || null };
  }
  return null;
}

function parseMoneyLoose(s) {
  const t = String(s || "").replace(/,/g, "").trim();
  const m = t.match(/\$?\s*([0-9]*\.?[0-9]+)\s*([KMB])?/i);
  if (!m) return null;
  let n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const u = String(m[2] || "").toUpperCase();
  if (u === "K") n *= 1e3;
  if (u === "M") n *= 1e6;
  if (u === "B") n *= 1e9;
  return n;
}

async function stonksFunRhHtml(ca) {
  if (!isEvmCa(ca)) return null;
  const pages = [
    STONKSFUN_XYZ + "/coin/" + ca,
    STONKSFUN_XYZ + "/token/" + ca,
    STONKS_FUN + "/coin/" + ca,
    STONKS_FUN + "/token/" + ca,
  ];
  for (const u of pages) {
    try {
      const res = await fetch(u, {
        headers: { "User-Agent": "VEXLORE-Bot", Accept: "text/html" },
        signal: AbortSignal.timeout(18000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      if (!html) continue;
      const looksCoin =
        /token details|freeze board|launch a stonk|share certificate|liquidity locked|uniswap v3 from block one|certificate/i.test(
          html
        );
      if (!looksCoin) continue;
      const nameM = html.match(/<h1[^>]*>\s*([^<]{1,80})\s*<\/h1>/i);
      const symM = html.match(/\$([A-Z0-9]{2,16})/);
      const holdM = html.match(/holders[^0-9]{0,24}([0-9,]{1,10})/i);
      const mcM = html.match(/market cap[^$]{0,24}(\$[\d.,]+[KMB]?)/i);
      const volM = html.match(/24h volume[^$]{0,24}(\$[\d.,]+[KMB]?)/i);
      const creatorM = html.match(/creator[^<]{0,80}?(0x[a-fA-F0-9]{40})/i);
      const poolM = html.match(/pool[^<]{0,80}?(0x[a-fA-F0-9]{40})/i);
      return {
        listed: true,
        source: "html",
        url: u,
        name: nameM ? String(nameM[1]).trim() : "",
        symbol: symM ? symM[1] : "",
        creator: creatorM ? creatorM[1] : "",
        pool: poolM ? poolM[1] : "",
        holders: holdM ? Number(String(holdM[1]).replace(/,/g, "")) : null,
        mc: parseMoneyLoose(mcM && mcM[1]),
        vol: parseMoneyLoose(volM && volM[1]),
      };
    } catch (_) {}
  }
  return null;
}

function pairDetailLines(pair) {
  if (!pair) return "Pair: not indexed on DexScreener yet";
  const base = pair.baseToken || {};
  const quote = pair.quoteToken || {};
  return (
    "DEX " + esc(pair.dexId || pair.dexName || "n/a") +
    (pair.pairAddress ? "\nPair <code>" + esc(pair.pairAddress) + "</code>" : "") +
    "\nBase " + esc(base.symbol || "") +
    (base.address ? " · <code>" + esc(base.address) + "</code>" : "") +
    "\nQuote " + esc(quote.symbol || quote.name || "") +
    (quote.address ? " · <code>" + esc(quote.address) + "</code>" : "") +
    "\nMC " + moneyMkt(pairMc(pair)) +
    " · FDV " + moneyMkt(pair.fdv) +
    "\n💧 Liq " + moneyMkt(pairLiq(pair)) +
    " · 📊 Vol24 " + moneyMkt(pairVol(pair)) +
    (pair.priceUsd ? "\nPx " + money(pair.priceUsd) : "") +
    "\n🕐 Pair: " + utc(toDate(pair.pairCreatedAt)) +
    (pair.url ? "\n" + pair.url : "")
  );
}

function sfSolLines(row, pair, paid) {
  if (!row || !row.listed || !row.token) {
    return (
      "❌ Not listed on StonkFun (stonkfun.xyz)" +
      (pair ? "\n\n💰 <b>Dex pair</b>\n" + pairDetailLines(pair) : "")
    );
  }
  const t = row.token;
  const L = row.launch || {};
  const m = t.market || {};
  const q = t.quote || L.quote || {};
  const links = t.links || {};
  const created = toDate(t.createdAt || t.launchedAt || L.createdAt || t.created_at);
  const graduated = toDate(t.graduatedAt || L.graduatedAt);
  const grad = t.graduationProgress != null ? t.graduationProgress : t.bondProgress;
  const gradN = Number(grad);
  const gradPct = Number.isFinite(gradN) ? pct(gradN <= 1 ? gradN * 100 : gradN) : "n/a";
  const quoteSym = t.quoteSymbol || q.symbol || L.quoteSymbol || (pair && pair.quoteToken && pair.quoteToken.symbol) || "";
  const quoteName = q.name || t.quoteName || (pair && pair.quoteToken && pair.quoteToken.name) || "";
  const quoteMint =
    t.quoteMint ||
    q.mint ||
    q.address ||
    L.quoteMint ||
    (L.quote && (L.quote.mint || L.quote.address)) ||
    (pair && pair.quoteToken && pair.quoteToken.address) ||
    "";
  const pool =
    t.pool ||
    L.pool ||
    t.poolAddress ||
    t.pairAddress ||
    (pair && pair.pairAddress) ||
    "";
  const mc = t.marketCap || t.marketCapUsd || m.marketCapUsd || pairMc(pair);
  const ath = t.peakMarketCapUsd || m.peakMarketCapUsd || L.targetMarketCapUsd;
  const liq = t.liquidityUsd || m.liquidityUsd || pairLiq(pair);
  const vol = t.volume || t.volume24h || t.volume24hUsd || m.volume24hUsd || pairVol(pair);
  const px = t.priceUsd || t.price || m.priceUsd || (pair && pair.priceUsd);
  return (
    "✅ Listed on StonkFun\n" +
    "<b>" + esc(t.name || L.name || "") + " (" + esc(t.symbol || L.symbol || "") + ")</b>\n" +
    "Quote " + esc(quoteSym || "n/a") +
    (quoteName ? " · " + esc(quoteName) : "") +
    (q.category || t.category ? " · " + esc(q.categoryLabel || q.category || t.category) : "") + "\n" +
    (quoteMint ? "Quote mint <code>" + esc(quoteMint) + "</code>\n" : "") +
    "Mode " + esc(t.mode || L.mode || "n/a") +
    " · pad " + esc(t.launchpad || L.launchpad || "StonkFun") + "\n" +
    "Status " + esc(t.status || "n/a") +
    " · bond " + gradPct +
    (graduated ? "\nGraduated " + utc(graduated) : "") + "\n" +
    "💰 <b>Market</b>\n" +
    "MC " + moneyMkt(mc) +
    " · ATH " + moneyMkt(ath) + "\n" +
    "💧 Liq " + moneyMkt(liq) +
    " · 📊 Vol24 " + moneyMkt(vol) + "\n" +
    (px ? "Px " + money(px) + "\n" : "") +
    (m.priceChange24h != null ? "24h " + pct(m.priceChange24h) + "\n" : "") +
    (L.startMarketCapUsd ? "Start MC " + moneyMkt(L.startMarketCapUsd) + "\n" : "") +
    (L.creator || t.creator ? "Creator <code>" + esc(L.creator || t.creator) + "</code>\n" : "") +
    (pool ? "Pool <code>" + esc(pool) + "</code>\n" : "") +
    "🕐 Launch: " + utc(created) + "\n" +
    (pair ? "🕐 Dex pair: " + utc(toDate(pair.pairCreatedAt)) + "\n" : "") +
    (pair ? pairDetailLines(pair) + "\n" : "") +
    (paid ? "🧾 " + (
      paid.profilePaid || paid.adPaid
        ? (paid.profilePaid ? "✅ Profile paid" : "❌ Profile not paid") +
          " · " +
          (paid.adPaid ? "✅ Ad paid" : "Ad no")
        : "❌ Dex profile not paid"
    ) + "\n" : "") +
    (t.transferFee && t.transferFee.bps != null ? "Tax " + esc(String(t.transferFee.bps)) + " bps\n" : "") +
    (t.flywheel && t.flywheel.active ? "Flywheel active\n" : "") +
    (links.twitter || links.website
      ? [links.twitter && ("X " + links.twitter), links.website].filter(Boolean).join(" · ") + "\n"
      : "") +
    "https://www.stonkfun.xyz/token/" + esc(t.mint || "")
  );
}

function stonksRhLines(jsonRow, htmlRow, ca, pair) {
  if (!jsonRow && !htmlRow && !pair) {
    return (
      "❌ Not found on stonks.fun / stonksfun.xyz / BaseStonk RH\n" +
      STONKSFUN_XYZ + "/coin/" + ca + "\n" +
      STONKS_FUN + "/coin/" + ca
    );
  }
  const t = (jsonRow && jsonRow.token) || {};
  const h = htmlRow || {};
  const source = (jsonRow && jsonRow.source) || (h.source) || (pair ? "DexScreener RH" : "stonks.fun");
  const name = t.name || h.name || (pair && pair.baseToken && pair.baseToken.name) || "";
  const symbol = t.symbol || h.symbol || (pair && pair.baseToken && pair.baseToken.symbol) || "";
  const creator = t.creator || t.deployer || t.owner || h.creator || "";
  const pool =
    t.pool ||
    t.poolAddress ||
    t.pair ||
    (t.pair && t.pair.address) ||
    h.pool ||
    (pair && pair.pairAddress) ||
    "";
  return (
    "✅ Found on " + esc(source) + "\n" +
    "<b>" + esc(name) + (symbol ? " ($" + esc(symbol) + ")" : "") + "</b>\n" +
    (creator ? "Creator <code>" + esc(creator) + "</code>\n" : "") +
    (pool ? "Pool <code>" + esc(pool) + "</code>\n" : "") +
    "MC " + moneyMkt(t.marketCap || t.usd_market_cap || t.mc || h.mc || pairMc(pair)) +
    " · Vol24 " + moneyMkt(t.volume24h || t.volume || h.vol || pairVol(pair)) + "\n" +
    (t.price || t.priceUsd || (pair && pair.priceUsd) ? "Px " + money(t.priceUsd || t.price || (pair && pair.priceUsd)) + "\n" : "") +
    (t.holders || h.holders != null
      ? "Holders " + String(t.holders || t.holderCount || h.holders) + "\n"
      : "") +
    (t.taxBps != null || t.buyTaxBps != null
      ? "Tax " + esc(String(t.taxBps ?? t.buyTaxBps)) + " bps\n"
      : "") +
    (t.generation ? "Gen " + esc(String(t.generation)) + "\n" : "") +
    "RH pad note: Uni v3 from block one on stonks.fun · 1% fee split on pad\n" +
    (pair ? "\n💰 <b>Dex pair</b>\n" + pairDetailLines(pair) + "\n" : "") +
    (h.url || STONKSFUN_XYZ + "/coin/" + ca)
  );
}

async function buildStonks(ca) {
  if (isEvmCa(ca)) {
    const [jsonRow, htmlRow, pair] = await Promise.all([
      soft(stonksFunRhJson(ca)),
      soft(stonksFunRhHtml(ca)),
      soft(dexRhPair(ca)),
    ]);
    return (
      "📈 <b>stonks.fun check</b> · RH " + RH_CHAIN_ID + "\n" +
      "<code>" + esc(ca) + "</code>\n\n" +
      stonksRhLines(jsonRow, htmlRow, ca, pair) +
      FOOTER
    ).slice(0, 4000);
  }
  if (!isCa(ca)) return "Usage: /stonks CA" + FOOTER;
  const [row, pair, paid, bag, otherPad] = await Promise.all([
    stonkFunSol(ca),
    soft(dexPair(ca)),
    soft(dexPaid(ca)),
    soft(bagFmToken(ca)),
    soft(moonshotOrOtherPad(ca)),
  ]);
  let extraPads = "";
  if (bag) {
    extraPads +=
      "\n\n🛍 <b>Bag / other pad</b>\n" +
      "Found listing signal · " +
      esc(bag.name || bag.symbol || "token") +
      (bag.marketCap || bag.usd_market_cap ? " · MC " + moneyMkt(bag.marketCap || bag.usd_market_cap) : "");
  }
  if (otherPad && otherPad.source === "moonshot") {
    extraPads += "\n🌙 Moonshot-style index hit for this mint";
  }
  return (
    "📈 <b>StonkFun check</b>\n" +
    "<code>" + esc(ca) + "</code>\n\n" +
    sfSolLines(row, pair, paid) +
    extraPads +
    FOOTER
  ).slice(0, 4000);
}

/* ───────── holders / family (solana) ───────── */

function sizeTag(h) {
  const tags = (h.identity && h.identity.tags) || [];
  const type = (h.identity && h.identity.type) || "";
  if (tags.includes("pool") || type === "pool") return "LP";
  if (tags.includes("developer") || type === "developer") return "DEV";
  if (tags.includes("bot") || type === "bot") return "BOT";
  const pctn = Number(h.percentage || 0);
  const usd = Number(h.value && h.value.usd);
  if (pctn >= 5 || usd >= 25000) return "WHALE";
  if (pctn >= 1 || usd >= 3000) return "FISH";
  if (pctn >= 0.2 || usd >= 500) return "CRAB";
  return "SHRIMP";
}

function tokenPnl(h) {
  const p = (h.pnl && (h.pnl.token || h.pnl)) || {};
  return {
    total: p.total ?? p.unrealized ?? p.realized,
    hold: p.holdTimeSecs ?? (p.timing && p.timing.holdTimeSecs),
  };
}

function upsert(map, mint, row) {
  if (!mint) return;
  const old = map.get(mint) || {};
  const created = row.created || old.created || null;
  const oldCreated = old.created || null;
  const betterCreated =
    created && oldCreated
      ? created.getTime() < oldCreated.getTime()
        ? created
        : oldCreated
      : created || oldCreated;

  map.set(mint, {
    mint,
    name: row.name || old.name || "",
    symbol: row.symbol || old.symbol || "",
    created: betterCreated,
    mc: row.mc != null ? row.mc : old.mc,
    url: row.url || old.url || "",
    tickerMatch: !!(row.tickerMatch || old.tickerMatch),
    nameMatch: !!(row.nameMatch || old.nameMatch),
  });
}

function sameTicker(a, b) {
  const x = norm(a);
  const y = norm(b);
  return !!(x && y && x === y);
}

async function pumpSearchAllExact(term, symbol, name) {
  const out = [];
  if (!term) return out;
  const limit = 50;

  for (let offset = 0; offset < 500; offset += limit) {
    const coins = await pumpSearch({
      limit: String(limit),
      offset: String(offset),
      searchTerm: term,
      sort: "created_timestamp",
      order: "ASC",
      includeNsfw: "false",
    });
    if (!coins.length) break;

    for (const c of coins) {
      if (!c || !c.mint) continue;
      const tick = sameTicker(c.symbol, symbol);
      const nm = sameTicker(c.name, name);
      if (!tick && !nm) continue;
      out.push(c);
    }
    if (coins.length < limit) break;
  }

  return out;
}

function ingestStSearchHits(list, map, symbol, name) {
  const rows = Array.isArray(list) ? list : [];
  for (const item of rows) {
    const tok = item.token || item;
    const mint = tok.mint || tok.address || item.mint || item.address;
    const bs = tok.symbol || item.symbol;
    const bn = tok.name || item.name;
    const tick = sameTicker(bs, symbol);
    const nm = sameTicker(bn, name);
    if ((!tick && !nm) || !mint) continue;
    const created =
      toDate(tok.createdAt || tok.creationTime || tok.created || item.createdAt) ||
      toDate(item.pools && item.pools[0] && item.pools[0].createdAt);
    upsert(map, mint, {
      name: bn,
      symbol: bs,
      created,
      mc:
        (item.pools && item.pools[0] && item.pools[0].marketCap && item.pools[0].marketCap.usd) ||
        tok.marketCap,
      tickerMatch: tick,
      nameMatch: nm,
    });
  }
}

async function findOgFamily(ca, pump, pair, tokenInfo) {
  const stm = stTokenMeta(tokenInfo);
  const name =
    (pump && pump.name) ||
    (pair && pair.baseToken && pair.baseToken.name) ||
    stm.name ||
    "";
  const symbol =
    (pump && pump.symbol) ||
    (pair && pair.baseToken && pair.baseToken.symbol) ||
    stm.symbol ||
    "";
  const map = new Map();

  upsert(map, ca, {
    name,
    symbol,
    created:
      toDate(pump && pump.created_timestamp) ||
      toDate(pair && pair.pairCreatedAt) ||
      stm.created,
    mc: pairMc(pair) || num(pump && (pump.usd_market_cap || pump.market_cap)) || stPoolsQuote(tokenInfo).mc,
    url: (pair && pair.url) || stm.url,
    tickerMatch: true,
    nameMatch: true,
  });

  const queries = [...new Set([symbol, name].filter(Boolean))];

  if (ST_KEY) {
    const jobs = [];
    if (symbol) {
      jobs.push(st("/search?symbol=" + encodeURIComponent(symbol) + "&limit=250"));
      jobs.push(st("/search?query=" + encodeURIComponent(symbol) + "&limit=250"));
    }
    if (name && (!symbol || norm(name) !== norm(symbol))) {
      jobs.push(st("/search?query=" + encodeURIComponent(name) + "&limit=250"));
    }
    const results = await Promise.all(jobs);
    for (const stRes of results) {
      const rows = (stRes && (stRes.data || stRes.tokens || stRes)) || [];
      ingestStSearchHits(rows, map, symbol, name);
    }
  }

  for (const q of queries) {
    const pairs = await dexSearch(q);
    for (const p of pairs) {
      const bn = p.baseToken && p.baseToken.name;
      const bs = p.baseToken && p.baseToken.symbol;
      const mint = p.baseToken && p.baseToken.address;
      const tick = sameTicker(bs, symbol);
      const nm = sameTicker(bn, name);
      if ((!tick && !nm) || !mint) continue;
      upsert(map, mint, {
        name: bn,
        symbol: bs,
        created: toDate(p.pairCreatedAt),
        mc: pairMc(p),
        url: p.url,
        tickerMatch: tick,
        nameMatch: nm,
      });
    }

    const coins = await pumpSearchAllExact(q, symbol, name);
    for (const c of coins) {
      upsert(map, c.mint, {
        name: c.name,
        symbol: c.symbol,
        created: toDate(c.created_timestamp),
        mc: c.usd_market_cap || c.market_cap,
        tickerMatch: sameTicker(c.symbol, symbol),
        nameMatch: sameTicker(c.name, name),
      });
    }
  }

  const all = [...map.values()].sort((a, b) => {
    const ta = a.created ? a.created.getTime() : Infinity;
    const tb = b.created ? b.created.getTime() : Infinity;
    return ta - tb;
  });

  const bothFamily = all.filter((x) => x.tickerMatch && x.nameMatch && x.created);
  const tickerFamily = all.filter((x) => x.tickerMatch && x.created);
  const nameFamily = all.filter((x) => x.nameMatch && x.created);
  const dated = bothFamily.length
    ? bothFamily
    : tickerFamily.length
    ? tickerFamily
    : nameFamily.length
    ? nameFamily
    : all.filter((x) => x.created);
  const og = dated[0] || all[0] || null;
  const you = all.find((x) => x.mint === ca) || null;
  const isOg = !!(og && you && og.mint === you.mint);

  return { all, og, you, isOg, name, symbol };
}

async function findRhFamily(ca, pair, gecko) {
  const g = geckoMc(gecko);
  const name = (pair && pair.baseToken && pair.baseToken.name) || g.name || "";
  const symbol = (pair && pair.baseToken && pair.baseToken.symbol) || g.symbol || "";
  const key = String(ca).toLowerCase();
  const map = new Map();
  const clean = rhCleanName(name);

  upsert(map, key, {
    name,
    symbol,
    created: toDate(pair && pair.pairCreatedAt),
    mc: pairMc(pair) || g.mc,
    url: pair && pair.url,
    tickerMatch: true,
    nameMatch: true,
  });

  const queries = [...new Set([symbol, name, clean].filter((q) => q && String(q).length >= 2))];
  for (const q of queries) {
    const [pairs, tokens] = await Promise.all([soft(dexRhSearch(q)), soft(bsRhTokenSearch(q))]);
    for (const p of pairs || []) {
      const bn = p.baseToken && p.baseToken.name;
      const bs = p.baseToken && p.baseToken.symbol;
      const mint = p.baseToken && p.baseToken.address;
      const tick = sameTicker(bs, symbol);
      const nm = sameRhName(bn, name);
      if ((!tick && !nm) || !mint) continue;
      upsert(map, String(mint).toLowerCase(), {
        name: bn,
        symbol: bs,
        created: toDate(p.pairCreatedAt),
        mc: pairMc(p),
        url: p.url,
        tickerMatch: tick,
        nameMatch: nm,
      });
    }
    for (const t of tokens || []) {
      const mint = t.address_hash || t.address || t.hash;
      const bs = t.symbol;
      const bn = t.name;
      const tick = sameTicker(bs, symbol);
      const nm = sameRhName(bn, name);
      if ((!tick && !nm) || !mint) continue;
      upsert(map, String(mint).toLowerCase(), {
        name: bn,
        symbol: bs,
        created: toDate(t.inserted_at || t.created_at || t.createdAt),
        mc: num(t.circulating_market_cap) || num(t.market_cap),
        tickerMatch: tick,
        nameMatch: nm,
      });
    }
  }

  const missingCreated = [...map.values()].filter((x) => !x.created).slice(0, 8);
  await Promise.all(
    missingCreated.map(async (row) => {
      const tok = await soft(bsRhToken(row.mint));
      const addr = await soft(bsRhAddress(row.mint));
      const created =
        toDate(tok && (tok.inserted_at || tok.created_at || tok.createdAt)) ||
        toDate(addr && (addr.creation_tx_timestamp || addr.created_at || (addr.block && addr.block.timestamp)));
      if (created) row.created = created;
    })
  );

  const all = [...map.values()].sort((a, b) => {
    const ta = a.created ? a.created.getTime() : Infinity;
    const tb = b.created ? b.created.getTime() : Infinity;
    return ta - tb;
  });
  const bothFamily = all.filter((x) => x.tickerMatch && x.nameMatch && x.created);
  const tickerFamily = all.filter((x) => x.tickerMatch && x.created);
  const nameFamily = all.filter((x) => x.nameMatch && x.created);
  const dated = bothFamily.length
    ? bothFamily
    : tickerFamily.length
    ? tickerFamily
    : nameFamily.length
    ? nameFamily
    : all.filter((x) => x.created);
  const og = dated[0] || all[0] || null;
  const you = all.find((x) => String(x.mint).toLowerCase() === key) || null;
  const isOg = !!(og && you && String(og.mint).toLowerCase() === String(you.mint).toLowerCase());
  return { all, og, you, isOg, name, symbol };
}

/** Mark the live “buzz” CA in a vamp family (highest MC among list). */
function vampBuzzMint(all) {
  let best = null;
  let bestMc = 0;
  for (const c of all || []) {
    const m = Number(c.mc) || 0;
    if (m > bestMc) {
      bestMc = m;
      best = c.mint;
    }
  }
  if (bestMc <= 0) return "";
  return String(best || "");
}

function vampListLine(c, ca, fam, buzzMint, isRh) {
  const mintKey = isRh ? String(c.mint).toLowerCase() : String(c.mint);
  const ogKey = fam.og ? (isRh ? String(fam.og.mint).toLowerCase() : String(fam.og.mint)) : "";
  const youKey = isRh ? String(ca).toLowerCase() : String(ca);
  const isOg = !!(ogKey && mintKey === ogKey);
  const you = mintKey === youKey ? " ← you" : "";
  const mcVal = Number(c.mc);
  const hasMc = Number.isFinite(mcVal) && mcVal > 0;
  const isBuzz = !!(buzzMint && mintKey === (isRh ? String(buzzMint).toLowerCase() : String(buzzMint)) && hasMc);
  const how = isRh
    ? c.tickerMatch && c.nameMatch
      ? "ticker+name"
      : c.tickerMatch
      ? "ticker"
      : "name"
    : "";
  return (
    (isOg ? "🟢 OG CA" : "🟣 copy") +
    (isBuzz ? " 🔥 BUZZ" : "") +
    " <b>" +
    esc(c.name || "") +
    " (" +
    esc(c.symbol || "") +
    ")</b>" +
    you +
    (how ? " · " + how : "") +
    "\n" +
    "<code>" +
    esc(c.mint) +
    "</code>\n" +
    "🕐 " +
    utc(c.created) +
    (hasMc ? " · MC " + money(mcVal) : " · MC n/a")
  );
}

async function xPulse(ca, pump, pair) {
  const comm = (pump && pump.telegram) || "";
  const officialX = (pump && pump.twitter) || "";

  if (!X_BEARER) {
    return (
      "🐦 X: add X_BEARER to rank first / top post\n" +
      (officialX ? "Official: " + officialX + "\n" : "") +
      (comm ? "💬 " + comm : "💬 no community link")
    );
  }

  const r = await xApi(
    "/2/tweets/search/recent?query=" +
      encodeURIComponent('"' + String(ca) + '"') +
      "&max_results=25&tweet.fields=public_metrics,created_at,author_id&expansions=author_id&user.fields=username"
  );

  if (!r.ok) {
    return (
      "🐦 " +
      xApiErr(r) +
      "\n" +
      (officialX ? "Official: " + officialX + "\n" : "") +
      (comm ? "💬 " + comm : "💬 no community link")
    );
  }

  const tweets = (r.data && r.data.data) || [];
  const users = (r.data && r.data.includes && r.data.includes.users) || [];
  const umap = {};
  users.forEach((u) => {
    umap[u.id] = u;
  });

  if (!tweets.length) {
    return (
      "🐦 no recent X posts with this CA\n" +
      (officialX ? "Official: " + officialX + "\n" : "") +
      (comm ? "💬 " + comm : "")
    );
  }

  const scored = tweets.map((t) => {
    const m = t.public_metrics || {};
    return { score: (m.like_count || 0) + (m.retweet_count || 0) * 2, user: umap[t.author_id], t };
  });
  scored.sort((a, b) => b.score - a.score);

  const first = tweets.slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))[0];
  const top = scored[0];

  return (
    "🐦 recent posts: " + tweets.length + "\n" +
    "🔥 top: @" + ((top.user && top.user.username) || "?") + " (" + top.score + ")\n" +
    "🥇 earliest in window: @" + ((umap[first.author_id] && umap[first.author_id].username) || "?") + "\n" +
    (officialX ? "Official: " + officialX + "\n" : "") +
    (comm ? "💬 " + comm : "")
  );
}

function lore(pump, ogTag, bundlePct, sniperPct, mc) {
  const desc = String((pump && pump.description) || "").trim();
  let score = 50;
  const notes = [];

  if (ogTag === "OG") {
    score += 12;
    notes.push("OG deploy");
  }
  if (ogTag === "VAMP") {
    score -= 18;
    notes.push("vamp ticker");
  }
  if (ogTag === "SERIAL") {
    score -= 6;
    notes.push("serial dev");
  }
  if (desc.length > 40) {
    score += 8;
    notes.push("has story");
  } else {
    score -= 6;
    notes.push("thin lore");
  }
  if (pump && pump.twitter && pump.telegram) {
    score += 8;
    notes.push("socials linked");
  }
  if (bundlePct >= 20) {
    score -= 15;
    notes.push("fat bundle");
  }
  if (sniperPct >= 20) {
    score -= 8;
    notes.push("snipers");
  }
  if (mc >= 100000) score += 6;

  score = Math.max(0, Math.min(100, score));
  let verdict = "❌ weak";
  if (score >= 70) verdict = "✅ watch";
  else if (score >= 50) verdict = "⚠️ mixed";

  return { score, verdict, notes, desc: desc.slice(0, 200) || "No description." };
}

function ogLine(fam) {
  if (!fam.og) return "OG unknown (no created time)";

  const gap =
    fam.you && fam.you.created && fam.og.created
      ? Math.round((fam.you.created - fam.og.created) / 60000)
      : null;

  const ogName = String(fam.og.name || "").trim();
  const ogSym = String(fam.og.symbol || "").trim();
  const ogLabel =
    ogName || ogSym
      ? (ogName || "Unknown") + (ogSym ? " (" + ogSym + ")" : "")
      : "name unknown";

  if (fam.isOg) {
    return (
      "🟢 THIS CA IS OG CA\n" +
      "🟢 OG CA: " + fam.og.mint + "\n" +
      "🟢 OG: " + ogLabel + "\n" +
      "🕐 OG time: " + utc(fam.og.created)
    );
  }

  return (
    "🟣 THIS CA IS VAMP (not OG)\n" +
    "🟢 OG CA: " + fam.og.mint + "\n" +
    "🟢 OG: " + ogLabel + "\n" +
    "🕐 OG time: " + utc(fam.og.created) + "\n" +
    "🕐 This time: " + utc(fam.you && fam.you.created) +
    (gap && gap > 0 ? "\n⏳ " + gap + " min after OG" : "")
  );
}

function clusterKey(w) {
  let t = Number(w.bundleTime || w.bundle_time || 0);
  if (!Number.isFinite(t) || t <= 0) return "unknown";
  if (t < 1e12) t *= 1000;
  return String(Math.floor(t / 1000));
}

function isMigrated(pump, pair) {
  if (pump && (pump.complete || pump.raydium_pool || pump.pump_swap_pool || pump.market_id)) return true;
  const dex = String((pair && (pair.dexId || pair.dexName)) || "").toLowerCase();
  return /pumpswap|pump-amm|pumpamm|raydium|meteora|orca/.test(dex) && !/pumpfun|pump\.fun|launchpad/.test(dex);
}

function parseBundlers(bundlers, risk) {
  const fromEp = bundlers && typeof bundlers === "object" ? bundlers : {};
  const fromRisk = (risk && risk.bundlers) || {};
  const raw =
    (Array.isArray(fromEp.wallets) && fromEp.wallets) ||
    (Array.isArray(fromRisk.wallets) && fromRisk.wallets) ||
    [];

  const seen = new Map();
  for (const w of raw) {
    if (!w || typeof w !== "object") continue;
    const addr = String(w.wallet || w.address || "").trim();
    if (!addr) continue;
    const prev = seen.get(addr);
    if (!prev || Number(w.percentage || 0) >= Number(prev.percentage || 0)) {
      seen.set(addr, {
        wallet: addr,
        percentage: Number(w.percentage || 0),
        initialPercentage: Number(w.initialPercentage || w.initial_percentage || 0),
        bundleTime: w.bundleTime || w.bundle_time || 0,
      });
    }
  }
  const wallets = [...seen.values()];
  const sumNow = wallets.reduce((s, w) => s + (Number(w.percentage) || 0), 0);
  const sumInit = wallets.reduce((s, w) => s + (Number(w.initialPercentage) || 0), 0);

  const nowPct =
    Number(fromEp.percentage ?? fromRisk.totalPercentage ?? fromRisk.percentage) ||
    (sumNow > 0 ? sumNow : 0);
  const initPct =
    Number(fromEp.initialPercentage ?? fromRisk.totalInitialPercentage ?? fromRisk.initialPercentage) ||
    (sumInit > 0 ? sumInit : 0);
  const totalW =
    num(fromEp.total) ||
    num(fromRisk.count) ||
    num(fromRisk.total) ||
    wallets.length ||
    0;

  return {
    wallets,
    nowPct: Number.isFinite(nowPct) ? nowPct : 0,
    initPct: Number.isFinite(initPct) ? initPct : 0,
    totalW,
  };
}

function parseHolders(holders, tokenInfo) {
  const raw = holders && typeof holders === "object" ? holders : {};
  const acc = raw.accounts || raw.holders || (Array.isArray(holders) ? holders : []);
  const list = Array.isArray(acc) ? acc.filter((h) => h && (h.wallet || h.address)) : [];
  const total =
    num(raw.total) ||
    num(tokenInfo && tokenInfo.holders) ||
    num(tokenInfo && tokenInfo.token && tokenInfo.token.holders) ||
    null;
  return { list, total };
}

/* ───────── Locks: Streamflow / Jupiter / LP (Rugcheck + Solana Tracker) ───────── */

function normalizeLockType(t) {
  const s = String(t || "").toLowerCase().replace(/[_-\s]/g, "");
  if (s.includes("streamflow") || s === "stream") return "streamflow";
  if (s.includes("jupiter")) return "jupiter";
  if (s.includes("bonfida")) return "bonfida";
  if (s.includes("raydium")) return "raydium";
  if (s.includes("meteora")) return "meteora";
  if (s.includes("fluxbeam")) return "fluxbeam";
  if (s.includes("burn")) return "burned";
  return s || "lock";
}

function lockPlatformLabel(type) {
  if (type === "streamflow") return "Streamflow";
  if (type === "jupiter") return "Jupiter";
  if (type === "bonfida") return "Bonfida";
  if (type === "raydium") return "Raydium LP";
  if (type === "meteora") return "Meteora LP";
  if (type === "fluxbeam") return "Fluxbeam LP";
  if (type === "burned") return "Burned LP";
  if (type === "lp") return "LP lock";
  return type || "Lock";
}

function parseStLocks(data) {
  const out = [];
  if (!data) return out;
  const list =
    (Array.isArray(data) && data) ||
    (Array.isArray(data.locks) && data.locks) ||
    (Array.isArray(data.data) && data.data) ||
    (Array.isArray(data.results) && data.results) ||
    (Array.isArray(data.items) && data.items) ||
    [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const type = normalizeLockType(
      row.platform || row.protocol || row.locker || row.type || row.source || row.program
    );
    const usd =
      num(row.locked_usd) ||
      num(row.usdcLocked) ||
      num(row.usdLocked) ||
      num(row.valueUsd) ||
      num(row.value_usd) ||
      num(row.usd) ||
      null;
    const pct =
      num(row.locked_pct) ||
      num(row.lockedPct) ||
      num(row.percentage) ||
      num(row.pct) ||
      null;
    const unlock = toDate(
      row.unlock_at ||
        row.unlockAt ||
        row.unlock_date ||
        row.unlockDate ||
        row.end ||
        row.end_time ||
        row.cliff ||
        row.unlockTimestamp
    );
    const amount =
      num(row.locked_raw) ||
      num(row.locked) ||
      num(row.amount) ||
      num(row.deposited) ||
      null;
    out.push({
      id: String(row.id || row.address || row.pubkey || row.contract || ""),
      type,
      unlock,
      usd,
      pct,
      amount,
      uri: String(row.uri || row.url || row.link || ""),
      status: String(row.status || ""),
    });
  }
  return out;
}

function parseRugcheckLpLocks(data) {
  const out = [];
  const markets = (data && data.markets) || [];
  for (const m of Array.isArray(markets) ? markets : []) {
    if (!m || typeof m !== "object") continue;
    const lp = m.lp && typeof m.lp === "object" ? m.lp : m;
    const lockedPct = num(lp.lpLockedPct) || num(lp.lockedPct) || num(m.lpLockedPct);
    const lockedUsd = num(lp.lpLockedUSD) || num(lp.lpLockedUsd) || num(lp.usdcLocked);
    const lockedAmt = num(lp.lpLocked) || num(lp.locked);
    if (!(lockedPct > 0 || lockedUsd > 0 || lockedAmt > 0)) continue;
    out.push({
      id: String(m.pubkey || m.market || ""),
      type: "lp",
      unlock: null,
      usd: lockedUsd,
      pct: lockedPct,
      amount: lockedAmt,
      uri: "",
      status: lockedPct >= 99.5 ? "fully locked / burned style" : "partial LP lock",
      marketType: String(m.marketType || m.dex || ""),
    });
  }
  return out;
}

function parseRugcheckLockers(data) {
  const out = [];
  const bag = data && data.lockers;
  if (!bag || typeof bag !== "object") return out;
  const entries = Array.isArray(bag) ? bag.map((v, i) => [String(i), v]) : Object.entries(bag);
  for (const [id, v] of entries) {
    if (!v || typeof v !== "object") continue;
    const type = normalizeLockType(v.type || v.programID || v.programId || v.owner);
    out.push({
      id: String(id || v.address || ""),
      type,
      unlock: toDate(v.unlockDate || v.unlock_date || v.unlockAt),
      usd: num(v.usdcLocked) || num(v.usdLocked) || num(v.valueUsd) || null,
      pct: num(v.lockedPct) || num(v.pct) || null,
      amount: num(v.lockedAmount) || num(v.amount) || null,
      uri: String(v.uri || ""),
      status: "",
      wallet: String(v.owner || v.sender || ""),
    });
  }
  return out;
}

function isBurnAddress(addr) {
  const a = String(addr || "").toLowerCase();
  if (!a) return false;
  if (a.includes("dead") || a.includes("burn")) return true;
  if (a.includes("1nc1nerator") || a.includes("incinerator")) return true;
  if (a.startsWith("11111111111111111111111111111111")) return true;
  if (/^1{20,}/.test(a)) return true;
  return false;
}

/** Burned supply sitting in burn / blackhole wallets */
function parseRugcheckBurns(data) {
  const out = [];
  const holders = (data && data.topHolders) || [];
  let burnedPct = 0;
  const wallets = [];
  for (const h of Array.isArray(holders) ? holders : []) {
    const owner = String(h.owner || h.address || h.wallet || "");
    if (!isBurnAddress(owner)) continue;
    const pct = num(h.pct) || num(h.percentage) || null;
    if (pct) burnedPct += pct;
    wallets.push({
      id: owner,
      type: "burned",
      pct,
      usd: null,
      amount: num(h.uiAmount) || num(h.amount) || null,
      wallet: owner,
      status: "burn / blackhole",
      unlock: null,
      uri: "",
    });
  }
  if (wallets.length) {
    out.push({
      id: "burn-total",
      type: "burned",
      pct: burnedPct > 0 ? burnedPct : null,
      usd: null,
      amount: null,
      wallet: wallets[0].wallet,
      status:
        wallets.length +
        " burn wallet(s)" +
        (burnedPct > 0 ? " · " + burnedPct.toFixed(2) + "% supply" : ""),
      unlock: null,
      uri: "",
      details: wallets,
    });
  }
  return out;
}

/** knownAccounts LOCKER / vesting / stream pools */
function parseRugcheckKnownLockers(data) {
  const out = [];
  const ka = data && data.knownAccounts;
  if (!ka || typeof ka !== "object") return out;
  const holders = Array.isArray(data.topHolders) ? data.topHolders : [];
  const holderPct = new Map();
  for (const h of holders) {
    const o = String(h.owner || h.address || "").toLowerCase();
    if (o) holderPct.set(o, num(h.pct) || num(h.percentage) || null);
  }
  for (const [addr, info] of Object.entries(ka)) {
    if (!info || typeof info !== "object") continue;
    const t = String(info.type || "").toUpperCase();
    const name = String(info.name || "");
    const isLock =
      t.includes("LOCK") ||
      t.includes("VEST") ||
      t.includes("STREAM") ||
      /streamflow|jupiter\s*lock|vesting|timelock|stake pool/i.test(name);
    if (!isLock) continue;
    const pct = holderPct.get(String(addr).toLowerCase()) || null;
    let type = "lock";
    if (/streamflow/i.test(name + t)) type = "streamflow";
    else if (/jupiter/i.test(name + t)) type = "jupiter";
    else if (/burn/i.test(name + t)) type = "burned";
    out.push({
      id: String(addr),
      type,
      wallet: String(addr),
      pct,
      usd: null,
      amount: null,
      unlock: null,
      uri: "",
      status: name || t || "locker",
    });
  }
  return out;
}

const SOL_RPCS = [
  "https://api.mainnet-beta.solana.com",
  "https://solana-rpc.publicnode.com",
  "https://rpc.ankr.com/solana",
];

async function solRpc(method, params) {
  for (const url of SOL_RPCS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "VEXLORE-Bot" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(14000),
      });
      const data = await res.json();
      if (data && data.result !== undefined) return data.result;
    } catch (_) {}
  }
  return null;
}

function daysBetween(a, b) {
  if (!a || !b || Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function daysHuman(n) {
  const d = Number(n);
  if (!Number.isFinite(d)) return "n/a";
  const a = Math.abs(d);
  if (a < 1) return d === 0 ? "0d" : "<1d";
  if (a < 30) return Math.round(d) + "d";
  if (a < 365) return (d / 30).toFixed(1) + "mo";
  return (d / 365).toFixed(1) + "y";
}

/** Enrich Streamflow / Jupiter lock with locker wallet + duration via on-chain history */
async function enrichSupplyLock(row) {
  if (!row || !row.id) return row;
  if (row.type !== "streamflow" && row.type !== "jupiter") return row;

  const out = { ...row };
  const now = new Date();

  if (out.unlock && out.unlock.getTime() > 0) {
    out.daysLeft = daysBetween(now, out.unlock);
  }

  try {
    const sigs = await solRpc("getSignaturesForAddress", [row.id, { limit: 1000 }]);
    if (Array.isArray(sigs) && sigs.length) {
      const oldest = sigs[sigs.length - 1];
      const created = toDate(oldest && oldest.blockTime);
      if (created) {
        out.created = created;
        if (out.unlock && out.unlock.getTime() > 0) {
          out.daysTotal = daysBetween(created, out.unlock);
        }
      }
      const createSig = oldest && oldest.signature;
      if (createSig) {
        const tx = await solRpc("getTransaction", [
          createSig,
          { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
        ]);
        const keys =
          (tx &&
            tx.transaction &&
            tx.transaction.message &&
            tx.transaction.message.accountKeys) ||
          [];
        for (const k of keys) {
          const pk = typeof k === "string" ? k : k && k.pubkey;
          const isSigner = typeof k === "object" && k && k.signer;
          if (pk && isSigner && pk !== row.id) {
            out.wallet = String(pk);
            break;
          }
        }
        if (!out.wallet && keys[0]) {
          const k0 = keys[0];
          out.wallet = String(typeof k0 === "string" ? k0 : k0.pubkey || "");
        }
      }
    }
  } catch (_) {}

  if (!out.wallet && row.wallet) out.wallet = row.wallet;
  if (!out.wallet && row.sender) out.wallet = row.sender;
  if (row.daysTotal != null && out.daysTotal == null) out.daysTotal = row.daysTotal;
  if (row.created && !out.created) out.created = toDate(row.created);

  if (!out.uri) {
    if (out.type === "streamflow" && out.id) {
      out.uri = "https://app.streamflow.finance/contract/solana/mainnet/" + out.id;
    } else if (out.type === "jupiter") {
      out.uri = "https://lock.jup.ag/";
    }
  }

  return out;
}

async function fetchTokenLocks(ca) {
  if (!isCa(ca) || isEvmCa(ca)) return null;

  const [rug, stLocks] = await Promise.all([
    soft(jget("https://api.rugcheck.xyz/v1/tokens/" + ca + "/report")),
    ST_KEY ? soft(st("/tokens/" + ca + "/locks")) : Promise.resolve(null),
  ]);

  const rows = [];
  const seen = new Set();
  const push = (row) => {
    if (!row) return;
    const key =
      (row.type || "") +
      "|" +
      (row.id || "") +
      "|" +
      (row.usd || "") +
      "|" +
      (row.pct || "") +
      "|" +
      (row.unlock ? row.unlock.getTime() : "");
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(row);
  };

  if (rug && rug.ok && rug.data) {
    for (const r of parseRugcheckLockers(rug.data)) push(r);
    for (const r of parseRugcheckLpLocks(rug.data)) push(r);
    for (const r of parseRugcheckBurns(rug.data)) push(r);
    for (const r of parseRugcheckKnownLockers(rug.data)) push(r);
  }
  for (const r of parseStLocks(stLocks)) push(r);

  // Enrich top Streamflow + Jupiter locks with wallet + lock duration
  const supplyLocks = rows
    .filter((x) => x.type === "streamflow" || x.type === "jupiter")
    .slice(0, 6);
  const enriched = await Promise.all(supplyLocks.map((r) => soft(enrichSupplyLock(r))));
  for (let i = 0; i < supplyLocks.length; i++) {
    if (enriched[i]) {
      const idx = rows.indexOf(supplyLocks[i]);
      if (idx >= 0) rows[idx] = enriched[i];
    }
  }

  rows.sort((a, b) => {
    const ta = a.type === "streamflow" || a.type === "jupiter" ? 0 : a.type === "lp" ? 1 : 2;
    const tb = b.type === "streamflow" || b.type === "jupiter" ? 0 : b.type === "lp" ? 1 : 2;
    if (ta !== tb) return ta - tb;
    return (Number(b.usd) || Number(b.pct) || 0) - (Number(a.usd) || Number(a.pct) || 0);
  });

  const streamflow = rows.filter((x) => x.type === "streamflow");
  const jupiter = rows.filter((x) => x.type === "jupiter");
  const burned = rows.filter((x) => x.type === "burned");
  const lp = rows.filter(
    (x) =>
      x.type === "lp" ||
      x.type === "raydium" ||
      x.type === "meteora" ||
      x.type === "fluxbeam"
  );
  const other = rows.filter(
    (x) =>
      x.type !== "streamflow" &&
      x.type !== "jupiter" &&
      x.type !== "burned" &&
      x.type !== "lp" &&
      x.type !== "raydium" &&
      x.type !== "meteora" &&
      x.type !== "fluxbeam"
  );
  const totalUsd = rows.reduce((s, x) => s + (Number(x.usd) || 0), 0) || null;
  const maxLpPct = lp.reduce((m, x) => Math.max(m, Number(x.pct) || 0), 0) || null;
  const burnedPct = burned.reduce((m, x) => m + (Number(x.pct) || 0), 0) || null;

  return {
    streamflow,
    jupiter,
    burned,
    lp,
    other,
    rows,
    totalUsd: totalUsd > 0 ? totalUsd : null,
    maxLpPct,
    burnedPct: burnedPct > 0 ? burnedPct : null,
    count: rows.length,
    ok: !!(rug && rug.ok) || !!stLocks,
  };
}

function formatLockRow(row) {
  const platform = lockPlatformLabel(row.type);
  const isSupply = row.type === "streamflow" || row.type === "jupiter";

  if (isSupply) {
    const line1Bits = [];
    if (row.usd != null) line1Bits.push(money(row.usd));
    if (row.pct != null) line1Bits.push(Number(row.pct).toFixed(1) + "% supply");
    if (row.daysTotal != null) line1Bits.push(daysHuman(row.daysTotal) + " lock");
    else if (row.daysLeft != null && row.daysLeft > 0)
      line1Bits.push(daysHuman(row.daysLeft) + " left");
    if (row.status && !row.daysTotal) line1Bits.push(row.status);

    const line2Bits = [];
    if (row.wallet) line2Bits.push("by " + short(row.wallet));
    if (row.daysLeft != null) {
      line2Bits.push(
        row.daysLeft > 0
          ? daysHuman(row.daysLeft) + " left"
          : row.daysLeft === 0
          ? "unlocks today"
          : "unlocked"
      );
    }
    if (row.unlock && row.unlock.getTime() > 0) line2Bits.push("until " + utc(row.unlock));
    if (row.id && row.id !== row.wallet) line2Bits.push(short(row.id));

    let s = "• " + platform + (line1Bits.length ? "  " + line1Bits.join(" · ") : "");
    if (line2Bits.length) s += "\n  " + line2Bits.join(" · ");
    return s;
  }

  if (row.type === "burned") {
    const bits = [];
    if (row.pct != null) bits.push(Number(row.pct).toFixed(2) + "% supply");
    if (row.status) bits.push(row.status);
    if (row.wallet) bits.push(short(row.wallet));
    return "• 🔥 Burned" + (bits.length ? "  " + bits.join(" · ") : "");
  }

  if (row.type === "lock") {
    const bits = [];
    if (row.pct != null) bits.push(Number(row.pct).toFixed(2) + "%");
    if (row.status) bits.push(row.status);
    if (row.wallet) bits.push(short(row.wallet));
    return "• Locker" + (bits.length ? "  " + bits.join(" · ") : "");
  }

  const bits = [];
  if (row.pct != null) bits.push(Number(row.pct).toFixed(1) + "%");
  if (row.usd != null) bits.push(money(row.usd));
  if (row.status) bits.push(row.status);
  else if (row.unlock && row.unlock.getTime() > 0) bits.push("unlock " + utc(row.unlock));
  else if (row.unlock && Number(row.unlock) === 0) bits.push("permanent");
  if (row.marketType) bits.push(String(row.marketType));
  return "• " + platform + (bits.length ? "  " + bits.join(" · ") : "");
}

function buildLocksBlock(locks) {
  if (!locks || (!locks.ok && !locks.count)) {
    return "🔒 <b>Locks</b>\nCould not load lock / burn data\n";
  }
  if (!locks.count) {
    return (
      "🔒 <b>Locks · Streamflow · Jupiter · Burn · LP</b>\n" +
      "No Streamflow, Jupiter, burn, or LP locks found for this mint\n"
    );
  }

  const lines = [];
  for (const row of locks.streamflow.slice(0, 4)) lines.push(formatLockRow(row));
  for (const row of locks.jupiter.slice(0, 3)) lines.push(formatLockRow(row));
  for (const row of (locks.burned || []).slice(0, 2)) lines.push(formatLockRow(row));
  for (const row of locks.lp.slice(0, 2)) lines.push(formatLockRow(row));
  for (const row of locks.other.slice(0, 3)) lines.push(formatLockRow(row));

  const more =
    locks.count > lines.length ? "\n… +" + (locks.count - lines.length) + " more" : "";

  const summaryParts = [];
  if (locks.streamflow.length) summaryParts.push("SF " + locks.streamflow.length);
  if (locks.jupiter.length) summaryParts.push("Jup " + locks.jupiter.length);
  if ((locks.burned || []).length) {
    summaryParts.push(
      "Burn" +
        (locks.burnedPct != null ? " " + Number(locks.burnedPct).toFixed(1) + "%" : "")
    );
  }
  if (locks.lp.length) summaryParts.push("LP " + locks.lp.length);
  if (locks.maxLpPct != null) summaryParts.push("LP locked " + locks.maxLpPct.toFixed(1) + "%");
  if (locks.totalUsd != null) summaryParts.push("~" + money(locks.totalUsd));

  return (
    "🔒 <b>Locks · Streamflow · Jupiter · Burn · LP</b>\n" +
    (summaryParts.length ? summaryParts.join(" · ") + "\n" : "") +
    lines.join("\n") +
    more +
    "\n"
  );
}

function boxSection(title, body) {
  const clean = String(body || "").replace(/\n+$/, "");
  return "┌─ " + title + "\n" + clean + "\n";
}

/* ───────── wallet behaviour analyser (solana only) ───────── */

function asWalletList(data, keys) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  for (const k of keys) {
    if (Array.isArray(data[k])) return data[k];
  }
  return [];
}

function walletUsdSize(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x < 0) return "SHRIMP";
  if (x >= 25000) return "WHALE";
  if (x >= 3000) return "FISH";
  if (x >= 500) return "CRAB";
  return "SHRIMP";
}

function walletSizeIcon(tag) {
  if (tag === "WHALE") return "🐳";
  if (tag === "FISH") return "🐟";
  if (tag === "CRAB") return "🦀";
  if (tag === "BOT") return "🤖";
  return "🦐";
}

function stableSym(s) {
  return /^(sol|wsol|usdc|usdt|usd1|pyusd)$/i.test(String(s || ""));
}

function tradeSide(t) {
  if (!t || typeof t !== "object") return "";
  const typed = String(t.type || t.side || "").toLowerCase();
  if (typed === "buy" || typed === "sell") return typed;
  const fromSym = t.from && t.from.token && t.from.token.symbol;
  const toSym = t.to && t.to.token && t.to.token.symbol;
  if (stableSym(fromSym) && !stableSym(toSym)) return "buy";
  if (!stableSym(fromSym) && stableSym(toSym)) return "sell";
  return typed;
}

function tradeUsd(t) {
  return (
    num(t && t.volume) ||
    num(t && t.volumeUsd) ||
    num(t && t.usd) ||
    num(t && t.from && t.from.amount && t.from.priceUsd && Number(t.from.amount) * Number(t.from.priceUsd)) ||
    num(t && t.to && t.to.amount && t.to.priceUsd && Number(t.to.amount) * Number(t.to.priceUsd)) ||
    null
  );
}

function tradeToken(t) {
  const side = tradeSide(t);
  const fromTok = t && t.from && t.from.token;
  const toTok = t && t.to && t.to.token;
  if (side === "buy") return toTok || fromTok || {};
  if (side === "sell") return fromTok || toTok || {};
  if (toTok && !stableSym(toTok.symbol)) return toTok;
  if (fromTok && !stableSym(fromTok.symbol)) return fromTok;
  return toTok || fromTok || {};
}

function pickPumpName(profile) {
  if (!profile || typeof profile !== "object") return "";
  return String(
    profile.username ||
      profile.name ||
      profile.displayName ||
      profile.display_name ||
      profile.handle ||
      ""
  ).trim();
}

async function fomoHandle(wallet) {
  const r = await jget("https://api.fomotags.xyz/v1/wallet/" + encodeURIComponent(wallet));
  const d = r.data;
  if (!r.ok || !d || typeof d !== "object") return "";
  return String(
    d.handle ||
      d.username ||
      d.name ||
      (d.user && (d.user.handle || d.user.username)) ||
      (d.trader && (d.trader.handle || d.trader.username)) ||
      ""
  ).replace(/^@/, "").trim();
}

function rateWallet({ winRate, pnl, holdSec, sellShare, stillHoldShare, tokens, buys, sells, tags }) {
  const notes = [];
  const tagSet = new Set((tags || []).map((t) => String(t).toLowerCase()));
  if (tagSet.has("bot") || tagSet.has("arbitrage") || tagSet.has("potential_bot")) {
    return {
      label: "🤖 BOT / MEV",
      notes: ["identity tagged bot/arb"].concat(tagSet.has("kol") ? ["also tagged KOL"] : []),
    };
  }

  let jeet = 0;
  let hold = 0;
  let smart = 0;

  if (holdSec != null && holdSec < 90) {
    jeet += 3;
    notes.push("dumps in seconds");
  } else if (holdSec != null && holdSec < 600) {
    jeet += 2;
    notes.push("very short holds");
  } else if (holdSec != null && holdSec >= 3600) {
    hold += 3;
    notes.push("holds for hours+");
  } else if (holdSec != null && holdSec >= 600) {
    hold += 1;
    notes.push("holds minutes+");
  }

  if (sellShare != null && sellShare >= 0.75) {
    jeet += 2;
    notes.push("mostly sells");
  } else if (sellShare != null && sellShare <= 0.35 && buys > 0) {
    hold += 2;
    notes.push("still buying / holding");
  }

  if (stillHoldShare != null && stillHoldShare >= 0.45) {
    hold += 2;
    notes.push("keeps bags");
  } else if (stillHoldShare != null && stillHoldShare <= 0.08 && (tokens || 0) >= 8) {
    jeet += 2;
    notes.push("exits almost everything");
  }

  if (winRate != null && winRate >= 58 && Number(pnl) > 0) {
    smart += 3;
    notes.push("winning book");
  } else if (winRate != null && winRate >= 50 && Number(pnl) > 0) {
    smart += 2;
    notes.push("slightly green");
  } else if (winRate != null && winRate < 35 && (tokens || 0) >= 8) {
    jeet += 1;
    notes.push("low win rate");
  }

  if (Number(pnl) >= 10000 && winRate != null && winRate >= 50) {
    smart += 2;
    notes.push("realised size");
  }

  if (tagSet.has("kol")) {
    smart += 1;
    notes.push("KOL tagged");
  }

  let label = "⚪ MIXED";
  if (smart >= 4 && smart >= jeet && smart >= hold) label = "🧠 SMART TRADER";
  else if (hold >= 4 && hold >= jeet) label = "💎 STRONG HOLDER";
  else if (jeet >= 4) label = "🏃 JEETER";
  else if (smart >= hold && smart >= jeet && smart >= 2) label = "🧠 SMART TRADER";
  else if (hold > jeet && hold >= 2) label = "💎 STRONG HOLDER";
  else if (jeet > hold && jeet >= 2) label = "🏃 JEETER";
  else if (!tokens && !buys && !sells) {
    label = "⚪ THIN HISTORY";
    notes.push("not enough trades indexed");
  }
  return { label, notes };
}

async function isSolTokenMint(ca) {
  const [pump, pair] = await Promise.all([soft(pumpCoin(ca)), soft(dexPair(ca))]);
  if (pump && pump.mint) return true;
  if (pair && (pairHasMarket(pair) || (pair.baseToken && pair.baseToken.address))) return true;
  return false;
}

async function buildWallet(ca, domain) {
  if (isEvmCa(ca)) {
    return "👛 Wallet Behaviour Analyser is Solana only.\n<code>" + esc(ca) + "</code>" + FOOTER;
  }
  if (!isCa(ca)) {
    return "Usage: /wallet SOLANA_WALLET   or   name.sns   or   name.sol" + FOOTER;
  }

  const [profile, follows, fomo, pnl, positions, trades, port] = await Promise.all([
    soft(pumpUserProfile(ca)),
    soft(pumpFollowCounts(ca)),
    soft(fomoHandle(ca)),
    ST_KEY ? soft(st("/v2/pnl/wallets/" + ca)) : Promise.resolve(null),
    ST_KEY ? soft(st("/v2/pnl/wallets/" + ca + "/positions?sort=last_trade&direction=desc&limit=25")) : Promise.resolve(null),
    ST_KEY ? soft(st("/wallet/" + ca + "/trades")) : Promise.resolve(null),
    ST_KEY ? soft(st("/wallet/" + ca)) : Promise.resolve(null),
  ]);

  const pumpName = pickPumpName(profile);
  const followers =
    pickCount(profile && (profile.followers ?? profile.follower_count ?? profile.followersCount)) ??
    (follows && follows.followers);
  const following =
    pickCount(profile && (profile.following ?? profile.following_count ?? profile.followingCount)) ??
    (follows && follows.following);

  const identity = (pnl && pnl.identity) || (port && port.identity) || {};
  const tags = Array.isArray(identity.tags) ? identity.tags : [];
  const idName = String(identity.name || "").trim();
  const idTw = String(identity.twitter || (identity.kol && identity.kol.twitter) || "").trim();
  const sns = identity.sns && identity.sns.domain ? String(identity.sns.domain) : "";

  const summary = (pnl && pnl.summary) || pnl || {};
  const analysis = (pnl && pnl.analysis) || {};
  const pnlObj = summary.pnl || {};
  const counts = summary.counts || {};
  const totalPnl = Number(pnlObj.total);
  const realized = Number(pnlObj.realized);
  const unrealized = Number(pnlObj.unrealized);
  const invested = Number(summary.invested ?? summary.cost ?? counts.invested);
  const winRate = Number(analysis.winRate ?? summary.winRate ?? summary.win_percentage);
  const tokensTraded = Number(counts.tokensTraded ?? analysis.tokens ?? summary.tokens);
  const profitable = Number(analysis.tokens && analysis.tokens.profitable);
  const losing = Number(analysis.tokens && analysis.tokens.losing);

  const posRows = asWalletList(positions, ["data", "positions", "tokens"]);
  const holdSecs = [];
  let openN = 0;
  for (const p of posRows) {
    if (!p || typeof p !== "object") continue;
    const hold =
      Number(
        (p.timing && (p.timing.holdTimeSecs ?? p.timing.avgHoldTimeSecs)) ??
          p.holdTimeSecs ??
          (p.pnl && p.pnl.holdTimeSecs)
      ) || NaN;
    if (Number.isFinite(hold) && hold >= 0) holdSecs.push(hold);
    const bal = Number(
      (p.position && (p.position.balance ?? p.position.holding)) ??
        p.holding ??
        p.balance
    );
    if (Number.isFinite(bal) && bal > 0) openN += 1;
  }
  const avgHold = holdSecs.length ? holdSecs.reduce((a, b) => a + b, 0) / holdSecs.length : null;
  const stillHoldShare = posRows.length ? openN / posRows.length : null;

  const tradeRows = asWalletList(trades, ["trades", "data", "items"]);
  let buys = 0;
  let sells = 0;
  for (const t of tradeRows) {
    const side = tradeSide(t);
    if (side === "buy") buys += 1;
    else if (side === "sell") sells += 1;
  }
  const sellShare = buys + sells ? sells / (buys + sells) : null;

  const portTokens = asWalletList(port, ["tokens", "data"]);
  const portTotal =
    num(port && (port.total ?? port.totalUsd ?? port.value ?? (port.summary && port.summary.total))) ||
    portTokens.reduce((s, row) => s + (Number(row && (row.value ?? row.valueUsd ?? (row.value && row.value.usd))) || 0), 0);

  const sizeTagName = tags.includes("bot") || tags.includes("arbitrage") ? "BOT" : walletUsdSize(portTotal);
  const rated = rateWallet({
    winRate: Number.isFinite(winRate) ? winRate : null,
    pnl: Number.isFinite(totalPnl) ? totalPnl : Number.isFinite(realized) ? realized : null,
    holdSec: avgHold,
    sellShare,
    stillHoldShare,
    tokens: Number.isFinite(tokensTraded) ? tokensTraded : posRows.length,
    buys,
    sells,
    tags,
  });

  const topHold = portTokens
    .slice()
    .sort((a, b) => {
      const va = Number(a && (a.value ?? a.valueUsd ?? (a.value && a.value.usd))) || 0;
      const vb = Number(b && (b.value ?? b.valueUsd ?? (b.value && b.value.usd))) || 0;
      return vb - va;
    })
    .filter((row) => {
      const tok = (row && (row.token || row)) || {};
      return !stableSym(tok.symbol);
    })
    .slice(0, 8)
    .map((row, i) => {
      const tok = row.token || row;
      const val = Number(row.value ?? row.valueUsd ?? (row.value && row.value.usd));
      return (
        i + 1 + ". <b>" + esc(tok.name || "") + " (" + esc(tok.symbol || "") + ")</b> · " +
        (Number.isFinite(val) ? money(val) : "n/a")
      );
    });

  const recentLines = tradeRows.slice(0, 8).map((t) => {
    const side = tradeSide(t) || "?";
    const tok = tradeToken(t);
    const when = toDate(t.time || t.timestamp || t.createdAt);
    const usd = tradeUsd(t);
    const icon = side === "buy" ? "🟢" : side === "sell" ? "🔴" : "⚪";
    return (
      icon + " " + side.toUpperCase() + " " +
      esc(tok.symbol || tok.name || "token") +
      " · " + (usd != null ? money(usd) : "n/a") +
      " · " + utc(when) +
      (t.program ? " · " + esc(t.program) : "")
    );
  });

  const domainLine = domain
    ? "🌐 SNS " + esc(domain) + " → <code>" + esc(ca) + "</code>\n"
    : "";

  if (!ST_KEY) {
    return (
      "👛 <b>Wallet Behaviour Analyser</b>\n" +
      domainLine +
      "<code>" + esc(ca) + "</code>\n\n" +
      (pumpName ? "🎃 Pump.fun @" + esc(pumpName) + "\n" : "🎃 Pump.fun username: n/a\n") +
      (fomo ? "📣 FOMO @" + esc(fomo) + "\n" : "📣 FOMO username: n/a\n") +
      "add SOLANA_TRACKER_KEY for trades / jeet-holder-smart rating" +
      FOOTER
    );
  }

  return (
    "👛 <b>Wallet Behaviour Analyser</b>\n" +
    walletSizeIcon(sizeTagName) + " " + sizeTagName + " · " + rated.label + "\n" +
    domainLine +
    "<code>" + esc(ca) + "</code>\n\n" +
    "🎃 Pump.fun: " + (pumpName ? "@" + esc(pumpName) : "n/a") +
    (followers != null || following != null
      ? " · fol " + (followers == null ? "n/a" : String(followers)) +
        " / fing " + (following == null ? "n/a" : String(following))
      : "") +
    "\n📣 FOMO: " + (fomo ? "@" + esc(fomo) : "n/a") +
    (idName ? "\n🏷 " + esc(idName) + (idTw ? " · " + esc(idTw) : "") : "") +
    (sns ? "\n🌐 " + esc(sns) : "") +
    (tags.length ? "\nTags: " + esc(tags.join(", ")) : "") +
    "\n\n💰 <b>Book</b>\n" +
    "Portfolio " + (portTotal ? money(portTotal) : "n/a") +
    " · Invested " + (Number.isFinite(invested) ? money(invested) : "n/a") + "\n" +
    "PnL " + (Number.isFinite(totalPnl) ? money(totalPnl) : "n/a") +
    " · real " + (Number.isFinite(realized) ? money(realized) : "n/a") +
    " · u/r " + (Number.isFinite(unrealized) ? money(unrealized) : "n/a") + "\n" +
    "Win rate " + (Number.isFinite(winRate) ? pct(winRate) : "n/a") +
    (Number.isFinite(profitable) || Number.isFinite(losing)
      ? " · W/L " + (Number.isFinite(profitable) ? profitable : "?") + "/" + (Number.isFinite(losing) ? losing : "?")
      : "") + "\n" +
    "Tokens traded " + (Number.isFinite(tokensTraded) ? String(tokensTraded) : String(posRows.length || "n/a")) +
    " · recent " + buys + " buys / " + sells + " sells\n" +
    "⏱ avg hold " + (avgHold == null ? "n/a" : holdHuman(avgHold)) +
    (stillHoldShare != null ? " · still holding " + pct(stillHoldShare * 100) : "") +
    "\n\n🧠 <b>Read</b>\n" +
    rated.label + "\n" +
    esc(rated.notes.join(" · ") || "thin sample") +
    "\n\n📦 <b>Top holdings (bags)</b>\n" +
    (topHold.join("\n") || "none indexed") +
    "\n\n📜 <b>Recent trades</b>\n" +
    (recentLines.join("\n") || "none indexed") +
    FOOTER
  ).slice(0, 4000);
}

/* ───────── calls / leaderboard / pnl (solana only) — ENHANCED TO MATCH YOUR PICS ───────── */

const PERIODS = {
  "12h": { label: "12H", ms: 12 * 60 * 60 * 1000 },
  "1d":  { label: "1D",  ms: 24 * 60 * 60 * 1000 },
  "1w":  { label: "1W",  ms: 7 * 24 * 60 * 60 * 1000 },
  "2w":  { label: "2W",  ms: 14 * 24 * 60 * 60 * 1000 },
  "1m":  { label: "1M",  ms: 30 * 24 * 60 * 60 * 1000 },
  "2m":  { label: "2M",  ms: 60 * 24 * 60 * 60 * 1000 },
  "3m":  { label: "3M",  ms: 90 * 24 * 60 * 60 * 1000 },
  "6m":  { label: "6M",  ms: 180 * 24 * 60 * 60 * 1000 },
};

function callMult(c) {
  const peakMc = num(c.peakMc);
  const mc = num(c.mc);
  if (peakMc && mc) return peakMc / mc;
  const peakPx = num(c.peakPrice);
  const px = num(c.price);
  if (peakPx && px) return peakPx / px;
  return null;
}

function enrichCall(c) {
  const mult = callMult(c) || 1;
  return { ...c, mult, gain: (mult - 1) * 100 };
}

function groupCalls(chatId, periodKey) {
  const p = PERIODS[periodKey] || PERIODS["1w"];
  const since = Date.now() - p.ms;
  return store.calls
    .filter((c) => String(c.chatId) === String(chatId) && Number(c.calledAt) >= since)
    .map(enrichCall)
    .sort((a, b) => b.mult - a.mult);
}

async function recordCall(ctx, ca) {
  const chat = ctx.chat;
  const user = ctx.from;
  if (!isGroupChat(chat) || !user || user.is_bot || !isCa(ca) || isEvmCa(ca)) return;

  touchGroup(chat);

  // First scan by ANY member in the group counts for the board.
  // Subsequent scans by same user within dedupe window are ignored.
  const recent = store.calls.find(
    (c) =>
      String(c.chatId) === String(chat.id) &&
      c.ca === ca &&
      String(c.userId) === String(user.id) &&
      Date.now() - Number(c.calledAt) < CALL_DEDUPE_MS
  );
  if (recent) return;

  const [pump, pair] = await Promise.all([pumpCoin(ca), dexPair(ca)]);
  const meta = quoteMeta(pump, pair);
  const now = Date.now();

  store.calls.push({
    id: chat.id + ":" + user.id + ":" + ca + ":" + now,
    chatId: chat.id,
    userId: user.id,
    username: user.username || "",
    name: [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || "member",
    ca,
    nameToken: meta.name,
    symbol: meta.symbol,
    calledAt: now,
    price: meta.price,
    mc: meta.mc,
    peakPrice: meta.price,
    peakMc: meta.mc,
    peakAt: now,
    url: meta.url,
  });

  const cutoff = Date.now() - PEAK_MAX_AGE_MS;
  if (store.calls.length > 8000) {
    store.calls = store.calls.filter((c) => Number(c.calledAt) >= cutoff);
  }
  saveStore(true);
}

async function updateCallPeaks() {
  const cutoff = Date.now() - PEAK_MAX_AGE_MS;
  const live = store.calls.filter((c) => Number(c.calledAt) >= cutoff && isCa(c.ca));
  const cas = [...new Set(live.map((c) => c.ca))];
  let changed = false;

  for (const ca of cas) {
    try {
      const pair = await dexPair(ca);
      if (!pair) continue;
      const price = num(pair.priceUsd);
      const mc = pairMc(pair);
      const url = pair.url || "";
      const name = (pair.baseToken && pair.baseToken.name) || "";
      const symbol = (pair.baseToken && pair.baseToken.symbol) || "";

      for (const c of live) {
        if (c.ca !== ca) continue;
        if (!c.price && price) c.price = price;
        if (!c.mc && mc) c.mc = mc;
        if (!c.peakPrice && c.price) c.peakPrice = c.price;
        if (!c.peakMc && c.mc) c.peakMc = c.mc;
        if (name && (!c.nameToken || c.nameToken === "Unknown")) c.nameToken = name;
        if (symbol && (!c.symbol || c.symbol === "?")) c.symbol = symbol;
        if (url) c.url = url;

        if (price && (!num(c.peakPrice) || price > Number(c.peakPrice))) {
          c.peakPrice = price;
          c.peakAt = Date.now();
          changed = true;
        }
        if (mc && (!num(c.peakMc) || mc > Number(c.peakMc))) {
          c.peakMc = mc;
          c.peakAt = Date.now();
          changed = true;
        }
      }
    } catch (_) {}
  }

  if (changed) saveStore();
}

function lbKeyboard(period) {
  const mark = (k) => (k === period ? "✅ " : "");
  return new InlineKeyboard()
    .text(mark("12h") + "12H", "lb:12h")
    .text(mark("1d") + "1D", "lb:1d")
    .text(mark("1w") + "1W", "lb:1w")
    .text(mark("2w") + "2W", "lb:2w")
    .row()
    .text(mark("1m") + "1M", "lb:1m")
    .text(mark("2m") + "2M", "lb:2m")
    .text(mark("3m") + "3M", "lb:3m")
    .text(mark("6m") + "6M", "lb:6m");
}

function buildLeaderboard(chat, periodKey) {
  const key = PERIODS[periodKey] ? periodKey : "1w";
  const period = PERIODS[key];
  const title = (chat && chat.title) || (store.groups[String(chat.id)] && store.groups[String(chat.id)].title) || "this group";
  const allInPeriod = groupCalls(chat.id, key);
  const rows = allInPeriod.slice(0, 10);

  if (!rows.length) {
    return (
      "🏆 <b>TokenScan</b>\n" +
      "<b>" + esc(title) + "</b>\n" +
      "Vexlore winner board · " + period.label + "\n\n" +
      "No calls recorded in this window yet.\n" +
      "Share a CA in the group to start the board." +
      FOOTER
    );
  }

  // Top Callers (points = sum of mults, simple clean scoring)
  const callers = new Map();
  for (const c of allInPeriod) {
    const id = String(c.userId);
    const cur = callers.get(id) || {
      userId: c.userId,
      username: c.username,
      name: c.name,
      pts: 0,
      best: c,
      calls: 0,
    };
    cur.calls += 1;
    cur.pts += Number(c.mult) || 1;
    if (c.mult > cur.best.mult) cur.best = c;
    callers.set(id, cur);
  }
  const topCallers = [...callers.values()].sort((a, b) => b.pts - a.pts).slice(0, 3);

  // Statistics
  const hitRate = allInPeriod.filter((c) => c.mult >= 2).length / allInPeriod.length;
  const mults = allInPeriod.map((c) => c.mult).filter((m) => Number.isFinite(m));
  const median = mults.length
    ? mults.sort((a, b) => a - b)[Math.floor(mults.length / 2)]
    : 1;
  const totalReturn = mults.reduce((s, m) => s + m, 0);
  const avgReturn = mults.length ? totalReturn / mults.length : 1;

  const medals = ["🥇", "🥈", "🥉"];
  const callerLines = topCallers.map((u, i) => {
    return (
      (i === 0 ? "👑 " : "") +
      esc(displayUser(u)) + " - " + u.pts.toFixed(2) + " pts"
    );
  });

  const callLines = rows.map((c, i) => {
    const rank = i + 1;
    const multStr = c.mult >= 2 ? xs(c.mult) : gainPct(c.mult);
    return (
      rank + "  <b>$" + esc(c.symbol || "?") + "</b> - " + esc(displayUser(c)) +
      " [" + multStr + "]"
    );
  });

  return (
    "🏆 <b>TokenScan</b>\n" +
    "<b>" + esc(title) + "</b>\n" +
    "Vexlore winner board · " + period.label + "\n\n" +
    "👑 <b>Top Callers</b>\n" +
    callerLines.join("\n") +
    "\n\n" +
    callLines.join("\n") +
    "\n\n📊 <b>Statistics</b>\n" +
    "Calls: " + allInPeriod.length + "\n" +
    "Hit Rate: " + Math.round(hitRate * 100) + "%\n" +
    "Median: " + xs(median) + "\n" +
    "Return: " + xs(totalReturn) + " (Avg: " + xs(avgReturn) + ")" +
    FOOTER
  ).slice(0, 4000);
}

/* ───────── /pnl card (image card, VEXLORE style) ───────── */

function timeAgo(ms) {
  const sec = Math.floor((Date.now() - ms) / 1000);
  if (sec < 60) return sec + "s ago";
  if (sec < 3600) return Math.floor(sec / 60) + "m ago";
  if (sec < 86400) return Math.floor(sec / 3600) + "h ago";
  const d = Math.floor(sec / 86400);
  const rem = sec % 86400;
  const h = Math.floor(rem / 3600);
  const m = Math.floor((rem % 3600) / 60);
  if (h > 0) return d + "d " + h + "h ago";
  return d + "d " + m + "m ago";
}

function pnlCallerName(c) {
  if (c && c.username) return "@" + String(c.username);
  if (c && c.name) return String(c.name);
  if (c && c.userId) return "id" + c.userId;
  return "unknown";
}

function pnlMultLabel(mult) {
  const x = Number(mult);
  if (!Number.isFinite(x) || x <= 0) return "n/a";
  if (x >= 100) return x.toFixed(0) + "x";
  if (x >= 10) return x.toFixed(1) + "x";
  return x.toFixed(2) + "x";
}

const PNL_FONT_FILE = path.join(__dirname, "vexlore-pnl-font.ttf");
let pnlFontName = "";

async function downloadPnlFont() {
  if (fs.existsSync(PNL_FONT_FILE) && fs.statSync(PNL_FONT_FILE).size > 20000) {
    return true;
  }
  const urls = [
    "https://cdn.jsdelivr.net/fontsource/fonts/inter@5.2.5/latin-700-normal.ttf",
    "https://cdn.jsdelivr.net/fontsource/fonts/inter@5.0.16/latin-700-normal.ttf",
    "https://github.com/googlefonts/roboto/raw/main/src/hinted/Roboto-Bold.ttf",
  ];
  for (const u of urls) {
    try {
      const res = await fetch(u, {
        headers: { "User-Agent": "VEXLORE-Bot" },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 20000) continue;
      fs.writeFileSync(PNL_FONT_FILE, buf);
      return true;
    } catch (_) {}
  }
  return false;
}

async function registerPnlFonts() {
  if (pnlFontName) return pnlFontName;
  try {
    const { GlobalFonts } = require("@napi-rs/canvas");
    await downloadPnlFont();
    const candidates = [
      PNL_FONT_FILE,
      "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
      "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
      "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
      "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf",
      "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
      "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
      "C:\\Windows\\Fonts\\arialbd.ttf",
      "C:\\Windows\\Fonts\\arial.ttf",
      "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
      "/Library/Fonts/Arial Bold.ttf",
    ];
    for (const file of candidates) {
      if (file && fs.existsSync(file)) {
        GlobalFonts.registerFromPath(file, "VexPnl");
        pnlFontName = "VexPnl";
        return pnlFontName;
      }
    }
  } catch (_) {}
  pnlFontName = "sans-serif";
  return pnlFontName;
}

function roundRectPath(g, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

function drawHexGrid(g, w, h) {
  g.save();
  g.strokeStyle = "rgba(80, 110, 130, 0.14)";
  g.lineWidth = 1;
  const size = 28;
  const hexH = size * Math.sqrt(3);
  for (let row = -1; row * hexH < h + hexH; row++) {
    for (let col = -1; col * size * 1.5 < w + size; col++) {
      const x = col * size * 1.5 + ((row % 2) * size * 0.75);
      const y = row * hexH * 0.5 + 8;
      g.beginPath();
      for (let a = 0; a < 6; a++) {
        const ang = (Math.PI / 180) * (60 * a);
        const px = x + size * Math.cos(ang);
        const py = y + size * Math.sin(ang);
        if (a === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
      g.stroke();
    }
  }
  g.restore();
}

function drawVexLogo(g, x, y, s) {
  g.save();
  g.translate(x, y);
  g.fillStyle = "#ff1a1a";
  g.shadowColor = "rgba(255, 20, 20, 0.75)";
  g.shadowBlur = 18;
  g.beginPath();
  g.moveTo(s * 0.50, 0);
  g.lineTo(s * 0.92, s * 0.28);
  g.lineTo(s * 0.78, s * 0.38);
  g.lineTo(s * 0.50, s * 0.20);
  g.lineTo(s * 0.22, s * 0.38);
  g.lineTo(s * 0.08, s * 0.28);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(s * 0.18, s * 0.42);
  g.lineTo(s * 0.50, s * 0.98);
  g.lineTo(s * 0.40, s * 0.48);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(s * 0.82, s * 0.42);
  g.lineTo(s * 0.50, s * 0.98);
  g.lineTo(s * 0.60, s * 0.48);
  g.closePath();
  g.fill();
  g.restore();
}

async function loadDexTokenImage(ca) {
  const { loadImage } = require("@napi-rs/canvas");
  const urls = [
    "https://dd.dexscreener.com/ds-data/tokens/solana/" + ca + ".png",
    "https://dd.dexscreener.com/ds-data/tokens/solana/" + ca + "/header.png",
  ];
  for (const u of urls) {
    try {
      const res = await fetch(u, {
        headers: { "User-Agent": "VEXLORE-Bot", Accept: "image/*" },
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 200) continue;
      const img = await loadImage(buf);
      if (img) return img;
    } catch (_) {}
  }
  return null;
}

function drawRoundImage(g, img, x, y, size, ring) {
  g.save();
  g.beginPath();
  g.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  g.closePath();
  g.clip();
  g.drawImage(img, x, y, size, size);
  g.restore();
  g.strokeStyle = ring;
  g.lineWidth = 6;
  g.beginPath();
  g.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  g.stroke();
}

function fitText(g, text, maxW) {
  let s = String(text || "");
  if (g.measureText(s).width <= maxW) return s;
  while (s.length > 1 && g.measureText(s + "…").width > maxW) s = s.slice(0, -1);
  return s + "…";
}

async function renderPnlCardImage({
  name,
  symbol,
  mult,
  calledAt,
  liveAt,
  gain,
  ago,
  caller,
  tokenImg,
}) {
  const { createCanvas } = require("@napi-rs/canvas");
  const font = await registerPnlFonts();
  const W = 1280;
  const H = 768;
  const canvas = createCanvas(W, H);
  const g = canvas.getContext("2d");

  const win = Number(mult) >= 1;
  const green = "#22ff66";
  const red = "#ff3b3b";
  const accent = win ? green : red;
  const tick = "$" + String(symbol || "?").replace(/^\$/, "");
  const tokenName = String(name || "").trim();

  g.fillStyle = "#07080c";
  g.fillRect(0, 0, W, H);
  drawHexGrid(g, W, H);

  const fade = g.createLinearGradient(0, 0, W, 0);
  fade.addColorStop(0, "rgba(0,0,0,0.20)");
  fade.addColorStop(0.58, "rgba(0,0,0,0.08)");
  fade.addColorStop(1, win ? "rgba(20,180,70,0.16)" : "rgba(180,20,20,0.18)");
  g.fillStyle = fade;
  g.fillRect(0, 0, W, H);

  drawVexLogo(g, 48, 28, 78);
  g.font = "bold 54px " + font;
  g.fillStyle = "#ffffff";
  g.fillText("VE", 140, 84);
  const veW = g.measureText("VE").width;
  g.fillStyle = "#ff2a2a";
  g.fillText("X", 140 + veW, 84);
  const xW = g.measureText("X").width;
  g.fillStyle = "#ffffff";
  g.fillText("LORE", 140 + veW + xW, 84);

  g.font = "bold 22px " + font;
  g.fillStyle = "#8b95a2";
  g.fillText("CALL PnL CARD", 140, 118);

  g.font = "bold 40px " + font;
  g.fillStyle = accent;
  g.shadowColor = win ? "rgba(34,255,102,0.35)" : "rgba(255,50,50,0.35)";
  g.shadowBlur = 12;
  g.fillText(fitText(g, tick, 760), 56, 176);
  g.shadowBlur = 0;

  if (tokenName) {
    g.font = "bold 26px " + font;
    g.fillStyle = "#d7dde6";
    g.fillText(fitText(g, tokenName, 760), 56, 214);
  }

  g.font = "bold 150px " + font;
  g.fillStyle = "#ffffff";
  g.shadowColor = win ? "rgba(34,255,102,0.18)" : "rgba(255,50,50,0.18)";
  g.shadowBlur = 16;
  g.fillText(pnlMultLabel(mult), 52, 360);
  g.shadowBlur = 0;

  g.font = "bold 30px " + font;
  g.fillStyle = accent;
  g.fillText((win ? "PROFIT  " : "LOSS  ") + String(gain || "n/a"), 56, 412);

  g.font = "bold 26px " + font;
  g.fillStyle = "#9aa3ad";
  g.fillText("Called at", 56, 468);
  g.fillText("Now", 56, 512);
  g.fillStyle = "#ffffff";
  g.fillText(String(calledAt || "n/a"), 230, 468);
  g.fillText(String(liveAt || "n/a"), 230, 512);

  g.font = "bold 22px " + font;
  g.fillStyle = accent;
  g.fillText(String(ago || ""), 56, 552);

  g.fillStyle = "#2a2f36";
  g.beginPath();
  g.arc(86, 616, 28, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "#6a7380";
  g.lineWidth = 3;
  g.stroke();
  g.fillStyle = "#cfd3d8";
  g.font = "bold 20px " + font;
  g.fillText("TG", 72, 624);

  const callerName = String(caller || "unknown");
  g.font = "bold 26px " + font;
  const nameW = Math.max(220, Math.min(620, g.measureText(callerName).width + 40));
  roundRectPath(g, 128, 590, nameW, 52, 12);
  g.fillStyle = win ? "#07140c" : "#140707";
  g.fill();
  g.strokeStyle = accent;
  g.lineWidth = 3;
  g.stroke();
  g.fillStyle = accent;
  g.fillText(fitText(g, callerName, nameW - 36), 146, 626);

  if (tokenImg) {
    drawRoundImage(g, tokenImg, 880, 170, 300, accent);
  } else {
    g.fillStyle = "#11161c";
    g.beginPath();
    g.arc(1030, 320, 150, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = accent;
    g.lineWidth = 6;
    g.stroke();
    g.fillStyle = accent;
    g.font = "bold 42px " + font;
    const tw = g.measureText(tick).width;
    g.fillText(tick, 1030 - tw / 2, 332);
  }

  g.fillStyle = "rgba(255,255,255,0.06)";
  roundRectPath(g, 40, 688, 1200, 52, 16);
  g.fill();
  g.fillStyle = "#c5ccd4";
  g.font = "bold 22px " + font;
  g.fillText("X: @Vexlorebot     TG: t.me/VexloreBOT     Web: vexlore.xyz", 64, 722);

  return canvas.toBuffer("image/png");
}

async function buildPnlCard(chatId, ca, userId) {
  if (!isCa(ca) || isEvmCa(ca)) {
    return { error: "Usage: /pnl CA   (Solana only)" + FOOTER };
  }

  const calls = store.calls
    .filter((c) => String(c.chatId) === String(chatId) && c.ca === ca)
    .sort((a, b) => Number(a.calledAt) - Number(b.calledAt));

  let call = calls[0];
  if (userId) {
    const mine = calls.find((c) => String(c.userId) === String(userId));
    if (mine) call = mine;
  }

  if (!call) {
    return {
      error:
        "❌ No call recorded for this CA in the group yet.\n" +
        "Scan the CA once and it will be counted." +
        FOOTER,
    };
  }

  const pair = await soft(dexPair(ca));
  const liveMc = pairMc(pair);
  const livePx = num(pair && pair.priceUsd);
  const entryMc = num(call.mc);
  const entryPx = num(call.price);

  let mult = 1;
  if (liveMc && entryMc) mult = liveMc / entryMc;
  else if (livePx && entryPx) mult = livePx / entryPx;

  const tokenImg = await loadDexTokenImage(ca);

  const buffer = await renderPnlCardImage({
    name: call.nameToken || (pair && pair.baseToken && pair.baseToken.name) || "",
    symbol: call.symbol || (pair && pair.baseToken && pair.baseToken.symbol) || "?",
    mult,
    calledAt: moneyMkt(entryMc || entryPx),
    liveAt: moneyMkt(liveMc || livePx),
    gain: gainPct(mult),
    ago: timeAgo(Number(call.calledAt)),
    caller: pnlCallerName(call),
    tokenImg,
  });

  return { buffer, ca };
}

function pnlKeyboard(ca) {
  return new InlineKeyboard()
    .text("🔄 Refresh", "pnlref:" + ca)
    .text("🗑 Delete", "del");
}

/* ───────── watch / notify (solana only) — WATCH DISABLED ───────── */

const watches = new Map();
const snaps = new Map();
const msgOwners = new Map();

function ownerKey(chatId, messageId) {
  return String(chatId) + ":" + String(messageId);
}

function rememberOwner(chatId, messageId, userId) {
  if (!chatId || !messageId || !userId) return;
  msgOwners.set(ownerKey(chatId, messageId), String(userId));
}

function watchCa(chatId, ca) {
  return;
}

function unwatchCa(chatId, ca) {
  const map = watches.get(chatId);
  if (!map) return;
  map.delete(ca);
  if (!map.size) watches.delete(chatId);
}

async function snapshotEvents(ca) {
  if (isEvmCa(ca)) return null;
  const [pump, pair, paid] = await Promise.all([
    pumpCoin(ca),
    dexPair(ca),
    dexPaid(ca),
  ]);
  const q = marketQuote(pump, pair, null);

  return {
    name: q.name,
    symbol: q.symbol,
    profilePaid: !!(paid && paid.profilePaid),
    adPaid: !!(paid && paid.adPaid),
    firstPay: paid && paid.firstPay,
    migrated: isMigrated(pump, pair),
    complete: !!(pump && pump.complete),
    mc: q.mc,
    url: q.url,
  };
}

async function pingChat(chatId, text, ca) {
  try {
    await bot.api.sendMessage(chatId, text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: kb(ca),
    });
  } catch (e) {
    console.error("notify fail", e.message || e);
  }
}

let pollBusy = false;
let peakBusy = false;
let peakTick = 0;

async function pollNotifs() {
  if (pollBusy) return;
  pollBusy = true;
  peakTick += 1;

  try {
    watches.clear();
    snaps.clear();

    if (!peakBusy && peakTick % 3 === 0) {
      peakBusy = true;
      updateCallPeaks()
        .catch((e) => console.error("peak fail", e.message || e))
        .finally(() => {
          peakBusy = false;
        });
    }

    await maybeSendGm();
  } finally {
    pollBusy = false;
  }
}

setInterval(pollNotifs, 20000);

/* ───────── GM 13:30 UTC ───────── */

const GM_QUOTES = [
  "Quiet work compounds. Make today count.",
  "Discipline beats hype. Stay sharp, stay patient.",
  "Clarity first. Size second. Ego never.",
  "One clean decision is worth more than ten rushed ones.",
  "Protect the bag. Protect the mind. Then hunt.",
  "The edge is patience dressed as action.",
  "Move with intention. Leave noise where it belongs.",
  "Strong days are built before the candle prints.",
  "Stay humble in wins. Stay calm in red.",
  "Build the habit. The result follows.",
];

async function maybeSendGm() {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const inWindow = now.getUTCHours() === 13 && now.getUTCMinutes() === 30;
  if (!inWindow || store.lastGmDay === day) return;

  store.lastGmDay = day;
  saveStore(true);

  const quote = GM_QUOTES[now.getUTCDate() % GM_QUOTES.length];
  const groups = Object.values(store.groups).filter((g) => g.active !== false);

  for (const g of groups) {
    const title = g.title || "this group";
    const text =
      "☀️ <b>GM " + esc(title) + "</b>\n\n" +
      esc(quote) + "\n\n" +
      "Scan clean. Call clean. Stay sharp." +
      FOOTER;
    try {
      await bot.api.sendMessage(g.id, text, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });
    } catch (e) {
      console.error("gm fail", g.id, e.message || e);
    }
  }
}

/* ───────── cards / reports ───────── */

function capOrNever(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return "never moved";
  return money(x);
}

function pickCount(data) {
  if (data == null) return null;
  if (typeof data === "number" && Number.isFinite(data)) return data >= 0 ? data : null;
  if (typeof data !== "object") return null;
  const n =
    data.count ??
    data.total ??
    data.followers ??
    data.following ??
    data.followerCount ??
    data.followingCount ??
    data.followers_count ??
    data.following_count ??
    data.followersCount ??
    data.followingCount ??
    (data.data && (data.data.count ?? data.data.total));
  const x = Number(n);
  return Number.isFinite(x) && x >= 0 ? x : null;
}

function asCoinList(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const list = data.coins || data.data || data.tokens || data.items;
  return Array.isArray(list) ? list : [];
}

function creatorFromSources(pump, tokenInfo) {
  return (
    (pump && pump.creator) ||
    (tokenInfo && tokenInfo.token && tokenInfo.token.creation && tokenInfo.token.creation.creator) ||
    (tokenInfo && tokenInfo.token && tokenInfo.token.creator) ||
    (tokenInfo &&
      tokenInfo.pools &&
      tokenInfo.pools[0] &&
      tokenInfo.pools[0].deployer) ||
    ""
  );
}

function isDevTokenMigrated(row) {
  if (!row) return false;
  if (row.complete === true || row.complete === "true" || row.complete === 1) return true;
  if (row.raydium_pool || row.pump_swap_pool || row.market_id) return true;
  const status = String(row.status || "").toLowerCase();
  if (status === "graduated" || status === "migrated" || status === "complete") return true;
  const market = String(row.market || row.dex || "").toLowerCase();
  if (/pumpswap|pump-amm|pumpamm|pumpfun-amm|raydium|meteora|orca/.test(market) && !/pumpfun$|pump\.fun|launchpad/.test(market)) {
    return true;
  }
  return false;
}

function athFromPayload(data) {
  if (!data || typeof data !== "object") return null;
  return (
    num(data.highest_market_cap) ||
    num(data.highestMarketCap) ||
    num(data.ath_market_cap) ||
    num(data.athMarketCap) ||
    num(data.athMarketCapUsd) ||
    num(data.market_cap_ath) ||
    num(data.usd_ath_market_cap) ||
    num(data.ath && (data.ath.market_cap || data.ath.usd || data.ath.marketCap)) ||
    null
  );
}

async function pumpUserProfile(creator) {
  const urls = [
    "https://frontend-api-v3.pump.fun/users/" + creator,
    "https://frontend-api-v3.pump.fun/profile/" + creator,
    "https://profile-api.pump.fun/profile/" + creator,
  ];
  for (const u of urls) {
    const r = await jget(u);
    if (r.ok && r.data && typeof r.data === "object") return r.data;
  }
  return null;
}

async function pumpFollowCounts(creator) {
  const [fol, fing] = await Promise.all([
    jget("https://frontend-api-v3.pump.fun/v3/followers/count/" + creator),
    jget("https://frontend-api-v3.pump.fun/following/v3/following/count/" + creator),
  ]);
  let followers = pickCount(fol.data);
  let following = pickCount(fing.data);
  if (followers == null) {
    const r = await jget("https://frontend-api-v3.pump.fun/following/followers/" + creator);
    followers = pickCount(r.data);
  }
  if (following == null) {
    const r = await jget("https://frontend-api-v3.pump.fun/following/" + creator);
    following = pickCount(r.data);
  }
  return { followers, following };
}

async function pumpCreatedCoins(creator) {
  const out = [];
  const seen = new Set();
  const paths = [
    "https://frontend-api-v3.pump.fun/coins/user-created-coins/" + creator,
    "https://frontend-api-v3.pump.fun/coins-v2/user-created-coins/" + creator,
  ];

  for (const base of paths) {
    let got = 0;
    for (let offset = 0; offset < 1000; offset += 50) {
      const r = await jget(base + "?offset=" + offset + "&limit=50&includeNsfw=true");
      const list = asCoinList(r.data);
      if (!list.length) break;
      for (const c of list) {
        const mint = c && (c.mint || c.address);
        if (!mint || seen.has(mint)) continue;
        seen.add(mint);
        out.push(c);
        got += 1;
      }
      if (list.length < 50) break;
    }
    if (got) break;
  }

  if (!out.length) {
    for (let offset = 0; offset < 500; offset += 50) {
      const coins = await pumpSearch({
        limit: "50",
        offset: String(offset),
        searchTerm: "",
        creator,
        sort: "created_timestamp",
        order: "DESC",
        includeNsfw: "true",
      });
      if (!coins.length) break;
      for (const c of coins) {
        const mint = c && c.mint;
        if (!mint || seen.has(mint)) continue;
        seen.add(mint);
        out.push(c);
      }
      if (coins.length < 50) break;
    }
  }

  return out;
}

async function stDeployerTokens(creator) {
  if (!ST_KEY || !creator) return [];
  const out = [];
  const seen = new Set();
  for (let page = 1; page <= 4; page++) {
    const data = await st("/deployer/" + creator + "?page=" + page + "&limit=250&launchpad=pumpfun");
    const list = asCoinList(data) || (data && data.tokens) || [];
    const rows = Array.isArray(list) ? list : [];
    if (!rows.length) break;
    for (const row of rows) {
      const mint = row && (row.mint || (row.token && row.token.mint) || row.address);
      if (!mint || seen.has(mint)) continue;
      seen.add(mint);
      out.push(row);
    }
    const pages = Number(data && data.pages);
    if (rows.length < 250 || (pages && page >= pages)) break;
  }
  return out;
}

async function fetchPeakMc(mint) {
  if (!mint) return null;
  if (ST_KEY) {
    const ath = await st("/tokens/" + mint + "/ath");
    const peak = athFromPayload(ath);
    if (peak) return peak;
  }
  const r = await jget("https://frontend-api-v3.pump.fun/v1/coins/" + mint + "/ath");
  return athFromPayload(r.data);
}

function mergeDevToken(map, raw) {
  if (!raw || typeof raw !== "object") return;
  const tok = raw.token || raw;
  const mint = tok.mint || raw.mint || tok.address || raw.address;
  if (!mint) return;
  const prev = map.get(mint) || {
    mint,
    name: "",
    symbol: "",
    created: null,
    currentMc: null,
    peakMc: null,
    migrated: false,
  };

  const name = tok.name || raw.name || prev.name;
  const symbol = tok.symbol || raw.symbol || prev.symbol;
  const created =
    toDate(raw.created_timestamp || tok.created_timestamp || raw.createdAt || tok.createdAt || (tok.creation && tok.creation.created_time)) ||
    prev.created;
  const currentMc =
    num(raw.usd_market_cap) ||
    num(raw.marketCapUsd) ||
    num(raw.market_cap) ||
    num(tok.marketCap) ||
    num(raw.pools && raw.pools[0] && raw.pools[0].marketCap && raw.pools[0].marketCap.usd) ||
    prev.currentMc;
  const peakHint =
    athFromPayload(raw) ||
    athFromPayload(tok) ||
    prev.peakMc;
  const migrated = prev.migrated || isDevTokenMigrated(raw) || isDevTokenMigrated(tok);

  map.set(mint, {
    mint,
    name,
    symbol,
    created,
    currentMc,
    peakMc: peakHint && currentMc ? Math.max(peakHint, currentMc) : peakHint || currentMc || prev.peakMc,
    migrated,
  });
}

function rateDev(stats) {
  const total = stats.total || 0;
  const migrated = stats.migrated || 0;
  const rate = total ? migrated / total : 0;
  const best = stats.bestPeak || 0;
  const never = stats.neverMoved || 0;
  const followers = stats.followers || 0;
  let score = 42;
  const notes = [];

  if (total === 0) {
    return { score: 0, verdict: "❌ no history", notes: ["no tokens found"] };
  }

  if (rate >= 0.15) {
    score += 28;
    notes.push("strong migrate rate");
  } else if (rate >= 0.05) {
    score += 16;
    notes.push("some migrations");
  } else if (migrated >= 1) {
    score += 8;
    notes.push("rare migrate");
  } else {
    score -= 14;
    notes.push("no migrations");
  }

  if (migrated >= 5) score += 10;
  else if (migrated >= 2) score += 6;

  if (best >= 1e6) {
    score += 18;
    notes.push("hit 1M+ ATH");
  } else if (best >= 1e5) {
    score += 12;
    notes.push("hit 100k+ ATH");
  } else if (best >= 20000) {
    score += 5;
    notes.push("some heat");
  } else {
    score -= 8;
    notes.push("low ATH book");
  }

  if (total >= 80 && rate < 0.03) {
    score -= 16;
    notes.push("serial deployer");
  } else if (total >= 25 && rate < 0.04) {
    score -= 8;
    notes.push("high volume deploys");
  }

  if (total && never / total >= 0.7) {
    score -= 8;
    notes.push("most never moved");
  }

  if (followers >= 5000) score += 6;
  else if (followers >= 500) score += 3;

  score = Math.max(0, Math.min(100, score));
  let verdict = "❌ weak";
  if (score >= 75) verdict = "✅ strong";
  else if (score >= 55) verdict = "⚠️ mixed";
  return { score, verdict, notes };
}

async function buildDev(ca) {
  if (isEvmCa(ca)) return buildRhDev(ca);
  const [pump, tokenInfo] = await Promise.all([pumpCoin(ca), st("/tokens/" + ca)]);
  const creator = String(creatorFromSources(pump, tokenInfo) || "").trim();
  if (!creator) {
    return "❌ Dev wallet not found.\n<code>" + esc(ca) + "</code>" + FOOTER;
  }

  const [profile, follows, pumpCoins, stCoins] = await Promise.all([
    pumpUserProfile(creator),
    pumpFollowCounts(creator),
    pumpCreatedCoins(creator),
    stDeployerTokens(creator),
  ]);

  const map = new Map();
  for (const c of pumpCoins) mergeDevToken(map, c);
  for (const c of stCoins) mergeDevToken(map, c);

  const all = [...map.values()];
  const migratedN = all.filter((t) => t.migrated).length;
  const totalN = all.length;

  const byCurrent = all.slice().sort((a, b) => (b.currentMc || 0) - (a.currentMc || 0));
  const enrichSet = [];
  const seenE = new Set();
  for (const t of all) {
    if (t.migrated && !seenE.has(t.mint)) {
      seenE.add(t.mint);
      enrichSet.push(t);
    }
  }
  for (const t of byCurrent) {
    if (enrichSet.length >= 20) break;
    if (seenE.has(t.mint)) continue;
    seenE.add(t.mint);
    enrichSet.push(t);
  }

  for (let i = 0; i < enrichSet.length; i += 5) {
    const chunk = enrichSet.slice(i, i + 5);
    const peaks = await Promise.all(chunk.map((t) => fetchPeakMc(t.mint)));
    chunk.forEach((t, idx) => {
      const peak = peaks[idx];
      if (peak) t.peakMc = Math.max(peak, t.peakMc || 0, t.currentMc || 0);
    });
  }

  all.sort((a, b) => (b.peakMc || 0) - (a.peakMc || 0) || (b.currentMc || 0) - (a.currentMc || 0));
  const top = all.slice(0, 10);
  const neverMoved = all.filter((t) => !num(t.currentMc) && !num(t.peakMc)).length;
  const bestPeak = all.reduce((m, t) => Math.max(m, t.peakMc || 0), 0);

  const devName =
    (profile && (profile.username || profile.name || profile.displayName)) ||
    (pump && pump.username) ||
    "unknown";
  const followers =
    pickCount(profile && (profile.followers ?? profile.follower_count ?? profile.followersCount)) ??
    follows.followers;
  const following =
    pickCount(profile && (profile.following ?? profile.following_count ?? profile.followingCount)) ??
    follows.following;

  const rated = rateDev({
    total: totalN,
    migrated: migratedN,
    bestPeak,
    neverMoved,
    followers: followers || 0,
  });

  const topLines = top.map((t, i) => {
    return (
      i + 1 + ". <b>" + esc(t.name || "") + " (" + esc(t.symbol || "") + ")</b>" +
      (t.migrated ? " 👑" : "") +
      "\n<code>" + esc(t.mint) + "</code>\n" +
      "🕐 " + utc(t.created) + "\n" +
      "ATH " + capOrNever(t.peakMc) + " · now " + capOrNever(t.currentMc)
    );
  });

  return (
    "👨‍💻 <b>Dev history</b>\n" +
    "Name: " + esc(devName) + "\n" +
    "Wallet: <code>" + esc(creator) + "</code>\n" +
    "Followers " + (followers == null ? "n/a" : String(followers)) +
    " · Following " + (following == null ? "n/a" : String(following)) +
    "\n\n" +
    "👑 " + migratedN + "/" + totalN + " migrated\n\n" +
    "🧠 <b>Dev rating " + rated.score + "/100</b> " + esc(rated.verdict) + "\n" +
    esc(rated.notes.join(" · ") || "thin sample") +
    "\n\n" +
    "<b>Top 10 by highest MC achieved</b>\n" +
    (topLines.join("\n\n") || "no tokens found") +
    FOOTER
  ).slice(0, 4000);
}

async function buildBundle(ca) {
  if (isEvmCa(ca)) return buildRhBundle(ca);
  if (!ST_KEY) {
    return "📦 <b>Bundle check</b>\nadd SOLANA_TRACKER_KEY for live clusters" + FOOTER;
  }

  const [pump, pair, bundlers, tokenInfo] = await Promise.all([
    pumpCoin(ca),
    dexPair(ca),
    st("/tokens/" + ca + "/bundlers"),
    st("/tokens/" + ca),
  ]);

  const q = marketQuote(pump, pair, tokenInfo);
  const name = q.name;
  const symbol = q.symbol;
  const risk = tokenRisk(tokenInfo);
  const parsed = parseBundlers(bundlers, risk);
  const wallets = parsed.wallets;
  const nowPct = parsed.nowPct;
  const initPct = parsed.initPct;
  const totalW = parsed.totalW;
  const sniperPct = Number((risk.snipers && (risk.snipers.totalPercentage || risk.snipers.percentage)) || 0);
  const insiderPct = Number((risk.insiders && risk.insiders.totalPercentage) || 0);
  const sniperN = Number((risk.snipers && (risk.snipers.count || risk.snipers.total)) || 0);
  const insiderN = Number((risk.insiders && (risk.insiders.count || risk.insiders.total)) || 0);

  const groups = new Map();
  for (const w of wallets) {
    const k = clusterKey(w);
    const g = groups.get(k) || { key: k, when: toDate(w.bundleTime || Number(k) * 1000), wallets: [], pct: 0, init: 0 };
    g.wallets.push(w);
    g.pct += Number(w.percentage || 0);
    g.init += Number(w.initialPercentage || 0);
    groups.set(k, g);
  }

  const clusters = [...groups.values()].sort((a, b) => b.pct - a.pct);
  const liveClusters = clusters.filter((c) => c.pct > 0.0001);

  let heat = "🟢 clean";
  if (nowPct >= 30 || liveClusters.some((c) => c.pct >= 15)) heat = "🔴 heavy";
  else if (nowPct >= 15 || liveClusters.some((c) => c.pct >= 8)) heat = "🟠 fat";
  else if (nowPct >= 5 || totalW >= 8) heat = "🟡 present";

  const clusterLines = (liveClusters.length ? liveClusters : clusters).slice(0, 8).map((c, i) => {
    const top = c.wallets
      .slice()
      .sort((a, b) => Number(b.percentage || 0) - Number(a.percentage || 0))
      .slice(0, 3)
      .map((w) => short(w.wallet) + " " + pct(w.percentage))
      .join(" · ");

    return (
      "#" + (i + 1) + "  " + c.wallets.length + " wallets · now " + pct(c.pct) + " · launch " + pct(c.init) + "\n" +
      "🕐 " + utc(c.when) + "\n" +
      (top || "no wallets")
    );
  });

  const topHold = wallets
    .slice()
    .sort((a, b) => Number(b.percentage || 0) - Number(a.percentage || 0))
    .slice(0, 10)
    .map(
      (w, i) =>
        i + 1 + ". " + short(w.wallet) + "  now " + pct(w.percentage) + "  launch " + pct(w.initialPercentage)
    );

  return (
    "📦 <b>Bundle / clusters</b>  " + heat + "\n" +
    "<b>" + esc(name) + " (" + esc(symbol) + ")</b>\n" +
    "<code>" + esc(ca) + "</code>\n\n" +
    "⚡ live hold " + pct(nowPct) + " · launch " + pct(initPct) + "\n" +
    "👛 bundler wallets " + totalW + " · clusters " + (liveClusters.length || clusters.length) + "\n" +
    "🎯 snipers " + pct(sniperPct) + " (" + sniperN + ") · insiders " + pct(insiderPct) + " (" + insiderN + ")\n\n" +
    "<b>Clusters (same bundle time)</b>\n" +
    esc(clusterLines.join("\n\n") || "no clusters") + "\n\n" +
    "<b>Top bundler wallets now</b>\n" +
    esc(topHold.join("\n") || "none") +
    FOOTER
  ).slice(0, 4000);
}

async function buildCallouts(ca) {
  if (isEvmCa(ca)) {
    return "📣 Pump.fun callouts are Solana / Pump.fun only.\nThis CA is Robinhood Chain." + FOOTER;
  }

  const [pump, pair, comments, official] = await Promise.all([
    pumpCoin(ca),
    dexPair(ca),
    pumpReplies(ca),
    pumpOfficialCallouts(ca),
  ]);

  const q = marketQuote(pump, pair, null);
  const rows = comments.length ? comments : official;
  const source = comments.length
    ? "Pump.fun comments"
    : official.length
    ? "official Pump.fun callouts"
    : "none";

  const lines = rows.slice(0, 18).map((c, i) => {
    const who = c.name ? "@" + c.name.replace(/^@/, "") : "anon";
    return (
      i + 1 + ". <b>" + esc(who) + "</b>\n" +
      (c.addr ? "<code>" + esc(c.addr) + "</code>\n" : "") +
      "🕐 " + utc(c.when) + "\n" +
      (c.text ? esc(c.text.slice(0, 240)) : "<i>no comment text</i>")
    );
  });

  return (
    "📣 <b>Pump.fun callouts</b>\n" +
    "<b>" + esc(q.name) + " (" + esc(q.symbol) + ")</b>\n" +
    "<code>" + esc(ca) + "</code>\n\n" +
    "Source: " + source + "\n" +
    "Count: " + rows.length + " · order: first posted → last\n\n" +
    (lines.join("\n\n") || "No Pump.fun callouts / comments found for this CA.") +
    FOOTER
  ).slice(0, 4000);
}

async function buildReport(ca) {
  const [pump, pair, paid, tokenInfo, bundlers, holders, locks] = await Promise.all([
    pumpCoin(ca),
    dexPair(ca),
    dexPaid(ca),
    st("/tokens/" + ca),
    st("/tokens/" + ca + "/bundlers"),
    st("/tokens/" + ca + "/holders?enrich=all"),
    fetchTokenLocks(ca),
  ]);

  const fam = await findOgFamily(ca, pump, pair, tokenInfo);
  let ogTag = fam.isOg ? "OG" : "VAMP";
  if (fam.all.length <= 1) ogTag = fam.isOg ? "OG" : "UNKNOWN";

  const q = marketQuote(pump, pair, tokenInfo);
  const name = q.name;
  const symbol = q.symbol;
  const mc = q.mc;
  const risk = tokenRisk(tokenInfo);
  const sniperPct = Number((risk.snipers && (risk.snipers.totalPercentage || risk.snipers.percentage)) || 0);
  const insiderPct = Number((risk.insiders && risk.insiders.totalPercentage) || 0);
  const parsedB = parseBundlers(bundlers, risk);
  const bPct = parsedB.nowPct;
  const bInit = parsedB.initPct;
  const bWallets = parsedB.wallets;
  const holderData = parseHolders(holders, tokenInfo);

  const cluster = bWallets
    .slice()
    .sort((a, b) => Number(b.percentage || 0) - Number(a.percentage || 0))
    .slice(0, 3)
    .map((w, i) => i + 1 + ". " + short(w.wallet) + " " + Number(w.percentage || 0).toFixed(2) + "%")
    .join("\n");

  let bundleBlock = ST_KEY
    ? "Now " + Number(bPct || 0).toFixed(2) + "% · launch " + Number(bInit || 0).toFixed(2) + "% · " + parsedB.totalW + " wallets"
    : "add Data API key";
  if (cluster) bundleBlock += "\n" + cluster;

  const acc = holderData.list;
  const people = [];
  const hLines = [];

  for (const h of acc.slice(0, 10)) {
    const tag = sizeTag(h);
    const { total, hold } = tokenPnl(h);
    const icon =
      tag === "LP" ? "💧" : tag === "WHALE" ? "🐳" : tag === "FISH" ? "🐟" : tag === "DEV" ? "👨‍💻" : tag === "BOT" ? "🤖" : "🦐";
    const wallet = h.wallet || h.address || "";

    hLines.push(
      icon +
        " " +
        tag +
        " " +
        short(wallet) +
        " " +
        Number(h.percentage || 0).toFixed(2) +
        "%" +
        (tag === "LP" ? "" : " · " + (total == null ? "n/a" : money(total)) + " · " + holdHuman(hold))
    );

    if (tag !== "LP" && tag !== "BOT") people.push({ hold: Number(hold), pnl: Number(total) });
  }

  const holds = people.map((p) => p.hold).filter((n) => Number.isFinite(n) && n >= 0);
  const pnls = people.map((p) => p.pnl).filter((n) => Number.isFinite(n));
  const avgHold = holds.length ? holds.reduce((a, b) => a + b, 0) / holds.length : null;
  const avgPnl = pnls.length ? pnls.reduce((a, b) => a + b, 0) / pnls.length : null;

  let paidBlock = "❌ Dex profile not paid (API)";
  if (!paid.ok) paidBlock = "⚠️ Dex orders request failed";
  else if (paid.profilePaid || paid.adPaid) {
    paidBlock =
      (paid.profilePaid ? "✅ Profile paid" : "❌ Profile not paid") +
      " · " +
      (paid.adPaid ? "✅ Ad paid" : "Ad no") +
      (paid.firstPay ? "\n🕒 first pay: " + utc(paid.firstPay) : "");
    const extra = paid.orders
      .filter((o) => o.live)
      .slice(0, 4)
      .map((o) => "• " + o.type + " · " + o.status + " · " + utc(o.when));
    if (extra.length) paidBlock += "\n" + extra.join("\n");
  } else if (paid.orders.length) {
    paidBlock =
      "❌ no live paid profile/ad\n" +
      paid.orders
        .slice(0, 4)
        .map((o) => "• " + o.type + " · " + o.status + " · " + utc(o.when))
        .join("\n");
  }
  if (pair && pair.info) paidBlock += "\nℹ️ Dex page has profile info (not the same as paid)";

  const L = lore(pump, ogTag, bPct, sniperPct, Number(mc || 0));
  const x = await xPulse(ca, pump, pair);
  const badge = ogTag === "OG" ? "🟢 OG" : ogTag === "VAMP" ? "🟣 VAMP" : "⚪ CHECK";
  const holderCountLine = holderData.total != null ? "count " + holderData.total + "\n" : "";

  // Add running PnL line if this CA was previously called in the group
  let pnlLine = "";
  try {
    const firstCall = store.calls
      .filter((c) => c.ca === ca)
      .sort((a, b) => Number(a.calledAt) - Number(b.calledAt))[0];
    if (firstCall && (firstCall.mc || firstCall.price)) {
      const entry = num(firstCall.mc) || num(firstCall.price);
      const live = num(mc) || num(q.price);
      if (entry && live) {
        const m = live / entry;
        pnlLine = "📈 Group call PnL  " + xs(m) + " from " + moneyMkt(entry) + " (first scanner)\n";
      }
    }
  } catch (_) {}

  const marketBody =
    "MC " + moneyMkt(mc) + " · FDV " + moneyMkt(q.fdv) + "\n" +
    "💧 Liq " + moneyMkt(q.liq) + " · 📊 Vol24 " + moneyMkt(q.vol) + "\n" +
    pnlLine;

  const launchBody =
    "Pump: " + utc(toDate(pump && pump.created_timestamp)) + "\n" +
    "Pair: " + utc(toDate(pair && pair.pairCreatedAt) || q.created) + "\n" +
    esc(ogLine(fam));

  const bundleBody =
    esc(bundleBlock) + "\n" +
    "🎯 Snipers " + sniperPct.toFixed(1) + "% · Insiders " + insiderPct.toFixed(1) + "%";

  const holderBody = ST_KEY
    ? esc(holderCountLine + (hLines.join("\n") || "none")) +
      "\n⏱ avg hold " +
      (avgHold == null ? "n/a" : holdHuman(avgHold)) +
      " · avg PnL " +
      (avgPnl == null ? "n/a" : money(avgPnl))
    : "add Data API key";

  const paidBody =
    esc(paidBlock) + "\n🚀 Boosts: " + ((pair && pair.boosts && pair.boosts.active) ?? "n/a");

  const loreBody =
    L.score + "/100  " + esc(L.verdict) + "\n" +
    esc(L.desc) + "\n" +
    esc(L.notes.join(" · "));

  return (
    badge + "  <b>" + esc(name) + " (" + esc(symbol) + ")</b>\n" +
    "<code>" + esc(ca) + "</code>\n\n" +
    boxSection("💰 Market", marketBody) + "\n" +
    boxSection("🕐 Launch UTC", launchBody) + "\n" +
    boxSection("📦 Bundles", bundleBody) + "\n" +
    buildLocksBlock(locks) + "\n" +
    boxSection("👛 Top holders", holderBody) + "\n" +
    boxSection("🧾 Dex paid", paidBody) +
    (q.url ? "\n🔗 " + q.url + "\n" : "\n") +
    (x ? "\n" + esc(x) + "\n" : "") +
    "\n" +
    boxSection("🧠 Lore", loreBody) +
    FOOTER
  ).slice(0, 4000);
}

async function buildVamp(ca) {
  const pump = await pumpCoin(ca);
  const pair = await dexPair(ca);
  const fam = await findOgFamily(ca, pump, pair, null);

  if (!fam.all.length) return "❌ No family found.\n<code>" + esc(ca) + "</code>" + FOOTER;

  const buzzMint = vampBuzzMint(fam.all);
  const lines = fam.all.slice(0, 12).map((c) => vampListLine(c, ca, fam, buzzMint, false));

  const verdict = fam.isOg
    ? "🟢 Provided CA is OG CA\n<code>" + esc(fam.og.mint) + "</code>"
    : "🟣 Provided CA is VAMP\n🟢 OG CA:\n<code>" + esc(fam.og && fam.og.mint) + "</code>";

  const buzzNote =
    buzzMint && Number(fam.all.find((x) => x.mint === buzzMint)?.mc) > 0
      ? "\n🔥 BUZZ = highest live MC in this family (other vamps can still be buzzing if MC is close)."
      : "";

  return (
    "🧛 <b>Vamp check</b>\n" +
    "Name: " + esc(fam.name) + " · Ticker: " + esc(fam.symbol) + "\n" +
    "Matches: " + fam.all.length + "\n\n" +
    verdict +
    "\n\n" +
    esc(ogLine(fam)) +
    buzzNote +
    "\n\n" +
    lines.join("\n\n") +
    FOOTER
  ).slice(0, 4000);
}

async function resolveRhDev(ca, addrInfo) {
  const info = addrInfo || (await soft(bsRhAddress(ca))) || {};
  const factory = String(info.creator_address_hash || "").trim();
  const createHash = String(info.creation_transaction_hash || "").trim();
  const createTx = createHash ? await soft(bsRhTx(createHash)) : null;
  const txFrom =
    (createTx && createTx.from && (createTx.from.hash || createTx.from)) ||
    (createTx && createTx.from_address) ||
    "";
  const factoryInfo = factory ? await soft(bsRhAddress(factory)) : null;
  const factoryIsContract = !!(factoryInfo && factoryInfo.is_contract);
  const deployer = String(txFrom || (!factoryIsContract ? factory : "") || factory || "").trim();
  return {
    factory,
    factoryIsContract,
    deployer,
    createHash,
    createdAt: toDate(
      (createTx && createTx.timestamp) ||
        info.creation_status ||
        null
    ) || toDate(createTx && createTx.timestamp),
    verified: !!(info.is_verified || info.is_fully_verified),
    contractName: info.name || (info.implementations && info.implementations[0] && info.implementations[0].name) || "",
  };
}

async function buildRhDev(ca) {
  const scan = await loadRhScan(ca);
  if (!scan.pair && !scan.gecko && !scan.bs && !scan.addrInfo) {
    return "❌ No Robinhood Chain token found.\n<code>" + esc(ca) + "</code>" + FOOTER;
  }
  const { q, addrInfo, paid } = scan;
  const dev = await resolveRhDev(ca, addrInfo);
  const counters = await soft(bsRhCounters(dev.deployer));
  const created = await soft(bsRhCreatedBy(dev.deployer));
  const extra = [];
  for (const row of (created || []).slice(0, 8)) {
    if (String(row.ca).toLowerCase() === String(ca).toLowerCase()) continue;
    const tok = await soft(bsRhToken(row.ca));
    extra.push({
      ca: row.ca,
      when: row.when,
      name: (tok && tok.name) || "",
      symbol: (tok && tok.symbol) || "",
      holders: tok && (tok.holders_count || tok.holders),
    });
  }

  const txN = counters && counters.transactions_count;
  let score = 45;
  const notes = [];
  if (dev.verified) {
    score += 8;
    notes.push("verified contract");
  }
  if (extra.length >= 8) {
    score -= 12;
    notes.push("serial deployer");
  } else if (extra.length >= 3) {
    score -= 6;
    notes.push("multiple deploys");
  } else if (extra.length === 0) {
    score += 4;
    notes.push("few visible deploys");
  }
  if (Number(txN) >= 2000) {
    score -= 6;
    notes.push("very active wallet");
  }
  score = Math.max(0, Math.min(100, score));
  const verdict = score >= 70 ? "✅ strong" : score >= 50 ? "⚠️ mixed" : "❌ weak";

  const extraLines = extra.slice(0, 8).map((t, i) => {
    return (
      i + 1 + ". <b>" + esc(t.name || "contract") + (t.symbol ? " (" + esc(t.symbol) + ")" : "") + "</b>\n" +
      "<code>" + esc(t.ca) + "</code>\n" +
      "🕐 " + utc(t.when) +
      (t.holders != null ? " · holders " + t.holders : "")
    );
  });

  return (
    "👨‍💻 <b>RH dev</b> · chain " + RH_CHAIN_ID + "\n" +
    "<b>" + esc(q.name) + " (" + esc(q.symbol) + ")</b>\n" +
    "<code>" + esc(ca) + "</code>\n\n" +
    "Deployer: <code>" + esc(dev.deployer || "unknown") + "</code>\n" +
    (dev.factory && String(dev.factory).toLowerCase() !== String(dev.deployer).toLowerCase()
      ? "Factory: <code>" + esc(dev.factory) + "</code>" + (dev.factoryIsContract ? " · contract" : "") + "\n"
      : "") +
    (dev.contractName ? "Contract: " + esc(dev.contractName) + "\n" : "") +
    "Verified: " + (dev.verified ? "yes" : "no") + "\n" +
    "Tx count: " + (txN == null ? "n/a" : String(txN)) + "\n" +
    (dev.createHash ? "Create tx: <code>" + esc(dev.createHash) + "</code>\n" : "") +
    "\n🧾 <b>Dex paid</b>\n" +
    esc(rhPaidBlock(paid)) +
    "\n\n🧠 <b>Dev rating " + score + "/100</b> " + esc(verdict) + "\n" +
    esc(notes.join(" · ") || "on-chain deploy metadata") +
    "\n\n<b>Other contracts from this deployer</b>\n" +
    (extraLines.join("\n\n") || "none indexed on last tx pages") +
    "\n\n" +
    RH_EXPLORER + "/address/" + (dev.deployer || ca) +
    FOOTER
  ).slice(0, 4000);
}

async function buildRhReport(ca) {
  const scan = await loadRhScan(ca);
  const { pair, gecko, bs, q, official, parsedH, bundled, socials, fam, paid, addrInfo } = scan;

  if (!pair && !gecko && !bs && !scan.paprika) {
    return (
      "❌ No Robinhood Chain token found.\n" +
      "<code>" + esc(ca) + "</code>\n" +
      "Chain ID " + RH_CHAIN_ID + " · " + RH_EXPLORER +
      FOOTER
    );
  }

  let officialBlock = "Not an official Robinhood Stock Token";
  if (official) {
    const px = await rhOfficialPrice(official.tokenSymbol || official.symbol || q.symbol);
    const bid = px && (px.bid || px.bid_price || px.bidPrice);
    const ask = px && (px.ask || px.ask_price || px.askPrice);
    officialBlock =
      "✅ Official RH Stock Token: " + esc(official.tokenSymbol || official.symbol || q.symbol) +
      ((official.tokenName || official.name) ? " · " + esc(official.tokenName || official.name) : "") +
      (bid || ask ? "\nRH book bid " + String(bid || "n/a") + " / ask " + String(ask || "n/a") : "");
  }

  const hLines = parsedH.rows.slice(0, 10).map((h, i) => {
    return (
      i + 1 + ". " +
      rhSizeIcon(h.tag) + " " + h.tag + " " +
      short(h.addr) +
      " · " + pct(h.pctn)
    );
  });

  const created =
    toDate(pair && pair.pairCreatedAt) ||
    toDate(bs && (bs.created_at || (bs.block && bs.block.timestamp)));

  const L = rhLore({
    official,
    fam,
    desc: socials.desc,
    socials,
    bundleNow: bundled.nowPct,
    topConc: parsedH.topConc,
    holderCount: parsedH.holderCount,
    mc: q.mc,
    paid,
  });
  const badge = L.ogTag === "OG" ? "🟢 OG" : L.ogTag === "VAMP" ? "🟣 VAMP" : "🏦";
  const dev = addrInfo ? await resolveRhDev(ca, addrInfo).catch(() => null) : null;

  return (
    badge + " <b>Robinhood Chain</b> · id " + RH_CHAIN_ID + "\n" +
    "<b>" + esc(q.name) + " (" + esc(q.symbol) + ")</b>\n" +
    "<code>" + esc(ca) + "</code>\n\n" +
    "💰 <b>Market (RH DEX only)</b>\n" +
    "MC " + moneyMkt(q.mc) + " · FDV " + moneyMkt(q.fdv) + "\n" +
    "💧 Liq " + moneyMkt(q.liq) + " · 📊 Vol24 " + moneyMkt(q.vol) + "\n" +
    (q.price != null ? "Px " + money(q.price) + "\n" : "") +
    (q.dex ? "DEX " + esc(q.dex) + "\n" : "") +
    "\n🕐 Pair: " + utc(created) + "\n" +
    (dev && dev.deployer ? "👨‍💻 Dev <code>" + esc(dev.deployer) + "</code>\n" : "") +
    esc(ogLine(fam)) + "\n\n" +
    "📜 <b>Official RH registry</b>\n" +
    officialBlock + "\n\n" +
    "📦 <b>Launch clusters</b>  " + bundled.heat + "\n" +
    "same-block window hold " + pct(bundled.nowPct) +
    " · " + bundled.initWallets + " bundler wallets" +
    (bundled.firstBlock ? " · blk " + bundled.firstBlock : "") + "\n\n" +
    "👛 <b>Holders (Blockscout RH live)</b>\n" +
    "count " + (parsedH.holderCount == null ? "n/a" : String(parsedH.holderCount)) +
    " · live rows " + String(parsedH.liveHolders || parsedH.rows.length || 0) +
    " · top10 " + pct(parsedH.topConc) + "\n" +
    (hLines.join("\n") || "no holder rows indexed") + "\n\n" +
    "🧾 <b>Dex paid</b>\n" +
    esc(rhPaidBlock(paid)) + "\n" +
    "🚀 Boosts: " + ((pair && pair.boosts && pair.boosts.active) ?? "n/a") + "\n\n" +
    "🧠 <b>Lore " + L.score + "/100</b> " + esc(L.verdict) + "\n" +
    esc(L.desc) + "\n" +
    esc(L.notes.join(" · ")) +
    (socials.twitter || socials.telegram || socials.website
      ? "\n" +
        [socials.twitter && ("X " + socials.twitter), socials.telegram && ("TG " + socials.telegram), socials.website]
          .filter(Boolean)
          .join(" · ")
      : "") +
    "\n\n" +
    (q.url ? q.url + "\n" : "") +
    RH_EXPLORER + "/token/" + ca +
    FOOTER
  ).slice(0, 4000);
}

async function buildRhVamp(ca) {
  const [pair, gecko] = await Promise.all([soft(dexRhPair(ca)), soft(geckoRhToken(ca))]);
  const fam = await findRhFamily(ca, pair, gecko);
  if (!fam.all.length) return "❌ No RH family found.\n<code>" + esc(ca) + "</code>" + FOOTER;

  const buzzMint = vampBuzzMint(fam.all);
  const lines = fam.all.slice(0, 12).map((c) => vampListLine(c, ca, fam, buzzMint, true));

  const verdict = fam.isOg
    ? "🟢 Provided CA is OG on Robinhood Chain"
    : "🟣 Provided CA is VAMP on Robinhood Chain\n🟢 OG CA:\n<code>" +
      esc(fam.og && fam.og.mint) + "</code>";

  const buzzNote =
    buzzMint && Number(fam.all.find((x) => String(x.mint).toLowerCase() === String(buzzMint).toLowerCase())?.mc) > 0
      ? "\n🔥 BUZZ = highest live MC in this RH family."
      : "";

  return (
    "🧛 <b>RH vamp check</b> · chain " + RH_CHAIN_ID + "\n" +
    "Name: " + esc(fam.name) + " · Ticker: " + esc(fam.symbol) + "\n" +
    "Matches: " + fam.all.length + " (RH pairs + Blockscout name/ticker search)\n\n" +
    verdict + "\n\n" +
    esc(ogLine(fam)) +
    buzzNote +
    "\n\n" +
    lines.join("\n\n") +
    FOOTER
  ).slice(0, 4000);
}

async function buildRhHolders(ca) {
  const scan = await loadRhScan(ca);
  if (!scan.pair && !scan.gecko && !scan.bs && !scan.paprika) {
    return "❌ No Robinhood Chain token found.\n<code>" + esc(ca) + "</code>" + FOOTER;
  }
  const { q, parsedH } = scan;
  const lines = parsedH.rows.slice(0, 15).map((h, i) => {
    return (
      i + 1 + ". " + rhSizeIcon(h.tag) + " " + h.tag + " " +
      short(h.addr) + " · " + pct(h.pctn) +
      "\n<code>" + esc(h.addr) + "</code>"
    );
  });
  return (
    "👛 <b>RH holders</b> · chain " + RH_CHAIN_ID + "\n" +
    "<b>" + esc(q.name) + " (" + esc(q.symbol) + ")</b>\n" +
    "<code>" + esc(ca) + "</code>\n\n" +
    "live holders " + (parsedH.holderCount == null ? "n/a" : String(parsedH.holderCount)) +
    " · rows shown " + String(parsedH.liveHolders || parsedH.rows.length || 0) +
    " · top10 " + pct(parsedH.topConc) +
    " · people top10 " + pct(parsedH.peopleConc) + "\n\n" +
    (lines.join("\n\n") || "no holder rows indexed") +
    FOOTER
  ).slice(0, 4000);
}

async function buildRhBundle(ca) {
  const scan = await loadRhScan(ca);
  if (!scan.pair && !scan.gecko && !scan.bs && !scan.paprika) {
    return "❌ No Robinhood Chain token found.\n<code>" + esc(ca) + "</code>" + FOOTER;
  }
  const { q, bundled } = scan;
  const clusterLines = (bundled.launch.length ? bundled.launch : bundled.clusters).slice(0, 8).map((c, i) => {
    const top = c.wallets.slice(0, 4).map((w) => short(w)).join(" · ");
    return (
      "#" + (i + 1) + " blk " + c.block +
      " · " + c.wallets.length + " wallets · now " + pct(c.nowPct) +
      " · " + c.txs + " txs\n" +
      "🕐 " + utc(c.when) + "\n" +
      (top || "no wallets")
    );
  });
  return (
    "📦 <b>RH launch clusters</b>  " + bundled.heat + "\n" +
    "<b>" + esc(q.name) + " (" + esc(q.symbol) + ")</b>\n" +
    "<code>" + esc(ca) + "</code>\n\n" +
    "RH has no Jito-style bundles. This groups first ~8s / ~80 L2-block buys.\n" +
    "⚡ launch-window hold " + pct(bundled.nowPct) +
    " · bundler wallets " + bundled.initWallets +
    (bundled.firstBlock ? " · first blk " + bundled.firstBlock : "") + "\n\n" +
    "<b>Clusters (same block)</b>\n" +
    (clusterLines.join("\n\n") || "0 clusters indexed") +
    FOOTER
  ).slice(0, 4000);
}

async function buildRhLore(ca) {
  const scan = await loadRhScan(ca);
  if (!scan.pair && !scan.gecko && !scan.bs && !scan.paprika) {
    return "❌ No Robinhood Chain token found.\n<code>" + esc(ca) + "</code>" + FOOTER;
  }
  const { q, official, parsedH, bundled, socials, fam, paid } = scan;
  const L = rhLore({
    official,
    fam,
    desc: socials.desc,
    socials,
    bundleNow: bundled.nowPct,
    topConc: parsedH.topConc,
    holderCount: parsedH.holderCount,
    mc: q.mc,
    paid,
  });
  return (
    "🧠 <b>RH lore</b> · chain " + RH_CHAIN_ID + "\n" +
    "<b>" + esc(q.name) + " (" + esc(q.symbol) + ")</b>\n" +
    "<code>" + esc(ca) + "</code>\n\n" +
    "<b>" + L.score + "/100</b> " + esc(L.verdict) + "\n" +
    esc(L.notes.join(" · ") || "thin sample") + "\n\n" +
    esc(L.desc) + "\n\n" +
    esc(ogLine(fam)) + "\n" +
    (official ? "✅ Official RH registry token\n" : "Not on official RH registry\n") +
    esc(rhPaidBlock(paid)) + "\n" +
    (socials.twitter ? "X " + esc(socials.twitter) + "\n" : "") +
    (socials.telegram ? "TG " + esc(socials.telegram) + "\n" : "") +
    (socials.website ? esc(socials.website) + "\n" : "") +
    FOOTER
  ).slice(0, 4000);
}

/* ───────── github audit (official GitHub REST API only) ───────── */

const GH_RESERVED_OWNERS = new Set([
  "topics", "trending", "orgs", "settings", "notifications", "search",
  "marketplace", "explore", "features", "pricing", "about", "login",
  "signup", "sponsors", "collections", "events", "codespaces", "copilot",
  "pulls", "issues", "new", "stars", "watching", "organizations", "users",
  "apps", "gist", "enterprise", "customer-stories", "security", "team",
]);

const GH_RESERVED_REPOS = new Set([
  "issues", "pulls", "actions", "projects", "wiki", "security", "insights",
  "settings", "pulse", "graphs", "network", "commits", "branches", "tags",
  "releases", "tree", "blob", "commit", "discussions", "packages",
]);

const ghJobs = new Map();
let ghSeq = 1;

function rememberGh(owner, repo) {
  const id = String(ghSeq++);
  ghJobs.set(id, { owner, repo: repo || "", at: Date.now() });
  if (ghJobs.size > 400) {
    const now = Date.now();
    for (const [k, v] of ghJobs) {
      if (now - v.at > 24 * 60 * 60 * 1000) ghJobs.delete(k);
    }
  }
  return id;
}

function countHuman(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x < 0) return "n/a";
  if (x >= 1e6) return (x / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (x >= 1e3) return (x / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
  return String(Math.round(x));
}

function starFaces(stars) {
  const s = Number(stars) || 0;
  if (s >= 10000) return "⭐⭐⭐⭐⭐";
  if (s >= 1000) return "⭐⭐⭐⭐";
  if (s >= 100) return "⭐⭐⭐";
  if (s >= 10) return "⭐⭐";
  if (s >= 1) return "⭐";
  return "☆";
}

function extractGithub(text) {
  const raw = String(text || "");
  const m = raw.match(
    /(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)(?:\/([A-Za-z0-9_.-]+))?/i
  );
  if (m) {
    const owner = m[1];
    let repo = m[2] || "";
    if (GH_RESERVED_OWNERS.has(owner.toLowerCase())) return null;
    if (repo) repo = repo.replace(/\.git$/i, "");
    if (repo && GH_RESERVED_REPOS.has(repo.toLowerCase())) repo = "";
    return { owner, repo };
  }

  const slash = raw.match(/^\s*\/?(?:git(?:hub)?)?\s+([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\s*$/i);
  if (slash) {
    return { owner: slash[1], repo: slash[2].replace(/\.git$/i, "") };
  }

  const ownerOnly = raw.match(/^\s*\/?(?:git(?:hub)?)?\s+@?([A-Za-z0-9_.-]+)\s*$/i);
  if (ownerOnly && !GH_RESERVED_OWNERS.has(ownerOnly[1].toLowerCase())) {
    return { owner: ownerOnly[1], repo: "" };
  }

  return null;
}

function ghHeaders() {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "VEXLORE-Bot",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (GH_TOKEN) headers.Authorization = "Bearer " + GH_TOKEN;
  return headers;
}

async function ghGet(apiPath) {
  return jget("https://api.github.com" + apiPath, ghHeaders());
}

function ghRepoLine(r) {
  if (!r || !r.full_name) return "n/a";
  return (
    "<b>" + esc(r.full_name) + "</b>" +
    (r.fork ? " · fork" : "") +
    "\n⭐ " + countHuman(r.stargazers_count) +
    " · 🍴 " + countHuman(r.forks_count) +
    (r.language ? " · " + esc(r.language) : "") +
    "\n🕐 created " + utc(toDate(r.created_at)) +
    "\n🕐 pushed " + utc(toDate(r.pushed_at))
  );
}

function rateGithub(repo, owner) {
  let score = 42;
  const notes = [];
  const stars = Number((repo && repo.stargazers_count) || 0);
  const forks = Number((repo && repo.forks_count) || 0);
  const ageMs = repo && repo.created_at ? Date.now() - new Date(repo.created_at).getTime() : 0;
  const ageDays = ageMs > 0 ? ageMs / 86400000 : 0;
  const pushMs = repo && repo.pushed_at ? Date.now() - new Date(repo.pushed_at).getTime() : Infinity;
  const pushDays = Number.isFinite(pushMs) ? pushMs / 86400000 : Infinity;
  const publicRepos = Number((owner && owner.public_repos) || 0);
  const ownerAgeMs = owner && owner.created_at ? Date.now() - new Date(owner.created_at).getTime() : 0;
  const ownerDays = ownerAgeMs > 0 ? ownerAgeMs / 86400000 : 0;

  if (repo && repo.archived) {
    score -= 18;
    notes.push("archived");
  }
  if (repo && repo.fork) {
    score -= 10;
    notes.push("fork");
  }
  if (repo && repo.license && repo.license.spdx_id && repo.license.spdx_id !== "NOASSERTION") {
    score += 6;
    notes.push("licensed");
  }
  if (repo && repo.description && String(repo.description).trim().length > 20) {
    score += 6;
    notes.push("has description");
  } else if (repo) {
    score -= 4;
    notes.push("thin description");
  }
  if (stars >= 10000) {
    score += 22;
    notes.push("very high stars");
  } else if (stars >= 1000) {
    score += 16;
    notes.push("high stars");
  } else if (stars >= 100) {
    score += 10;
    notes.push("solid stars");
  } else if (stars >= 10) {
    score += 4;
    notes.push("some stars");
  } else {
    score -= 4;
    notes.push("few stars");
  }
  if (forks >= 100) score += 6;
  else if (forks >= 10) score += 3;
  if (pushDays <= 7) {
    score += 10;
    notes.push("pushed this week");
  } else if (pushDays <= 30) {
    score += 6;
    notes.push("pushed this month");
  } else if (pushDays <= 180) {
    score += 2;
    notes.push("pushed in 6m");
  } else if (Number.isFinite(pushDays)) {
    score -= 10;
    notes.push("stale push");
  }
  if (ageDays >= 365) {
    score += 6;
    notes.push("repo 1y+");
  } else if (ageDays > 0 && ageDays < 7) {
    score -= 6;
    notes.push("brand new repo");
  }
  if (ownerDays >= 365) score += 4;
  else if (ownerDays > 0 && ownerDays < 14) {
    score -= 8;
    notes.push("new GitHub account");
  }
  if (publicRepos >= 20) score += 3;
  else if (publicRepos === 1 && repo) notes.push("only public repo");

  score = Math.max(0, Math.min(100, score));
  let verdict = "❌ weak";
  if (score >= 75) verdict = "✅ strong";
  else if (score >= 55) verdict = "⚠️ mixed";
  return { score, verdict, notes };
}
function looksPumpGithubHit(row, login) {
  const needle = String(login || "").toLowerCase();
  if (!needle || !row) return false;
  const blob = [
    row.website,
    row.twitter,
    row.telegram,
    row.description,
    row.name,
    row.symbol,
  ]
    .map((x) => String(x || "").toLowerCase())
    .join(" ");
  return blob.includes("github.com/" + needle);
}

async function searchPumpGithubFeeTokens(login) {
  const q = String(login || "").trim();
  if (!q) return [];
  const queries = ["github.com/" + q, q];
  const map = new Map();

  for (const term of queries) {
    const coins = await soft(
      pumpSearch({
        limit: "50",
        offset: "0",
        searchTerm: term,
        sort: "usd_market_cap",
        order: "DESC",
        includeNsfw: "false",
      })
    );
    for (const c of coins || []) {
      if (!c || !c.mint) continue;
      if (!looksPumpGithubHit(c, q)) continue;
      const prev = map.get(c.mint) || {};
      map.set(c.mint, {
        mint: c.mint,
        name: c.name || prev.name || "",
        symbol: c.symbol || prev.symbol || "",
        mc: num(c.usd_market_cap || c.market_cap) || prev.mc,
        website: c.website || prev.website || "",
      });
    }
  }

  return [...map.values()].sort((a, b) => (b.mc || 0) - (a.mc || 0));
}
function solAmt(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "n/a";
  if (x <= 0) return "0 SOL";
  if (x >= 100) return x.toFixed(2) + " SOL";
  if (x >= 1) return x.toFixed(3) + " SOL";
  return x.toFixed(4) + " SOL";
}

function pickSol(...vals) {
  for (const v of vals) {
    if (v == null || v === "") continue;
    if (typeof v === "object") {
      const inner = pickSol(v.sol, v.amount, v.value, v.claimed, v.earned);
      if (inner != null) return inner;
    }
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function feeCoinMint(row) {
  return String(
    (row && (row.mint || row.address || row.token || (row.coin && (row.coin.mint || row.coin.address)))) ||
      ""
  ).trim();
}

function upsertFeeCoin(map, row) {
  const mint = feeCoinMint(row);
  if (!mint) return;
  const old = map.get(mint) || {};
  const claimed = pickSol(row.claimed_sol, row.claimed, row.earned && row.earned.sol, row.earned, old.claimed);
  const unclaimed = pickSol(row.unclaimed_sol, row.unclaimed, old.unclaimed);
  const earned = pickSol(row.earned_sol, row.total_sol, row.earned && row.earned.sol, old.earned);
  map.set(mint, {
    mint,
    name: row.name || (row.coin && row.coin.name) || old.name || "",
    symbol: row.symbol || (row.coin && row.coin.symbol) || old.symbol || "",
    mc: num(row.marketCapUsd || row.usd_market_cap || row.mc) || old.mc,
    shareBps: row.share_bps || row.bps || old.shareBps,
    claimed: claimed != null ? claimed : old.claimed,
    unclaimed: unclaimed != null ? unclaimed : old.unclaimed,
    earned: earned != null ? earned : old.earned,
    distributions: row.distributions || old.distributions,
    lastAt: toDate(row.lastEarnedAt || row.last_claimed_at || row.updatedAt) || old.lastAt,
  });
}

async function pumpFeeProxy(q) {
  const urls = [
    "https://pumpfun-creator-rewards-lp642k3kpa-uc.a.run.app/api/earnings?q=" + encodeURIComponent(q),
    "https://pumpfun-creator-rewards-lp642k3kpa-uc.a.run.app/api/fees?q=" + encodeURIComponent(q),
  ];
  for (const u of urls) {
    const r = await soft(jget(u));
    if (r && r.ok && r.data && (r.data.totals || r.data.coins || r.data.resolved)) return r.data;
  }
  return null;
}

async function pumpSwapFees(addr) {
  if (!addr) return null;
  const base = "https://swap-api.pump.fun/v1/fee-sharing/account/" + encodeURIComponent(addr);
  const [totals, shares] = await Promise.all([
    soft(jget(base + "/totals")),
    soft(jget(base + "/shares")),
  ]);
  if (!(totals && totals.ok) && !(shares && shares.ok)) return null;
  return {
    totals: totals && totals.data,
    shares: shares && shares.data,
  };
}

async function pumpFeeByGithub(login, githubId) {
  const queries = [...new Set([String(login || ""), String(githubId || "")].filter(Boolean))];
  let proxy = null;
  for (const q of queries) {
    proxy = await pumpFeeProxy(q);
    if (proxy) break;
  }

  const wallet =
    (proxy && proxy.resolved && (proxy.resolved.wallet || proxy.resolved.address || proxy.resolved.pda)) ||
    "";
  const swap = wallet ? await pumpSwapFees(wallet) : null;

  const map = new Map();
  const bags = [
    proxy && proxy.coins,
    proxy && proxy.coinEarnings,
    swap && swap.shares && (swap.shares.shares || swap.shares.coins || swap.shares.items || swap.shares),
  ];
  for (const bag of bags) {
    for (const row of Array.isArray(bag) ? bag : []) upsertFeeCoin(map, row);
  }

  const totals = (proxy && proxy.totals) || {};
  const insights = (proxy && proxy.insights) || {};
  const swapT = (swap && swap.totals) || {};
  const claimed =
    pickSol(totals.shareholderClaimed, swapT.claimed, swapT.claimedSol, insights.distributed) || 0;
  const unclaimed =
    pickSol(totals.shareholderUnclaimed, swapT.unclaimed, swapT.unclaimedSol, insights.unclaimed) || 0;
  const earned =
    pickSol(totals.shareholderTotalEarned, swapT.earned, swapT.totalEarned) ||
    claimed + unclaimed;

  return {
    wallet,
    claimed,
    unclaimed,
    earned,
    coins: [...map.values()].sort(
      (a, b) => Number(b.claimed || b.earned || 0) - Number(a.claimed || a.earned || 0)
    ),
    source: proxy ? "pump fee API" : swap ? "swap-api" : "",
  };
}
function ratePumpGithubFees(owner, fee) {
  let score = 42;
  const notes = [];
  const org = String((owner && owner.type) || "") === "Organization";
  const n = (fee && fee.coins && fee.coins.length) || 0;
  const claimed = Number(fee && fee.claimed) || 0;
  const unclaimed = Number(fee && fee.unclaimed) || 0;

  if (org) {
    score -= 20;
    notes.push("org cannot claim Pump GitHub fees");
  } else {
    score += 6;
    notes.push("individual GitHub user");
  }
  if (claimed > 0) {
    score += 16;
    notes.push("has claimed on-chain");
  } else if (unclaimed > 0) {
    score += 8;
    notes.push("fees sitting unclaimed");
  } else {
    score -= 8;
    notes.push("no claimed/unclaimed fee book");
  }
  if (claimed >= 100) score += 8;
  else if (claimed >= 10) score += 4;
  if (n >= 5) notes.push("several linked coins");
  else if (n >= 1) notes.push("linked coins found");

  score = Math.max(0, Math.min(100, score));
  const verdict = score >= 75 ? "✅ strong" : score >= 55 ? "⚠️ mixed" : "❌ weak";
  return { score, verdict, notes };
}

function pumpGithubFeeBlock(owner, fee, mentionTokens) {
  const login = owner && owner.login ? owner.login : "";
  const rated = ratePumpGithubFees(owner, fee);
  const coins = (fee && fee.coins) || [];
  const lines = coins.slice(0, 8).map((t, i) => {
    const paid = t.claimed != null ? t.claimed : t.earned;
    return (
      i + 1 + ". <b>" + esc(t.name || "token") +
      (t.symbol ? " (" + esc(t.symbol) + ")" : "") + "</b>\n" +
      "<code>" + esc(t.mint) + "</code>\n" +
      "claimed/paid " + solAmt(paid) +
      (t.unclaimed != null ? " · unclaimed " + solAmt(t.unclaimed) : "") +
      (t.shareBps != null ? " · share " + (Number(t.shareBps) / 100).toFixed(1) + "%" : "") +
      (t.mc ? " · MC " + moneyMkt(t.mc) : "") +
      "\nhttps://pump.fun/coin/" + esc(t.mint)
    );
  });

  const mentionLines = (mentionTokens || []).slice(0, 5).map((t, i) => {
    return (
      i + 1 + ". " + esc(t.name || "token") +
      (t.symbol ? " (" + esc(t.symbol) + ")" : "") +
      " · MC " + moneyMkt(t.mc) +
      "\n<code>" + esc(t.mint) + "</code>"
    );
  });

  return (
    "💸 <b>Pump GitHub fees</b> @" + esc(login) + "\n" +
    "GitHub id " + esc(owner && owner.id != null ? String(owner.id) : "n/a") +
    " · " + (String((owner && owner.type) || "") === "Organization" ? "ORG" : "user") + "\n" +
    (fee && fee.wallet ? "Fee PDA/wallet <code>" + esc(fee.wallet) + "</code>\n" : "") +
    "Claimed " + solAmt(fee && fee.claimed) +
    " · Unclaimed " + solAmt(fee && fee.unclaimed) +
    " · Earned " + solAmt(fee && fee.earned) + "\n" +
    "Tokens in fee book: " + String(coins.length) + "\n" +
    "🧠 <b>Fee rating " + rated.score + "/100</b> " + esc(rated.verdict) + "\n" +
    esc(rated.notes.join(" · ") || "fee APIs") +
    "\n\n<b>Which tokens paid this GitHub</b>\n" +
    (lines.join("\n\n") || "No claimed/paid fee rows found.") +
    (mentionLines.length
      ? "\n\n🔗 <b>Coins that only mention this GitHub</b>\n" +
        mentionLines.join("\n") +
        "\n<i>A mention is not a claim.</i>"
      : "") +
    "\n<i>Claimed = withdrawn from the GitHub social-fee box. Not GitHub stars. Not proof they made the coin.</i>"
  );
}
async function buildGithubReport(owner, repoName) {
  const userRes = await ghGet("/users/" + encodeURIComponent(owner));
  if (!userRes.ok || !userRes.data || !userRes.data.login) {
    const msg =
      userRes.status === 403
        ? "GitHub rate limit. Add GITHUB_TOKEN to raise the cap."
        : userRes.status === 404
        ? "GitHub user/org not found."
        : "GitHub lookup failed (" + userRes.status + ").";
    return "❌ " + msg + "\n<code>" + esc(owner + (repoName ? "/" + repoName : "")) + "</code>" + FOOTER;
  }

  const ownerData = userRes.data;
  const login = ownerData.login;

  const [createdRes, pushedRes, repoRes, langsRes, commitRes] = await Promise.all([
    ghGet("/users/" + encodeURIComponent(login) + "/repos?type=owner&sort=created&direction=desc&per_page=3"),
    ghGet("/users/" + encodeURIComponent(login) + "/repos?type=owner&sort=pushed&direction=desc&per_page=3"),
    repoName
      ? ghGet("/repos/" + encodeURIComponent(login) + "/" + encodeURIComponent(repoName))
      : Promise.resolve({ ok: false, status: 0, data: null }),
    repoName
      ? ghGet("/repos/" + encodeURIComponent(login) + "/" + encodeURIComponent(repoName) + "/languages")
      : Promise.resolve({ ok: false, status: 0, data: null }),
    repoName
      ? ghGet("/repos/" + encodeURIComponent(login) + "/" + encodeURIComponent(repoName) + "/commits?per_page=1")
      : Promise.resolve({ ok: false, status: 0, data: null }),
  ]);

  const createdList = Array.isArray(createdRes.data) ? createdRes.data : [];
  const pushedList = Array.isArray(pushedRes.data) ? pushedRes.data : [];
  const latestCreated = createdList[0] || null;
  const latestPushed = pushedList[0] || null;

  let repo = null;
  if (repoName) {
    if (!repoRes.ok || !repoRes.data || !repoRes.data.full_name) {
      return (
        "❌ GitHub repository not found.\n" +
        "<code>" + esc(login + "/" + repoName) + "</code>\n" +
        "Owner exists: https://github.com/" + encodeURIComponent(login) +
        FOOTER
      );
    }
    repo = repoRes.data;
  }

  const langs = langsRes.ok && langsRes.data && typeof langsRes.data === "object" ? langsRes.data : {};
  const langTotal = Object.values(langs).reduce((s, n) => s + (Number(n) || 0), 0);
  const langLines = Object.entries(langs)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 6)
    .map(([k, v]) => {
      const p = langTotal ? ((Number(v) / langTotal) * 100).toFixed(1) : "0.0";
      return k + " " + p + "%";
    });

  const lastCommit = Array.isArray(commitRes.data) && commitRes.data[0] ? commitRes.data[0] : null;
  const commitWhen = lastCommit && lastCommit.commit && lastCommit.commit.committer
    ? toDate(lastCommit.commit.committer.date)
    : lastCommit && lastCommit.commit && lastCommit.commit.author
    ? toDate(lastCommit.commit.author.date)
    : null;
  const commitMsg =
    lastCommit && lastCommit.commit && lastCommit.commit.message
      ? String(lastCommit.commit.message).split("\n")[0].slice(0, 120)
      : "";
  const commitBy =
    (lastCommit && lastCommit.author && lastCommit.author.login) ||
    (lastCommit && lastCommit.commit && lastCommit.commit.author && lastCommit.commit.author.name) ||
    "";

  const rated = rateGithub(repo || latestCreated, ownerData);
  const topics = repo && Array.isArray(repo.topics) ? repo.topics.slice(0, 8) : [];
  const license =
    (repo && repo.license && (repo.license.spdx_id || repo.license.name)) ||
    "none";

  const header = repo
    ? "👾 <b>GitHub repo</b>\n" +
      "<b>" + esc(repo.full_name) + "</b>" +
      (repo.private ? " · private" : " · public") +
      (repo.fork ? " · fork" : "") +
      (repo.archived ? " · archived" : "") +
      "\n" + repo.html_url
    : "👾 <b>GitHub profile</b>\n" +
      "<b>" + esc(login) + "</b>\n" +
      ownerData.html_url;

  const repoBlock = repo
    ? "\n\n📄 <b>Repository</b>\n" +
      (repo.description ? esc(String(repo.description).slice(0, 240)) + "\n" : "No description.\n") +
      "⭐ Stars " + countHuman(repo.stargazers_count) +
      "  " + starFaces(repo.stargazers_count) +
      "\n🍴 Forks " + countHuman(repo.forks_count) +
      " · 👀 Watchers " + countHuman(repo.subscribers_count != null ? repo.subscribers_count : repo.watchers_count) +
      "\n❗ Open issues " + countHuman(repo.open_issues_count) +
      " · 📦 Size " + countHuman(repo.size) + " KB" +
      "\n💻 Language " + esc(repo.language || "n/a") +
      " · 📜 License " + esc(license) +
      "\n🌿 Default branch " + esc(repo.default_branch || "n/a") +
      "\n🕐 Created " + utc(toDate(repo.created_at)) +
      "\n🕐 Updated " + utc(toDate(repo.updated_at)) +
      "\n🕐 Pushed " + utc(toDate(repo.pushed_at)) +
      (repo.homepage ? "\n🔗 " + esc(repo.homepage) : "") +
      (topics.length ? "\n🏷 " + esc(topics.join(", ")) : "") +
      (langLines.length ? "\n🧬 " + esc(langLines.join(" · ")) : "") +
      (lastCommit
        ? "\n\n📌 <b>Latest commit</b>\n" +
          utc(commitWhen) +
          (commitBy ? " · " + esc(commitBy) : "") +
          (commitMsg ? "\n" + esc(commitMsg) : "")
        : "")
    : "";

      const [feeBook, mentionTokens] = await Promise.all([
    soft(pumpFeeByGithub(ownerData.login, ownerData.id)),
    soft(searchPumpGithubFeeTokens(ownerData.login)),
  ]);

  return (
    header +
    repoBlock +
    "\n\n👤 <b>Owner</b>\n" +
    esc(ownerData.name || login) +
    " · " + esc(ownerData.type || "User") +
    "\n@" + esc(login) +
    (ownerData.bio ? "\n" + esc(String(ownerData.bio).slice(0, 160)) : "") +
    "\n📅 Account created " + utc(toDate(ownerData.created_at)) +
    "\n📂 Public repos created till now: <b>" + countHuman(ownerData.public_repos) + "</b>" +
    "\n👥 Followers " + countHuman(ownerData.followers) +
    " · Following " + countHuman(ownerData.following) +
    (ownerData.company ? "\n🏢 " + esc(ownerData.company) : "") +
    (ownerData.location ? "\n📍 " + esc(ownerData.location) : "") +
    (ownerData.blog ? "\n🔗 " + esc(ownerData.blog) : "") +
    "\n\n🆕 <b>Latest created repo</b>\n" +
    (latestCreated ? ghRepoLine(latestCreated) : "none listed") +
    "\n\n🚀 <b>Latest pushed repo</b>\n" +
    (latestPushed ? ghRepoLine(latestPushed) : "none listed") +
    "\n\n🧠 <b>Rating " + rated.score + "/100</b> " +
    starFaces(repo ? repo.stargazers_count : ownerData.public_repos) +
    " " + esc(rated.verdict) +
    "\n" +
    esc(rated.notes.join(" · ") || "public GitHub metadata") +
       "\n<i>Live GitHub API numbers. Not a source-code clone audit.</i>" +
    "\n\n" +
        pumpGithubFeeBlock(ownerData, feeBook, mentionTokens) +
    FOOTER
  ).slice(0, 4000);
}

/* ───────── x / twitter post scan ───────── */

const xJobs = new Map();
let xSeq = 1;

function rememberX(postId) {
  const id = String(xSeq++);
  xJobs.set(id, { postId: String(postId || ""), at: Date.now() });
  if (xJobs.size > 400) {
    const now = Date.now();
    for (const [k, v] of xJobs) {
      if (now - v.at > 24 * 60 * 60 * 1000) xJobs.delete(k);
    }
  }
  return id;
}

function extractXPost(text) {
  const raw = String(text || "");
  const m = raw.match(
    /(?:https?:\/\/)?(?:www\.)?(?:mobile\.)?(?:twitter\.com|x\.com)\/(?:([A-Za-z0-9_]{1,15})\/status(?:es)?|i\/(?:web\/)?status)\/(\d{5,25})(?:\?[^\s]*)?/i
  );
  if (!m) return null;
  const handle = m[1] && !/^i$/i.test(m[1]) ? m[1] : "";
  return { handle, id: m[2] };
}

function guessXCountry(location) {
  const s = String(location || "").trim();
  if (!s) return "";
  const low = " " + s.toLowerCase().replace(/[._]/g, " ") + " ";
  const pairs = [
    ["united states", "United States"], [" usa ", "United States"], [" u s a ", "United States"],
    ["america", "United States"], ["california", "United States"], ["new york", "United States"],
    ["texas", "United States"], ["florida", "United States"], ["los angeles", "United States"],
    ["united kingdom", "United Kingdom"], [" england ", "United Kingdom"], [" scotland ", "United Kingdom"],
    [" london ", "United Kingdom"], [" uk ", "United Kingdom"], ["britain", "United Kingdom"],
    ["canada", "Canada"], ["toronto", "Canada"], ["vancouver", "Canada"],
    ["australia", "Australia"], ["sydney", "Australia"], ["melbourne", "Australia"],
    ["germany", "Germany"], ["berlin", "Germany"], ["deutschland", "Germany"],
    ["france", "France"], ["paris", "France"],
    ["india", "India"], ["mumbai", "India"], ["delhi", "India"], ["bangalore", "India"],
    ["japan", "Japan"], ["tokyo", "Japan"],
    ["south korea", "South Korea"], ["korea", "South Korea"], ["seoul", "South Korea"],
    ["china", "China"], ["beijing", "China"], ["shanghai", "China"],
    ["singapore", "Singapore"], ["hong kong", "Hong Kong"],
    ["brazil", "Brazil"], ["sao paulo", "Brazil"],
    ["mexico", "Mexico"], ["spain", "Spain"], ["madrid", "Spain"],
    ["italy", "Italy"], ["rome", "Italy"], ["netherlands", "Netherlands"], ["amsterdam", "Netherlands"],
    ["sweden", "Sweden"], ["norway", "Norway"], ["denmark", "Denmark"], ["finland", "Finland"],
    ["poland", "Poland"], ["ukraine", "Ukraine"], ["russia", "Russia"],
    ["uae", "United Arab Emirates"], ["dubai", "United Arab Emirates"], ["abu dhabi", "United Arab Emirates"],
    ["saudi", "Saudi Arabia"], ["turkey", "Turkey"], ["nigeria", "Nigeria"],
    ["south africa", "South Africa"], ["argentina", "Argentina"], ["chile", "Chile"],
    ["indonesia", "Indonesia"], ["philippines", "Philippines"], ["thailand", "Thailand"],
    ["vietnam", "Vietnam"], ["pakistan", "Pakistan"], ["bangladesh", "Bangladesh"],
    ["ireland", "Ireland"], ["portugal", "Portugal"], ["switzerland", "Switzerland"],
    ["austria", "Austria"], ["belgium", "Belgium"], ["new zealand", "New Zealand"],
    ["israel", "Israel"], ["egypt", "Egypt"], ["colombia", "Colombia"],
  ];
  for (const [needle, country] of pairs) {
    if (low.includes(needle)) return country;
  }
  return "";
}

function rateXAccount({
  followers,
  following,
  tweets,
  listed,
  createdAt,
  verified,
  verifiedType,
  protectedAcc,
  likes,
  views,
  location,
  country,
}) {
  let score = 42;
  const notes = [];
  const fol = Number(followers) || 0;
  const fing = Number(following) || 0;
  const tw = Number(tweets) || 0;
  const lis = Number(listed) || 0;
  const likeN = Number(likes) || 0;
  const viewN = Number(views) || 0;
  const ageMs = createdAt ? Date.now() - createdAt.getTime() : 0;
  const ageDays = ageMs > 0 ? ageMs / 86400000 : 0;

  if (verified) {
    score += verifiedType && String(verifiedType).toLowerCase() === "government" ? 16 : 12;
    notes.push(verifiedType ? "verified " + String(verifiedType) : "verified");
  }
  if (protectedAcc) {
    score -= 8;
    notes.push("protected account");
  }
  if (fol >= 1000000) {
    score += 22;
    notes.push("mega following");
  } else if (fol >= 100000) {
    score += 16;
    notes.push("large following");
  } else if (fol >= 10000) {
    score += 12;
    notes.push("solid following");
  } else if (fol >= 1000) {
    score += 6;
    notes.push("some following");
  } else if (fol < 50) {
    score -= 8;
    notes.push("tiny following");
  }
  if (fing > 0 && fol > 0 && fing / fol >= 8 && fol < 5000) {
    score -= 10;
    notes.push("follows far more than followers");
  } else if (fol >= 500 && fing > 0 && fol / fing >= 20) {
    score += 4;
    notes.push("strong follow ratio");
  }
  if (ageDays >= 365 * 5) {
    score += 8;
    notes.push("account 5y+");
  } else if (ageDays >= 365) {
    score += 5;
    notes.push("account 1y+");
  } else if (ageDays > 0 && ageDays < 14) {
    score -= 14;
    notes.push("brand new account");
  } else if (ageDays > 0 && ageDays < 90) {
    score -= 6;
    notes.push("young account");
  }
  if (tw >= 10000) score += 3;
  else if (tw < 5 && ageDays > 30) {
    score -= 4;
    notes.push("almost no posts");
  }
  if (lis >= 100) score += 4;
  if (country) {
    score += 3;
    notes.push("country tagged");
  } else if (location) {
    score += 2;
    notes.push("has location");
  } else {
    notes.push("no location set");
  }
  if (fol > 0 && likeN / fol >= 0.05) {
    score += 6;
    notes.push("strong post engagement");
  } else if (fol >= 1000 && likeN / fol < 0.001 && likeN < 10) {
    score -= 4;
    notes.push("weak post engagement");
  }
  if (viewN >= 100000) {
    score += 4;
    notes.push("high views on this post");
  }

  score = Math.max(0, Math.min(100, score));
  let verdict = "❌ weak";
  if (score >= 75) verdict = "✅ strong";
  else if (score >= 55) verdict = "⚠️ mixed";
  return { score, verdict, notes };
}

function xEmbedToken(id) {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

function stripHtml(s) {
  return String(s || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

async function xSyndication(id) {
  const token = xEmbedToken(id);
  const urls = [
    "https://cdn.syndication.twimg.com/tweet-result?id=" +
      encodeURIComponent(id) +
      "&lang=en&token=" +
      encodeURIComponent(token),
    "https://cdn.syndication.twimg.com/tweet-result?id=" + encodeURIComponent(id) + "&lang=en",
  ];
  for (const u of urls) {
    const r = await jget(u);
    if (r.ok && r.data && (r.data.text || r.data.id_str || r.data.user)) return r.data;
  }
  return null;
}

async function xOembed(id) {
  const r = await jget(
    "https://publish.twitter.com/oembed?omit_script=true&url=" +
      encodeURIComponent("https://x.com/i/status/" + id)
  );
  return r.ok && r.data ? r.data : null;
}

function buildXEmbedReport(id, syn, oembed, linkHandle) {
  const user = (syn && syn.user) || {};
  const handleFromSyn = user.screen_name || "";
  const handleFromOembed =
    (oembed && oembed.author_url && String(oembed.author_url).split("/").pop()) || "";
  const handle = handleFromSyn || handleFromOembed || linkHandle || "";
  const name = user.name || (oembed && oembed.author_name) || "";
  const text =
    (syn && syn.text) ||
    stripHtml(oembed && oembed.html) ||
    "";
  const posted = toDate((syn && syn.created_at) || null);
  const likes = syn && (syn.favorite_count ?? syn.likes);
  const replies = syn && (syn.conversation_count ?? syn.reply_count);
  const quotes = syn && syn.quote_count;
  const verified = !!(user.verified || user.is_blue_verified);
  const postUrl = handle
    ? "https://x.com/" + handle + "/status/" + id
    : "https://x.com/i/status/" + id;
  const location = String(user.location || "").trim();
  const country = guessXCountry(location);
  const created = toDate(user.created_at);
  const rated = rateXAccount({
    followers: user.followers_count,
    following: user.friends_count || user.following_count,
    tweets: user.statuses_count,
    listed: user.listed_count,
    createdAt: created,
    verified,
    verifiedType: "",
    protectedAcc: !!user.protected,
    likes,
    views: null,
    location,
    country,
  });

  let handleLine = handle ? "@" + esc(handle) : "unknown user";
  if (linkHandle && handle && norm(linkHandle) !== norm(handle)) {
    handleLine +=
      "\n⚠️ Link handle was @" +
      esc(linkHandle) +
      " · current @" +
      esc(handle) +
      " (possible username change)";
  } else if (handleFromSyn && handleFromOembed && norm(handleFromSyn) !== norm(handleFromOembed)) {
    handleLine +=
      "\n⚠️ Handles differ: @" +
      esc(handleFromSyn) +
      " vs @" +
      esc(handleFromOembed) +
      " (possible rename)";
  }

  return (
    "🐦 <b>X post scan</b>\n" +
    "<b>" +
    handleLine +
    "</b>" +
    (name ? " · " + esc(name) : "") +
    (verified ? " · ✅ verified" : "") +
    "\n" +
    postUrl +
    "\n\n📄 <b>Post</b>\n" +
    "🕐 " +
    utc(posted) +
    (syn && syn.lang ? " · lang " + esc(syn.lang) : "") +
    "\n❤️ Likes " +
    countHuman(likes) +
    (replies != null ? " · 💬 Replies " + countHuman(replies) : "") +
    (quotes != null ? " · 💬 Quotes " + countHuman(quotes) : "") +
    "\n" +
    esc(String(text || "").slice(0, 280) || "no text") +
    "\n\n👤 <b>Account</b>\n" +
    (handle ? "Username: @" + esc(handle) + "\n" : "Username: n/a\n") +
    (user.followers_count != null
      ? "Followers " +
        countHuman(user.followers_count) +
        " · Following " +
        countHuman(user.friends_count || user.following_count) +
        "\n"
      : "") +
    (created ? "📅 Account created " + utc(created) + "\n" : "") +
    "📍 Location " +
    (location ? esc(location) : "not set") +
    "\n🌍 Country " +
    (country ? esc(country) : "unknown") +
    (user.description ? "\n" + esc(String(user.description).slice(0, 160)) : "") +
    "\n\n🧠 <b>Account rating " +
    rated.score +
    "/100</b> " +
    esc(rated.verdict) +
    "\n" +
    esc(rated.notes.join(" · ") || "public embed metadata") +
    "\n<i>Loaded from X public embed. Full history of username changes is not exposed by public X APIs.</i>" +
    FOOTER
  ).slice(0, 4000);
}

async function buildXReport(postId, linkHandle) {
  const id = String(postId || "").trim();
  if (!/^\d{5,25}$/.test(id)) {
    return "Usage: /x https://x.com/user/status/ID" + FOOTER;
  }

  if (!X_BEARER) {
    const [syn, oembed] = await Promise.all([soft(xSyndication(id)), soft(xOembed(id))]);
    if ((syn && (syn.text || syn.user)) || (oembed && (oembed.html || oembed.author_name))) {
      return buildXEmbedReport(id, syn, oembed, linkHandle);
    }
    return (
      "🐦 <b>X post scan</b>\n" +
      "https://x.com/i/status/" +
      esc(id) +
      "\n\nCould not load the public embed for this post." +
      FOOTER
    );
  }

  const qs =
    "tweet.fields=" +
    encodeURIComponent(
      "created_at,public_metrics,author_id,lang,source,possibly_sensitive,referenced_tweets,geo,conversation_id,text"
    ) +
    "&expansions=" +
    encodeURIComponent("author_id,attachments.media_keys,geo.place_id") +
    "&user.fields=" +
    encodeURIComponent(
      "username,name,description,location,public_metrics,created_at,verified,verified_type,protected,url"
    ) +
    "&place.fields=" +
    encodeURIComponent("full_name,country,country_code,place_type,name") +
    "&media.fields=" +
    encodeURIComponent("type,url,preview_image_url,public_metrics");

  const r = await xApi("/2/tweets/" + encodeURIComponent(id) + "?" + qs);

  if (!r.ok || !r.data || !r.data.data) {
    const [syn, oembed] = await Promise.all([soft(xSyndication(id)), soft(xOembed(id))]);
    if ((syn && (syn.text || syn.user)) || (oembed && (oembed.html || oembed.author_name))) {
      return buildXEmbedReport(id, syn, oembed, linkHandle);
    }
    const title = r.data && r.data.title ? String(r.data.title) : "";
    const detail = r.data && r.data.detail ? String(r.data.detail) : "";
    const msg =
      r.status === 401 || r.status === 403
        ? "X API denied this token (" + r.status + "). Check X_BEARER / product access."
        : r.status === 404
        ? "Post not found, deleted, or private."
        : r.status === 429
        ? "X API rate limit. Try again in a minute."
        : "X lookup failed (" + r.status + ")" + (title ? " · " + title : "") + (detail ? " · " + detail : "");
    return "❌ " + esc(msg) + "\nhttps://x.com/i/status/" + esc(id) + FOOTER;
  }

  const tweet = r.data.data;
  const users = (r.data.includes && r.data.includes.users) || [];
  const places = (r.data.includes && r.data.includes.places) || [];
  const media = (r.data.includes && r.data.includes.media) || [];
  const author = users.find((u) => String(u.id) === String(tweet.author_id)) || users[0] || {};
  const place = places[0] || {};
  const metrics = tweet.public_metrics || {};
  const um = author.public_metrics || {};

  const likes = metrics.like_count;
  const reposts = metrics.retweet_count;
  const replies = metrics.reply_count;
  const quotes = metrics.quote_count;
  const bookmarks = metrics.bookmark_count;
  const views = metrics.impression_count;
  const videoViews = media
    .map((m) => Number(m && m.public_metrics && m.public_metrics.view_count))
    .filter((n) => Number.isFinite(n) && n >= 0);
  const mediaViews = videoViews.length ? videoViews.reduce((a, b) => a + b, 0) : null;

  const followers = um.followers_count;
  const following = um.following_count;
  const tweetsN = um.tweet_count;
  const listed = um.listed_count;
  const location = String(author.location || "").trim();
  const country = String(place.country || "").trim() || guessXCountry(location);
  const created = toDate(author.created_at);
  const posted = toDate(tweet.created_at);
  const verified = !!(author.verified || (author.verified_type && author.verified_type !== "none"));
  const refs = Array.isArray(tweet.referenced_tweets) ? tweet.referenced_tweets : [];
  const kind = refs.some((x) => x.type === "retweeted")
    ? "repost"
    : refs.some((x) => x.type === "quoted")
    ? "quote"
    : refs.some((x) => x.type === "replied_to")
    ? "reply"
    : "original";

  const rated = rateXAccount({
    followers,
    following,
    tweets: tweetsN,
    listed,
    createdAt: created,
    verified,
    verifiedType: author.verified_type || "",
    protectedAcc: !!author.protected,
    likes,
    views,
    location,
    country,
  });

  const handle = author.username || "";
  const postUrl = handle
    ? "https://x.com/" + handle + "/status/" + id
    : "https://x.com/i/status/" + id;

  let usernameBlock = handle ? "Username: @" + esc(handle) : "Username: n/a";
  if (linkHandle && handle && norm(linkHandle) !== norm(handle)) {
    usernameBlock +=
      "\n⚠️ Link had @" +
      esc(linkHandle) +
      " · live account is @" +
      esc(handle) +
      " (username may have changed)";
  }

  return (
    "🐦 <b>X post scan</b>\n" +
    (handle ? "<b>@" + esc(handle) + "</b>" : "<b>unknown user</b>") +
    (author.name ? " · " + esc(author.name) : "") +
    (verified ? " · ✅ verified" : "") +
    (author.protected ? " · 🔒 protected" : "") +
    "\n" +
    postUrl +
    "\n\n📄 <b>Post</b>\n" +
    "Type " +
    esc(kind) +
    " · 🕐 " +
    utc(posted) +
    (tweet.lang ? " · lang " + esc(tweet.lang) : "") +
    "\n❤️ Likes " +
    countHuman(likes) +
    " · 🔁 Reposts " +
    countHuman(reposts) +
    "\n💬 Replies " +
    countHuman(replies) +
    " · 💬 Quotes " +
    countHuman(quotes) +
    "\n🔖 Bookmarks " +
    countHuman(bookmarks) +
    "\n👀 Views " +
    (views == null ? "n/a" : countHuman(views)) +
    (mediaViews != null ? " · 🎬 Media views " + countHuman(mediaViews) : "") +
    "\n" +
    esc(String(tweet.text || "").slice(0, 280) || "no text") +
    "\n\n👤 <b>Account</b>\n" +
    usernameBlock +
    "\nFollowers " +
    countHuman(followers) +
    " · Following " +
    countHuman(following) +
    "\nPosts " +
    countHuman(tweetsN) +
    " · Listed " +
    countHuman(listed) +
    "\n📅 Account created " +
    utc(created) +
    "\n📍 Location " +
    (location ? esc(location) : "not set") +
    "\n🌍 Country " +
    (country ? esc(country) : "unknown") +
    (place.full_name ? "\n📌 Post geo " + esc(place.full_name) : "") +
    (author.description ? "\n" + esc(String(author.description).slice(0, 160)) : "") +
    "\n\n🧠 <b>Account rating " +
    rated.score +
    "/100</b> " +
    esc(rated.verdict) +
    "\n" +
    esc(rated.notes.join(" · ") || "public X metadata") +
    "\n<i>Location/country is profile text or geotag. Full username-change history is not available on standard X API.</i>" +
    FOOTER
  ).slice(0, 4000);
}

/* ───────── telegram ───────── */

const kb = (ca) =>
  new InlineKeyboard()
    .text("🔄 Refresh", "ref:" + ca)
    .text("🧛 Vamp", "vamp:" + ca)
    .text("📦 Bundle", "bundle:" + ca)
    .row()
    .text("👨‍💻 Dev", "dev:" + ca)
    .text("📣 Callouts", "callouts:" + ca)
    .text("📈 Stonks", "sf:" + ca)
    .row()
    .text("🗑 Delete", "del");

const kbRh = (ca) =>
  new InlineKeyboard()
    .text("🔄 Refresh", "rhref:" + ca)
    .text("🧛 Vamp", "rhvamp:" + ca)
    .text("📦 Bundle", "rhbundle:" + ca)
    .row()
    .text("👨‍💻 Dev", "rhdev:" + ca)
    .text("👛 Holders", "rhhold:" + ca)
    .text("🧠 Lore", "rhlore:" + ca)
    .row()
    .text("📈 Stonks", "rhsf:" + ca)
    .text("🗑 Delete", "del");

const kbArc = (ca) =>
  new InlineKeyboard()
    .text("🔄 Refresh", "arcref:" + ca)
    .text("🧛 Vamp", "arcvamp:" + ca)
    .text("📦 Bundle", "arcbundle:" + ca)
    .row()
    .text("👨‍💻 Dev", "arcdev:" + ca)
    .text("👛 Holders", "archold:" + ca)
    .text("🧠 Lore", "arclore:" + ca)
    .row()
    .text("🗑 Delete", "del");

const kbGh = (id) =>
  new InlineKeyboard()
    .text("🔄 Refresh", "ghref:" + id)
    .text("💸 Fees", "ghfees:" + id)
    .text("🗑 Delete", "del");

const kbX = (id) =>
  new InlineKeyboard()
    .text("🔄 Refresh", "xref:" + id)
    .text("🗑 Delete", "del");

const kbWallet = (ca) =>
  new InlineKeyboard()
    .text("🔄 Refresh", "wref:" + ca)
    .text("🗑 Delete", "del");

const kbSf = (ca) =>
  new InlineKeyboard()
    .text("🔄 Refresh", (isEvmCa(ca) ? "rhsf:" : "sf:") + ca)
    .text("🗑 Delete", "del");

const WELCOME =
  "✨ <b>Welcome to VEXLORE</b> ✨\n" +
  "Cute scanner. Clean calls. Fast reads.\n\n" +
  "🪄 <b>Easy start</b>\n" +
  "Just paste a CA, 0x, wallet, GitHub, or X link.\n" +
  "No command needed.\n\n" +
  "🟣 <b>Solana</b>\n" +
  "• paste CA → full scan\n" +
  "• /vamp CA → OG vs copy\n" +
  "• /bundle CA → bundles\n" +
  "• /cluster CA → clusters\n" +
  "• /dev CA → dev book\n" +
  "• /callouts CA → Pump.fun comments\n" +
  "• /wallet name.sol → wallet analyser\n" +
  "• /stonks CA → pad check\n" +
  "• /lb → group leaderboard\n" +
  "• /pnl CA → PnL card\n\n" +
  "🟠 <b>Other chains</b>\n" +
  "Paste a 0x and I auto-detect.\n" +
  "Or pick one:\n" +
  "/rh  ·  /arc  ·  /eth  ·  /bnb  ·  /base  ·  /hype\n\n" +
  "💕 <b>Links</b>\n" +
  "🤖 Bot: <a href=\"https://t.me/VexloreBOT\">t.me/VexloreBOT</a>\n" +
  "🛟 Support: <a href=\"https://t.me/vexloresupport\">t.me/vexloresupport</a>\n" +
  "🏠 Community: <a href=\"https://t.me/VEXLORECOMM\">t.me/VEXLORECOMM</a>\n" +
  "🐦 X: <a href=\"https://x.com/Vexlorebot\">@Vexlorebot</a>\n" +
  "🌐 Web: <a href=\"https://vexlore.xyz\">vexlore.xyz</a>\n\n" +
  "❤️ Made by Robin with Love";

bot.command("start", (ctx) =>
  ctx.reply(WELCOME, { parse_mode: "HTML" })
);

bot.command("welcome", (ctx) =>
  ctx.reply(WELCOME, { parse_mode: "HTML" })
);

/* ───────── NEW COMMANDS: /lb and /pnl ───────── */

bot.command("lb", async (ctx) => {
  touchGroup(ctx.chat);
  const period = "1w";
  const text = buildLeaderboard(ctx.chat, period);
  await ctx.reply(text, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: lbKeyboard(period),
  });
});

bot.command("pnl", async (ctx) => {
  const ca = extractCa(ctx.match || ctx.message.text);
  if (!isCa(ca) || isEvmCa(ca)) {
    return ctx.reply("Usage: /pnl CA   (Solana only)");
  }
  touchGroup(ctx.chat);
  try {
    const card = await buildPnlCard(ctx.chat.id, ca, ctx.from && ctx.from.id);
    if (card.error) {
      return ctx.reply(card.error, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });
    }
    const sent = await ctx.replyWithPhoto(new InputFile(card.buffer, "vexlore-pnl.png"), {
      reply_markup: pnlKeyboard(ca),
    });
    rememberOwner(ctx.chat.id, sent.message_id, ctx.from && ctx.from.id);
  } catch (e) {
    await ctx.reply(
      "PnL card image failed: " +
        (e && e.message ? e.message : "install @napi-rs/canvas") +
        FOOTER
    );
  }
});

bot.on("my_chat_member", async (ctx) => {
  const upd = ctx.myChatMember;
  if (!upd) return;

  const oldStatus = upd.old_chat_member && upd.old_chat_member.status;
  const neu = upd.new_chat_member;
  const newStatus = neu && neu.status;
  const chat = upd.chat;

  if (!chat || (chat.type !== "group" && chat.type !== "supergroup" && chat.type !== "channel")) return;
  if (newStatus === "left" || newStatus === "kicked") {
    dropGroup(chat);
    return;
  }

  if (isGroupChat(chat)) touchGroup(chat);

  const justAdded =
    oldStatus === "left" ||
    oldStatus === "kicked" ||
    !oldStatus;

  const canSend =
    newStatus === "administrator" ||
    (newStatus === "member" && chat.type !== "channel");

  if (justAdded || newStatus === "restricted" || (newStatus === "member" && chat.type === "channel")) {
    try {
      await ctx.api.sendMessage(
        chat.id,
        "👋 <b>VEXLORE</b> was added.\n\n" +
          "Please make me <b>admin</b> with permission to <b>send messages</b> so I can post scans and alerts.",
        { parse_mode: "HTML" }
      );
    } catch (_) {}
  }

  if (newStatus === "administrator" && justAdded && canSend) {
    try {
      await ctx.api.sendMessage(chat.id, WELCOME, { parse_mode: "HTML" });
    } catch (_) {}
  }
});
async function replyArcScan(ctx, ca, loading) {
  const msg = await ctx.reply(loading);
  rememberOwner(ctx.chat.id, msg.message_id, ctx.from && ctx.from.id);
  try {
    const text = await buildArcReport(ca);
    await finishScanMessage(ctx, msg, text, kbArc(ca), ca);
  } catch (e) {
    await ctx.api.editMessageText(ctx.chat.id, msg.message_id, "Arc error: " + (e.message || "fail"));
  }
}
async function replyRhScan(ctx, ca, loading) {
  const msg = await ctx.reply(loading);
  rememberOwner(ctx.chat.id, msg.message_id, ctx.from && ctx.from.id);
  try {
    const text = await buildRhReport(ca);
    await finishScanMessage(ctx, msg, text, kbRh(ca), ca);
  } catch (e) {
    await ctx.api.editMessageText(ctx.chat.id, msg.message_id, "RH error: " + (e.message || "fail"));
  }
}

async function replyGithubScan(ctx, owner, repo, loading) {
  const id = rememberGh(owner, repo);
  const msg = await ctx.reply(loading);
  rememberOwner(ctx.chat.id, msg.message_id, ctx.from && ctx.from.id);
  try {
    const text = await buildGithubReport(owner, repo);
    await ctx.api.editMessageText(ctx.chat.id, msg.message_id, text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: kbGh(id),
    });
  } catch (e) {
    await ctx.api.editMessageText(ctx.chat.id, msg.message_id, "GitHub error: " + (e.message || "fail"));
  }
}

async function replyXScan(ctx, postId, loading, linkHandle) {
  const id = rememberX(postId);
  const msg = await ctx.reply(loading);
  rememberOwner(ctx.chat.id, msg.message_id, ctx.from && ctx.from.id);
  try {
    const text = await buildXReport(postId, linkHandle);
    await ctx.api.editMessageText(ctx.chat.id, msg.message_id, text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: kbX(id),
    });
  } catch (e) {
    await ctx.api.editMessageText(ctx.chat.id, msg.message_id, "X error: " + (e.message || "fail"));
  }
}

async function replyWalletScan(ctx, ca, loading, domain) {
  const msg = await ctx.reply(loading);
  rememberOwner(ctx.chat.id, msg.message_id, ctx.from && ctx.from.id);
  try {
    const text = await buildWallet(ca, domain);
    await ctx.api.editMessageText(ctx.chat.id, msg.message_id, text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: kbWallet(ca),
    });
  } catch (e) {
    await ctx.api.editMessageText(ctx.chat.id, msg.message_id, "Error: " + (e.message || "fail"));
  }
}

async function replyStonksScan(ctx, ca, loading) {
  const msg = await ctx.reply(loading);
  rememberOwner(ctx.chat.id, msg.message_id, ctx.from && ctx.from.id);
  try {
    const text = await buildStonks(ca);
    await finishScanMessage(ctx, msg, text, isEvmCa(ca) ? kbRh(ca) : kb(ca), ca);
  } catch (e) {
    await ctx.api.editMessageText(ctx.chat.id, msg.message_id, "Stonks error: " + (e.message || "fail"));
  }
}

bot.command("rh", async (ctx) => {
  const ca = extractEvmCa(ctx.match || ctx.message.text);
  if (!isEvmCa(ca)) return ctx.reply("Usage: /rh 0x…  (Robinhood Chain only)");
  touchGroup(ctx.chat);
  await replyRhScan(ctx, ca, "🏦 Scanning Robinhood Chain...");
});

bot.command("arc", async (ctx) => {
  const ca = extractEvmCa(ctx.match || ctx.message.text);
  if (!isEvmCa(ca)) return ctx.reply("Usage: /arc 0x…  (Arc chain only, id 5042)");
  touchGroup(ctx.chat);
  await replyArcScan(ctx, ca, "🟠 Scanning Arc...");
});

bot.command("vamp", async (ctx) => {
  const hit = extractAnyCa(ctx.match || ctx.message.text);
  if (hit.chain === "rh") {
        if ((await detectEvmChain(hit.ca)) === "arc") {
      touchGroup(ctx.chat);
      const msg = await ctx.reply("🧛 Arc vamp check...");
      rememberOwner(ctx.chat.id, msg.message_id, ctx.from && ctx.from.id);
      try {
        const text = await buildArcVamp(hit.ca);
        await finishScanMessage(ctx, msg, text, kbArc(hit.ca), hit.ca);
      } catch (e) {
        await ctx.api.editMessageText(ctx.chat.id, msg.message_id, "Error: " + (e.message || "fail"));
      }
      return;
    }
    touchGroup(ctx.chat);
    const msg = await ctx.reply("🧛 RH vamp check...");
    rememberOwner(ctx.chat.id, msg.message_id, ctx.from && ctx.from.id);
    try {
      const text = await buildRhVamp(hit.ca);
      await finishScanMessage(ctx, msg, text, kbRh(hit.ca), hit.ca);
    } catch (e) {
      await ctx.api.editMessageText(ctx.chat.id, msg.message_id, "Error: " + (e.message || "fail"));
    }
    return;
  }
  const ca = hit.ca;
  if (!isCa(ca)) return ctx.reply("Usage: /vamp CA");
  touchGroup(ctx.chat);
  recordCall(ctx, ca).catch(() => {});
  const msg = await ctx.reply("🧛 Checking OG vs vamp...");
  rememberOwner(ctx.chat.id, msg.message_id, ctx.from && ctx.from.id);
  try {
    const text = await buildVamp(ca);
    await finishScanMessage(ctx, msg, text, kb(ca), ca);
  } catch (e) {
    await ctx.api.editMessageText(ctx.chat.id, msg.message_id, "Error: " + (e.message || "fail"));
  }
});

bot.command("bundle", async (ctx) => {
  const hit = extractAnyCa(ctx.match || ctx.message.text);
    if (hit.chain === "rh") {
    if ((await detectEvmChain(hit.ca)) === "arc") {
      touchGroup(ctx.chat);
      const msg = await ctx.reply("📦 Arc launch clusters...");
      rememberOwner(ctx.chat.id, msg.message_id, ctx.from && ctx.from.id);
      try {
        const text = await buildArcBundle(hit.ca);
        await finishScanMessage(ctx, msg, text, kbArc(hit.ca), hit.ca);
      } catch (e) {
        await ctx.api.editMessageText(ctx.chat.id, msg.message_id, "Error: " + (e.message || "fail"));
      }
      return;
    }
    touchGroup(ctx.chat);
    const msg = await ctx.reply("📦 RH launch clusters...");
    rememberOwner(ctx.chat.id, msg.message_id, ctx.from && ctx.from.id);
    try {
      const text = await buildRhBundle(hit.ca);
      await finishScanMessage(ctx, msg, text, kbRh(hit.ca), hit.ca);
    } catch (e) {
      await ctx.api.editMessageText(ctx.chat.id, msg.message_id, "Error: " + (e.message || "fail"));
    }
    return;
  }
  const ca = hit.ca;
  if (!isCa(ca)) return ctx.reply("Usage: /bundle CA");
  touchGroup(ctx.chat);
  recordCall(ctx, ca).catch(() => {});
  const msg = await ctx.reply("📦 Checking live bundles...");
  rememberOwner(ctx.chat.id, msg.message_id, ctx.from && ctx.from.id);
  try {
    const text = await buildBundle(ca);
    await finishScanMessage(ctx, msg, text, kb(ca), ca);
  } catch (e) {
    await ctx.api.editMessageText(ctx.chat.id, msg.message_id, "Error: " + (e.message || "fail"));
  }
});

bot.command("callouts", async (ctx) => {
  const hit = extractAnyCa(ctx.match || ctx.message.text);
  if (hit.chain === "rh") {
    return ctx.reply("📣 Callouts are Pump.fun / Solana only.\nUsage: /callouts CA");
  }
  const ca = hit.ca;
  if (!isCa(ca)) return ctx.reply("Usage: /callouts CA");
  touchGroup(ctx.chat);
  recordCall(ctx, ca).catch(() => {});
  const msg = await ctx.reply("📣 Loading Pump.fun callouts...");
  rememberOwner(ctx.chat.id, msg.message_id, ctx.from && ctx.from.id);
  try {
    const text = await buildCallouts(ca);
    await finishScanMessage(ctx, msg, text, kb(ca), ca);
  } catch (e) {
    await ctx.api.editMessageText(ctx.chat.id, msg.message_id, "Error: " + (e.message || "fail"));
  }
});

bot.command("holders", async (ctx) => {
  const hit = extractAnyCa(ctx.match || ctx.message.text);
  if (hit.chain !== "rh") return ctx.reply("Usage: /holders 0x…  (Robinhood or Arc)");
  const evmChain = await detectEvmChain(hit.ca);
  if (evmChain === "arc") {
    touchGroup(ctx.chat);
    const msg = await ctx.reply("👛 Arc holders...");
    rememberOwner(ctx.chat.id, msg.message_id, ctx.from && ctx.from.id);
    try {
      const text = await buildArcHolders(hit.ca);
      await finishScanMessage(ctx, msg, text, kbArc(hit.ca), hit.ca);
    } catch (e) {
      await ctx.api.editMessageText(ctx.chat.id, msg.message_id, "Error: " + (e.message || "fail"));
    }
    return;
  }
  touchGroup(ctx.chat);
  const msg = await ctx.reply("👛 RH holders...");
  rememberOwner(ctx.chat.id, msg.message_id, ctx.from && ctx.from.id);
  try {
    const text = await buildRhHolders(hit.ca);
    await finishScanMessage(ctx, msg, text, kbRh(hit.ca), hit.ca);
  } catch (e) {
    await ctx.api.editMessageText(ctx.chat.id, msg.message_id, "Error: " + (e.message || "fail"));
  }
});

bot.command("lore", async (ctx) => {
  const hit = extractAnyCa(ctx.match || ctx.message.text);
  if (hit.chain !== "rh") return ctx.reply("Usage: /lore 0x…  (Robinhood or Arc)");
  const evmChain = await detectEvmChain(hit.ca);
  if (evmChain === "arc") {
    touchGroup(ctx.chat);
    const msg = await ctx.reply("🧠 Arc lore...");
    rememberOwner(ctx.chat.id, msg.message_id, ctx.from && ctx.from.id);
    try {
      const text = await buildArcLore(hit.ca);
      await finishScanMessage(ctx, msg, text, kbArc(hit.ca), hit.ca);
    } catch (e) {
      await ctx.api.editMessageText(ctx.chat.id, msg.message_id, "Error: " + (e.message || "fail"));
    }
    return;
  }
  touchGroup(ctx.chat);
  const msg = await ctx.reply("🧠 RH lore...");
  rememberOwner(ctx.chat.id, msg.message_id, ctx.from && ctx.from.id);
  try {
    const text = await buildRhLore(hit.ca);
    await finishScanMessage(ctx, msg, text, kbRh(hit.ca), hit.ca);
  } catch (e) {
    await ctx.api.editMessageText(ctx.chat.id, msg.message_id, "Error: " + (e.message || "fail"));
  }
});

bot.command("dev", async (ctx) => {
  const hit = extractAnyCa(ctx.match || ctx.message.text);
  if (hit.chain === "rh") { 
       if ((await detectEvmChain(hit.ca)) === "arc") {
      touchGroup(ctx.chat);
      const msg = await ctx.reply("👨‍💻 Arc dev...");
      rememberOwner(ctx.chat.id, msg.message_id, ctx.from && ctx.from.id);
      try {
        const text = await buildArcDev(hit.ca);
        await finishScanMessage(ctx, msg, text, kbArc(hit.ca), hit.ca);
      } catch (e) {
        await ctx.api.editMessageText(ctx.chat.id, msg.message_id, "Error: " + (e.message || "fail"));
      }
      return;
    }
    touchGroup(ctx.chat);
    const msg = await ctx.reply("👨‍💻 RH dev...");
    rememberOwner(ctx.chat.id, msg.message_id, ctx.from && ctx.from.id);
    try {
      const text = await buildRhDev(hit.ca);
      await finishScanMessage(ctx, msg, text, kbRh(hit.ca), hit.ca);
    } catch (e) {
      await ctx.api.editMessageText(ctx.chat.id, msg.message_id, "Error: " + (e.message || "fail"));
    }
    return;
  }
  const ca = hit.ca;
  if (!isCa(ca)) return ctx.reply("Usage: /dev CA");
  touchGroup(ctx.chat);
  const msg = await ctx.reply("👨‍💻 Dev history...");
  rememberOwner(ctx.chat.id, msg.message_id, ctx.from && ctx.from.id);
  try {
    const text = await buildDev(ca);
    await finishScanMessage(ctx, msg, text, kb(ca), ca);
  } catch (e) {
    await ctx.api.editMessageText(ctx.chat.id, msg.message_id, "Error: " + (e.message || "fail"));
  }
});

bot.command("wallet", async (ctx) => {
  const raw = ctx.match || ctx.message.text;
  const hit = extractAnyCa(raw);
  if (hit.chain === "rh") return ctx.reply("👛 Wallet Behaviour Analyser is Solana only.\nUsage: /wallet SOLANA_WALLET or name.sns / name.sol");
  if (hit.ca && isCa(hit.ca)) {
    touchGroup(ctx.chat);
    await replyWalletScan(ctx, hit.ca, "👛 Wallet Behaviour Analyser...");
    return;
  }
  const domain = extractSnsName(raw);
  if (!domain) return ctx.reply("Usage: /wallet SOLANA_WALLET   or   name.sns   or   name.sol");
  touchGroup(ctx.chat);
  const resolved = await resolveSnsDomain(domain);
  if (!resolved) return ctx.reply("❌ Could not resolve " + domain + " to a Solana wallet.");
  await replyWalletScan(ctx, resolved, "👛 Resolving " + domain + "...", domain);
});

bot.command("stonks", async (ctx) => {
  const link = extractStonksLink(ctx.match || ctx.message.text);
  const hit = link || extractAnyCa(ctx.match || ctx.message.text);
  if (!hit.ca) return ctx.reply("Usage: /stonks CA   or   /stonks https://www.stonkfun.xyz/token/MINT");
  touchGroup(ctx.chat);
  await replyStonksScan(ctx, hit.ca, "📈 Checking StonkFun / stonks.fun...");
});

bot.command("stonkfun", async (ctx) => {
  const link = extractStonksLink(ctx.match || ctx.message.text);
  const hit = link || extractAnyCa(ctx.match || ctx.message.text);
  if (!hit.ca) return ctx.reply("Usage: /stonkfun CA");
  touchGroup(ctx.chat);
  await replyStonksScan(ctx, hit.ca, "📈 Checking StonkFun / stonks.fun...");
});

bot.command("git", async (ctx) => {
  const hit = extractGithub(ctx.match || ctx.message.text);
  if (!hit || !hit.owner) return ctx.reply("Usage: /git owner/repo   or   /git https://github.com/owner/repo");
  touchGroup(ctx.chat);
  await replyGithubScan(ctx, hit.owner, hit.repo, "👾 Scanning GitHub...");
});

bot.command("github", async (ctx) => {
  const hit = extractGithub(ctx.match || ctx.message.text);
  if (!hit || !hit.owner) return ctx.reply("Usage: /github owner/repo   or   /github https://github.com/owner/repo");
  touchGroup(ctx.chat);
  await replyGithubScan(ctx, hit.owner, hit.repo, "👾 Scanning GitHub...");
});

bot.command("x", async (ctx) => {
  const hit = extractXPost(ctx.match || ctx.message.text);
  if (!hit || !hit.id) return ctx.reply("Usage: /x https://x.com/user/status/ID");
  touchGroup(ctx.chat);
  await replyXScan(ctx, hit.id, "🐦 Scanning X post...", hit.handle);
});

bot.command("tweet", async (ctx) => {
  const hit = extractXPost(ctx.match || ctx.message.text);
  if (!hit || !hit.id) return ctx.reply("Usage: /tweet https://x.com/user/status/ID");
  touchGroup(ctx.chat);
  await replyXScan(ctx, hit.id, "🐦 Scanning X post...", hit.handle);
});

bot.command("watch", async (ctx) => {
  return ctx.reply("👀 Watch is turned off.");
});

bot.on("message:text", async (ctx) => {
  const raw = ctx.message.text.trim();
  if (raw.startsWith("/")) return;

  const gh = extractGithub(raw);
  if (gh && gh.owner) {
    touchGroup(ctx.chat);
    await replyGithubScan(ctx, gh.owner, gh.repo, "👾 Scanning GitHub...");
    return;
  }

  const xp = extractXPost(raw);
  if (xp && xp.id) {
    touchGroup(ctx.chat);
    await replyXScan(ctx, xp.id, "🐦 Scanning X post...", xp.handle);
    return;
  }

  const sl = extractStonksLink(raw);
  if (sl && sl.ca) {
    touchGroup(ctx.chat);
    await replyStonksScan(ctx, sl.ca, "📈 Checking StonkFun / stonks.fun...");
    return;
  }

  const hit = extractAnyCa(raw);
  if (!hit.ca) {
    const domain = extractSnsName(raw);
    if (!domain) return;
    touchGroup(ctx.chat);
    const resolved = await resolveSnsDomain(domain);
    if (!resolved) {
      await ctx.reply("❌ Could not resolve " + domain + " to a Solana wallet.");
      return;
    }
    await replyWalletScan(ctx, resolved, "👛 Resolving " + domain + "...", domain);
    return;
  }

  touchGroup(ctx.chat);

  if (hit.chain === "rh") {
    const evmChain = await detectEvmChain(hit.ca);
    if (evmChain === "arc") {
      await replyArcScan(ctx, hit.ca, "🟠 Scanning Arc...");
      return;
    }
    await replyRhScan(ctx, hit.ca, "🏦 Scanning Robinhood Chain...");
    return;
  }
  // Pasted Solana CA → always token scan (never auto wallet).
  // Wallet analyser only via /wallet (or SNS name resolution above).
  const ca = hit.ca;

  recordCall(ctx, ca).catch(() => {});

  const msg = await ctx.reply("🔍 Scanning...");
  rememberOwner(ctx.chat.id, msg.message_id, ctx.from && ctx.from.id);
  try {
    const report = await buildReport(ca);
    await finishScanMessage(ctx, msg, report, kb(ca), ca);
  } catch (e) {
    await ctx.api.editMessageText(ctx.chat.id, msg.message_id, "Error: " + (e.message || "fail"));
  }
});

/* ───────── CALLBACKS ───────── */

bot.callbackQuery(/^lb:(.+)$/, async (ctx) => {
  const period = ctx.match[1];
  if (!PERIODS[period]) return ctx.answerCallbackQuery({ text: "Invalid period" });
  await ctx.answerCallbackQuery({ text: "Updating..." });
  try {
    const text = buildLeaderboard(ctx.chat, period);
    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: lbKeyboard(period),
    });
  } catch (_) {
    await ctx.answerCallbackQuery({ text: "failed" });
  }
});

bot.callbackQuery(/^pnlref:(.+)$/, async (ctx) => {
  const ca = ctx.match[1];
  await ctx.answerCallbackQuery({ text: "Refreshing PnL..." });
  try {
    const card = await buildPnlCard(ctx.chat.id, ca, ctx.from && ctx.from.id);
    if (card.error) {
      await ctx.answerCallbackQuery({ text: "no call found", show_alert: true });
      return;
    }
    await ctx.editMessageMedia(
      {
        type: "photo",
        media: new InputFile(card.buffer, "vexlore-pnl.png"),
      },
      { reply_markup: pnlKeyboard(ca) }
    );
  } catch (_) {
    await ctx.answerCallbackQuery({ text: "failed" });
  }
});
bot.callbackQuery(/^ref:(.+)$/, async (ctx) => {
  const ca = ctx.match[1];
  if (isEvmCa(ca)) return ctx.answerCallbackQuery({ text: "Use RH refresh" });
  await ctx.answerCallbackQuery({ text: "Refreshing..." });
  try {
    const report = await buildReport(ca);
    await ctx.editMessageText(report + "\nUpdated: " + utc(new Date()), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: kb(ca),
    });
  } catch (_) {
    await ctx.answerCallbackQuery({ text: "failed" });
  }
});

bot.callbackQuery(/^vamp:(.+)$/, async (ctx) => {
  const ca = ctx.match[1];
  if (isEvmCa(ca)) return ctx.answerCallbackQuery({ text: "Use RH vamp" });
  await ctx.answerCallbackQuery({ text: "Vamp check..." });
  try {
    const text = await buildVamp(ca);
    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: kb(ca),
    });
  } catch (_) {
    await ctx.answerCallbackQuery({ text: "failed" });
  }
});

bot.callbackQuery(/^bundle:(.+)$/, async (ctx) => {
  const ca = ctx.match[1];
  if (isEvmCa(ca)) {
    return ctx.answerCallbackQuery({ text: "Bundle is Solana only", show_alert: true });
  }
  await ctx.answerCallbackQuery({ text: "Bundles..." });
  try {
    const text = await buildBundle(ca);
    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: kb(ca),
    });
  } catch (_) {
    await ctx.answerCallbackQuery({ text: "failed" });
  }
});

bot.callbackQuery(/^dev:(.+)$/, async (ctx) => {
  const ca = ctx.match[1];
  if (isEvmCa(ca)) {
    return ctx.answerCallbackQuery({ text: "Dev history is Solana only", show_alert: true });
  }
  await ctx.answerCallbackQuery({ text: "Dev history..." });
  try {
    const text = await buildDev(ca);
    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: kb(ca),
    });
  } catch (_) {
    await ctx.answerCallbackQuery({ text: "failed" });
  }
});

bot.callbackQuery(/^callouts:(.+)$/, async (ctx) => {
  const ca = ctx.match[1];
  if (isEvmCa(ca)) {
    return ctx.answerCallbackQuery({ text: "Callouts are Pump.fun only", show_alert: true });
  }
  await ctx.answerCallbackQuery({ text: "Callouts..." });
  try {
    const text = await buildCallouts(ca);
    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: kb(ca),
    });
  } catch (_) {
    await ctx.answerCallbackQuery({ text: "failed" });
  }
});

bot.callbackQuery(/^sf:(.+)$/, async (ctx) => {
  const ca = ctx.match[1];
  if (isEvmCa(ca)) return ctx.answerCallbackQuery({ text: "Use RH Stonks" });
  await ctx.answerCallbackQuery({ text: "StonkFun..." });
  try {
    const text = await buildStonks(ca);
    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: kb(ca),
    });
  } catch (_) {
    await ctx.answerCallbackQuery({ text: "failed" });
  }
});

bot.callbackQuery(/^rhsf:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery({ text: "stonks.fun..." });
  try {
    const text = await buildStonks(ctx.match[1]);
    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: kbRh(ctx.match[1]),
    });
  } catch (_) {
    await ctx.answerCallbackQuery({ text: "failed" });
  }
});

bot.callbackQuery(/^watch:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery({ text: "Watch is turned off", show_alert: true });
});

bot.callbackQuery(/^wref:(.+)$/, async (ctx) => {
  const ca = ctx.match[1];
  if (isEvmCa(ca)) return ctx.answerCallbackQuery({ text: "Wallet scan is Solana only" });
  await ctx.answerCallbackQuery({ text: "Wallet refresh..." });
  try {
    const text = await buildWallet(ca);
    await ctx.editMessageText(text + "\nUpdated: " + utc(new Date()), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: kbWallet(ca),
    });
  } catch (_) {
    await ctx.answerCallbackQuery({ text: "failed" });
  }
});

bot.callbackQuery(/^rhref:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery({ text: "RH refresh..." });
  try {
    const report = await buildRhReport(ctx.match[1]);
    await ctx.editMessageText(report + "\nUpdated: " + utc(new Date()), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: kbRh(ctx.match[1]),
    });
  } catch (_) {
    await ctx.answerCallbackQuery({ text: "failed" });
  }
});

bot.callbackQuery(/^rhvamp:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery({ text: "RH vamp..." });
  try {
    const text = await buildRhVamp(ctx.match[1]);
    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: kbRh(ctx.match[1]),
    });
  } catch (_) {
    await ctx.answerCallbackQuery({ text: "failed" });
  }
});

bot.callbackQuery(/^rhbundle:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery({ text: "RH clusters..." });
  try {
    const text = await buildRhBundle(ctx.match[1]);
    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: kbRh(ctx.match[1]),
    });
  } catch (_) {
    await ctx.answerCallbackQuery({ text: "failed" });
  }
});

bot.callbackQuery(/^rhhold:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery({ text: "RH holders..." });
  try {
    const text = await buildRhHolders(ctx.match[1]);
    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: kbRh(ctx.match[1]),
    });
  } catch (_) {
    await ctx.answerCallbackQuery({ text: "failed" });
  }
});

bot.callbackQuery(/^rhlore:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery({ text: "RH lore..." });
  try {
    const text = await buildRhLore(ctx.match[1]);
    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: kbRh(ctx.match[1]),
    });
  } catch (_) {
    await ctx.answerCallbackQuery({ text: "failed" });
  }
});

bot.callbackQuery(/^rhdev:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery({ text: "RH dev..." });
  try {
    const text = await buildRhDev(ctx.match[1]);
    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: kbRh(ctx.match[1]),
    });
  } catch (_) {
    await ctx.answerCallbackQuery({ text: "failed" });
  }
});

bot.callbackQuery(/^arcref:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery({ text: "Arc refresh..." });
  try {
    const report = await buildArcReport(ctx.match[1]);
    await ctx.editMessageText(report + "\nUpdated: " + utc(new Date()), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: kbArc(ctx.match[1]),
    });
  } catch (_) {
    await ctx.answerCallbackQuery({ text: "failed" });
  }
});

bot.callbackQuery(/^arcvamp:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery({ text: "Arc vamp..." });
  try {
    const text = await buildArcVamp(ctx.match[1]);
    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: kbArc(ctx.match[1]),
    });
  } catch (_) {
    await ctx.answerCallbackQuery({ text: "failed" });
  }
});

bot.callbackQuery(/^arcbundle:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery({ text: "Arc clusters..." });
  try {
    const text = await buildArcBundle(ctx.match[1]);
    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: kbArc(ctx.match[1]),
    });
  } catch (_) {
    await ctx.answerCallbackQuery({ text: "failed" });
  }
});

bot.callbackQuery(/^archold:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery({ text: "Arc holders..." });
  try {
    const text = await buildArcHolders(ctx.match[1]);
    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: kbArc(ctx.match[1]),
    });
  } catch (_) {
    await ctx.answerCallbackQuery({ text: "failed" });
  }
});

bot.callbackQuery(/^arclore:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery({ text: "Arc lore..." });
  try {
    const text = await buildArcLore(ctx.match[1]);
    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: kbArc(ctx.match[1]),
    });
  } catch (_) {
    await ctx.answerCallbackQuery({ text: "failed" });
  }
});

bot.callbackQuery(/^arcdev:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery({ text: "Arc dev..." });
  try {
    const text = await buildArcDev(ctx.match[1]);
    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: kbArc(ctx.match[1]),
    });
  } catch (_) {
    await ctx.answerCallbackQuery({ text: "failed" });
  }
});
bot.callbackQuery(/^ghref:(.+)$/, async (ctx) => {
  const job = ghJobs.get(String(ctx.match[1]));
  if (!job) {
    return ctx.answerCallbackQuery({
      text: "Scan expired. Send the GitHub link again.",
      show_alert: true,
    });
  }
  await ctx.answerCallbackQuery({ text: "GitHub refresh..." });
  try {
    const text = await buildGithubReport(job.owner, job.repo);
    await ctx.editMessageText(text + "\nUpdated: " + utc(new Date()), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: kbGh(ctx.match[1]),
    });
  } catch (_) {
    await ctx.answerCallbackQuery({ text: "failed" });
  }
});

bot.callbackQuery(/^ghfees:(.+)$/, async (ctx) => {
  const job = ghJobs.get(String(ctx.match[1]));
  if (!job) {
    return ctx.answerCallbackQuery({
      text: "Scan expired. Send the GitHub link again.",
      show_alert: true,
    });
  }
  await ctx.answerCallbackQuery({ text: "Pump GitHub fees..." });
  try {
    const userRes = await ghGet("/users/" + encodeURIComponent(job.owner));
    if (!userRes.ok || !userRes.data || !userRes.data.login) {
      await ctx.editMessageText("❌ GitHub user not found." + FOOTER, {
        parse_mode: "HTML",
      });
      return;
    }
      const [feeBook, mentionTokens] = await Promise.all([
      pumpFeeByGithub(userRes.data.login, userRes.data.id),
      searchPumpGithubFeeTokens(userRes.data.login),
    ]);
    const text =
      "👾 <b>Pump GitHub fee scan</b>\n" +
      "<b>" + esc(userRes.data.login) + "</b>\n" +
      userRes.data.html_url +
      "\n\n" +
      pumpGithubFeeBlock(userRes.data, feeBook, mentionTokens) +
      "\nUpdated: " + utc(new Date()) +
      FOOTER;
    await ctx.editMessageText(text.slice(0, 4000), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: kbGh(ctx.match[1]),
    });
  } catch (_) {
    await ctx.answerCallbackQuery({ text: "failed" });
  }
});
bot.callbackQuery(/^xref:(.+)$/, async (ctx) => {
  const job = xJobs.get(String(ctx.match[1]));
  if (!job || !job.postId) return ctx.answerCallbackQuery({ text: "Scan expired. Send the link again.", show_alert: true });
  await ctx.answerCallbackQuery({ text: "X refresh..." });
  try {
    const text = await buildXReport(job.postId);
    await ctx.editMessageText(text + "\nUpdated: " + utc(new Date()), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: kbX(ctx.match[1]),
    });
  } catch (_) {
    await ctx.answerCallbackQuery({ text: "failed" });
  }
});

bot.callbackQuery(/^del$/, async (ctx) => {
  const msg = ctx.callbackQuery && ctx.callbackQuery.message;
  if (!msg) return ctx.answerCallbackQuery({ text: "failed" });

  const owner = msgOwners.get(ownerKey(msg.chat.id, msg.message_id));
  if (!owner || String(ctx.from.id) !== String(owner)) {
    return ctx.answerCallbackQuery({
      text: "Only the person who posted this CA can delete it",
      show_alert: true,
    });
  }

  try {
    await ctx.deleteMessage();
    msgOwners.delete(ownerKey(msg.chat.id, msg.message_id));
    await ctx.answerCallbackQuery({ text: "Deleted" });
  } catch (_) {
    await ctx.answerCallbackQuery({ text: "Can't delete this message" });
  }
});

bot.catch((err) => console.error(err));

(async () => {
  try {
    await bot.api.setMyDefaultAdministratorRights({
      rights: {
        is_anonymous: false,
        can_manage_chat: false,
        can_delete_messages: false,
        can_manage_video_chats: false,
        can_restrict_members: false,
        can_promote_members: false,
        can_change_info: false,
        can_invite_users: false,
        can_post_messages: true,
        can_edit_messages: false,
        can_pin_messages: false,
        can_manage_topics: false,
      },
    });
  } catch (e) {
    console.error("setMyDefaultAdministratorRights fail", e.message || e);
  }

  await bot.start();
  console.log("Bot is running");
})();