import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
const require=createRequire(new URL('../../results/deepseek-v4.1-flash/package.json',import.meta.url));
const {WebSocket}=require('ws');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
class Client {
  messages=[];
  constructor(port){this.port=port;}
  async connect(token) {
    this.ws=new WebSocket(`ws://localhost:${this.port}/ws`);
    this.ws.on('message',data=>{try {
      const m=JSON.parse(data);this.messages.push(m);
      if(m.t==='ping')this.send({t:'pong',ts:m.ts,sentAt:m.sentAt,at:m.at});
    }catch{}});
    await new Promise((resolve,reject)=>{this.ws.once('open',resolve);this.ws.once('error',reject)});
    this.send({t:'hello',...(token?{token}:{})});
    this.welcome=await this.wait('welcome');
    return this;
  }
  send(m){if(this.ws.readyState===1)this.ws.send(JSON.stringify(m));}
  async wait(t,timeout=10000,after=0){
    const until=Date.now()+timeout;
    while(Date.now()<until){const m=this.messages.slice(after).find(m=>m.t===t);if(m)return m;await sleep(30);}
    throw Error(`:${this.port} timed out: ${t}; recent=${JSON.stringify(this.messages.filter(m=>m.t!=='snapshot').slice(-8))}`);
  }
  close(){this.ws.close();}
}
const reports=[];
async function evaluate(name,port) {
  const report={name};
  try {
    report.health=await fetch(`http://localhost:${port}/health`).then(r=>r.json());
    let a=await new Client(port).connect();
    const b=await new Client(port).connect();
    a.send({t:'set_nickname',nickname:'AuditAlpha'});b.send({t:'set_nickname',nickname:'AuditBravo'});
    await sleep(200);
    a.send({t:'queue_join',mode:'duel'});b.send({t:'queue_join',mode:'duel'});
    await a.wait('round_start',12000);
    await sleep(1000);
    report.rankedStarts={matchStarts:a.messages.filter(m=>m.t==='match_start').length,
      roundStarts:a.messages.filter(m=>m.t==='round_start').length,
      found:a.messages.filter(m=>m.t==='match_found')};
    if(name==='minimax') {
      const reconnect=await new Client(port).connect(a.welcome.token);
      await sleep(700);
      report.reconnectMessages=reconnect.messages.map(m=>m.t);
      a=reconnect;
    }
    b.close();
    try {
      const end=await a.wait('match_end',22000);
      report.forfeit=end;
      report.leaderboard=await fetch(`http://localhost:${port}/api/leaderboard?mode=duel`).then(r=>r.json());
      report.profile=await fetch(`http://localhost:${port}/api/profile/${a.welcome.playerId}`).then(r=>r.json());
    }catch(e){report.forfeitError=String(e);}
    a.close();
    if(name==='minimax') {
      const survivor=await new Client(port).connect(),leaver=await new Client(port).connect();
      survivor.send({t:'queue_join',mode:'duel'});leaver.send({t:'queue_join',mode:'duel'});
      await survivor.wait('round_start',10000);leaver.close();
      report.normalForfeit=await survivor.wait('match_end',22000);
      survivor.close();
      const c=await new Client(port).connect(),d=await new Client(port).connect();
      c.send({t:'queue_join',mode:'ffa'});d.send({t:'queue_join',mode:'ffa'});
      await c.wait('match_start',10000);
      report.twoHumanRankedFfa=c.messages.filter(m=>m.t==='match_start');
      c.close();d.close();
    }
  }catch(e){report.error=String(e);}
  // Bounded malformed frames, with a separate socket for each case.
  const frames=['{','null','[]','1','"hello"','{}',JSON.stringify({t:'hello',token:7}),
    JSON.stringify({t:'hello',token:{a:1}}),JSON.stringify({t:'hello',token:[]}),
    JSON.stringify({t:'create_room',opts:null}),JSON.stringify({t:'create_room',opts:{size:4,name:12}}),
    JSON.stringify({t:'set_slot',slot:0.5,kind:'bot',difficulty:'hard'}),
    JSON.stringify({t:'set_slot',slot:1e100,kind:'bot',difficulty:'hard'}),
    JSON.stringify({t:'input',seq:1,tick:1,dir:1.5,balloon:true,balloonPressed:true}),
    JSON.stringify({t:'input',seq:1.5,tick:1,dir:'north',balloon:true}),
    JSON.stringify({t:'join_room',code:{}}),JSON.stringify({t:'emote',id:0.5}),
    JSON.stringify({t:'pong',ts:{},sentAt:{}}),JSON.stringify({t:'queue_join',mode:{}}),
    JSON.stringify({t:'set_cosmetics',animal:'nonsense',hat:'nonsense'})];
  let survived=0;
  for(const frame of frames) {
    try {
      const c=await new Client(port).connect();
      c.ws.send(frame);await sleep(50);c.close();
      const health=await fetch(`http://localhost:${port}/health`).then(r=>r.json());
      if(health.ok)survived++;
    }catch{}
  }
  report.malformed={cases:frames.length,healthSurvived:survived};
  reports.push(report);
  await writeFile(new URL('../logs/oct21-network.json',import.meta.url),JSON.stringify(reports,null,2));
  console.log(name,JSON.stringify(report));
}
await Promise.all([evaluate('minimax',4317),evaluate('deepseek-v4.1-flash',4318),evaluate('glm-oct21',4319)]);
