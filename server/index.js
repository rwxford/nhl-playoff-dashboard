// server/index.js — Express + WebSocket server for NHL Playoff Dashboard
import 'dotenv/config';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import nhlApi from './nhlApi.js';
import { buildSeriesState } from './nhlApi.js';
import { generateForecasts } from './llmForecaster.js';
import { generateCommentary } from './joeBCommentary.js';
import { sendNotification } from './notifier.js';

// ── __dirname shim for ES modules ────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Config ────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT, 10) || 3000;
const POLL_LIVE = parseInt(process.env.POLL_INTERVAL_LIVE, 10) || 30_000;
const POLL_SCHEDULE = parseInt(process.env.POLL_INTERVAL_SCHEDULE, 10) || 300_000;

// ── In-memory state ───────────────────────────────────────────────────
let currentBracket = { rounds: [], lastUpdated: null };
let currentSeries = [];
let currentScores = { games: [], lastUpdated: null };
let currentPredictions = [];
let previousScoreMap = new Map(); // gameId → { homeScore, awayScore, gameState }

// ── Helpers ───────────────────────────────────────────────────────────
function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function broadcastWS(type, payload) {
  const message = JSON.stringify({ type, data: payload, timestamp: new Date().toISOString() });
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      // WebSocket.OPEN
      client.send(message);
    }
  }
}

function detectScoreChanges(newGames) {
  const changes = [];
  for (const game of newGames) {
    const prev = previousScoreMap.get(game.gameId);
    if (!prev) {
      // First time seeing this game — not a "change"
      continue;
    }
    const goalScored =
      game.homeScore !== prev.homeScore || game.awayScore !== prev.awayScore;
    const gameEnded =
      prev.gameState !== 'FINAL' &&
      prev.gameState !== 'OFF' &&
      (game.gameState === 'FINAL' || game.gameState === 'OFF');
    const gameStarted =
      (prev.gameState === 'FUT' || prev.gameState === 'PRE') &&
      (game.gameState === 'LIVE' || game.gameState === 'CRIT');

    if (goalScored || gameEnded || gameStarted) {
      changes.push({ game, goalScored, gameEnded, gameStarted });
    }
  }
  return changes;
}

function updateScoreMap(games) {
  for (const g of games) {
    previousScoreMap.set(g.gameId, {
      homeScore: g.homeScore,
      awayScore: g.awayScore,
      gameState: g.gameState,
    });
  }
}

// ── Express app ───────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// REST endpoints
app.get('/api/bracket', (_req, res) => {
  res.json({ bracket: currentBracket, series: currentSeries });
});

app.get('/api/scores', (_req, res) => {
  res.json(currentScores);
});

app.get('/api/predictions', async (_req, res) => {
  try {
    const activeSeries = currentSeries.filter(
      (s) => s.seriesStatus === 'IN_PROGRESS'
    );
    currentPredictions = await generateForecasts(activeSeries);
    res.json({ predictions: currentPredictions, lastUpdated: new Date().toISOString() });
  } catch (err) {
    log(`Predictions error: ${err.message}`);
    res.status(500).json({ error: 'Failed to generate predictions', detail: err.message });
  }
});

app.get('/api/commentary/:gameId', async (req, res) => {
  try {
    const { gameId } = req.params;
    const details = await nhlApi.getGameDetails(gameId);
    const liveGame = currentScores.games.find(
      (g) => String(g.gameId) === String(gameId)
    );
    const commentary = await generateCommentary({
      type: 'GOAL',
      gameContext: {
        homeTeam: liveGame?.homeTeam?.abbrev,
        awayTeam: liveGame?.awayTeam?.abbrev,
        homeScore: liveGame?.homeScore ?? 0,
        awayScore: liveGame?.awayScore ?? 0,
        period: liveGame?.period,
        time: liveGame?.clock,
        gameId,
      },
      details,
    });
    res.json({ gameId, commentary, lastUpdated: new Date().toISOString() });
  } catch (err) {
    log(`Commentary error (${req.params.gameId}): ${err.message}`);
    res.status(500).json({ error: 'Failed to generate commentary', detail: err.message });
  }
});

