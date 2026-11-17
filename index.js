const { Bot, InlineKeyboard, InputFile } = require("grammy");
const fs = require("fs");
const path = require("path");

const bot = new Bot(process.env.BOT_TOKEN);
const ST_KEY = process.env.SOLANA_TRACKER_KEY || "";
const X_BEARER = String(process.env.X_BEARER || "")
  .trim()
  .replace(/^Bearer\s+/i, "")
  .replace(/^[\"']+|[\"']+$/g, "");
const GH_TOKEN = process.env.GITHUB_TOKEN || "";
const XAI_API_KEY = String(process.env.XAI_API_KEY || process.env.GROK_API_KEY || "").trim();
const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || "").trim();
const AI_BASE_URL = String(process.env.AI_BASE_URL || "").trim().replace(/\/$/, "");
const AI_MODEL = String(process.env.AI_MODEL || "").trim();
const FOOTER = "\n\n Made for CHADS with Love ❤️ Robin ";
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

function isCa(