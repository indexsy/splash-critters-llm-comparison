import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || '/Users/jackychou/.claude/skills/motion-ad/scripts/node_modules/playwright-core');
const browser=await chromium.launch({headless:true});
const reports=await Promise.all([['minimax',4317],['deepseek-v4.1-flash',4318]].map(async ([name,port])=>{
  const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();
  await page.addInitScript(()=>{
    window.__matchProbe={counts:{},end:null,rounds:[]};
    const Base=window.WebSocket;
    window.WebSocket=class extends Base {
      constructor(...args){super(...args);this.addEventListener('message',e=>{try{
        const m=JSON.parse(e.data);window.__matchProbe.counts[m.t]=(window.__matchProbe.counts[m.t]||0)+1;
        if(m.t==='match_end')window.__matchProbe.end=m;
        if(m.t==='round_end')window.__matchProbe.rounds.push(m);
      }catch{}})}
    };
  });
  await page.goto(`http://localhost:${port}/`);await page.waitForTimeout(800);
  if(name==='minimax') {
    await page.getByRole('button',{name:'Play',exact:true}).click();
    await page.getByRole('button',{name:'Practice vs bots',exact:true}).click();
  } else {
    await page.keyboard.press('Enter');await page.waitForTimeout(300);
    const box=await page.locator('canvas').boundingBox();
    await page.mouse.click(box.x+225*box.width/256,box.y+11*box.height/224);
    await page.waitForTimeout(300);
    await page.mouse.click(box.x+185*box.width/256,box.y+110*box.height/224);
  }
  const start=Date.now();let timedOut=false;
  try{await page.waitForFunction(()=>window.__matchProbe.end!==null,{},{timeout:180000});}
  catch{timedOut=true;}
  await page.waitForTimeout(1000);
  const probe=await page.evaluate(()=>({...window.__matchProbe,text:document.body.innerText}));
  await page.screenshot({path:new URL(`../screenshots/${name}-fullmatch.png`,import.meta.url).pathname});
  const result={name,elapsedSeconds:(Date.now()-start)/1000,timedOut,...probe};
  await context.close();console.log(JSON.stringify(result));return result;
}));
await writeFile(new URL('../logs/oct21-fullmatch.json',import.meta.url),JSON.stringify(reports,null,2));
await browser.close();
