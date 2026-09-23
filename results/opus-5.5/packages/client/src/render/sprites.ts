// Sprite facade: the one import for every procedural sprite. All getters return cached
// HTMLCanvasElements (built on first use, keyed by their arguments). Browser only.
//
// Critters
//   getAnimalFrame(animal, dir, frame, slot, colorblind)  16x16 body, frame 0 idle / 1-2 walk
//   animalFrameAt(moving, timeMs)                          walk-cycle frame for a critter
//   getHat(hat, facing, frame) + hatPlacement(...)         hat alone (null for 'none')
//   getCritter(animal, hat, dir, frame, slot, cb, hatFrame) body + hat, CRITTER_W x CRITTER_H,
//                                                          draw at (boxX, boxY - CRITTER_OY)
//   getPortrait(animal, hat, slot, cb)                     14x14 framed HUD head portrait
//   getShadow(w)                                           translucent ground shadow
export { ANIMAL_FRAME_COUNT, ANIMAL_SIZE, WALK_FRAME_MS, animalFrameAt, facingOf, getAnimalFrame, hatPlacement } from './sprites-animals';
export type { Facing } from './sprites-animals';
export { getHat, hatFrameCount } from './sprites-hats';
export { CRITTER_H, CRITTER_OY, CRITTER_W, PORTRAIT_SIZE, getCritter, getPortrait, getShadow } from './sprites-critter';
//
// Soaks & revenge ducks
//   getSoakFrame(animal, frame, slot, cb)  SOAK_W x SOAK_H, critter box at (SOAK_OX, SOAK_OY);
//                                          soakFrameCount(animal) frames (cat: extra drama),
//                                          SOAK_FRAME_MS each, last frame = resting puddle
//   getDuckRide(animal, frame, slot, cb, hat)  rider on a rubber duck, DUCK_RIDE_FRAMES bob
//                                          frames; put DUCK_RIDE_ANCHOR on the duck position
export {
  DUCK_RIDE_ANCHOR,
  DUCK_RIDE_FRAMES,
  DUCK_RIDE_H,
  DUCK_RIDE_W,
  SOAK_FRAME_MS,
  SOAK_H,
  SOAK_OX,
  SOAK_OY,
  SOAK_W,
  getDuckRide,
  getSoakFrame,
  soakFrameCount,
} from './sprites-soak';
//
// Balloons & splashes
//   getBalloon(frame, slot, cb, fromDuck)      16x16, BALLOON_FRAMES; pick with balloonFrameAt()
//   getSlidingBalloon(dir, slot, cb, fromDuck) kicked balloon with speed streaks
//   getSplash(part, dir, frame, cb)            16x16 'center' | 'arm' | 'end' tiles,
//                                              SPLASH_FRAMES; pick with splashFrameAt(). Every
//                                              frame is solid water (the tile soaks until
//                                              endTick); after endTick, spray droplet particles
//                                              in splashPalette(cb).droplets instead
export {
  BALLOON_FRAMES,
  SPLASH_FRAMES,
  balloonFrameAt,
  getBalloon,
  getSlidingBalloon,
  getSplash,
  splashFrameAt,
} from './sprites-fx';
export type { SplashPart } from './sprites-fx';
//
// Icons (also importable from ./icons)
//   getItem(kind, frame)          16x16 power-up pickup, ITEM_FRAMES shine frames (null for None)
//   getTierBadge(tier, size)      'small' 12x12 / 'large' 24x24 rank badge
//   getEmoteBubble(id)            speech bubble for quack / ribbit / squeak / honk
//   getGlyph(name), pingGlyph(rtt) HUD glyphs (stats, ping bars, crown, soaked, cursor, ...)
//   getLogo()                     two-line title logo
export {
  BADGE_LARGE,
  BADGE_SMALL,
  EMOTE_BUBBLE_H,
  EMOTE_BUBBLE_W,
  GLYPH_NAMES,
  ITEM_FRAMES,
  ITEM_FRAME_MS,
  ITEM_SIZE,
  getEmoteBubble,
  getGlyph,
  getItem,
  getLogo,
  getTierBadge,
  pingGlyph,
} from './icons';
export type { BadgeSize, GlyphName } from './icons';
