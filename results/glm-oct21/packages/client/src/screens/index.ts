import { CONFIG, xpProgress } from '@splash/shared'
import type { PlayerProfile, RoomInfo, S2C, GameMode, LobbyPlayer, CreateRoomOpts, BotDifficulty, MapTheme } from '@splash/shared'
import { Screens, Store, send, playMusic, actionFor, saveBinds, type Screen } from '../main'
import { NetState } from '../net'
import { Sfx, Music, AudioFlags, applySettings, setMuted } from '../audio'
import { fontCanvas, tintCanvas, cv, PAL, drawText } from '../render/sprites'
import { GAME } from './game'

// ---------------------------------------------------------------- shared helpers
function panel(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  g.fillStyle = 'rgba(10,14,40,0.9)'
  g.fillRect(x, y, w, h)
  g.fillStyle = PAL.B
  g.fillRect(x, y, w, 1)
  g.fillRect(x, y + h - 1, w, 1)
  g.fillRect(x, y, 1, h)
  g.fillRect(x + w - 1, y, 1, h)
}

function label(g: CanvasRenderingContext2D, text: string, x: number, y: number, color = '#ffffff', scale = 1): void {
  drawText(g, text, x, y, color, true, scale)
}

function centerLabel(g: CanvasRenderingContext2D, text: string, y: number, color = '#ffffff', scale = 1): void {
  const w = text.length * 5 * scale
  label(g, text, Math.round((256 - w) / 2), y, color, scale)
}

export function toastFlash(msg: string): void {
  Store.toastText = msg.slice(0, 42).toUpperCase()
  Store.toastUntil = performance.now() + 2600
}

function drawToastBar(g: CanvasRenderingContext2D): void {
  if (Store.toastUntil && performance.now() < Store.toastUntil && Store.toastText) {
    g.fillStyle = 'rgba(233,79,55,0.9)'
    g.fillRect(0, 0, 256, 12)
    g.drawImage(tintCanvas(fontCanvas(Store.toastText), '#ffffff'), 5, 3)
  }
}

function bar(g: CanvasRenderingContext2D, x: number, y: number, w: number, frac: number, fg: string): void {
  g.fillStyle = '#1b2440'
  g.fillRect(x, y, w, 5)
  g.fillStyle = fg
  g.fillRect(x, y, Math.round(w * Math.max(0, Math.min(1, frac))), 5)
}

function profile(): PlayerProfile | null {
  return Store.net?.profile ?? null
}

function previewFrame(): number {
  return Math.floor(performance.now() / 380) % 2
}

let pendingJoin: (() => void) | null = null
let practicePending = ''
let tutorialPending = false

function pollPending(): void {
  if (pendingJoin && profile()) {
    const fn = pendingJoin
    pendingJoin = null
    fn()
  }
}

// ---------------------------------------------------------------- router
export function route(): void {
  const h = location.hash
  Store.hash = h
  if (h.startsWith('#/room/')) {
    const code = h.slice(7).toUpperCase().slice(0, 10)
    const go = () => {
      send({ t: 'join_room', code })
      Screens.replace(makeJoining(code))
    }
    if (profile()) go()
    else {
      pendingJoin = go
      Screens.replace(makeTitle())
    }
  }
}

function makeJoining(code: string): Screen {
  let timeout = 6
  return {
    update(dt: number): void {
      timeout -= dt
      if (timeout <= 0) Screens.replace(makeMenu())
    },
    onMsg(msg: S2C): void {
      if (msg.t === 'error') {
        toastFlash(msg.msg)
        Screens.replace(makeMenu())
      }
    },
    draw(g): void {
      g.fillStyle = '#0b1030'
      g.fillRect(0, 0, 256, 224)
      centerLabel(g, 'JOINING ROOM', 92, PAL.B, 2)
      centerLabel(g, code, 122, PAL.Y, 2)
      centerLabel(g, '.'.repeat(1 + (Math.floor(performance.now() / 350) % 3)), 150, PAL.L, 1)
      drawToastBar(g)
    }
  }
}

// ---------------------------------------------------------------- TITLE
function makeTitle(): Screen {
  return {
    enter(): void {
      playMusic('title')
    },
    update(): void {
      pollPending()
    },
    onKey(_code, down): void {
      if (!down || !profile()) return
      Sfx.blip()
      if (!Store.tutorialDone) Screens.replace(makeTutorialIntro())
      else Screens.replace(makeMenu())
    },
    onMsg(msg: S2C): void {
      if (msg.t === 'error') toastFlash(msg.msg)
    },
    draw(g): void {
      g.fillStyle = '#0b1030'
      g.fillRect(0, 0, 256, 224)
      const t = performance.now()
      for (let row = 0; row < 5; row++) {
        const off = Math.round(Math.sin(t / 320 + row) * 3)
        g.fillStyle = row % 2 === 0 ? '#123566' : '#16418a'
        g.fillRect(0, 196 + row * 6 + off, 256, 6)
      }
      const bounce = Math.round(Math.sin(t / 350) * 3)
      centerLabel(g, 'SPLASH', 40 + bounce, PAL.B, 4)
      centerLabel(g, 'CRITTERS', 68 + bounce, PAL.Y, 4)
      const critters = ['frog', 'duck', 'otter', 'penguin']
      const hats = ['none', 'bucket', 'snorkel', 'crown']
      for (let i = 0; i < 4; i++) {
        const bob = Math.round(Math.sin(t / 260 + i) * 2)
        const frames = Store.animals[critters[i]!]!
        g.drawImage(previewFrame() % 2 === 1 ? frames.b : frames.a, 56 + i * 36, 112 + bob)
        const h = Store.hats[hats[i]!]
        if (hats[i] !== 'none' && h) g.drawImage(h, 56 + i * 36, 112 + bob)
      }
      if (NetState.down) centerLabel(g, 'CONNECTING...', 156, PAL.R, 1)
      else if (!profile()) centerLabel(g, 'SPAWNING CRITTER...', 156, PAL.L, 1)
      else if (Math.floor(t / 400) % 2 === 0) centerLabel(g, 'PRESS ANY KEY', 156, PAL.W, 1)
      const p = profile()
      if (p) centerLabel(g, `${p.nickname}#${p.tag}`, 170, PAL.C, 1)
      drawToastBar(g)
    }
  }
}

