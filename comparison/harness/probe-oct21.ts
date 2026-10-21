// @ts-nocheck -- benchmark intentionally inspects TS-private room lifecycle state.
// Supplemental probes: call the shipped simulation/room code, with no source edits.
import { writeFileSync } from 'node:fs';
import { Room as MiniRoom } from '../../results/minimax/packages/server/src/rooms.ts';
import { Predictor } from '../../results/minimax/packages/client/src/prediction.ts';
import * as Mini from '../../results/minimax/packages/shared/src/index.ts';
import { Room as DeepRoom } from '../../results/deepseek-v4.1-flash/packages/server/src/rooms.ts';
import { openDatabase } from '../../results/deepseek-v4.1-flash/packages/server/src/db/index.ts';
import * as Deep from '../../results/deepseek-v4.1-flash/packages/shared/src/index.ts';
import { BotBrain as DeepBot } from '../../results/deepseek-v4.1-flash/packages/server/src/bots/bot.ts';

const report: any = {};
// Fix the room's ambient map/bot seed sources for reproducible headless probes.
Math.random = Mini.mulberry32(20261021);
Date.now = () => 1792573200000;
const options = {name:'Probe',maxPlayers:2 as const,isPublic:false,theme:'beach' as const,
  roundsToWin:3,botFill:true,ranked:false,mode:'duel' as const};
function miniRoom() {
  const room = new MiniRoom(options,'PROBE1', {onMatchEnd:()=>({placements:[],ratingDeltas:[],xp:[],stats:{}})});
  room.setSlot(0,'bot','hard');room.setSlot(1,'bot','easy');room.startMatch();
  return room;
}
const room = miniRoom();
const state = room.state!;
const predictor = new Predictor();
const start = {roundNo:1,mapSeed:state.arena.seed,castleGrid:state.arena.castles.join(''),theme:'beach' as const,
  mode:'duel' as const,roundsToWin:3,players:state.players.map(p=>({animal:p.animal,hat:p.hat})),localId:0};
predictor.startRound(start);
predictor.tick(null); // history entry now exists
const snapshot = room.buildSnapshot();
snapshot.tick=1; snapshot.players[0].x=9; snapshot.players[0].y=7;
predictor.applySnapshot(snapshot);
report.miniReconcile = {authoritativeX:9,actualPredictedX:predictor.state!.players[0].x,
  authoritativeY:7,actualPredictedY:predictor.state!.players[0].y};

const slot = room.slots[0];
slot.kind='human';slot.lastSeq=600;
room.beginNextRound(2);
room.queueInput(slot,{seq:1,tick:0,dir:2,balloon:false});
report.miniRoundSequence = {newRound:room.state!.roundNo,serverSlotLastSeq:slot.lastSeq,
  freshSeqOneAccepted:slot.pendingInput !== null};
state.players[0].speed=7;state.players[0].splashRange=10;state.players[0].balloonCount=8;
Mini.beginRound(state,3,1234,'beach');
report.miniStatsAcrossRounds={speed:state.players[0].speed,range:state.players[0].splashRange,count:state.players[0].balloonCount};

// The spec requires lingering splashes to stay dangerous for 12 ticks.
const lingering=Mini.createMatchState({mode:'duel',seed:1,players:[{animal:'frog',hat:'none'},{animal:'duck',hat:'none'}]});
lingering.phase='running';lingering.countdown=0;
lingering.players[0].x=3;lingering.players[0].y=3;
lingering.splashes.push({id:1,x:3,y:3,lens:[2,2,2,2],ticks:10,depth:1,owner:1,revenge:false});
Mini.simulateTick(lingering,[]);
report.miniLingeringSplash={alive:lingering.players[0].alive,splashTicksRemaining:lingering.splashes[0]?.ticks};

// Loot generation is reproducible using only public round_start fields.
const a=Mini.generateArena({width:13,height:11,seed:12345,theme:'beach',spawns:Mini.spawnPointsFor('duel',13,11)});
const b=Deep.generateArena('duel',12345,'beach');
report.loot = {miniNonempty:a.contents.filter(Boolean).length,miniCastles:a.castles.filter(Boolean).length,
  deepNonempty:b.hidden.flat().filter(Boolean).length,deepCastles:b.castles.flat().filter(Boolean).length};

