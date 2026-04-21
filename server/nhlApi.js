// server/nhlApi.js — NHL API client for playoff dashboard
// Uses native fetch (Node 18+). All methods return sensible defaults on failure.

const BASE = 'https://api-web.nhle.com/v1';
const SEASON = '20252026';

function ts() {
  return new Date().toISOString();
}

/** Transform raw bracket payload into a clean series array */
export function buildSeriesState(bracketData) {
  if (!bracketData || !Array.isArray(bracketData.rounds)) return [];

  const series = [];

  for (const round of bracketData.rounds) {
    const roundNumber = round.roundNumber ?? round.round ?? 0;

    const rawSeries = round.series ?? round.seriesList ?? [];
    for (const s of rawSeries) {
      const top = s.topSeed ?? s.matchup?.topSeed ?? {};
      const bottom = s.bottomSeed ?? s.matchup?.bottomSeed ?? {};

      // Determine series status
      let seriesStatus = 'TBD';
      const topWins = top.wins ?? 0;
      const bottomWins = bottom.wins ?? 0;
      if (topWins === 4 || bottomWins === 4) {
        seriesStatus = 'COMPLETE';
      } else if (topWins > 0 || bottomWins > 0) {
        seriesStatus = 'IN_PROGRESS';
      } else if (top.abbrev && bottom.abbrev) {
        // Both teams known but no wins yet — could be upcoming or in progress
        seriesStatus = 'IN_PROGRESS';
      }

      const games = (s.games ?? []).map((g) => ({
        gameId: g.id ?? g.gameId ?? null,
        date: g.gameDate ?? g.startTimeUTC ?? null,
        homeTeam: g.homeTeam?.abbrev ?? g.homeTeam?.triCode ?? '',
        awayTeam: g.awayTeam?.abbrev ?? g.awayTeam?.triCode ?? '',
        homeScore: g.homeTeam?.score ?? g.homeScore ?? 0,
        awayScore: g.awayTeam?.score ?? g.awayScore ?? 0,
        state: g.gameState ?? g.gameScheduleState ?? 'FUT',
      }));

      series.push({
        seriesId: s.seriesLetter ?? s.seriesId ?? `R${roundNumber}-${series.length}`,
        round: roundNumber,
        topSeed: {
          abbrev: top.abbrev ?? top.triCode ?? '',
          name: top.name?.default ?? top.teamName ?? top.name ?? '',
          wins: topWins,
          logo: top.logo ?? top.teamLogo ?? '',
        },
        bottomSeed: {
          abbrev: bottom.abbrev ?? bottom.triCode ?? '',
          name: bottom.name?.default ?? bottom.teamName ?? bottom.name ?? '',
          wins: bottomWins,
          logo: bottom.logo ?? bottom.teamLogo ?? '',
        },
        seriesStatus,
        games,
      });
    }
  }

  return series;
}

class NHLApi {
  // ── Playoff bracket / carousel ──────────────────────────────────────
  async getPlayoffBracket() {
    try {
      const res = await fetch(`${BASE}/playoff-series/carousel/${SEASON}/`);
      if (!res.ok) throw new Error(`Bracket HTTP ${res.status}`);
      const data = await res.json();

      // Normalize: the API may nest rounds differently across seasons
      const rounds = (data.rounds ?? data.series ?? []).map((r) => {
        const roundNumber = r.roundNumber ?? r.round ?? 0;
        const seriesList = (r.series ?? r.seriesList ?? []).map((s) => {
          const top = s.topSeed ?? s.matchup?.topSeed ?? {};
          const bottom = s.bottomSeed ?? s.matchup?.bottomSeed ?? {};
          return {
            seriesLetter: s.seriesLetter ?? s.seriesId ?? null,
            topSeed: {
              abbrev: top.abbrev ?? '',
              name: top.name?.default ?? top.teamName ?? '',
              wins: top.wins ?? 0,
              logo: top.logo ?? '',
            },
            bottomSeed: {
              abbrev: bottom.abbrev ?? '',
              name: bottom.name?.default ?? bottom.teamName ?? '',
              wins: bottom.wins ?? 0,
              logo: bottom.logo ?? '',
            },
            games: s.games ?? [],
          };
        });
        return { roundNumber, series: seriesList };
      });

      return { rounds, lastUpdated: ts() };
    } catch (err) {
      console.error(`[${ts()}] getPlayoffBracket failed:`, err.message);
      return { rounds: [], lastUpdated: ts(), error: err.message };
    }
  }

