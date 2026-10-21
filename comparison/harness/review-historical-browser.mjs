import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || '/Users/jackychou/.claude/skills/motion-ad/scripts/node_modules/playwright-core');
const browser=await chromium.launch({headless:true});
const reports=[];
for(const [name,port] of [['opus-5',4413],['opus-5.5',4412]]) {
  const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.addInitScript(()=>{
    window.__review={counts:{},trace:[],snapshot:null};
    const get=Map.prototype.get,set=Map.prototype.set;
    Map.prototype.get=function(key){const value=get.call(this,key);
      if(key==='round_start')window.__review.trace.push({event:'handlers_get',size:value?.size ?? null,at:performance.now()});
      return value;};
    Map.prototype.set=function(key,value){
      if(key==='round_start')window.__review.trace.push({event:'handlers_set',size:value?.size ?? null,at:performance.now()});
      return set.call(this,key,value);};
    const WS=WebSocket;
    window.WebSocket=class extends WS {
      constructor(...args){super(...args);this.addEventListener('message',e=>{try{
        const m=JSON.parse(e.data),type=typeof m.type==='string'?m.type:m.t;
        window.__review.counts[type]=(window.__review.counts[type]||0)+1;
        if(['match_start','round_start'].includes(type))window.__review.trace.push({event:'wire_'+type,at:performance.now()});
        if(type==='snapshot')window.__review.snapshot={tick:m.tick ?? m.state?.tick ?? m.snapshot?.tick,
          roundNo:m.roundNo ?? m.state?.roundNo ?? m.snapshot?.roundNo,phase:m.phase ?? m.state?.phase ?? m.snapshot?.phase};
      }catch{}})}
    };
  });
  await page.goto(`http://localhost:${port}/`);await page.waitForTimeout(700);
  if(name==='opus-5') {
    await page.getByRole('button',{name:'Skip to menu',exact:true}).click();
    await page.getByRole('button',{name:/Practice vs bots/i}).click();
  } else {
    await page.keyboard.press('Enter');
    await page.getByRole('button',{name:'Skip',exact:true}).click();
    await page.getByRole('button',{name:'Practice vs bots',exact:true}).click();
    await page.getByRole('button',{name:'Start',exact:true}).click();
  }
  await page.waitForTimeout(12000);
  const report={name,errors,normal:await page.evaluate(()=>({...window.__review,text:document.body.innerText}))};
  await page.screenshot({path:new URL(`../screenshots/score-review-${name}-normal.png`,import.meta.url).pathname});
  if(name==='opus-5.5') {
    report.reopenTrials=[];
    for(let trial=0;trial<8;trial++) {
      const route=trial%2===0?'':'#/menu';
      await page.goto(`http://localhost:${port}/?reviewTrial=${trial}${route}`);await page.waitForTimeout(1200);
      report.reopenTrials.push({route:route||'/',...await page.evaluate(()=>({...window.__review,text:document.body.innerText,
        screen:document.querySelector('[data-screen]')?.getAttribute('data-screen')}))});
    }
    await page.screenshot({path:new URL(`../screenshots/score-review-${name}-reopen.png`,import.meta.url).pathname});
  }
  reports.push(report);console.log(JSON.stringify(report));await context.close();
}
await browser.close();
await writeFile(new URL('../logs/score-review-browser.json',import.meta.url),JSON.stringify(reports,null,2));
