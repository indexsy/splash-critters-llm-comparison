import { CONFIG } from '@splash/shared'
import { gcRooms, roomTick } from './rooms'
import type { RoomHost } from './rooms'
import type { Matchmaker } from './matchmaker'

export interface GameLoopOptions {
  host: RoomHost
  mm: Matchmaker
  onFrame?: (fps: number) => void
  offline?: boolean
}

export function startGameLoop(opts: GameLoopOptions): () => void {
  const { host, mm } = opts
  let last = Date.now()
  let frames = 0
  let fpsAt = last
  let fps = 0
  let roomsSlice = 0

  const iv = setInterval(() => {
    last = Date.now()
    mm.start()
    const rooms = [...host.rooms.values()].filter((r) => !r.closed)
    roomsSlice = (roomsSlice + 1) % 4
    const startIv = roomsSlice
    for (const room of rooms) {
      try {
        roomTick(host, room)
      } catch (err) {
        console.error(`[room ${room.id}] tick error`, err)
        room.closed = true
      }
    }
    if (last - fpsAt > 1000) {
      fps = frames
      frames = 0
      fpsAt = last
      opts.onFrame?.(fps)
    }
    void startIv
  }, CONFIG.TICK_MS)

  const gcIv = setInterval(() => gcRooms(host), 60000)
  return () => {
    clearInterval(iv)
    clearInterval(gcIv)
    mm.stop()
  }
}
