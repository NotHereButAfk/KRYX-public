export const TOURNAMENT_TYPES = Object.freeze({
  most_kills: {title:'Most Kills', objective:'Get the most kills in the tournament Deathmatch matches.'},
  longest_survival: {title:'Longest Survived in Survival', objective:'Stay alive for the longest time in the tournament Survival run.'},
});
export const tournamentType = id => Object.hasOwn(TOURNAMENT_TYPES,id) ? TOURNAMENT_TYPES[id] : null;
