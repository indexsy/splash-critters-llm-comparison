// Acceptance flow 5: audio sanity. A probe (installed before the page loads) taps everything the
// game connects to the speakers into an AnalyserNode, so the script measures what a player would
// hear. Checks: sound starts after the first key press, M mutes and unmutes (the Settings toggle
// follows), the Music slider really scales the music (keyboard on the slider), a second tab's M
// reaches this tab (shared settings), no console errors.
// The tab is left muted at the end (the owner asked for quiet test tabs).
import { Checks, clickButton, errorsOf, loadChromium, log, newPage, shot, sleep, startServer, waitScreen } from './lib.mjs';

const checks = new Checks('flow5-audio');
const server = await startServer();
const browser = await loadChromium().launch();

/** Runs in the page before any game script: mirror every connection to the destination. */
function installAudioProbe() {
  const probes = new WeakMap();
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function patched(target, ...rest) {
    const result = connect.call(this, target, ...rest);
    if (target instanceof AudioDestinationNode) {
      const ctx = target.context;
      let analyser = probes.get(ctx);
      if (!analyser) {
        analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        probes.set(ctx, analyser);
        window.__audioProbe = analyser;
      }
      connect.call(this, analyser);
    }
    return result;
  };
}

/** RMS of the game's output over ~`ms`: the mean of analyser-window RMS values sampled every 40 ms. */
async function level(page, ms = 1200) {
  return page.evaluate(async (dur) => {
    const a = window.__audioProbe;
    if (!a) return -1;
    const buf = new Float32Array(a.fftSize);
    let sum = 0;
    let n = 0;
    const end = performance.now() + dur;
    while (performance.now() < end) {
      a.getFloatTimeDomainData(buf);
      let s = 0;
      for (const v of buf) s += v * v;
      sum += Math.sqrt(s / buf.length);
      n += 1;
      await new Promise((r) => setTimeout(r, 40));
    }
    return Math.round((sum / Math.max(1, n)) * 10000) / 10000;
  }, ms);
}

async function musicSlider(page) {
  const slider = page.getByRole('slider', { name: /Music/i });
  await slider.waitFor({ timeout: 5000 });
  return slider;
}

try {
  const context = await browser.newContext({ viewport: { width: 800, height: 700 } });
  await context.addInitScript(installAudioProbe);
  const page = await newPage(context, 'audio', { music: true });
  await page.goto(server.base);
  await page.locator('.title-prompt').waitFor({ timeout: 15000 });
  const silentBefore = await level(page, 400);
  checks.ok('no audio before the first user gesture (autoplay policy)', silentBefore <= 0, `probe ${silentBefore}`);
  await page.keyboard.press('Enter');
  const skip = page.getByRole('button', { name: 'Skip', exact: true });
  await skip.waitFor({ timeout: 10000 });
  await skip.click();
  await waitScreen(page, 'menu');
  await sleep(800);
  const menuMusic = await level(page);
  checks.ok('menu music plays after the first key press', menuMusic > 0.005, `RMS ${menuMusic}`);

  await page.keyboard.press('KeyM');
  await sleep(300);
  const muted = await level(page);
  checks.ok('M mutes everything', muted < 0.0005, `RMS ${muted}`);
  await page.keyboard.press('KeyM');
  await sleep(300);
  const unmuted = await level(page);
  checks.ok('M again unmutes', unmuted > 0.005, `RMS ${unmuted}`);

  await clickButton(page, 'Settings');
  await waitScreen(page, 'settings');
  await sleep(500);
  const slider = await musicSlider(page);
  await slider.focus();
  const levels = {};
  await page.keyboard.press('End');
  await sleep(500);
  levels['1.0'] = await level(page);
  await page.keyboard.press('Home');
  await sleep(500);
  levels['0.0'] = await level(page);
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  const value = await slider.getAttribute('aria-valuenow') ?? (await slider.inputValue());
  await sleep(500);
  levels.partial = await level(page);
  log(`  music levels by slider: ${JSON.stringify(levels)} (partial slider value ${value})`);
  checks.ok('music respects the Music volume slider (0 silent, partial < full)', levels['0.0'] < 0.0005 && levels.partial > levels['0.0'] && levels.partial < levels['1.0'], JSON.stringify(levels));
  await shot(page, 'f5-01-settings-audio');

  const toggle = page.getByRole('switch', { name: /Mute all sound/ });
  await page.keyboard.press('KeyM');
  await sleep(200);
  const toggleOn = (await toggle.getAttribute('aria-checked')) === 'true';
  checks.ok('the Settings mute toggle follows the M key', toggleOn);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('splash.settings') ?? '{}'));
  checks.ok('mute and volumes persist in localStorage', stored.muted === true && typeof stored.musicVolume === 'number', JSON.stringify({ muted: stored.muted, music: stored.musicVolume }));
  await shot(page, 'f5-02-settings-muted');

  // Settings are shared by every tab: unmuting with M in a second tab unmutes this one too.
  const other = await newPage(context, 'audio-tab2', { music: true });
  await other.goto(server.base);
  await other.locator('.title-prompt').waitFor({ timeout: 15000 });
  await other.keyboard.press('KeyM');
  await sleep(400);
  const followed = (await toggle.getAttribute('aria-checked')) === 'false';
  const heard = await level(page);
  checks.ok('M in a second tab unmutes the first tab as well (shared settings)', followed && heard > 0.001, `toggle off: ${followed}, RMS ${heard}`);
  await page.keyboard.press('KeyM');
  await sleep(400);
  const both = await Promise.all([page, other].map((p) => p.evaluate(() => JSON.parse(localStorage.getItem('splash.settings') ?? '{}').muted)));
  checks.ok('muted again from the first tab (left quiet)', (await toggle.getAttribute('aria-checked')) === 'true' && both.every(Boolean));
  const errors = errorsOf(page, other);
  checks.ok('no console errors', errors.length === 0, errors.join(' | '));
  await context.close();
} catch (err) {
  checks.ok(`flow crashed: ${err.message}`, false);
} finally {
  await browser.close();
  await server.close();
  checks.finish();
}
