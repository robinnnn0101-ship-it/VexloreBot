# VexloreBot

**Telegram bot for token checks.**  
Paste a Solana CA, Robinhood, Arc address, wallet, or `.sol` / `.sns` name → get **one sheet**: OG, bundles, holders, dev history, and lore.

**Live bot:** [t.me/VexloreBOT](https://t.me/VexloreBOT)

---

## Quick start (for users)

1. Open [@VexloreBOT](https://t.me/VexloreBOT)
2. Paste a Solana CA (or Robinhood / Arc 0x)
3. Read the full sheet (OG / Vamp / Bundles / Holders / Dev / Lore)
4. Use the buttons or the commands below for deeper reads

Core OG check stays free.

---

## All commands (A–Z)

### Core & help
| Command | What it does |
|---------|--------------|
| `/start` | Welcome message + links |
| `/welcome` | Same as `/start` |
| `/help` | Welcome + tip to open the command menu |

### Token scans (Solana / RH / Arc)
| Command | What it does |
|---------|--------------|
| *(just paste a CA)* | Full auto scan (Solana / RH / Arc detected) |
| `/vamp <CA>` | Strict OG vs vamp check (name + ticker must match) |
| `/bundle <CA>` | Live bundles / launch clusters |
| `/dev <CA>` | Dev history |
| `/callouts <CA>` | Pump.fun callouts (Solana only) |
| `/analysis <CA>` | Full score-card image (Solana only) |
| `/ta <CA>` | Technical analysis card (alias of analysis) |
| `/pnl <CA>` | PnL card image (Solana only) |
| `/rh 0x…` | Force Robinhood Chain scan |
| `/arc 0x…` | Force Arc chain scan |
| `/holders 0x…` | Holders (Robinhood or Arc) |
| `/lore 0x…` | Lore / story (Robinhood or Arc) |

### Wallet analyser
| Command | What it does |
|---------|--------------|
| `/wallet <address>` | Solana wallet (or `name.sol` / `name.sns`) |
| `/wallet bnb\|eth\|rh\|arc 0x…` | EVM wallet with chain hint |
| `/wallet trx T…` | Tron wallet |

### Extra token tools
| Command | What it does |
|---------|--------------|
| `/stonks <CA>` or `/stonkfun <CA>` | StonkFun / stonks.fun check |
| `/c <CA or token>` | Chart text |
| `/th <CA>` | Top holders |
| `/nar <CA>` | Narrative |
| `/soc <CA>` | Socials |
| `/dp <CA>` | DEX paid status |

### GitHub & X
| Command | What it does |
|---------|--------------|
| `/git owner/repo` or `/github …` | GitHub repo scan |
| `/x <tweet url>` or `/tweet …` | X / Twitter post scan |

### Group / fun / agent
| Command | What it does |
|---------|--------------|
| `/lb` | Leaderboard (group) |
| `/ask <question>` | Ask the Vexlore AI agent |
| `/teach <tip>` | Train the agent with a tip |
| `/dapp` | Links to website + community |
| `/watch` | Currently turned off |

---

## How people use it

- **Groups**: paste CA → full sheet → buttons for Vamp / Bundle / Dev / Analysis
- **Wallet check**: `/wallet` + address or `.sol` / `.sns` name → strong-holder vs jeeter tag + trades
- **AI agent**: `/ask` anything about a token or the market
- **GitHub / X**: drop a repo or tweet link for a quick red-flag scan

---

## Tech stack

- **Runtime**: Node.js (CommonJS)
- **Bot**: [grammy](https://grammy.dev/)
- **Images**: `@napi-rs/canvas`
- **HTTP**: Express + CORS
- **Data**: Solana Tracker, Pump.fun, Dexscreener, GeckoTerminal, Blockscout, GitHub, X, SNS, etc.

Entry point: `index.js`

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `BOT_TOKEN` | Yes | Telegram bot token |
| `SOLANA_TRACKER_KEY` | Recommended | Solana Tracker API key |
| `X_BEARER` | Optional | X (Twitter) Bearer token |
| `GITHUB_TOKEN` | Optional | GitHub token |
| `XAI_API_KEY` / `GROK_API_KEY` | Optional | xAI / Grok key (for `/ask`) |
| `OPENAI_API_KEY` | Optional | OpenAI key |
| `AI_BASE_URL` / `AI_MODEL` | Optional | Custom AI endpoint |
| `DATA_DIR` or `RAILWAY_VOLUME_MOUNT_PATH` | Optional | Persistent storage |

---

## Local run

```bash
git clone https://github.com/robinnnn0101-ship-it/VexloreBot.git
cd VexloreBot
npm install
export BOT_TOKEN="your_token"
node index.js
