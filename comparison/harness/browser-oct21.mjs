import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/jackychou/.claude/skills/motion-ad/scripts/node_modules/playwright-core');
const root = new URL('../../', import.meta.url);
const browser = await chromium.launch({ headless: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const reports = [];
async function screenshot(page, name) {
  await page.screenshot({path: new URL(`comparison/screenshots/${name}.png`, root).pathname});
}
async function canvasClick(page, x, y) {
  const box = await page.locator('canvas').boundingBox();
  await page.mouse.click(box.x + x * box.width / 256, box.y + y * box.height / 224);
}
for (const [name, port] of [['minimax',4317], ['deepseek-v4.1-flash',4318], ['glm-oct21',4319], ['glm-oct21-dev',4320]]) {
  const context = await browser.newContext({viewport:{width:1280,height:900}});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(() => {
    window.__probe = {counts:{}, last:{}, sockets:0, sent:[]};
    const Original = window.WebSocket;
    window.WebSocket = class extends Original {
      constructor(...args) {
        super(...args);
        window.__probe.sockets++;
        this.addEventListener('message', e => {
          try {
            const m = JSON.parse(e.data);
            window.__probe.counts[m.t] = (window.__probe.counts[m.t] || 0) + 1;
            window.__probe.last[m.t] = m;
          } catch {}
        });
      }
      send(data) {
        try {
          const m = JSON.parse(data);
          if (m.t !== 'input') window.__probe.sent.push(m);
        } catch {}
        return super.send(data);
      }
    };
  });
  const response = await page.goto(`http://localhost:${port}/`);
  await sleep(1200);
  const report = {name, status:response.status(), errors};
  await screenshot(page, `${name}-title`);
  if (name === 'minimax') {
    await page.getByRole('button', {name:'Play', exact:true}).click();
    await screenshot(page, `${name}-menu`);
    await page.getByRole('button', {name:'Practice vs bots', exact:true}).click();
    await sleep(7000);
    await page.keyboard.down('ArrowRight');
    await sleep(400);
    await page.keyboard.up('ArrowRight');
    await page.keyboard.press('Space');
    await screenshot(page, `${name}-game`);
    await sleep(7000);
    report.game = await page.evaluate(() => ({...window.__probe, text:document.body.innerText}));
    await page.reload();
    await sleep(3000);
    await screenshot(page, `${name}-reconnect`);
    report.reconnect = await page.evaluate(() => ({...window.__probe, text:document.body.innerText}));
  } else if (name === 'deepseek-v4.1-flash') {
    await page.keyboard.press('Enter');
    await sleep(500);
    await screenshot(page, `${name}-tutorial`);
    await canvasClick(page, 225, 11);
    await sleep(700);
    await screenshot(page, `${name}-menu`);
    await canvasClick(page, 185, 110);
    await sleep(7000);
    await page.keyboard.down('ArrowRight');
    await sleep(400);
    await page.keyboard.up('ArrowRight');
    await page.keyboard.press('Space');
    await screenshot(page, `${name}-game`);
    await sleep(7000);
    report.game = await page.evaluate(() => window.__probe);
    await page.reload();
    await sleep(3000);
    await screenshot(page, `${name}-reconnect`);
    report.reconnect = await page.evaluate(() => window.__probe);
  } else {
    await page.keyboard.press('Enter');
    report.probe = await page.evaluate(() => ({...window.__probe,text:document.body.innerText,canvas:!!document.querySelector('canvas'),
      nonzero:document.querySelector('canvas') ? document.querySelector('canvas').getContext('2d').getImageData(0,0,256,224).data.some(v=>v!==0) : null}));
  }
  reports.push(report);
  await writeFile(new URL('comparison/logs/oct21-browser.json', root), JSON.stringify(reports,(key,value)=>key==='token'?'[REDACTED]':value,2));
  console.log(name, JSON.stringify({status:report.status, errors, counts:report.game?.counts, probe:report.probe}));
  await context.close();
}
await browser.close();
await writeFile(new URL('comparison/logs/oct21-browser.json', root), JSON.stringify(reports,(key,value)=>key==='token'?'[REDACTED]':value,2));