// ---------------------------------------------------------------- TUTORIAL intro
function makeTutorialIntro(): Screen {
  return {
    update(): void {},
    draw(g): void {
      g.fillStyle = '#0b1030'
      g.fillRect(0, 0, 256, 224)
      panel(g, 14, 22, 228, 130)
      centerLabel(g, 'HOW TO PLAY', 30, PAL.Y, 2)
      label(g, '1. MOVE: WASD OR ARROWS', 30, 66)
      label(g, '2. DROP BALLOON: SPACE', 30, 84)
      label(g, '3. SOAK CRITTERS, WASH', 30, 102)
      label(g, '   CASTLES FOR ROUND PTS', 42, 114)
      label(g, '4. AVOID EXPLOSIONS!!', 30, 132)
      centerLabel(g, 'ENTER = LEARN IN-GAME', 176, PAL.L, 1)
      centerLabel(g, 'ESC = SKIP', 192, PAL.U, 1)
      drawToastBar(g)
    },
    onKey(code, down): void {
      if (!down) return
      const act = actionFor(code)
      if (act === 'confirm') tutorialStart()
      else if (act === 'back') {
        Store.tutorialDone = true
        localStorage.setItem('sc_tutorial_done', '1')
        Screens.replace(makeMenu())
      }
    },
    onMsg(msg: S2C): void {
      if (msg.t === 'error') toastFlash(msg.msg)
    }
  }
}

function tutorialStart(): void {
  tutorialPending = true
  send({ t: 'create_room', opts: { name: 'Tutorial', size: 2, public: false, theme: 'backyard', roundsToWin: 2, botFill: true } })
  Screens.replace(makeJoining('LEARN'))
}

function practiceStart(): void {
  practicePending = 'START'
  send({ t: 'create_room', opts: { name: 'Practice', size: 4, public: false, theme: 'random', roundsToWin: 2, botFill: true } })
  Screens.replace(makeJoining('PRACT'))
}

// ---------------------------------------------------------------- MENU
function makeMenu(): Screen {
  const items: Array<{ label: string; sub: string; choose: () => void }> = [
    { label: 'Ranked Duel', sub: '1 VS 1 LADDER', choose: () => Screens.replace(makeQueue('duel')) },
    { label: 'Ranked FFA', sub: '4-SCRAP LADDER', choose: () => Screens.replace(makeQueue('ffa')) },
    { label: 'Casual Rooms', sub: 'BROWSE + CODES', choose: () => Screens.replace(makeBrowser()) },
    { label: 'Practice', sub: 'VS BOTS, NO RATING', choose: () => practiceStart() },
    { label: 'Leaderboard', sub: 'PUDDLE LEGENDS', choose: () => Screens.replace(makeLeaderboard()) },
    { label: 'Locker', sub: 'ANIMAL + HAT', choose: () => Screens.replace(makeLocker()) },
    { label: 'Help', sub: 'HOW TO SPLASH', choose: () => Screens.replace(makeHelp()) },
    { label: 'Settings', sub: 'SOUND + CONTROLS', choose: () => Screens.replace(makeSettings()) }
  ]
  let sel = 0
  return {
    enter(): void {
      playMusic('menu')
      send({ t: 'room_list_request' })
    },
    update(): void {
      if (!profile()) Screens.replace(makeTitle())
    },
    onKey(code, down): void {
      if (!down) return
      const act = actionFor(code)
      if (act === 'up') {
        sel = (sel + items.length - 1) % items.length
        Sfx.blip()
      } else if (act === 'down') {
        sel = (sel + 1) % items.length
        Sfx.blip()
      } else if (act === 'confirm') items[sel]!.choose()
    },
    onMsg(msg: S2C): void {
      if (msg.t === 'error') toastFlash(msg.msg)
      if (msg.t === 'ticker') toastFlash(msg.msg)
      if (msg.t === 'room_list') Store.roomList = msg.rooms
    },
    draw(g): void {
      g.fillStyle = '#101536'
      g.fillRect(0, 0, 256, 224)
      label(g, 'SPLASH', 10, 8, PAL.B, 2)
      label(g, 'CRITTERS', 60, 8, PAL.Y, 2)
      panel(g, 6, 28, 142, 182)
      items.forEach((it, i) => {
        const y = 38 + i * 21
        const isSel = i === sel
        if (isSel) {
          g.fillStyle = 'rgba(58,160,255,0.28)'
          g.fillRect(8, y - 4, 138, 18)
          label(g, '>', 10, y, PAL.Y)
        }
        g.drawImage(tintCanvas(fontCanvas(it.label.toUpperCase()), isSel ? PAL.Y : PAL.W), 20, y)
        label(g, it.sub.slice(0, 20), 20, y + 9, isSel ? PAL.C : PAL.U)
      })
      const p = profile()
      panel(g, 152, 28, 96, 100)
      label(g, 'YOUR CRITTER', 158, 34, PAL.C)
      if (p) {
        const frames = Store.animals[p.animal] ?? Store.animals['frog']!
        g.drawImage(previewFrame() % 2 === 1 ? frames.b : frames.a, 184, 50)
        const h = Store.hats[p.hat]
        if (h) g.drawImage(h, 184, 50)
        label(g, p.nickname.slice(0, 10), 158, 78, PAL.Y)
        label(g, `LV ${p.level}`, 158, 90, PAL.W)
        const prog = xpProgress(p.xp)
        bar(g, 158, 100, 82, prog.cur / prog.need, PAL.L)
        const rd = p.ratings['duel']
        const rf = p.ratings['ffa']
        label(g, `DUEL ${rd?.rating ?? CONFIG.ELO.START}`, 158, 110, PAL.C)
        label(g, `FFA  ${rf?.rating ?? CONFIG.ELO.START}`, 158, 120, PAL.C)
      }
      panel(g, 152, 132, 96, 62)
      label(g, 'LOBBIES', 158, 138, PAL.C)
      const open = Store.roomList.filter((r) => !r.inMatch).length
      label(g, `OPEN  ${open}`, 158, 150)
      label(g, `ALL   ${Store.roomList.length}`, 158, 162)
      label(g, 'WASD+SPACE PLAY', 158, 176, PAL.U)
      label(g, 'M TO MUTE', 158, 186, PAL.U)
      drawToastBar(g)
    }
  }
}

