// server/llmForecaster.js — Multi-LLM prediction engine for NHL playoff series
// Queries OpenAI, Anthropic Claude, and Google Gemini in parallel, then
// aggregates results into a consensus forecast.

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

// ── System prompt shared by every provider ─────────────────────────────
const SYSTEM_PROMPT = `You are a world-class NHL analytics expert. Given the current state of a playoff series, predict the outcome. Respond in JSON only:
{
  "winner": "TEAM_ABBREV",
  "games": 4-7,
  "confidence": 0.0-1.0,
  "reasoning": "one sentence",
  "mvp": "Player Name"
}`;

// ── Hardcoded 2026 regular-season data for all 16 playoff teams ────────
const TEAM_DATA = {
  COL: { name: 'Colorado Avalanche', record: '55-16-11', points: 121, gd: '+101', key: 'MacKinnon (53G-74A), Makar, Necas (100pts)', notes: "Presidents' Trophy, 298 GF (1st), 197 GA (1st)" },
  CAR: { name: 'Carolina Hurricanes', record: '53-22-7', points: 113, gd: '+56', key: 'Svechnikov, Aho, Andersen', notes: 'Metro Div champs, East #1 seed' },
  BUF: { name: 'Buffalo Sabres', record: '50-23-9', points: 109, gd: '+44', key: 'Thompson, Dahlin, Power', notes: 'Ended 14-year playoff drought, Atlantic Div champs' },
  DAL: { name: 'Dallas Stars', record: '50-20-12', points: 112, gd: '+52', key: 'Rantanen, Robertson, Oettinger', notes: 'Central 2nd seed' },
  TBL: { name: 'Tampa Bay Lightning', record: '48-26-8', points: 104, gd: '+30', key: 'Kucherov, Hedman, Vasilevskiy', notes: 'Atlantic 2nd, Cup DNA' },
  MTL: { name: 'Montreal Canadiens', record: '46-27-9', points: 101, gd: '+18', key: 'Suzuki, Caufield, Slafkovsky', notes: 'Atlantic 3rd' },
  MIN: { name: 'Minnesota Wild', record: '46-24-12', points: 104, gd: '+38', key: 'Kaprizov, Boldy, Hughes, Faber', notes: 'Central 3rd, Zuccarello OUT' },
  PIT: { name: 'Pittsburgh Penguins', record: '43-29-10', points: 98, gd: '+12', key: 'Crosby, Malkin, Letang', notes: 'Metro 2nd' },
  PHI: { name: 'Philadelphia Flyers', record: '43-29-10', points: 98, gd: '+10', key: 'Michkov, Martone, Vladar', notes: 'Metro 3rd, first playoffs since 2020' },
  VGK: { name: 'Vegas Golden Knights', record: '39-26-17', points: 95, gd: '+12', key: 'Eichel, Marner, Stone, Dorofeyev', notes: 'Pacific Div champs, Tortorella coach, Karlsson OUT' },
  EDM: { name: 'Edmonton Oilers', record: '41-30-11', points: 93, gd: '+8', key: 'McDavid (134pts), Draisaitl BACK', notes: 'Pacific 2nd, 2 straight Cup Finals losses' },
  ANA: { name: 'Anaheim Ducks', record: '43-33-6', points: 92, gd: '+2', key: 'Zegras, Terry, Strome', notes: 'Pacific 3rd, first playoffs since 2018' },
  UTA: { name: 'Utah Mammoth', record: '43-33-6', points: 92, gd: '-4', key: 'Keller (88pts), Guenther (40G), Cooley, Vejmelka', notes: 'First EVER playoff appearance, WC1' },
  LAK: { name: 'Los Angeles Kings', record: '35-27-20', points: 90, gd: '-8', key: 'Kopitar, Fiala, Kempe', notes: 'WC2' },
  OTT: { name: 'Ottawa Senators', record: '38-30-14', points: 90, gd: '+6', key: 'Tkachuk, Stützle, Norris', notes: 'WC2 East, Zub OUT' },
  BOS: { name: 'Boston Bruins', record: '40-28-14', points: 94, gd: '+14', key: 'Pastrnak, McAvoy, Marchand', notes: 'WC1 East' },
};