// ── HTTP + WebSocket server ───────────────────────────────────────────
const server = createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  log('WebSocket client connected');
  // Send current state immediately
  ws.send(
    JSON.stringify({
      type: 'init',
      data: {
        bracket: currentBracket,
        series: currentSeries,
        scores: currentScores,
        predictions: currentPredictions,
      },
      timestamp: new Date().toISOString(),
    })
  );

  ws.on('close', () => log('WebSocket client disconnected'));
  ws.on('error', (err) => log(`WebSocket error: ${err.message}`));
});

// ── Polling loops ─────────────────────────────────────────────────────
async function pollLiveScores() {
  try {
    const scores = await nhlApi.getLiveScores();
    const changes = detectScoreChanges(scores.games);
    updateScoreMap(scores.games);
    currentScores = scores;

    if (changes.length > 0) {
      broadcastWS('scores', currentScores);

      for (const change of changes) {
        const { game, goalScored, gameEnded, gameStarted } = change;
        const label = `${game.awayTeam.abbrev} ${game.awayScore} @ ${game.homeTeam.abbrev} ${game.homeScore}`;

        if (goalScored) {
          log(`GOAL: ${label}`);
          sendNotification({ title: '🚨 GOAL!', message: label, type: 'goal' });
        }
        if (gameEnded) {
          log(`FINAL: ${label}`);
          sendNotification({ title: '🏒 Game Final', message: label, type: 'final' });
          // Refresh predictions when a game ends
          pollBracketAndPredictions().catch(() => {});
        }

        // Generate Joe B commentary for changed games
        try {
          const details = await nhlApi.getGameDetails(game.gameId);
          const eventType = goalScored ? 'GOAL' : gameEnded ? 'GAME_FINAL' : 'PERIOD_END';
          const commentary = await generateCommentary({
            type: eventType,
            gameContext: {
              homeTeam: game.homeTeam.abbrev,
              awayTeam: game.awayTeam.abbrev,
              homeScore: game.homeScore,
              awayScore: game.awayScore,
              period: game.period,
              time: game.clock,
              gameId: game.gameId,
            },
            details,
          });
          broadcastWS('commentary', { gameId: game.gameId, commentary });
        } catch (err) {
          log(`Commentary generation failed for ${game.gameId}: ${err.message}`);
        }
      }
    }
  } catch (err) {
    log(`pollLiveScores error: ${err.message}`);
  }
}

async function pollBracketAndPredictions() {
  try {
    currentBracket = await nhlApi.getPlayoffBracket();
    currentSeries = buildSeriesState(currentBracket);
    broadcastWS('bracket', { bracket: currentBracket, series: currentSeries });

    // Refresh predictions for active series
    const active = currentSeries.filter((s) => s.seriesStatus === 'IN_PROGRESS');
    if (active.length > 0) {
      currentPredictions = await generateForecasts(active);
      broadcastWS('predictions', currentPredictions);
    }
  } catch (err) {
    log(`pollBracketAndPredictions error: ${err.message}`);
  }
}

// ── Startup ───────────────────────────────────────────────────────────
let liveTimer;
let scheduleTimer;

async function start() {
  // Initial data fetch
  log('Fetching initial data…');
  await Promise.allSettled([pollBracketAndPredictions(), pollLiveScores()]);
  // Seed score map on first run
  updateScoreMap(currentScores.games);
  log(`Loaded ${currentSeries.length} series, ${currentScores.games.length} games`);

  // Start polling
  liveTimer = setInterval(pollLiveScores, POLL_LIVE);
  scheduleTimer = setInterval(pollBracketAndPredictions, POLL_SCHEDULE);
  log(`Polling: live every ${POLL_LIVE / 1000}s, bracket every ${POLL_SCHEDULE / 1000}s`);

  server.listen(PORT, () => {
    log(`Server listening on http://localhost:${PORT}`);
  });
}

// ── Graceful shutdown ─────────────────────────────────────────────────
function shutdown(signal) {
  log(`${signal} received — shutting down`);
  clearInterval(liveTimer);
  clearInterval(scheduleTimer);

  wss.clients.forEach((client) => client.close());
  wss.close(() => {
    server.close(() => {
      log('Server closed');
      process.exit(0);
    });
  });

  // Force exit after 5 s
  setTimeout(() => {
    log('Forcing exit');
    process.exit(1);
  }, 5000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