function makeHelp(): Screen {
  const lines = [
    'WATER BALLOONS DROP WHERE',
    'YOU STAND. FUSE 3 SEC.',
    'SOAK CRITTERS IN SPLASHES!',
    'WASH CASTLES: 2X2 WALLS',
    'RUMBLE SEQ OF SPLASHES.',
    'BOULDERS BLOCK SPLASHES.',
    'BALLOONS SLIDE VERSES',
    'KICKED. BOOTS PUSH THEM.',
    'TIDE RISES FROM EDGES:',
    'AVOID THE WATER RINGS!',
    'A DUCK WILL ATTACK YOU.',
    'MOST ROUNDS WINS. GOOD LUCK!'
  ]
  let idx = 0
  return {
    update(): void {},
    onKey(code, down): void {
      if (!down) return
      const act = actionFor(code)
      if (act === 'back' || act === 'confirm') Screens.replace(makeMenu())
      else if (act === 'down') idx = Math.min(lines.length - 5, idx + 1)
      else if (act === 'up') idx = Math.max(0, idx - 1)
    },
    draw(g): void {
      g.fillStyle = '#0b1030'
      g.fillRect(0, 0, 256, 224)
      panel(g, 8, 14, 240, 190)
      centerLabel(g, 'HOUSE RULES', 22, PAL.Y, 2)
      lines.slice(idx, idx + 5).forEach((l, i) => label(g, l.toUpperCase(), 20, 58 + i * 18))
      centerLabel(g, 'UP/DOWN SCROLL - ESC BACK', 200, PAL.U, 1)
      drawToastBar(g)
    }
  }
}

// ---------------------------------------------------------------- QUEUE
function makeQueue(mode: GameMode): Screen {
  let eta = -1
  let range: number = CONFIG.MM_START_RANGE
  let waiting = 0
  let done = false
  return {
    enter(): void {
      playMusic('lobby')
      send({ t: 'queue_join', mode })
    },
    update(dt: number): void {
      void dt
    },
    onMsg(msg: S2C): void {
      if (msg.t === 'queue_status' && msg.mode === mode) {
        eta = msg.eta
        range = msg.searchRange
        waiting = msg.playersWaiting
      } else if (msg.t === 'match_found' && !done) {
        done = true
        GAME.begin('ranked', profile(), mode)
        Screens.replace(makeGameScreen())
      } else if (msg.t === 'error') toastFlash(msg.msg)
    },
    onKey(code, down): void {
      if (!down) return
      if (actionFor(code) === 'back') {
        send({ t: 'queue_leave' })
        Screens.replace(makeMenu())
      }
    },
    draw(g): void {
      g.fillStyle = '#0b1030'
      g.fillRect(0, 0, 256, 224)
      centerLabel(g, mode === 'duel' ? 'RANKED DUEL' : 'RANKED FFA', 36, PAL.Y, 2)
      const frames = Store.animals[profile()?.animal ?? 'frog'] ?? Store.animals['frog']!
      const bob = Math.round(Math.sin(performance.now() / 200) * 3)
      g.drawImage(previewFrame() % 2 === 1 ? frames.b : frames.a, 120, 70 + bob)
      const h = Store.hats[profile()?.hat ?? 'none']
      if (h) g.drawImage(h, 120, 70 + bob)
      centerLabel(g, eta >= 0 ? `ETA ~${eta}S` : 'CONTACTING THE POND', 112, PAL.C, 1)
      centerLabel(g, `SEARCH RANGE ${range}`, 126, PAL.U, 1)
      centerLabel(g, `WAITING WITH ${waiting} CRITTERS`, 140, PAL.U, 1)
      centerLabel(g, 'ESC = CANCEL', 172, PAL.R, 1)
      drawToastBar(g)
    }
  }
}

// ---------------------------------------------------------------- GAME wrapper
function makeGameScreen(): Screen {
  return {
    update(dt: number): void {
      GAME.update(dt)
    },
    draw(g): void {
      GAME.draw(g)
    },
    onKey(code, down): void {
      GAME.onKey(code, down)
    },
    onMsg(msg: S2C): void {
      GAME.onMsg(msg)
    },
    leaves(): void {
      GAME.onExit()
    }
  }
}

// ---------------------------------------------------------------- BROWSER
const ROOM_NAME_POOL = ['Water Wars', 'Splash Zone', 'Puddle Colosseum', 'Wet Bandits', 'Balloon Fountain', 'Soggy Showdown']

