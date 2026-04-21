/* ═══════════════════════════════════════════════════════════════
   NHL Playoff Dashboard — app.js
   Vanilla JS frontend: WebSocket + REST fallback, bracket
   rendering, predictions, commentary feed.
   ═══════════════════════════════════════════════════════════════ */

class PlayoffDashboard {
  constructor() {
    this.ws = null;
    this.bracket = null;
    this.scores = [];
    this.predictions = {};
    this.commentary = [];
    this.notificationsEnabled = true;
    this.reconnectDelay = 1000;
    this.reconnectMax = 30000;
    this.pollInterval = null;
    this.init();
  }

  /* ────────────────────────────────────────────────────────────
     DEFAULTS — 2026 Bracket Seed Data
     ──────────────────────────────────────────────────────────── */
  static DEFAULT_BRACKET = {
    east: {
      r1: [
        { id: 'east-r1-1', topSeed: 'CAR', botSeed: 'OTT', topWins: 0, botWins: 0, status: 'UPCOMING', games: [] },
        { id: 'east-r1-2', topSeed: 'PIT', botSeed: 'PHI', topWins: 0, botWins: 0, status: 'UPCOMING', games: [] },
        { id: 'east-r1-3', topSeed: 'BUF', botSeed: 'BOS', topWins: 0, botWins: 0, status: 'UPCOMING', games: [] },
        { id: 'east-r1-4', topSeed: 'TBL', botSeed: 'MTL', topWins: 0, botWins: 0, status: 'UPCOMING', games: [] },
      ],
      r2: [
        { id: 'east-r2-1', topSeed: null, botSeed: null, topWins: 0, botWins: 0, status: 'UPCOMING', games: [] },
        { id: 'east-r2-2', topSeed: null, botSeed: null, topWins: 0, botWins: 0, status: 'UPCOMING', games: [] },
      ],
      r3: [
        { id: 'east-r3-1', topSeed: null, botSeed: null, topWins: 0, botWins: 0, status: 'UPCOMING', games: [] },
      ],
    },
    west: {
      r1: [
        { id: 'west-r1-1', topSeed: 'COL', botSeed: 'LAK', topWins: 0, botWins: 0, status: 'UPCOMING', games: [] },
        { id: 'west-r1-2', topSeed: 'DAL', botSeed: 'MIN', topWins: 0, botWins: 0, status: 'UPCOMING', games: [] },
        { id: 'west-r1-3', topSeed: 'VGK', botSeed: 'UTA', topWins: 0, botWins: 0, status: 'UPCOMING', games: [] },
        { id: 'west-r1-4', topSeed: 'EDM', botSeed: 'ANA', topWins: 0, botWins: 0, status: 'UPCOMING', games: [] },
      ],
      r2: [
        { id: 'west-r2-1', topSeed: null, botSeed: null, topWins: 0, botWins: 0, status: 'UPCOMING', games: [] },
        { id: 'west-r2-2', topSeed: null, botSeed: null, topWins: 0, botWins: 0, status: 'UPCOMING', games: [] },
      ],
      r3: [
        { id: 'west-r3-1', topSeed: null, botSeed: null, topWins: 0, botWins: 0, status: 'UPCOMING', games: [] },
      ],
    },
    final: { id: 'final', topSeed: null, botSeed: null, topWins: 0, botWins: 0, status: 'UPCOMING', games: [] },
  };

  /* ────────────────────────────────────────────────────────────
     INITIALIZATION
     ──────────────────────────────────────────────────────────── */
  init() {
    // DOM references
    this.els = {
      liveDot:          document.getElementById('live-dot'),
      tickerContent:    document.getElementById('ticker-content'),
      bracketEast:      document.getElementById('bracket-east'),
      bracketWest:      document.getElementById('bracket-west'),
      bracketFinal:     document.getElementById('bracket-final'),
      predictionsContent: document.getElementById('predictions-content'),
      commentaryFeed:   document.getElementById('commentary-feed'),
      notifyBtn:        document.getElementById('notification-toggle'),
      notifyLabel:      document.getElementById('notify-label'),
      lastUpdated:      document.getElementById('last-updated'),
    };

    // Event listeners
    this.els.notifyBtn.addEventListener('click', () => this.toggleNotifications());

    // Connect WS + initial fetch
    this.connectWebSocket();
    this.fetchBracket();
    this.fetchScores();
    this.fetchPredictions();

    // Fallback polling every 30 s
    this.pollInterval = setInterval(() => {
      this.fetchScores();
      this.fetchBracket();
      this.fetchPredictions();
    }, 30000);
  }