// Real MiniMax room loop, virtual wall clock advances exactly one fixed tick each call.
let hardWins=0,easyWins=0,ties=0,completed=0,placed=0,selfSoaks=0,rounds=0;
const miniRuns=[];
for(let match=0;match<12;match++) {
  const r=miniRoom(); let priorRound=0,firstDecisionAtRound2=-1;
  for(let tick=0;tick<180000 && r.phase!=='matchEnd';tick++) {
    const previousTick=r.state!.tick;
    const previousRound=r.state!.roundNo;
    r.tick(2_000_000+tick*1000/30);
    const s=r.state!;
    if(s.roundNo!==priorRound) {rounds++;priorRound=s.roundNo;}
    if(s.roundNo===2 && firstDecisionAtRound2<0 && s.players.some(p=>p.dir!==0)) firstDecisionAtRound2=s.tick;
    for(const event of s.tick!==previousTick && s.roundNo===previousRound ? s.events : []) {
      if(event.t==='balloon_placed')placed++;
      if(event.t==='player_soaked' && event.by===event.player)selfSoaks++;
    }
  }
  const wins=r.state!.players.map(p=>p.roundWins);
  if(r.phase==='matchEnd')completed++;
  if(wins[0]>wins[1])hardWins++;else if(wins[1]>wins[0])easyWins++;else ties++;
  miniRuns.push({wins,round:r.state!.roundNo,phase:r.phase,firstDecisionAtRound2});
}
report.miniBotRooms={matches:12,completed,hardWins,easyWins,ties,placed,selfSoaks,rounds,runs:miniRuns};

// DeepSeek bots use the identical sim + brain as production; fixed seeds for repeatability.
const deepRuns=[];let deepHard=0,deepEasy=0,deepDraws=0,deepPlaced=0,deepSelf=0;
for(let round=1;round<=24;round++) {
  const arena=Deep.generateArena('duel',round,'beach');
  const participants=[{id:'hard',slot:0,name:'Hard',animal:'frog' as const,hat:'none' as const,isBot:true,difficulty:'hard' as const},
    {id:'easy',slot:1,name:'Easy',animal:'duck' as const,hat:'none' as const,isBot:true,difficulty:'easy' as const}];
  const s=Deep.createRoundState('duel',arena,participants,{roundNo:1,enableKick:true,enableRevengeDucks:true});
  const bots=[new DeepBot('hard','hard',round*2),new DeepBot('easy','easy',round*2+1)];
  for(let tick=0;tick<6000 && !s.ended;tick++) {
    const existingIds=new Set(s.balloons.map(b=>b.id));
    const events=Deep.simulateTick(s,{hard:bots[0].decide(s),easy:bots[1].decide(s)});
    deepPlaced+=s.balloons.filter(b=>!existingIds.has(b.id)).length;
    for(const e of events) {
      if(e.type==='player_soaked' && e.cause==='splash' && s.splashes.some(sp=>sp.ownerId===e.playerId && sp.x===e.x && sp.y===e.y))deepSelf++;
    }
  }
  if(s.winnerId==='hard')deepHard++;else if(s.winnerId==='easy')deepEasy++;else deepDraws++;
  deepRuns.push({seed:round,winner:s.winnerId,tick:s.tick,ended:s.ended});
}
report.deepBotRounds={rounds:24,hardWins:deepHard,easyWins:deepEasy,draws:deepDraws,placed:deepPlaced,selfSoaks:deepSelf,runs:deepRuns};

// Inspect the first Hard bot's failed escape at tile/position level.
const traceArena=Deep.generateArena('duel',1,'beach');
const traceState=Deep.createRoundState('duel',traceArena,[{id:'hard',slot:0,name:'Hard',animal:'frog',hat:'none',isBot:true},
  {id:'easy',slot:1,name:'Easy',animal:'duck',hat:'none',isBot:true}],{enableKick:true,enableRevengeDucks:true});
const traceBots=[new DeepBot('hard','hard',2),new DeepBot('easy','easy',3)];
report.deepEscapeTrace=[];
while(!traceState.ended && traceState.tick<150) {
  const inputs={hard:traceBots[0].decide(traceState),easy:traceBots[1].decide(traceState)};
  const events=Deep.simulateTick(traceState,inputs);
  if(traceState.tick%10===0 || events.some(e=>e.type==='player_soaked'))report.deepEscapeTrace.push({tick:traceState.tick,
    hard:{x:traceState.players[0].x,y:traceState.players[0].y,input:inputs.hard},
    balloons:structuredClone(traceState.balloons),events});
}