function makeBrowser(): Screen {
  let sel = 0
  let mode: 'list' | 'create' | 'code' = 'list'
  const opts: CreateRoomOpts = { name: ROOM_NAME_POOL[0]!, size: 4, public: true, theme: 'random', roundsToWin: 3, botFill: true }
  let nameIdx = 0
  let setting = 0
  const codeChars: string[] = []
  let codeCursor = 0
  return {
    enter(): void {
      playMusic('lobby')
      send({ t: 'room_list_request' })
    },
    update(dt: number): void {
      if (Math.floor(performance.now() / 4000 + dt) % 4 === 0) send({ t: 'room_list_request' })
    },
    onMsg(msg: S2C): void {
      if (msg.t === 'room_list') Store.roomList = msg.rooms
      else if (msg.t === 'error') toastFlash(msg.msg)
    },
    onKey(code, down): void {
      if (!down) return
      const act = actionFor(code)
      if (mode === 'list') {
        if (act === 'up' && Store.roomList.length > 0) {
          sel = (sel + Store.roomList.length - 1) % Store.roomList.length
          Sfx.blip()
        } else if (act === 'down' && Store.roomList.length > 0) {
          sel = (sel + 1) % Store.roomList.length
          Sfx.blip()
        } else if (act === 'confirm') {
          const room = Store.roomList[sel]
          if (room) {
            if (room.inMatch) toastFlash('ROOM IN MATCH - WAIT')
            else {
              send({ t: 'join_room', code: room.code })
              Screens.replace(makeJoining(room.code))
            }
          }
        } else if (code === 'KeyC') mode = 'create'
        else if (code === 'KeyJ') mode = 'code'
        else if (act === 'back') Screens.replace(makeMenu())
      } else if (mode === 'create') {
        if (act === 'back') mode = 'list'
        else if (act === 'up') {
          setting = Math.max(0, setting - 1)
          Sfx.blip()
        } else if (act === 'down') {
          setting = Math.min(5, setting + 1)
          Sfx.blip()
        } else if (act === 'confirm') {
          send({ t: 'create_room', opts: { ...opts, name: opts.name ?? ROOM_NAME_POOL[nameIdx]! } })
          Screens.replace(makeJoining('MAKING'))
        } else if (act === 'left' || act === 'right') {
          const sgn = act === 'right' ? 1 : -1
          if (setting === 0) {
            nameIdx = (nameIdx + sgn + ROOM_NAME_POOL.length) % ROOM_NAME_POOL.length
            opts.name = ROOM_NAME_POOL[nameIdx]!
          } else if (setting === 1) {
            opts.size = (opts.size === 2 ? 4 : 2) as 2 | 4
          } else if (setting === 2) {
            opts.public = !opts.public
          } else if (setting === 3) {
            cycleTheme(opts, sgn)
          } else if (setting === 4) {
            cycleRounds(opts, sgn)
          } else if (setting === 5) {
            opts.botFill = !opts.botFill
          }
          Sfx.blip()
        }
      } else {
        if (act === 'back') {
          mode = 'list'
          codeChars.length = 0
          codeCursor = 0
        } else if (act === 'confirm') {
          const jc = codeChars.join('')
          if (jc.length >= 4) {
            send({ t: 'join_room', code: jc })
            Screens.replace(makeJoining(jc))
          }
        } else if (code.startsWith('Key') && code.length === 4 && /^[A-Z]$/.test(code.slice(3))) {
          if (codeCursor < 8) {
            codeChars[codeCursor] = code.slice(3)
            codeCursor++
            Sfx.blip()
          }
        } else if (code.startsWith('Digit') && code.length === 6) {
          if (codeCursor < 8) {
            codeChars[codeCursor] = code.slice(5)
            codeCursor++
            Sfx.blip()
          }
        }
      }
    },
    draw(g): void {
      g.fillStyle = '#0e1338'
      g.fillRect(0, 0, 256, 224)
      if (mode === 'list') {
        centerLabel(g, 'ROOM BROWSER', 10, PAL.B, 2)
        panel(g, 4, 30, 248, 160)
        if (Store.roomList.length === 0) centerLabel(g, 'NO ROOMS. C=CREATE J=CODE', 104, PAL.U, 1)
        Store.roomList.slice(0, 8).forEach((r, i) => {
          const y = 40 + i * 18
          if (i === sel) {
            g.fillStyle = 'rgba(58,160,255,0.28)'
            g.fillRect(6, y - 4, 244, 16)
            label(g, '>', 8, y, PAL.Y)
          }
          label(g, r.name.toUpperCase().slice(0, 14), 18, y, r.inMatch ? PAL.U : PAL.W)
          label(g, r.code, 130, y, PAL.C)
          label(g, `${r.playerCount}/${r.size}`, 176, y)
          label(g, r.mode.toUpperCase(), 210, y, PAL.L)
        })
        label(g, 'C=CREATE J=CODE ENTER=JOIN ESC=BACK', 8, 200, PAL.Y)
      } else if (mode === 'create') {
        centerLabel(g, 'CREATE ROOM', 10, PAL.B, 2)
        panel(g, 10, 28, 236, 166)
        const rows: Array<[string, string]> = [
          ['NAME', (opts.name ?? ROOM_NAME_POOL[nameIdx]!).toUpperCase().slice(0, 14)],
          ['SIZE', opts.size === 2 ? '1 VS 1' : '4 PLAYERS'],
          ['VISIB', opts.public ? 'PUBLIC' : 'PRIVATE'],
          ['THEME', opts.theme.toUpperCase()],
          ['ROUNDS', `FIRST TO ${opts.roundsToWin}`],
          ['BOTFILL', opts.botFill ? 'ON' : 'OFF']
        ]
        rows.forEach((row, i) => {
          const y = 42 + i * 22
          if (i === setting) {
            g.fillStyle = 'rgba(58,160,255,0.28)'
            g.fillRect(12, y - 4, 232, 18)
            label(g, '>', 14, y, PAL.Y)
          }
          label(g, row[0], 26, y)
          label(g, row[1], 100, y, i === setting ? PAL.Y : PAL.W)
        })
        centerLabel(g, 'ENTER = MAKE ROOM!', 190, PAL.L, 1)
        label(g, 'UP/DOWN SEL, LEFT/RIGHT CHANGE', 8, 204, PAL.U)
      } else {
        centerLabel(g, 'ENTER ROOM CODE', 60, PAL.B, 2)
        const shown: string[] = []
        for (let i = 0; i < 8; i++) shown[i] = codeChars[i] ?? '_'
        centerLabel(g, shown.join(''), 100, PAL.Y, 2)
        centerLabel(g, 'TYPE A-Z / DIGITS', 140, PAL.L, 1)
        centerLabel(g, 'ESC=BACK ENTER=JOIN', 158, PAL.U, 1)
      }
      drawToastBar(g)
    }
  }
}

