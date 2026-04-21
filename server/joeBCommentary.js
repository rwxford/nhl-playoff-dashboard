// server/joeBCommentary.js — Joe Beninati-style AI commentary generator
// Uses OpenAI gpt-4o for creative play-by-play text, with a fallback bank
// for when the API is unavailable.

import OpenAI from 'openai';

// ── Joe B system prompt ─────────────────────────────────────────────────
const JOE_B_SYSTEM = `You are Joe Beninati, the legendary NHL play-by-play announcer. You are providing live commentary for the 2026 Stanley Cup Playoffs.

Your style rules:
- ELECTRIC, passionate, dramatic delivery
- Use your signature catchphrases: "Where mama hides the cookies!" (top-shelf goal), "SCORE!" (loud, emphatic), "What a save!", "He wires one!", "Off the post and IN!"
- Reference player stats and storylines naturally
- Keep each call to 2-4 sentences max — punchy, vivid, immediate
- Use ALL CAPS for emphasis on key moments
- Vary your calls — don't repeat the same phrases
- For game-ending moments, go BIGGER
- For routine updates, be professional but engaging
- Reference the significance: "14-year drought", "first-ever playoff game", "Presidents' Trophy winners"
- Always mention both teams — give credit where due

Event types you'll commentate on:
- GOAL: Most dramatic. Name the scorer, the assist, describe the shot.
- PERIOD_END: Summarize the period, key stats.
- GAME_FINAL: Dramatic wrap-up. Series implications.
- SERIES_UPDATE: When a team wins/takes a lead in the series.
- UPSET_ALERT: When an underdog is winning or pulls off an upset.
- SAVE: Great goaltending moment.
`;

// ── Fallback commentary bank ────────────────────────────────────────────
// Used when the OpenAI API is unavailable (missing key, rate limit, etc.).
const FALLBACK_CALLS = {
  GOAL: [
    "SCORE! WHERE MAMA HIDES THE COOKIES! Top shelf, bar down, and the building ERUPTS!",
    "He WIRES one past the goaltender! What a SHOT! What a MOMENT!",
    "SCORES! Off the rush, quick release, and it's IN! The crowd is on their FEET!",
  ],
  PERIOD_END: [
    "And that will do it for this period, folks. WHAT a battle we've witnessed.",
    "The horn sounds! Both teams leaving it ALL on the ice tonight.",
  ],
  GAME_FINAL: [
    "THAT'S the game! What a performance! Playoff hockey at its absolute FINEST!",
    "Final horn! The handshake line forms — respect between warriors.",
  ],
  UPSET_ALERT: [
    "UPSET ALERT! The underdogs are BARKING tonight! Nobody saw THIS coming!",
    "Hold onto your hats, folks — we have got ourselves a SERIES!",
  ],
  SAVE: [
    "What a SAVE! Robbed him BLIND! That's why they pay the big bucks, folks!",
    "STOPPED! Larceny! Grand THEFT! The goaltender says NOT TODAY!",
  ],
  SERIES_UPDATE: [
    "And JUST LIKE THAT, the series has shifted! Buckle up, folks — this is far from over!",
    "What a STATEMENT win! The pressure is ON now in this series!",
  ],
};

// ── Helpers ─────────────────────────────────────────────────────────────

function log(msg) {
  console.log(`[${new Date().toISOString()}] [JoeB] ${msg}`);
}

/**
 * Pick a random entry from an array.
 */
function randomPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Build a concise user-prompt describing the event so the LLM can commentate.
 *
 * @param {object} event
 * @returns {string}
 */
function buildUserPrompt(event) {
  const { type, gameContext, details } = event;
  const ctx = gameContext || {};
  const scoreLine = `${ctx.awayTeam || '???'} ${ctx.awayScore ?? 0} @ ${ctx.homeTeam || '???'} ${ctx.homeScore ?? 0}`;
  const periodInfo = ctx.period ? `Period ${ctx.period}` : '';
  const timeInfo = ctx.time ? `(${ctx.time} remaining)` : '';

  const lines = [
    `EVENT TYPE: ${type}`,
    `SCORE: ${scoreLine}`,
  ];

  if (periodInfo) lines.push(`TIME: ${periodInfo} ${timeInfo}`.trim());
  if (details) lines.push(`DETAILS: ${details}`);

  lines.push('', 'Provide your Joe Beninati-style call for this moment.');

  return lines.join('\n');
}

/**
 * Return a fallback commentary string for the given event type.
 *
 * @param {string} eventType
 * @returns {string}
 */
function getFallbackCommentary(eventType) {
  const pool = FALLBACK_CALLS[eventType] || FALLBACK_CALLS.GOAL;
  return randomPick(pool);
}

// ── Main commentary generator ───────────────────────────────────────────

/**
 * Generate Joe Beninati-style commentary for a game event.
 *
 * @param {object} event — { type, gameContext: { homeTeam, awayTeam, homeScore, awayScore, period, time }, details }
 * @returns {object} — { text, event, timestamp, gameId }
 */
export async function generateCommentary(event) {
  const eventType = event?.type || 'GOAL';
  const gameId = event?.gameContext?.gameId || event?.gameId || 'unknown';
  const timestamp = new Date().toISOString();

  try {
    // ── Validate API key ──────────────────────────────────────────────
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey === 'sk-xxx') {
      throw new Error('OPENAI_API_KEY not configured');
    }

    const client = new OpenAI({ apiKey });
    const userPrompt = buildUserPrompt(event);

    const completion = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: JOE_B_SYSTEM },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.9,  // higher temp for creative, varied calls
      max_tokens: 250,
    });

    const text = completion.choices?.[0]?.message?.content?.trim();
    if (!text) {
      throw new Error('Empty response from OpenAI');
    }

    log(`Commentary generated for ${gameId} (${eventType})`);
    return { text, event: eventType, timestamp, gameId };
  } catch (err) {
    log(`API error — using fallback: ${err.message}`);
    const fallbackText = getFallbackCommentary(eventType);
    return { text: fallbackText, event: eventType, timestamp, gameId };
  }
}