  /* ────────────────────────────────────────────────────────────
     WEBSOCKET
     ──────────────────────────────────────────────────────────── */
  connectWebSocket() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}`;
    try {
      this.ws = new WebSocket(url);
    } catch (_) {
      this.scheduleReconnect();
      return;
    }

    this.ws.addEventListener('open', () => {
      console.log('[WS] connected');
      this.reconnectDelay = 1000; // reset backoff
    });

    this.ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.routeMessage(msg);
      } catch (err) {
        console.error('[WS] bad message', err);
      }
    });

    this.ws.addEventListener('close', () => {
      console.warn('[WS] closed — reconnecting');
      this.scheduleReconnect();
    });

    this.ws.addEventListener('error', () => {
      // close will also fire; let it handle reconnect
      this.ws.close();
    });
  }

  scheduleReconnect() {
    setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.reconnectMax);
      this.connectWebSocket();
    }, this.reconnectDelay);
  }

  routeMessage(msg) {
    switch (msg.type) {
      case 'init':
        if (msg.data.bracket) {
          this.bracket = this.mapSeriesToBracket(msg.data.bracket);
          requestAnimationFrame(() => this.renderBracket());
        }
        if (msg.data.scores) {
          this.scores = msg.data.scores;
          requestAnimationFrame(() => this.renderScores());
        }
        if (msg.data.predictions) {
          this.predictions = msg.data.predictions;
          requestAnimationFrame(() => this.renderPredictions());
        }
        break;
      case 'bracket':
        this.bracket = this.mapSeriesToBracket(msg.data);
        requestAnimationFrame(() => this.renderBracket());
        break;
      case 'scores':
        this.scores = msg.data;
        requestAnimationFrame(() => this.renderScores());
        break;
      case 'predictions':
        this.predictions = msg.data;
        requestAnimationFrame(() => this.renderPredictions());
        break;
      case 'commentary':
        this.commentary.push(msg.data);
        requestAnimationFrame(() => this.renderCommentary(msg.data));
        break;
      case 'notification':
        if (this.notificationsEnabled) {
          this.showBrowserNotification(msg.data.title, msg.data.body);
        }
        break;
      default:
        console.log('[WS] unknown type', msg.type);
    }
    this.updateTimestamp();
  }

  /* ────────────────────────────────────────────────────────────
     DATA FETCHING (REST fallback)
     ──────────────────────────────────────────────────────────── */
  async fetchBracket() {
    try {
      const res = await fetch('/api/bracket');
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json();
      this.bracket = this.mapSeriesToBracket(data);
    } catch {
      if (!this.bracket) this.bracket = PlayoffDashboard.DEFAULT_BRACKET;
    }
    requestAnimationFrame(() => this.renderBracket());
    this.updateTimestamp();
  }

  async fetchScores() {
    try {
      const res = await fetch('/api/scores');
      if (!res.ok) throw new Error(res.statusText);
      this.scores = await res.json();
      requestAnimationFrame(() => this.renderScores());
      this.updateTimestamp();
    } catch {
      // silently retry on next poll
    }
  }

  async fetchPredictions() {
    try {
      const res = await fetch('/api/predictions');
      if (!res.ok) throw new Error(res.statusText);
      this.predictions = await res.json();
      requestAnimationFrame(() => this.renderPredictions());
      this.updateTimestamp();
    } catch {
      // silently retry on next poll
    }
  }

  /* ────────────────────────────────────────────────────────────
     HELPERS
     ──────────────────────────────────────────────────────────── */
  getTeamLogo(abbrev) {
    if (!abbrev) return '';
    return `https://assets.nhle.com/logos/nhl/svg/${abbrev}_dark.svg`;
  }

  getConfidenceColor(pct) {
    if (pct >= 75) return 'high';
    if (pct >= 50) return 'medium';
    return 'low';
  }

  updateTimestamp() {
    const now = new Date();
    const ts = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    this.els.lastUpdated.textContent = `Last updated: ${ts}`;
  }

  /* ────────────────────────────────────────────────────────────
     SERVER DATA → BRACKET MAPPING
     ──────────────────────────────────────────────────────────── */
  mapSeriesToBracket(serverData) {
    // If data already has conference structure, return as-is
    if (serverData?.east && serverData?.west) return serverData;

    const bracket = JSON.parse(JSON.stringify(PlayoffDashboard.DEFAULT_BRACKET));
    const series = serverData?.series || [];

    // Known R1 slot mappings
    const R1_SLOTS = {
      east: {
        0: ['CAR', 'OTT'],
        1: ['PIT', 'PHI'],
        2: ['BUF', 'BOS'],
        3: ['TBL', 'MTL'],
      },
      west: {
        0: ['COL', 'LAK'],
        1: ['DAL', 'MIN'],
        2: ['VGK', 'UTA'],
        3: ['EDM', 'ANA'],
      },
    };

    for (const s of series) {
      if (!s.topSeed?.abbrev || !s.bottomSeed?.abbrev) continue;
      const pair = [s.topSeed.abbrev, s.bottomSeed.abbrev];
      const round = s.round || 1;

      if (round === 1) {
        for (const conf of ['east', 'west']) {
          for (const [idx, teams] of Object.entries(R1_SLOTS[conf])) {
            if (pair.includes(teams[0]) && pair.includes(teams[1])) {
              const slot = bracket[conf].r1[parseInt(idx)];
              slot.topSeed = s.topSeed.abbrev;
              slot.botSeed = s.bottomSeed.abbrev;
              slot.topWins = s.topSeed.wins || 0;
              slot.botWins = s.bottomSeed.wins || 0;
              slot.status = s.seriesStatus === 'COMPLETE' ? 'FINAL' : s.seriesStatus === 'IN_PROGRESS' ? 'LIVE' : 'UPCOMING';
              slot.games = (s.games || []).map(g => ({
                home: g.homeTeam, away: g.awayTeam,
                homeScore: g.homeScore, awayScore: g.awayScore,
                winner: g.state === 'FINAL' || g.state === 'OFF' ? (g.homeScore > g.awayScore ? g.homeTeam : g.awayTeam) : null
              }));
            }
          }
        }
      }
      // For rounds 2, 3, 4 — map similarly if data exists
    }
    return bracket;
  }

  /* ────────────────────────────────────────────────────────────
     RENDER — BRACKET
     ──────────────────────────────────────────────────────────── */
  renderBracket() {
    if (!this.bracket) return;

    const b = this.bracket;

    // East
    this.renderConferenceBracket('east', b.east);
    // West
    this.renderConferenceBracket('west', b.west);
    // Final
    const finalSlot = document.getElementById('final-s1');
    if (finalSlot && b.final) {
      finalSlot.innerHTML = '';
      finalSlot.appendChild(this.createSeriesCard(b.final));
    }

    // Update live dot visibility
    const hasLive = this.hasLiveGames();
    this.els.liveDot.classList.toggle('hidden', !hasLive);
  }

  renderConferenceBracket(conf, data) {
    if (!data) return;
    const rounds = ['r1', 'r2', 'r3'];
    rounds.forEach((r) => {
      const series = data[r];
      if (!series) return;
      series.forEach((s, idx) => {
        const slotId = `${conf}-${r}-s${idx + 1}`;
        const slot = document.getElementById(slotId);
        if (!slot) return;
        slot.innerHTML = '';
        slot.appendChild(this.createSeriesCard(s));
      });
    });
  }

  hasLiveGames() {
    if (!this.bracket) return false;
    const check = (series) => series && series.some((s) => s.status === 'LIVE');
    const b = this.bracket;
    if (b.final && b.final.status === 'LIVE') return true;
    for (const conf of ['east', 'west']) {
      for (const r of ['r1', 'r2', 'r3']) {
        if (b[conf] && check(b[conf][r])) return true;
      }
    }
    const scoreGames = Array.isArray(this.scores) ? this.scores : (this.scores?.games || []);
    return scoreGames.some((g) => (g.status || g.gameState) === 'LIVE');
  }

  /* ── Series Card builder ─────────────────────────────────── */
  createSeriesCard(series) {
    const card = document.createElement('div');
    card.className = 'series-card';
    if (series.status === 'LIVE') card.classList.add('live');

    // If no teams yet (TBD)
    const topAbbrev = series.topSeed || 'TBD';
    const botAbbrev = series.botSeed || 'TBD';

    // Status badge
    const statusClass = {
      LIVE: 'status-live',
      FINAL: 'status-final',
      UPCOMING: 'status-upcoming',
    }[series.status] || 'status-upcoming';

    card.innerHTML = `
      <div class="series-header">
        <span class="series-label">${series.id || ''}</span>
        <span class="series-status ${statusClass}">${series.status || 'UPCOMING'}</span>
      </div>
      ${this.buildTeamRow(topAbbrev, series.topWins, series.topWins > series.botWins)}
      ${this.buildTeamRow(botAbbrev, series.botWins, series.botWins > series.topWins)}
      <div class="series-detail">
        <ul class="game-list">
          ${this.buildGameList(series.games || [])}
        </ul>
      </div>
    `;

    // Click to expand
    card.addEventListener('click', () => card.classList.toggle('expanded'));

    return card;
  }

  buildTeamRow(abbrev, wins, isLeader) {
    const logo = abbrev !== 'TBD' ? `<img class="team-logo" src="${this.getTeamLogo(abbrev)}" alt="${abbrev}" onerror="this.style.display='none'">` : '<span class="team-logo" style="width:28px"></span>';
    let dots = '';
    for (let i = 0; i < 4; i++) {
      dots += `<span class="win-dot${i < wins ? ' filled' : ''}"></span>`;
    }
    return `
      <div class="team-row${isLeader ? ' leader' : ''}">
        ${logo}
        <span class="team-abbrev">${abbrev}</span>
        <span class="win-dots">${dots}</span>
      </div>
    `;
  }

  buildGameList(games) {
    if (!games || games.length === 0) return '<li>No games played yet</li>';
    return games.map((g, i) => {
      const winnerClass = g.winner ? 'gm-winner' : '';
      return `<li>
        <span>Game ${i + 1}</span>
        <span class="${winnerClass}">${g.away || '?'} ${g.awayScore ?? '-'} @ ${g.home || '?'} ${g.homeScore ?? '-'}</span>
      </li>`;
    }).join('');
  }

  /* Bracket connector lines (CSS-based, via existing HTML structure) */
  createConnectorLine(fromEl, toEl) {
    // Connectors are handled via CSS pseudo-elements and the
    // .connector-group elements already in the HTML.
    // This method is a no-op placeholder kept for API completeness.
  }

  /* ────────────────────────────────────────────────────────────
     RENDER — LIVE SCORES TICKER
     ──────────────────────────────────────────────────────────── */
  renderScores() {
    const container = this.els.tickerContent;
    const games = Array.isArray(this.scores) ? this.scores : (this.scores?.games || []);
    if (!games || games.length === 0) {
      container.innerHTML = '<div class="ticker-placeholder">No active games right now</div>';
      return;
    }

    const normalized = games.map(g => ({
      home: g.homeTeam?.abbrev || g.home || '',
      away: g.awayTeam?.abbrev || g.away || '',
      homeScore: g.homeScore ?? 0,
      awayScore: g.awayScore ?? 0,
      status: g.gameState || g.status || 'FUT',
      period: g.period ? `P${g.period}` : '',
      timeRemaining: g.timeRemaining || '',
    }));

    const fragment = document.createDocumentFragment();
    normalized.forEach((game, idx) => {
      if (idx > 0) {
        const divider = document.createElement('div');
        divider.className = 'ticker-divider';
        fragment.appendChild(divider);
      }

      const el = document.createElement('div');
      el.className = 'ticker-game';
      if (game.status === 'LIVE') el.classList.add('live');

      const statusClass = game.status === 'LIVE' ? 'live-status' : game.status === 'FINAL' ? 'final-status' : '';
      let statusText = game.status || '';
      if (game.status === 'LIVE' && game.period && game.timeRemaining) {
        statusText = `${game.period} — ${game.timeRemaining}`;
      }

      el.innerHTML = `
        <div class="team-score">
          <img src="${this.getTeamLogo(game.away)}" alt="${game.away}" width="22" height="22" onerror="this.style.display='none'">
          <span>${game.away || ''}</span>
          <span class="score-num">${game.awayScore ?? 0}</span>
        </div>
        <span class="vs-dash">@</span>
        <div class="team-score">
          <img src="${this.getTeamLogo(game.home)}" alt="${game.home}" width="22" height="22" onerror="this.style.display='none'">
          <span>${game.home || ''}</span>
          <span class="score-num">${game.homeScore ?? 0}</span>
        </div>
        <span class="game-status ${statusClass}">${statusText}</span>
      `;
      fragment.appendChild(el);
    });

    container.innerHTML = '';
    container.appendChild(fragment);
  }

  /* ────────────────────────────────────────────────────────────
     RENDER — PREDICTIONS
     ──────────────────────────────────────────────────────────── */
  renderPredictions() {
    const container = this.els.predictionsContent;
    const rawData = this.predictions;
    let entries = [];

    if (rawData?.predictions) {
      entries = rawData.predictions;
    } else if (Array.isArray(rawData)) {
      entries = rawData;
    } else {
      entries = Object.values(rawData || {});
    }

    if (entries.length === 0) {
      container.innerHTML = '<div class="placeholder-msg">No predictions available yet</div>';
      return;
    }

    const fragment = document.createDocumentFragment();
    entries.forEach(pred => {
      const card = document.createElement('div');
      const confidence = pred.consensus?.confidence ? Math.round(pred.consensus.confidence * 100) : 0;
      const confLevel = this.getConfidenceColor(confidence);
      card.className = `prediction-card confidence-${confLevel}`;

      const picks = (pred.predictions || pred.picks || []).map(p => `
        <div class="llm-pick">
          <span class="llm-name">${this.sanitize(p.provider || p.llm || '')}</span>
          <span class="llm-value">${this.sanitize(p.winner || p.pick || '—')}</span>
          <span class="llm-conf">${p.confidence ? Math.round(p.confidence * 100) : 0}%</span>
        </div>
      `).join('');

      card.innerHTML = `
        <div class="pred-matchup">${this.sanitize(pred.seriesId || pred.matchup || '')}</div>
        <div class="llm-picks">${picks}</div>
        <div class="consensus-row">
          <span class="consensus-label">Consensus</span>
          <div class="consensus-bar"><div class="consensus-fill ${confLevel}" style="width:${confidence}%"></div></div>
          <span class="consensus-pct">${confidence}%</span>
        </div>
        <div class="consensus-pick">${this.sanitize(pred.consensus?.winner || pred.consensus?.pick || '—')}${pred.consensus?.games ? ` in ${pred.consensus.games}` : ''} <span style="color:var(--gray-500);font-size:.6rem">${pred.consensus?.agreement || ''}</span></div>
      `;
      fragment.appendChild(card);
    });

    container.innerHTML = '';
    container.appendChild(fragment);
  }

  /* ────────────────────────────────────────────────────────────
     RENDER — COMMENTARY FEED
     ──────────────────────────────────────────────────────────── */
  renderCommentary(entry) {
    const feed = this.els.commentaryFeed;

    // Remove placeholder if present
    const placeholder = feed.querySelector('.commentary-placeholder');
    if (placeholder) placeholder.remove();

    const el = document.createElement('div');
    const eventType = (entry.eventType || '').toLowerCase();
    el.className = `commentary-entry event-${eventType}`;

    const ts = entry.timestamp
      ? new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : '';

    el.innerHTML = `
      <div class="entry-meta">
        <span class="entry-time">${ts}</span>
        <span class="entry-context">${this.sanitize(entry.context || '')}</span>
      </div>
      <div class="entry-text">${this.sanitize(entry.text || '')}</div>
    `;

    feed.appendChild(el);

    // Auto-scroll to newest entry
    requestAnimationFrame(() => {
      feed.scrollTop = feed.scrollHeight;
    });

    // Optional audio chime
    this.playChime();
  }

  /** Render an entire array of commentary entries (used on initial fetch) */
  renderAllCommentary() {
    const feed = this.els.commentaryFeed;
    feed.innerHTML = '';
    if (this.commentary.length === 0) {
      feed.innerHTML = '<div class="placeholder-msg commentary-placeholder">Waiting for play-by-play…</div>';
      return;
    }
    this.commentary.forEach((entry) => this.renderCommentary(entry));
  }

  /* ────────────────────────────────────────────────────────────
     NOTIFICATIONS
     ──────────────────────────────────────────────────────────── */
  toggleNotifications() {
    this.notificationsEnabled = !this.notificationsEnabled;
    this.els.notifyBtn.classList.toggle('off', !this.notificationsEnabled);
    this.els.notifyLabel.textContent = this.notificationsEnabled ? 'Notifications ON' : 'Notifications OFF';

    if (this.notificationsEnabled && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  showBrowserNotification(title, body) {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') {
      Notification.requestPermission().then((perm) => {
        if (perm === 'granted') new Notification(title, { body, icon: this.getTeamLogo('NHL') });
      });
      return;
    }
    try {
      new Notification(title, { body, icon: this.getTeamLogo('NHL') });
    } catch {
      // Silent fail on environments that block notifications
    }
  }

  /* ────────────────────────────────────────────────────────────
     AUDIO CHIME (subtle, optional)
     ──────────────────────────────────────────────────────────── */
  playChime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    } catch {
      // Audio not available — silent
    }
  }

  /* ────────────────────────────────────────────────────────────
     UTIL
     ──────────────────────────────────────────────────────────── */
  sanitize(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

/* ── Boot ──────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  window.dashboard = new PlayoffDashboard();
});