// ── Helpers ─────────────────────────────────────────────────────────────

function log(msg) {
  console.log(`[${new Date().toISOString()}] [LLMForecaster] ${msg}`);
}

/**
 * Safely parse a JSON string that may be wrapped in markdown fences.
 * Returns the parsed object or null on failure.
 */
function safeParseJSON(raw) {
  try {
    // Strip markdown code fences if present
    const cleaned = raw
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

/**
 * Round-name helper for display strings.
 */
function roundLabel(round) {
  const labels = { 1: 'Round 1', 2: 'Round 2', 3: 'Conference Finals', 4: 'Stanley Cup Final' };
  return labels[round] || `Round ${round}`;
}

// ── Build series context string ─────────────────────────────────────────

/**
 * Converts a series object into a rich text context block the LLMs can reason
 * about.  Includes record / key-player lookups from TEAM_DATA.
 *
 * @param {object} series — { topSeed: { abbrev, name, wins }, bottomSeed: { abbrev, name, wins }, round, games }
 * @returns {string}
 */
export function buildSeriesContext(series) {
  const top = series.topSeed;
  const bot = series.bottomSeed;
  const topData = TEAM_DATA[top.abbrev] || {};
  const botData = TEAM_DATA[bot.abbrev] || {};

  // Determine current series state description
  let stateDesc;
  if (top.wins === 0 && bot.wins === 0) {
    stateDesc = 'Series tied 0-0 (not yet started)';
  } else if (top.wins === bot.wins) {
    stateDesc = `Series tied ${top.wins}-${bot.wins}`;
  } else if (top.wins > bot.wins) {
    stateDesc = `${top.abbrev} leads ${top.wins}-${bot.wins}`;
  } else {
    stateDesc = `${bot.abbrev} leads ${bot.wins}-${top.wins}`;
  }

  // Format individual game results
  const gameLines = (series.games || [])
    .filter((g) => g.state === 'FINAL' || g.state === 'OFF')
    .map((g, i) => {
      const home = g.homeTeam || '???';
      const away = g.awayTeam || '???';
      return `Game ${i + 1}: ${away} ${g.awayScore}, ${home} ${g.homeScore}`;
    })
    .join(' | ');

  const lines = [
    `2026 Stanley Cup Playoffs - ${roundLabel(series.round)}`,
    `Series: ${topData.name || top.name} (${top.abbrev}) vs ${botData.name || bot.name} (${bot.abbrev})`,
    `Current State: ${stateDesc}`,
  ];

  if (gameLines) {
    lines.push(`Game Results: ${gameLines}`);
  }

  // Top-seed regular-season context
  if (topData.record) {
    lines.push(`${top.abbrev} Regular Season: ${topData.record} (${topData.points} pts, ${topData.notes || ''}, ${topData.gd} GD)`);
  }
  if (topData.key) {
    lines.push(`${top.abbrev} Key Players: ${topData.key}`);
  }

  // Bottom-seed regular-season context
  if (botData.record) {
    lines.push(`${bot.abbrev} Regular Season: ${botData.record} (${botData.points} pts, ${botData.notes || ''}, ${botData.gd} GD)`);
  }
  if (botData.key) {
    lines.push(`${bot.abbrev} Key Players: ${botData.key}`);
  }

  return lines.join('\n');
}

// ── Provider query functions ────────────────────────────────────────────

/**
 * Query OpenAI (gpt-4o) for a series prediction.
 */
async function queryOpenAI(seriesContext) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey === 'sk-xxx') {
      throw new Error('OPENAI_API_KEY not configured');
    }

    const client = new OpenAI({ apiKey });
    const completion = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: seriesContext },
      ],
      temperature: 0.7,
      max_tokens: 300,
    });

    const raw = completion.choices?.[0]?.message?.content ?? '';
    const parsed = safeParseJSON(raw);
    if (!parsed || !parsed.winner) {
      throw new Error('Failed to parse OpenAI response as valid prediction JSON');
    }

    return { provider: 'openai', model: 'gpt-4o', ...parsed };
  } catch (err) {
    log(`OpenAI error: ${err.message}`);
    return { provider: 'openai', error: err.message, fallback: true, winner: null, confidence: 0 };
  }
}