function cycleTheme(o: CreateRoomOpts, sgn: number): void {
  const themes: Array<MapTheme | 'random'> = ['random', 'backyard', 'beach', 'pool']
  const i = themes.indexOf(o.theme)
  o.theme = themes[(i + sgn + themes.length) % themes.length]!
}

function cycleRounds(o: CreateRoomOpts, sgn: number): void {
  const choices: Array<2 | 3 | 5> = [2, 3, 5]
  const i = choices.indexOf(o.roundsToWin as 2 | 3 | 5)
  o.roundsToWin = choices[(i + sgn + choices.length) % choices.length]!
}

// ---------------------------------------------------------------- LOBBY
const BOT_CYCLE: Array<'empty' | BotDifficulty> = ['empty', 'easy', 'medium', 'hard']

function makeLobby(): Screen {
  let room: RoomInfo | null = null
  let players: LobbyPlayer[] = []
  let selSlot = 0
  return {
    enter(): void {
      playMusic('lobby')
    },
    update(): void {
      if (practicePending && room && players.every((p) => p.kind !== 'empty') && !room.inMatch) {
        practicePending = ''
        send({ t: 'set_ready', ready: true })
        setTimeout(() => send({ t: 'start_match' }), 200)
      } else if (tutorialPending && room && players.length >= 2 && !room.inMatch) {
        tutorialPending = false
        send({ t: 'set_slot', slot: 1, kind: 'bot', difficulty: 'easy' })
        setTimeout(() => {
          send({ t: 'set_ready', ready: true })
          setTimeout(() => send({ t: 'start_match' }), 200)
        }, 200)
      }
    },
    onMsg(msg: S2C): void {
      if (msg.t === 'lobby_state') {
        room = msg.room
        players = msg.players
        if (practicePending || tutorialPending) return
        if (room.inMatch && GAME.phase === 'intro' && GAME.myId < 0) {
          GAME.begin('casual', profile(), room.mode)
          Screens.replace(makeGameScreen())
        }
      } else if (msg.t === 'match_start') {
        GAME.begin('casual', profile(), msg.config.mode)
        Screens.replace(makeGameScreen())
      } else if (msg.t === 'error') toastFlash(msg.msg)
      else if (msg.t === 'host_left') toastFlash('HOST LEFT - ROOM CLOSED')
      else if (msg.t === 'round_cancel') return
    },
    onKey(code, down): void {
      if (!down || !room) return
      const act = actionFor(code)
      const mySlot = players.findIndex((p) => p.playerId === profile()?.id)
      const isHost = mySlot === room.hostSlot
      if (act === 'back') {
        send({ t: 'leave_room' })
        Screens.replace(makeMenu())
        return
      }
      if (room.inMatch) return
      if (isHost) {
        if (act === 'confirm') send({ t: 'start_match' })
        else if (act === 'left' || act === 'right') {
          const sgn = act === 'right' ? 1 : -1
          const cur = players[selSlot]?.kind === 'bot' ? ((players[selSlot]!.difficulty ?? 'medium') as 'easy' | 'medium' | 'hard') : 'empty'
          const i = BOT_CYCLE.indexOf(cur)
          const next = BOT_CYCLE[(i + sgn + BOT_CYCLE.length) % BOT_CYCLE.length]!
          if (next === 'empty') send({ t: 'set_slot', slot: selSlot, kind: 'empty', difficulty: 'medium' })
          else send({ t: 'set_slot', slot: selSlot, kind: 'bot', difficulty: next })
          Sfx.blip()
        } else if (act === 'up') {
          selSlot = Math.max(0, selSlot - 1)
          Sfx.blip()
        } else if (act === 'down') {
          selSlot = Math.min(room.size - 1, selSlot + 1)
          Sfx.blip()
        }
      } else if (act === 'confirm') {
        const mine = players.find((p) => p.playerId === profile()?.id)
        send({ t: 'set_ready', ready: !(mine?.ready ?? false) })
        Sfx.blip()
      }
    },
    draw(g): void {
      g.fillStyle = '#0b1030'
      g.fillRect(0, 0, 256, 224)
      if (!room) {
        centerLabel(g, 'WAITING FOR LOBBY...', 108, PAL.C, 1)
        drawToastBar(g)
        return
      }
      centerLabel(g, `ROOM ${room.code}`, 6, PAL.Y, 2)
      label(g, room.mode.toUpperCase(), 196, 12, PAL.L)
      label(g, `TO ${room.roundsToWin}`, 196, 22, PAL.U)
      panel(g, 4, 28, 248, 132)
      players.forEach((p, i) => {
        const y = 38 + i * 21
        const isMe = p.playerId === profile()?.id
        const isHost = room!.hostSlot === i
        if (isHost) {
          g.fillStyle = 'rgba(255,210,63,0.14)'
          g.fillRect(6, y - 4, 234, 18)
        } else if (isMe) {
          g.fillStyle = 'rgba(156,207,90,0.14)'
          g.fillRect(6, y - 4, 234, 18)
        }
        if (selSlot === i) label(g, '>', 10, y, PAL.Y)
        label(g, `${i + 1}`, 18, y, PAL.U)
        const frames = Store.animals[p.animal ?? 'frog'] ?? Store.animals['frog']!
        g.drawImage(p.kind === 'bot' ? frames.soak : previewFrame() % 2 === 1 ? frames.b : frames.a, 28, y - 5)
        if (p.hat && p.hat !== 'none') {
          const h = Store.hats[p.hat]
          if (h) g.drawImage(h, 28, y - 5)
        }
        if (p.kind === 'human') {
          label(g, (p.nickname ?? '').toUpperCase().slice(0, 9), 48, y, isMe ? PAL.Y : PAL.W)
          label(g, `LV${p.level ?? 1}`, 108, y, PAL.C)
          if (p.rating !== undefined) label(g, `${p.rating}`, 138, y, PAL.C)
          const rdy = p.ready ?? false
          label(g, rdy ? 'READY' : 'NOT RDY', 165, y, rdy ? PAL.L : PAL.R)
          if (isHost) label(g, 'HOST', 212, y, PAL.Y)
        } else if (p.kind === 'bot') {
          label(g, 'PRACTICE BOT', 48, y, PAL.P)
          label(g, (p.difficulty ?? 'medium').toUpperCase(), 165, y, PAL.P)
        } else {
          label(g, 'OPEN SLOT', 48, y, PAL.U)
          label(g, 'BOTS+HERE', 165, y, PAL.U)
        }
      })
      label(g, `${room.name.toUpperCase().slice(0, 18)} THEME>${room.theme.toUpperCase()}`, 12, 168, PAL.U)
      label(g, room.botFill ? 'BOTS REFILL EMPTY SLOTS' : 'NO BOTS, HUMANS ONLY!', 12, 178, room.botFill ? PAL.L : PAL.R)
      if (NetState.down) centerLabel(g, 'RECONNECTING...', 190, PAL.R, 2)
      else if (room.hostSlot === players.findIndex((p) => p.playerId === profile()?.id)) {
        centerLabel(g, 'LEFT/RIGHT EDIT SLOT - ENTER START', 188, PAL.Y, 1)
      } else centerLabel(g, 'ENTER = READY UP!', 188, PAL.L, 1)
      centerLabel(g, 'HTTP://#/ROOM/'+room.code, 200, PAL.U, 1)
      drawToastBar(g)
    }
  }
}

