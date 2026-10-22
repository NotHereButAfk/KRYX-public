const number = (value) => Number.isFinite(value) ? value : 0;
export const compareMatchRows = (a, b) => number(b.kills) - number(a.kills)
  || number(b.score) - number(a.score) || String(a.name || '').localeCompare(String(b.name || ''));

// One row builder for the TAB scoreboard and the final results screen. In an
// authoritative match the server roster is the complete source of truth and
// already contains both humans and bots; local BotManager slots must not be
// consulted because AuthNetBridge deliberately clears them on welcome.
export function buildMatchRows({
  authClient = null,
  playerName = 'You',
  playerKills = 0,
  playerDeaths = 0,
  playerScore = 0,
  bots = [],
  isSurvival = false,
} = {}) {
  if (authClient) {
    return (authClient.roster || []).filter(entry=>!entry.survivalEnemy).map((entry) => {
      const isYou = entry.id === authClient.you;
      const self = isYou ? (authClient.self || {}) : entry;
      return {
        name: entry.name || (isYou ? playerName : 'Player'),
        nameCosmetics:entry.nameCosmetics||null,
        kills: number(self.kills),
        deaths: number(self.deaths),
        score: number(self.score),
        assists: number(self.assists),
        survival: isSurvival, damageDealt:number(entry.damageDealt), bossDamage:number(entry.bossDamage),wavesSurvived:number(entry.wavesSurvived),
        isYou,
        isBot: !!entry.isBot,
      };
    }).sort(compareMatchRows);
  }

  const rows = [{
    name: playerName || 'You',
    kills: number(playerKills),
    deaths: number(playerDeaths),
    score: number(playerScore),
    isYou: true,
    isBot: false,
  }];
  if (!isSurvival) {
    for (const bot of bots || []) {
      const networked = bot._netId != null;
      const kills = number(networked ? bot._netKills : bot._botKills);
      rows.push({
        name: bot.displayName || 'Spartan',
        kills,
        deaths: number(networked ? bot._netDeaths : bot._botDeaths),
        score: number(networked ? bot._netScore : kills * 100),
        isYou: false,
        isBot: !networked,
      });
    }
  }
  return rows.sort(compareMatchRows);
}

export function buildLeaderboardRows(rows) {
  return (rows || []).map((row) => {
    const kills = number(row.kills);
    const deaths = number(row.deaths);
    return {
      ...row,
      kills,
      deaths,
      score: number(row.score),
      assists: row.assists,
      kd: deaths > 0 ? (kills / deaths).toFixed(1) : kills.toFixed(1),
    };
  }).sort(compareMatchRows);
}