/**
 * Query Anthropic Claude (claude-sonnet-4-20250514) for a series prediction.
 */
async function queryClaude(seriesContext) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || apiKey === 'sk-ant-xxx') {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }

    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: seriesContext },
      ],
    });

    const raw = message.content?.[0]?.text ?? '';
    const parsed = safeParseJSON(raw);
    if (!parsed || !parsed.winner) {
      throw new Error('Failed to parse Claude response as valid prediction JSON');
    }

    return { provider: 'claude', model: 'claude-sonnet-4-20250514', ...parsed };
  } catch (err) {
    log(`Claude error: ${err.message}`);
    return { provider: 'claude', error: err.message, fallback: true, winner: null, confidence: 0 };
  }
}

/**
 * Query Google Gemini (gemini-2.0-flash) for a series prediction.
 */
async function queryGemini(seriesContext) {
  try {
    const apiKey = process.env.GOOGLE_AI_API_KEY;
    if (!apiKey || apiKey === 'xxx') {
      throw new Error('GOOGLE_AI_API_KEY not configured');
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      systemInstruction: SYSTEM_PROMPT,
    });

    const result = await model.generateContent(seriesContext);
    const raw = result.response?.text() ?? '';
    const parsed = safeParseJSON(raw);
    if (!parsed || !parsed.winner) {
      throw new Error('Failed to parse Gemini response as valid prediction JSON');
    }

    return { provider: 'gemini', model: 'gemini-2.0-flash', ...parsed };
  } catch (err) {
    log(`Gemini error: ${err.message}`);
    return { provider: 'gemini', error: err.message, fallback: true, winner: null, confidence: 0 };
  }
}

// ── Stats-based fallback predictor (no API keys needed) ────────────────

/**
 * Generate a prediction purely from regular-season stats when LLM APIs are
 * unavailable.  Uses points, goal differential, and current series score to
 * produce a reasonable pick.
 */