  // ── Live scores ─────────────────────────────────────────────────────
  async getLiveScores() {
    try {
      const res = await fetch(`${BASE}/score/now`);
      if (!res.ok) throw new Error(`Scores HTTP ${res.status}`);
      const data = await res.json();

      const games = (data.games ?? [])
        .filter((g) => g.gameType === 3) // 3 = playoff
        .map((g) => ({
          gameId: g.id,
          homeTeam: {
            abbrev: g.homeTeam?.abbrev ?? '',
            name: g.homeTeam?.name?.default ?? g.homeTeam?.placeName?.default ?? '',
            logo: g.homeTeam?.logo ?? '',
          },
          awayTeam: {
            abbrev: g.awayTeam?.abbrev ?? '',
            name: g.awayTeam?.name?.default ?? g.awayTeam?.placeName?.default ?? '',
            logo: g.awayTeam?.logo ?? '',
          },
          homeScore: g.homeTeam?.score ?? 0,
          awayScore: g.awayTeam?.score ?? 0,
          period: g.period ?? 0,
          timeRemaining: g.clock?.timeRemaining ?? '',
          gameState: g.gameState ?? 'FUT', // LIVE, FINAL, FUT, PRE, CRIT, OFF
        }));

      return { games, lastUpdated: ts() };
    } catch (err) {
      console.error(`[${ts()}] getLiveScores failed:`, err.message);
      return { games: [], lastUpdated: ts(), error: err.message };
    }
  }

  // ── Single game details ─────────────────────────────────────────────
  async getGameDetails(gameId) {
    try {
      const res = await fetch(`${BASE}/gamecenter/${gameId}/landing`);
      if (!res.ok) throw new Error(`GameDetails HTTP ${res.status}`);
      const data = await res.json();

      const goals = (data.summary?.scoring ?? []).flatMap((period) =>
        (period.goals ?? []).map((g) => ({
          period: period.periodDescriptor?.number ?? 0,
          time: g.timeInPeriod ?? '',
          scorer: g.name?.default ?? g.firstName?.default + ' ' + g.lastName?.default ?? '',
          team: g.teamAbbrev?.default ?? g.teamAbbrev ?? '',
          assists: (g.assists ?? []).map((a) => a.name?.default ?? `${a.firstName?.default} ${a.lastName?.default}`),
          goalModifier: g.goalModifier ?? '',
        }))
      );

      const boxscore = data.boxscore ?? data.summary ?? {};
      const homeShots = boxscore.homeTeam?.sog ?? data.homeTeam?.sog ?? 0;
      const awayShots = boxscore.awayTeam?.sog ?? data.awayTeam?.sog ?? 0;

      const stars = (data.summary?.threeStars ?? []).map((s) => ({
        star: s.star ?? 0,
        name: s.name?.default ?? '',
        team: s.teamAbbrev ?? '',
        position: s.position ?? '',
      }));

      // Goalie stats from boxscore
      const extractGoalies = (teamBox) =>
        (teamBox?.goalies ?? []).map((gk) => ({
          name: gk.name?.default ?? '',
          savePct: gk.savePctg ?? 0,
          saves: gk.saves ?? 0,
          shotsAgainst: gk.shotsAgainst ?? 0,
          toi: gk.toi ?? '',
        }));

      const homeGoalies = extractGoalies(boxscore.playerByGameStats?.homeTeam ?? boxscore.homeTeam);
      const awayGoalies = extractGoalies(boxscore.playerByGameStats?.awayTeam ?? boxscore.awayTeam);

      return {
        gameId,
        goals,
        shots: { home: homeShots, away: awayShots },
        stars,
        goalies: { home: homeGoalies, away: awayGoalies },
        lastUpdated: ts(),
      };
    } catch (err) {
      console.error(`[${ts()}] getGameDetails(${gameId}) failed:`, err.message);
      return {
        gameId,
        goals: [],
        shots: { home: 0, away: 0 },
        stars: [],
        goalies: { home: [], away: [] },
        lastUpdated: ts(),
        error: err.message,
      };
    }
  }

  // ── Standings ───────────────────────────────────────────────────────
  async getStandings() {
    try {
      const res = await fetch(`${BASE}/standings/now`);
      if (!res.ok) throw new Error(`Standings HTTP ${res.status}`);
      const data = await res.json();

      const teams = (data.standings ?? []).map((t) => ({
        abbrev: t.teamAbbrev?.default ?? '',
        name: t.teamName?.default ?? '',
        conference: t.conferenceName ?? '',
        division: t.divisionName ?? '',
        wins: t.wins ?? 0,
        losses: t.losses ?? 0,
        otLosses: t.otLosses ?? 0,
        points: t.points ?? 0,
        gamesPlayed: t.gamesPlayed ?? 0,
        goalDiff: t.goalDifferential ?? 0,
        streakCode: t.streakCode ?? '',
        streakCount: t.streakCount ?? 0,
        logo: t.teamLogo ?? '',
      }));

      return { teams, lastUpdated: ts() };
    } catch (err) {
      console.error(`[${ts()}] getStandings failed:`, err.message);
      return { teams: [], lastUpdated: ts(), error: err.message };
    }
  }
}

const nhlApi = new NHLApi();
export default nhlApi;
