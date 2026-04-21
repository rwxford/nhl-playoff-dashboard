# NHL Playoff Dashboard 🏒

A real-time dashboard for tracking the 2026 Stanley Cup Playoffs with live scores, dynamic bracket visualization, multi-LLM predictions, and AI-generated Joe Beninati-style play-by-play commentary with desktop notifications.

## Features

- **Live Score Tracking** — Polls the NHL API every 30s for active playoff games
- **Dynamic Bracket** — Visual bracket auto-updates as series progress through all 4 rounds
- **Multi-LLM Predictions** — Queries OpenAI (GPT-4o), Anthropic (Claude Sonnet), and Google (Gemini Flash) for series forecasts with consensus aggregation
- **Joe B Commentary** — AI-generated play-by-play in the style of legendary announcer Joe Beninati, with signature catchphrases
- **Desktop Notifications** — Native OS pop-ups via node-notifier on goals, game finals, upsets, and series clinches
- **WebSocket Updates** — Real-time push to all connected browsers; REST fallback
- **Browser Notifications** — Optional Web Notification API alerts

## Screenshot

![Dashboard](screenshot.png)
*(Dashboard dark theme showing bracket, live ticker, predictions panel, and commentary feed)*

## Quick Start

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/nhl-playoff-dashboard.git
cd nhl-playoff-dashboard

# Install dependencies
npm install

# Configure API keys (optional — app works with fallback data)
cp .env.example .env
# Edit .env with your keys

# Start the server
npm start

# Open in browser
open http://localhost:3000
```

## Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP server port |
| `OPENAI_API_KEY` | — | OpenAI API key for GPT-4o predictions + commentary |
| `ANTHROPIC_API_KEY` | — | Anthropic API key for Claude predictions |
| `GOOGLE_AI_API_KEY` | — | Google AI API key for Gemini predictions |
| `POLL_INTERVAL_LIVE` | `30000` | Live score polling interval (ms) |
| `POLL_INTERVAL_SCHEDULE` | `300000` | Bracket/predictions refresh interval (ms) |
| `ENABLE_DESKTOP_NOTIFICATIONS` | `true` | Enable/disable OS-level desktop pop-ups |

The dashboard works without any API keys — LLM features gracefully fall back to pre-written commentary and skip predictions.

## Architecture

```
nhl-playoff-dashboard/
├── server/
│   ├── index.js              # Express + WebSocket server, polling, REST API
│   ├── nhlApi.js             # NHL Stats API client (scores, bracket, standings)
│   ├── llmForecaster.js      # Multi-LLM prediction engine with consensus
│   ├── joeBCommentary.js     # Joe B commentary generator (GPT-4o + fallbacks)
│   └── notifier.js           # Desktop notification dispatcher (node-notifier)
├── public/
│   ├── index.html            # Dashboard SPA
│   ├── styles.css            # Dark theme, bracket grid, animations
│   └── app.js                # Frontend (WebSocket, rendering, browser notifications)
├── package.json              # ESM, 8 dependencies
├── .env.example              # Config template
└── .gitignore
```

## Tech Stack

- **Runtime:** Node.js 18+ (native fetch, ES modules)
- **Server:** Express 4 + ws (WebSocket)
- **Data:** NHL Stats API (`api-web.nhle.com`)
- **LLMs:** OpenAI SDK, Anthropic SDK, Google Generative AI SDK
- **Notifications:** node-notifier (cross-platform desktop pop-ups)
- **Frontend:** Vanilla JS (no framework), CSS Grid bracket, Web Audio API chimes

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/bracket` | Current playoff bracket state |
| `GET` | `/api/scores` | Live game scores |
| `GET` | `/api/predictions` | Trigger LLM forecasts for active series |
| `GET` | `/api/commentary/:gameId` | Generate Joe B commentary for a game |

## WebSocket Messages

The server broadcasts JSON messages over WebSocket with this shape:

```json
{
  "type": "bracket|scores|predictions|commentary|init",
  "data": { "..." },
  "timestamp": "ISO"
}
```

## How Predictions Work

1. For each active series, the server builds a rich context string with team records, key players, injury reports, and game results
2. The context is sent to all 3 LLMs in parallel
3. Each LLM returns a structured prediction (winner, games, confidence, MVP, reasoning)
4. The consensus engine aggregates votes:
   - **Unanimous:** all 3 LLMs agree
   - **Majority:** 2 of 3 agree
   - **Split:** all 3 disagree (highest confidence wins)

## License

MIT
