// server/notifier.js — Desktop notification module for NHL Playoff Dashboard
// Uses node-notifier to push native OS notifications for goals, finals, upsets,
// and series-clinching moments.  Gated behind ENABLE_DESKTOP_NOTIFICATIONS env var.

import notifier from 'node-notifier';
import path from 'path';
import { fileURLToPath } from 'url';

// ── __dirname shim for ES modules ──────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Helpers ─────────────────────────────────────────────────────────────

function log(msg) {
  console.log(`[${new Date().toISOString()}] [Notifier] ${msg}`);
}

/**
 * Resolve the notification icon path.  Returns the path only if the file
 * appears to exist (we don't hard-fail on a missing icon).
 */
function resolveIcon() {
  try {
    return path.join(__dirname, '../public/nhl-icon.png');
  } catch {
    return undefined;
  }
}

// ── Core notification sender ────────────────────────────────────────────

/**
 * Send a desktop notification via node-notifier.
 *
 * Gated by ENABLE_DESKTOP_NOTIFICATIONS=true in the environment.
 * Always logs to the console regardless of the env toggle.
 *
 * @param {object} opts
 * @param {string} opts.title   — notification title
 * @param {string} opts.message — notification body
 * @param {string} [opts.type]  — 'info' | 'goal' | 'final' | 'upset' | 'series'
 * @returns {object} { sent: boolean, reason: string }
 */
export function sendNotification({ title, message, type = 'info' } = {}) {
  const displayTitle = title || '🏒 NHL Playoff Dashboard';
  const displayMessage = message || '';

  // Always log to console with timestamp
  log(`[${type.toUpperCase()}] ${displayTitle} — ${displayMessage}`);

  // Check feature flag
  if (process.env.ENABLE_DESKTOP_NOTIFICATIONS !== 'true') {
    return { sent: false, reason: 'Desktop notifications disabled (ENABLE_DESKTOP_NOTIFICATIONS != true)' };
  }

  if (!displayMessage) {
    return { sent: false, reason: 'No message content provided' };
  }

  try {
    notifier.notify({
      title: displayTitle,
      message: displayMessage,
      sound: true,
      wait: false,
      timeout: 10,
      icon: resolveIcon(),
    });
    return { sent: true, reason: 'Notification dispatched' };
  } catch (err) {
    log(`Notification error: ${err.message}`);
    return { sent: false, reason: `Notification error: ${err.message}` };
  }
}

// ── Specialized alert helpers ───────────────────────────────────────────

/**
 * Send a goal-scored notification.
 *
 * @param {string} scorerTeam  — abbreviation or full team name
 * @param {string} scorer      — player who scored
 * @param {string} score       — current score line (e.g. "COL 2, LAK 1")
 * @param {string} commentary  — Joe B commentary snippet
 */
export function sendGoalAlert(scorerTeam, scorer, score, commentary = '') {
  return sendNotification({
    title: `🚨 GOAL! ${scorerTeam}`,
    message: `${scorer} scores! ${score}\n${commentary}`.trim(),
    type: 'goal',
  });
}

/**
 * Send a game-final notification.
 *
 * @param {string} winner      — winning team
 * @param {string} loser       — losing team
 * @param {string} score       — final score
 * @param {string} seriesState — e.g. "COL leads 3-1"
 * @param {string} commentary  — Joe B commentary snippet
 */
export function sendGameFinalAlert(winner, loser, score, seriesState, commentary = '') {
  return sendNotification({
    title: `🏒 FINAL: ${winner} defeats ${loser}`,
    message: `${score} | Series: ${seriesState}\n${commentary}`.trim(),
    type: 'final',
  });
}

/**
 * Send an upset-alert notification.
 *
 * @param {string} underdog   — underdog team
 * @param {string} favorite   — favored team
 * @param {string} commentary — Joe B commentary snippet
 */
export function sendUpsetAlert(underdog, favorite, commentary = '') {
  return sendNotification({
    title: `⚠️ UPSET ALERT: ${underdog} leads ${favorite}!`,
    message: commentary,
    type: 'upset',
  });
}

/**
 * Send a series-clinching notification.
 *
 * @param {string} winner     — advancing team
 * @param {string} loser      — eliminated team
 * @param {string} round      — round label (e.g. "Round 1")
 * @param {string} commentary — Joe B commentary snippet
 */
export function sendSeriesAlert(winner, loser, round, commentary = '') {
  return sendNotification({
    title: `🏆 ${winner} advances!`,
    message: `${winner} eliminates ${loser} in ${round}\n${commentary}`.trim(),
    type: 'series',
  });
}