function statsFallbackPredict(series) {
  const topAbbrev = series.topSeed?.abbrev;
  const botAbbrev = series.bottomSeed?.abbrev;
  const topData = TEAM_DATA[topAbbrev] || {};
  const botData = TEAM_DATA[botAbbrev] || {};

  const topPts = topData.points || 80;
  const botPts = botData.points || 80;
  const topGD  = parseInt(String(topData.gd).replace('+', '')) || 0;
  const botGD  = parseInt(String(botData.gd).replace('+', '')) || 0;

  // Composite score: 60% points, 40% goal differential (normalized to ~100 scale)
  const topScore = topPts * 0.6 + (topGD + 100) * 0.4;
  const botScore = botPts * 0.6 + (botGD + 100) * 0.4;

  // Factor in current series wins
  const topWins = series.topSeed?.wins || 0;
  const botWins = series.bottomSeed?.wins || 0;
  const seriesBonus = (topWins - botWins) * 3; // each win gap adds weight

  const adjustedTop = topScore + seriesBonus;
  const adjustedBot = botScore - seriesBonus;

  const total = adjustedTop + adjustedBot;
  const topProb = adjustedTop / total;

  const isTopWinner = topProb >= 0.5;
  const winnerAbbrev = isTopWinner ? topAbbrev : botAbbrev;
  const confidence = isTopWinner ? topProb : (1 - topProb);

  // Estimate games: bigger gap = fewer games
  const gap = Math.abs(topProb - 0.5);
  let games;
  if (gap > 0.15) games = 4 + Math.max(topWins, botWins);
  else if (gap > 0.08) games = 5 + Math.min(topWins, botWins);
  else games = 6 + Math.min(1, Math.min(topWins, botWins));
  games = Math.max(4, Math.min(7, games));

  // MVP: pick first name from winner's key players
  const winnerData = isTopWinner ? topData : botData;
  const mvpMatch = (winnerData.key || '').match(/^([^(,]+)/);
  const mvp = mvpMatch ? mvpMatch[1].trim() : 'Unknown';

  const reasoning = `${winnerAbbrev} has ${isTopWinner ? topData.points : botData.points} pts and ${isTopWinner ? topData.gd : botData.gd} GD — statistical edge based on regular season performance.`;

  return {
    provider: 'stats-model',
    model: 'stats-fallback-v1',
    winner: winnerAbbrev,
    games,
    confidence: Math.round(confidence * 100) / 100,
    reasoning,
    mvp,
    fallback: false, // this IS a valid prediction, not a failure
  };
}

// ── Consensus aggregation ───────────────────────────────────────────────

/**
 * Given an array of provider predictions, compute a consensus pick.
 *
 * - Count votes for each predicted winner (skip fallback/null predictions).
 * - Average confidence across valid predictions.
 * - Majority team wins; ties broken by higher average confidence.
 *
 * @param {Array} predictions — [openaiResult, claudeResult, geminiResult]
 * @returns {object} consensus
 */
function buildConsensus(predictions) {
  const votes = {};   // abbrev → { count, totalConf, totalGames }
  let validCount = 0;

  for (const p of predictions) {
    if (!p.winner) continue; // skip fallback results
    validCount++;
    if (!votes[p.winner]) {
      votes[p.winner] = { count: 0, totalConf: 0, totalGames: 0 };
    }
    votes[p.winner].count += 1;
    votes[p.winner].totalConf += (p.confidence ?? 0);
    votes[p.winner].totalGames += (p.games ?? 0);
  }

  // No valid predictions at all — return empty consensus
  if (validCount === 0) {
    return { winner: null, confidence: 0, games: null, agreement: 'none' };
  }

  // Sort candidates: first by vote count (desc), then by avg confidence (desc)
  const candidates = Object.entries(votes)
    .map(([abbrev, v]) => ({
      abbrev,
      count: v.count,
      avgConf: v.totalConf / v.count,
      avgGames: Math.round(v.totalGames / v.count),
    }))
    .sort((a, b) => b.count - a.count || b.avgConf - a.avgConf);

  const pick = candidates[0];

  // Determine agreement level
  let agreement;
  if (pick.count === validCount) {
    agreement = 'unanimous';
  } else if (pick.count > validCount / 2) {
    agreement = 'majority';
  } else {
    agreement = 'split';
  }

  return {
    winner: pick.abbrev,
    confidence: Math.round(pick.avgConf * 100) / 100,
    games: pick.avgGames,
    agreement,
  };
}

// ── Main forecast generator ─────────────────────────────────────────────

/**
 * Generate forecasts for every provided series by querying all three LLMs
 * in parallel and aggregating results.
 *
 * @param {Array} allSeries — array of series objects
 * @returns {Array} forecasts
 */
export async function generateForecasts(allSeries) {
  if (!allSeries || allSeries.length === 0) {
    log('No series provided — skipping forecasts');
    return [];
  }

  log(`Generating forecasts for ${allSeries.length} series…`);

  const forecasts = await Promise.all(
    allSeries.map(async (series) => {
      const context = buildSeriesContext(series);

      // Query all three providers concurrently
      const [openaiResult, claudeResult, geminiResult] = await Promise.all([
        queryOpenAI(context),
        queryClaude(context),
        queryGemini(context),
      ]);

      let predictions = [openaiResult, claudeResult, geminiResult];

      // If ALL LLMs failed, inject a stats-based fallback so the dashboard
      // always shows meaningful predictions even without API keys.
      const allFailed = predictions.every((p) => !p.winner);
      if (allFailed) {
        const statsPick = statsFallbackPredict(series);
        predictions = [statsPick, ...predictions];
        log(`All LLMs failed for ${series.topSeed?.abbrev}-${series.bottomSeed?.abbrev} — using stats fallback → ${statsPick.winner} in ${statsPick.games}`);
      }

      const consensus = buildConsensus(predictions);

      const seriesId =
        series.seriesId ||
        `${series.topSeed?.abbrev || '???'}-vs-${series.bottomSeed?.abbrev || '???'}`;

      return {
        seriesId,
        predictions,
        consensus,
        generatedAt: new Date().toISOString(),
      };
    }),
  );

  log(`Forecasts complete — ${forecasts.length} series processed`);
  return forecasts;
}
