```markdown
# VexloreBot

**Telegram bot for instant token intel.**

Paste a Solana CA, Robinhood `0x`, Arc address, BNB/ETH wallet, Tron address, or `.sol` / `.sns` name and get **one clean sheet**: OG vs vamp, bundles, holders, dev history, and lore.

**Live bot:** [@VexloreBOT](https://t.me/VexloreBOT)  
**Website:** [vexlore.xyz](https://vexlore.xyz)  
**Community:** [t.me/VEXLORECOMM](https://t.me/VEXLORECOMM)  
**X:** [@Vexlorebot](https://x.com/Vexlorebot)

---

## Features

- **One-sheet scans** — OG / vamp / bundles / holders / dev / lore in a single message
- **Multi-chain** — Solana, Robinhood Chain, Arc, EVM (BNB/ETH), Tron
- **Wallet analyser** — Strong holder vs jeeter + trade history (`.sol` / `.sns` supported)
- **Image cards** — Analysis, PnL, and score cards via `@napi-rs/canvas`
- **AI agent** — `/ask` anything about a token or market (Grok / OpenAI)
- **Extras** — GitHub repo scan, X/Twitter post scan, StonkFun checks, DEX paid status
- **Group ready** — Buttons + leaderboard for Telegram chats

Core OG check stays free.

---

## Quick start (users)

1. Open [@VexloreBOT](https://t.me/VexloreBOT)
2. Send `/start`
3. Paste a Solana CA (or Robinhood / Arc `0x`)
4. Read the full sheet
5. Use buttons or commands below for deeper reads

---

## Commands

### Core
| Command | Description |
|---------|-------------|
| `/start` | Welcome + links |
| `/welcome` | Same as `/start` |
| `/help` | Welcome + tip to open command menu |

### Token scans
| Command | Description |
|---------|-------------|
| *(paste CA)* | Full auto scan (Solana / RH / Arc) |
| `/vamp <CA>` | Strict OG vs vamp (name + ticker must match) |
| `/bundle <CA>` | Live bundles / launch clusters |
| `/dev <CA>` | Dev history |
| `/callouts <CA>` | Pump.fun callouts (Solana) |
| `/analysis <CA>` | Full score-card image (Solana) |
| `/ta <CA>` | Alias of `/analysis` |
| `/pnl <CA>` | PnL card image (Solana) |
| `/rh 0x…` | Force Robinhood Chain |
| `/arc 0x…` | Force Arc chain |
| `/holders 0x…` | Holders (RH or Arc) |
| `/lore 0x…` | Lore / story (RH or Arc) |

### Wallet analyser
| Command | Description |
|---------|-------------|
| `/wallet <address>` | Solana wallet or `name.sol` / `name.sns` |
| `/wallet bnb\|eth\|rh\|arc 0x…` | EVM wallet with chain hint |
| `/wallet trx T…` | Tron wallet |

### Extra tools
| Command | Description |
|---------|-------------|
| `/stonks <CA>` or `/stonkfun <CA>` | StonkFun / stonks.fun check |
| `/c <CA>` | Chart text |
| `/th <CA>` | Top holders |
| `/nar <CA>` | Narrative |
| `/soc <CA>` | Socials |
| `/dp <CA>` | DEX paid status |
| `/git owner/repo` | GitHub repo scan |
| `/x <tweet url>` | X / Twitter post scan |
| `/lb` | Leaderboard (groups) |
| `/ask <question>` | Ask the Vexlore AI agent |
| `/teach <tip>` | Train the agent |
| `/dapp` | Website + community links |

---

## How people use it

- **Groups** — Paste CA → full sheet → buttons for Vamp / Bundle / Dev / Analysis
- **Wallet check** — `/wallet` + address or `.sol` / `.sns` → strong-holder vs jeeter + trades
- **AI agent** — `/ask` anything about a token or the market
- **GitHub / X** — Drop a repo or tweet link for a quick red-flag scan

---

## Tech stack

| Layer | Tech |
|-------|------|
| Runtime | Node.js (CommonJS) |
| Bot | [grammY](https://grammy.dev/) |
| Images | `@napi-rs/canvas` |
| HTTP | Express + CORS |
| Data | Solana Tracker, Pump.fun, Dexscreener, GeckoTerminal, Blockscout, GitHub, X, SNS, etc. |

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
```

For production, set the remaining env vars and use a process manager or Railway.

---

## Deployment

Works out of the box on Railway (volume for persistence recommended).  
Set the environment variables above and point the start command to `node index.js`.

---

## Disclaimer

This is a research tool. Not financial advice. Always DYOR.  
Core checks are free. Deeper reads and AI features may depend on API keys.

---

**Illusion breaker.**  
Built for groups that check before they call.
```