// ---------------------------------------------------------------- results
export function pushResults(): void {
  Screens.push(makeResultsScreen())
}

export function ScreensReplaceMenu(): void {
  Screens.replace(makeMenu())
}

function makeResultsScreen(): Screen {
  return {
    enter(): void {
      playMusic('results')
    },
    update(dt: number): void {
      void dt
    },
    onMsg(msg: S2C): void {
      if (msg.t === 'round_start') Screens.pop()
      else if (msg.t === 'error') toastFlash(msg.msg)
      else if (msg.t === 'lobby_state' && !msg.room.inMatch) {
        Screens.replace(makeLobby())
      }
    },
    onKey(code, down): void {
      if (!down) return
      const act = actionFor(code)
      if (act === 'balloon') {
        send({ t: 'rematch_vote' })
        toastFlash('VOTED REMATCH! WAITING FOR LOBBY...')
      } else if (act === 'confirm' || act === 'back') {
        send({ t: 'leave_room' })
        Screens.replace(makeMenu())
      }
    },
    draw(g): void {
      g.fillStyle = '#0b1030'
      g.fillRect(0, 0, 256, 224)
      centerLabel(g, 'MATCH RESULTS', 12, PAL.Y, 2)
      const res = GAME.lastResult
      if (!res) {
        centerLabel(g, 'WAITING FOR RESULTS...', 110, PAL.U, 1)
        drawToastBar(g)
        return
      }
      panel(g, 6, 34, 244, 122)
      res.places.forEach((p, i) => {
        const y = 44 + i * 17
        const me = p.id === res.meId
        if (me) {
          g.fillStyle = 'rgba(255,210,63,0.16)'
          g.fillRect(8, y - 3, 240, 15)
        }
        const medal = p.placement === 1 ? PAL.Y : p.placement === 2 ? '#dfe6f3' : '#a06b4b'
        label(g, `${p.placement}.`, 14, y, medal)
        const frames = Store.animals[p.animal] ?? Store.animals['frog']!
        g.drawImage(previewFrame() % 2 === 1 && p.isBot ? frames.soak : previewFrame() % 2 === 1 ? frames.b : frames.a, 30, y - 5)
        if (p.hat !== 'none') {
          const h = Store.hats[p.hat]
          if (h) g.drawImage(h, 30, y - 5)
        }
        label(g, p.nickname.toUpperCase().slice(0, 11), 48, y, me ? PAL.Y : PAL.W)
        label(g, p.isBot ? 'BOT' : `${p.roundsWon}R`, 132, y, p.isBot ? PAL.P : PAL.C)
        label(g, `${p.soaks} SOAKS`, 160, y, PAL.C)
        if (p.award) label(g, p.award.toUpperCase().replace(/_/g, ' ').slice(0, 11), 206, y, PAL.P)
      })
      if (res.xp) {
        panel(g, 6, 162, 244, 36)
        label(g, `+${res.xp.gained} XP`, 14, 168, PAL.L, 2)
        const pr = xpProgress(res.xp.total)
        label(g, `LV ${pr.cur}/${pr.need}`, 80, 168)
        if (res.xp.leveledUp) label(g, 'LEVEL UP!!', 170, 168, PAL.Y)
        bar(g, 14, 188, 220, pr.cur / pr.need, PAL.L)
      }
      if (res.rating) {
        const d = res.rating.after - res.rating.before
        label(g, `${res.rating.tier.toUpperCase()} ${res.rating.after} (${d >= 0 ? '+' : ''}${d}) PEAK ${res.rating.peak}`, 12, 204, d >= 0 ? PAL.L : PAL.R)
      } else {
        const mePlace = res.places.find((p) => p.id === res.meId)?.placement ?? 1
        centerLabel(g, mePlace === 1 ? 'VICTORY SPLASH!' : `YOU FINISHED #${mePlace}`, 204, 'infer'.length ? (mePlace === 1 ? PAL.L : PAL.U) : PAL.U, 1)
      }
      centerLabel(g, 'SPACE=REMATCH(LOBBIES) ENTER=LEAVE', 212, PAL.U, 1)
      drawToastBar(g)
    }
  }
}

