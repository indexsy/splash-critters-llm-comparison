import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const require=createRequire(new URL('../../results/deepseek-v4.1-flash/package.json',import.meta.url));
const {WebSocket}=require('ws');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
class Client {
  messages=[];
  constructor(port,key){this.port=port;this.key=key;}
  async connect(token) {
    this.ws=new WebSocket(`ws://localhost:${this.port}/ws`);
    this.ws.on('message',data=>{try{
      const m=JSON.parse(data);this.messages.push(m);
      if(this.key==='type' && m.type==='ping')this.send({type:'pong',t:m.t});
      if(this.key==='t' && m.t==='ping')this.send({t:'pong',serverTime:m.serverTime});
    }catch{}});
    await new Promise((resolve,reject)=>{this.ws.once('open',resolve);this.ws.once('error',reject)});
    this.send({[this.key]:'hello',...(token?{token}:{})});
    this.welcome=await this.wait('welcome');return this;
  }
  send(m){this.ws.send(JSON.stringify(m));}
  async wait(type,timeout=5000,after=0){
    const end=Date.now()+timeout;
    while(Date.now()<end){const m=this.messages.slice(after).find(m=>m[this.key]===type);if(m)return m;await sleep(10);}
    throw Error(`Timeout ${type} on ${this.port}; recent=${JSON.stringify(this.messages.slice(-3))}`);
  }
  close(){this.ws.close();}
}
async function grokRace() {
  let welcomes=0,sameAccountGroups=0;
  for(let trial=0;trial<10;trial++) {
    const token=randomUUID();
    const clients=await Promise.all(Array.from({length:6},()=>new Client(4414,'t').connect(token)));
    welcomes+=clients.length;
    if(new Set(clients.map(c=>c.welcome.playerId)).size===1)sameAccountGroups++;
    clients.forEach(c=>c.close());
  }
  return {trials:10,welcomes,sameAccountGroups,health:await fetch('http://localhost:4414/health').then(r=>r.json())};
}
async function astraExhaustion() {
  const flooder=await new Client(4411,'type').connect();
  let created=0;
  for(let i=0;i<200;i++) {
    const after=flooder.messages.length;
    flooder.send({type:'create_room',opts:{name:'Review',mode:'duel',isPublic:false,theme:'beach',roundsToWin:3,botFill:false}});
    await flooder.wait('room_created',5000,after);created++;
    flooder.send({type:'leave_room'});await sleep(70);
  }
  const before=await fetch('http://localhost:4411/health').then(r=>r.json());
  const a=await new Client(4411,'type').connect(),b=await new Client(4411,'type').connect();
  a.send({type:'set_nickname',nickname:'ReviewAlpha'});b.send({type:'set_nickname',nickname:'ReviewBravo'});
  await sleep(200);a.send({type:'queue_join',mode:'duel'});b.send({type:'queue_join',mode:'duel'});
  await sleep(3000);
  let after;
  try{after=await fetch('http://localhost:4411/health').then(r=>r.json());}catch(e){after=String(e);}
  flooder.close();a.close();b.close();
  return {created,before,after};
}
const reports=await Promise.all([grokRace().then(result=>({name:'grok-4.7-same-token',...result})),
  astraExhaustion().then(result=>({name:'astra-room-limit',...result}))]);
console.log(JSON.stringify(reports,null,2));
await writeFile(new URL('../logs/score-review-network.json',import.meta.url),JSON.stringify(reports,null,2));