// One idle human vs three Medium bots, 8 deterministic practice rounds.
const practice=[];
for(let seed=1;seed<=8;seed++) {
  const sim=Deep.createRoundState('ffa',Deep.generateArena('ffa',seed,'beach'),
    Array.from({length:4},(_,slot)=>({id:String(slot),slot,name:String(slot),animal:'frog' as const,hat:'none' as const,isBot:slot>0})),
    {enableKick:true,enableRevengeDucks:true});
  const bots=[1,2,3].map(id=>new DeepBot(String(id),'medium',seed*4+id));
  for(let tick=0;tick<6000 && !sim.ended;tick++)Deep.simulateTick(sim,{'1':bots[0].decide(sim),'2':bots[1].decide(sim),'3':bots[2].decide(sim)});
  practice.push({seed,winner:sim.winnerId,tick:sim.tick,ended:sim.ended});
}
report.deepIdleHumanPractice=practice;

// Reverse the duel slots to distinguish a difficulty failure from spawn advantage.
const reversed=[];
for(let seed=1;seed<=24;seed++) {
  const sim=Deep.createRoundState('duel',Deep.generateArena('duel',seed,'beach'),
    [{id:'easy',slot:0,name:'Easy',animal:'frog',hat:'none',isBot:true},
      {id:'hard',slot:1,name:'Hard',animal:'duck',hat:'none',isBot:true}]);
  const hard=new DeepBot('hard','hard',seed*2),easy=new DeepBot('easy','easy',seed*2+1);
  while(!sim.ended && sim.tick<6000)Deep.simulateTick(sim,{hard:hard.decide(sim),easy:easy.decide(sim)});
  reversed.push({seed,winner:sim.winnerId,tick:sim.tick});
}
report.deepReversedSlots={hardWins:reversed.filter(r=>r.winner==='hard').length,
  easyWins:reversed.filter(r=>r.winner==='easy').length,draws:reversed.filter(r=>!r.winner).length,runs:reversed};

// Exposed power-ups must be destroyed by a later splash.
const powerupState=Deep.createRoundState('duel',Deep.generateArena('duel',1,'beach'),
  [{id:'a',slot:0,name:'A',animal:'frog',hat:'none',isBot:false},{id:'b',slot:1,name:'B',animal:'duck',hat:'none',isBot:false}]);
powerupState.arena.castles.forEach(row=>row.fill(0));
powerupState.powerups.push({id:99,x:3,y:3,kind:'balloon',revealedTick:0});
Deep.addBalloonForTest(powerupState,'a',3,3,2,1);
const puEvents=Deep.simulateTick(powerupState,{});
report.deepExposedPowerup={survived:powerupState.powerups.some(p=>p.id===99),
  splashesOnPowerup:powerupState.splashes.filter(s=>s.x===3 && s.y===3),events:puEvents};

// Run a complete DeepSeek production Room with all bot slots, including result persistence.
const db=openDatabase('/var/folders/7v/dtpvhs8x0n1d3_7vfccbrbvw0000gn/T/opencode/splash-oct21/deep-probe');
const deepRoom=new DeepRoom('PROBE2',{name:'Probe',size:2,isPrivate:true,theme:'beach',roundsToWin:3},db,
  {send(){},isOnline(){return true},roomListChanged(){},profileChanged(){}},()=>{});
deepRoom.slots=[deepRoom.makeBot(0,'hard'),deepRoom.makeBot(1,'easy')];
deepRoom.startMatchInternal();
for(let tick=0;tick<100000 && deepRoom.status!=='match_end';tick++)deepRoom.tick();
report.deepCompleteRoom={status:deepRoom.status,round:deepRoom.runtime?.roundNo,scores:deepRoom.runtime?.roundsWon,
  results:deepRoom.runtime?.matchEndPayload};
db.close();
writeFileSync(new URL('../logs/oct21-probes.json',import.meta.url),JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,deepEscapeTrace:'See JSON log',miniBotRooms:{...report.miniBotRooms,runs:'See JSON log'},
  deepBotRounds:{...report.deepBotRounds,runs:'See JSON log'},deepReversedSlots:{...report.deepReversedSlots,runs:'See JSON log'}},null,2));