// ---------------------------------------------------------------- LEADERBOARD
interface LbRow {
  rank: number
  nickname: string
  animal: string
  rating: number
  level: number
}

function makeLeaderboard(): Screen {
  let rows: LbRow[] = []
  let mode: GameMode = 'duel'
  let rankMine: number | null = null
  function fetchIt() {
    fetch(`/api/leaderboard?mode=${mode}`)
      .then((r) => r.json())
      .then((j: { entries?: LbRow[]; myRank?: number | null }) => {
        rows = j.entries ?? []
        rankMine = j.myRank ?? null
      })
      .catch(() => {
        rows = []
      })
  }
  return {
    enter(): void {
      playMusic('menu')
      fetchIt()
    },
    update(dt: number): void {
      void dt
    },
    onKey(code, down): void {
      if (!down) return
      const act = actionFor(code)
      if (act === 'back' || act === 'confirm') Screens.replace(makeMenu())
      else if (code === 'KeyD') {
        mode = 'duel'
        fetchIt()
      } else if (code === 'KeyF') {
        mode = 'ffa'
        fetchIt()
      }
    },
    draw(g): void {
      g.fillStyle = '#0b1030'
      g.fillRect(0, 0, 256, 224)
      centerLabel(g, mode === 'duel' ? 'DUEL LADDER' : 'FFA LADDER', 10, PAL.Y, 2)
      panel(g, 4, 30, 248, 164)
      rows.slice(0, 10).forEach((r, i) => {
        const y = 40 + i * 15
        const frames = Store.animals[r.animal] ?? Store.animals['frog']!
        g.drawImage(frames.a, 14, y - 4)
        label(g, `${r.rank}`, 34, y, i < 3 ? PAL.Y : PAL.W)
        label(g, r.nickname.toUpperCase().slice(0, 10), 52, y)
        label(g, `LV${r.level}`, 134, y, PAL.C)
        label(g, `${r.rating}`, 174, y, PAL.L)
      })
      if (rows.length === 0) centerLabel(g, 'NO ENTRIES YET - BE FIRST!', 100, PAL.U, 1)
      if (rankMine) centerLabel(g, `YOU ARE RANK #${rankMine}`, 200, PAL.L, 1)
      label(g, 'D=DUEL F=FFA', 8, 200, PAL.U)
      centerLabel(g, 'ESC=BACK', 210, PAL.U, 1)
      drawToastBar(g)
    }
  }
}

// ---------------------------------------------------------------- LOCKER
function makeLocker(): Screen {
  const animals = CONFIG.ANIMALS.map((a) => a)
  const hats = CONFIG.HATS.map((h) => h)
  let selRow = 0
  let animalIdx = animals.findIndex((a) => a.id === profile()?.animal)
  let hatIdx = hats.findIndex((h) => h.id === profile()?.hat)
  if (animalIdx < 0) animalIdx = 0
  if (hatIdx < 0) hatIdx = 0
  const canUse = (need: number) => (profile()?.level ?? 1) >= need
  return {
    enter(): void {
      playMusic('menu')
    },
    update(dt: number): void {
      void dt
    },
    onKey(code, down): void {
      if (!down) return
      const act = actionFor(code)
      if (act === 'back') Screens.replace(makeMenu())
      else if (act === 'up' || act === 'down') {
        selRow = selRow === 0 ? 1 : 0
        Sfx.blip()
      } else if (act === 'left' || act === 'right') {
        const sgn = act === 'right' ? 1 : -1
        const list = selRow === 0 ? animals : hats
        const curIdx = selRow === 0 ? animalIdx : hatIdx
        let idx = curIdx
        for (let k = 0; k < list.length; k++) {
          idx = (idx + sgn + list.length) % list.length
          if (canUse(list[idx]!.level)) break
        }
        if (selRow === 0) animalIdx = idx
        else hatIdx = idx
        Sfx.blip()
        send({ t: 'set_cosmetics', animal: animals[animalIdx]!.id, hat: hats[hatIdx]!.id })
      }
    },
    draw(g): void {
      g.fillStyle = '#0b1030'
      g.fillRect(0, 0, 256, 224)
      centerLabel(g, 'LOCKER', 10, PAL.O, 2)
      panel(g, 4, 30, 248, 170)
      const a = animals[animalIdx]!
      const h = hats[hatIdx]!
      const frames = Store.animals[a.id] ?? Store.animals['frog']!
      const x = 34
      const y = 52
      g.drawImage(previewFrame() % 2 === 1 ? frames.b : frames.a, x, y)
      if (h.id !== 'none') g.drawImage(Store.hats[h.id]!, x, y)
      label(g, a.name.toUpperCase(), 72, 54, PAL.Y, 2)
      label(g, h.name.toUpperCase(), 72, 76, PAL.C)
      label(g, 'YOUR CRITTER + HEADGEAR', 32, 110, PAL.U)
      const rows: Array<[string, string, boolean]> = [
        ['ANIMAL', `${a.name} LV${a.level}`, canUse(a.level)],
        ['HAT', `${h.name} LV${h.level}`, canUse(h.level)]
      ]
      rows.forEach((row, i) => {
        const yy = 128 + i * 30
        if (selRow === i) {
          g.fillStyle = 'rgba(58,160,255,0.28)'
          g.fillRect(12, yy - 6, 228, 24)
          label(g, '<>', 16, yy, PAL.Y)
        }
        label(g, row[0], 30, yy)
        label(g, row[2] ? row[1].toUpperCase() : `LOCKED LV${listNeed(selRow, animals, hats, i)}`, 100, yy, row[2] ? PAL.W : PAL.U)
      })
      label(g, 'UNLOCKS AS YOU LEVEL UP!', 30, 190, PAL.U)
      centerLabel(g, 'LEFT/RIGHT SWITCH - ESC BACK', 206, PAL.U, 1)
      drawToastBar(g)
    }
  }
}

