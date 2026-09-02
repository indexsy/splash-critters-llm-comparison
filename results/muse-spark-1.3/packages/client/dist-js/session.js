// Shared session across screens.
export const session = {
    room: null,
    code: null,
    mode: 'duel',
    theme: 'backyard',
    roundsToWin: 3,
    roundNo: 1,
    castles: [],
    w: 13,
    h: 11,
    players: [],
    balloons: [],
    splashes: [],
    powerups: [],
    tideRing: 0,
    scores: {},
    placements: null,
    ratingDeltas: null,
    xp: null,
    queue: null,
    countdown: '',
};
export function resetMatch() {
    session.placements = null;
    session.ratingDeltas = null;
    session.xp = null;
    session.scores = {};
    session.roundNo = 1;
}
