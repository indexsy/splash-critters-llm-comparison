import { ensureNet } from './boot.js';
import { app } from './state.js';
import { renderTitle } from './screens/title.js';
import { renderMenu } from './screens/menu.js';
import { renderTutorial } from './screens/tutorial.js';
import { renderBrowser } from './screens/browser.js';
import { renderLobby } from './screens/lobby.js';
import { renderQueue } from './screens/queue.js';
import { renderGame } from './screens/game.js';
import { renderResults } from './screens/results.js';
import { renderLeaderboard } from './screens/leaderboard.js';
import { renderLocker } from './screens/locker.js';
import { renderSettings } from './screens/settings.js';
const root = document.getElementById('app');
let cleanup = null;
function nav(hash) {
    if (location.hash === hash)
        route();
    else
        location.hash = hash;
}
function route() {
    if (cleanup) {
        cleanup();
        cleanup = null;
    }
    const h = location.hash || '#/';
    const [path, query] = h.split('?');
    const q = new URLSearchParams(query ?? '');
    if (path.startsWith('#/room/')) {
        const code = path.slice('#/room/'.length).toUpperCase();
        cleanup = renderLobby(root, nav, code);
    }
    else if (path === '#/menu')
        cleanup = renderMenu(root, nav);
    else if (path === '#/tutorial')
        cleanup = renderTutorial(root, nav);
    else if (path === '#/browser')
        cleanup = renderBrowser(root, nav);
    else if (path === '#/queue')
        cleanup = renderQueue(root, nav, (q.get('mode') === 'ffa' ? 'ffa' : 'duel'));
    else if (path === '#/game')
        cleanup = renderGame(root, nav);
    else if (path === '#/results')
        cleanup = renderResults(root, nav);
    else if (path === '#/leaderboard')
        cleanup = renderLeaderboard(root, nav);
    else if (path === '#/locker')
        cleanup = renderLocker(root, nav);
    else if (path === '#/settings')
        cleanup = renderSettings(root, nav);
    else
        cleanup = renderTitle(root, nav);
}
window.addEventListener('hashchange', route);
ensureNet();
// Wait for profile (welcome) before first route so lobby joins are authed.
let tries = 0;
const iv = window.setInterval(() => {
    tries++;
    if (app.profile || tries > 40) {
        clearInterval(iv);
        if (!location.hash)
            location.hash = '#/';
        route();
    }
}, 100);