function listNeed(row: number, animals: Array<{ id: string; level: number }>, hats: Array<{ id: string; level: number }>, which: number): number {
  void row
  return which === 0 ? animals[0]?.level ?? 1 : hats[0]?.level ?? 1
}

// ---------------------------------------------------------------- SETTINGS
function makeSettings(): Screen {
  let sel = 0
  let listening = false
  const rows = ['SFX VOLUME', 'MUSIC VOLUME', 'MUTE', 'COLORBLIND', 'SCREEN SHAKE', 'SPLASH FLASH']
  const bindings: Array<{ act: string; label: string }> = [
    { act: 'up', label: 'KEY UP' },
    { act: 'down', label: 'KEY DOWN' },
    { act: 'left', label: 'KEY LEFT' },
    { act: 'right', label: 'KEY RIGHT' },
    { act: 'balloon', label: 'KEY BALLOON' }
  ]
  return {
    enter(): void {
      playMusic('menu')
    },
    update(dt: number): void {
      void dt
    },
    onKey(code, down): void {
      const act = actionFor(code)
      if (listening) {
        if (!down) return
        if (act === 'back') {
          listening = false
          return
        }
        const b = bindings[sel - rows.length]
        if (b) {
          Store.binds[b.act] = code
          saveBinds()
          Sfx.pickup()
        }
        listening = false
        return
      }
      if (!down) return
      if (act === 'back') Screens.replace(makeMenu())
      else if (act === 'up') {
        sel = Math.max(0, sel - 1)
        Sfx.blip()
      } else if (act === 'down') {
        sel = Math.min(rows.length + bindings.length - 1, sel + 1)
        Sfx.blip()
      } else if (act === 'left' || act === 'right') {
        if (sel === 0) AudioFlags.sfxVol = clampV(AudioFlags.sfxVol + (act === 'right' ? 0.1 : -0.1))
        else if (sel === 1) AudioFlags.musicVol = clampV(AudioFlags.musicVol + (act === 'right' ? 0.1 : -0.1))
        else if (sel === 2) {
          setMuted(!AudioFlags.muted)
        } else if (sel === 3) Store.colorblind = !Store.colorblind
        else if (sel === 4) Store.shake = !Store.shake
        else if (sel === 5) Store.flash = !Store.flash
        else return
        prefsSave()
        applySettings()
        Sfx.blip()
      } else if (act === 'confirm') {
        if (sel === 2) {
          setMuted(!AudioFlags.muted)
          prefsSave()
          applySettings()
          Sfx.pickup()
        } else if (sel === 3) Store.colorblind = !Store.colorblind
        else if (sel === 4) Store.shake = !Store.shake
        else if (sel === 5) Store.flash = !Store.flash
        else if (sel >= rows.length && sel < rows.length + bindings.length) listening = true
        prefsSave()
      }
    },
    draw(g): void {
      g.fillStyle = '#0b1030'
      g.fillRect(0, 0, 256, 224)
      centerLabel(g, 'SETTINGS', 10, PAL.O, 2)
      panel(g, 4, 28, 248, 184)
      const all = [...rows.map((r) => ({ t: r })), ...bindings.map((b) => ({ t: b.label }))]
      all.forEach((r, i) => {
        const y = 40 + i * 18
        if (sel === i) {
          g.fillStyle = 'rgba(255,255,255,0.12)'
          g.fillRect(10, y - 4, 236, 16)
          label(g, '>', 12, y, PAL.Y)
        }
        const isBind = i >= rows.length
        label(g, r.t, 26, y, isBind ? PAL.Y : PAL.W)
        if (i === 0) {
          bar(g, 130, y + 1, 64, AudioFlags.sfxVol + 0.001, PAL.B)
        } else if (i === 1) {
          bar(g, 130, y + 1, 64, AudioFlags.musicVol + 0.001, PAL.P)
        } else if (i === 2) {
          label(g, AudioFlags.muted ? 'MUTED' : 'SOUND ON', 130, y, AudioFlags.muted ? PAL.R : PAL.L)
        } else if (i === 3) {
          label(g, Store.colorblind ? 'ON' : 'OFF', 130, y)
        } else if (i === 4) {
          label(g, Store.shake ? 'ON' : 'OFF', 130, y)
        } else if (i === 5) {
          label(g, Store.flash ? 'ON' : 'OFF', 130, y)
        } else {
          const b = bindings[i - rows.length]!
          label(g, (Store.binds[b.act] ?? '?').replace('Key', '').replace('Digit', '#').toUpperCase(), 130, y, PAL.C)
        }
      })
      if (listening) centerLabel(g, 'PRESS ANY KEY TO BIND THAT!', 214, PAL.Y, 1)
      else centerLabel(g, 'ENTER/ARROWS CHANGE. ESC BACK', 214, PAL.U, 1)
      drawToastBar(g)
    }
  }
}

function clampV(v: number): number {
  return Math.max(0.05, Math.min(1, Math.round(v * 10) / 10))
}

function prefsSave(): void {
  localStorage.setItem('sc_muted', AudioFlags.muted ? '1' : '0')
  localStorage.setItem('sc_colorblind', Store.colorblind ? '1' : '0')
  localStorage.setItem('sc_shake', Store.shake ? '1' : '0')
  localStorage.setItem('sc_flash', Store.flash ? '1' : '0')
}

// welcome / net errors wiring
export function screensInit(): void {
  void 0
}

