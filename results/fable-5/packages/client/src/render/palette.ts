// NES-ish limited palette. Everything on screen uses these.
export const PAL = {
  // UI / core
  black: "#0f0f1b",
  white: "#fff1e8",
  gray: "#94816b",
  darkgray: "#49413a",
  navy: "#123", // deep water backdrop
  uiBg: "#12243f",
  uiPanel: "#1b3a5c",
  uiEdge: "#3f6d9e",
  gold: "#ffd23e",
  red: "#e14141",
  green: "#4fce5d",

  // water & splash
  water: "#3e8ef7",
  waterDeep: "#2456c9",
  waterLight: "#8fd3ff",
  splash: "#bfefff",
  splashAlt: "#ffd23e", // colorblind-safe alternative splash tone

  // sand / castle
  sand: "#e8c170",
  sandDark: "#c99a45",
  sandLight: "#f6e0a8",

  // themes
  grass: "#4f9e4f",
  grassDark: "#3a7a3a",
  fence: "#a06a3a",
  poolTile: "#7fd4e0",
  poolTileDark: "#54aebd",
  rock: "#7a7a8a",
  rockDark: "#54545f",

  // critters
  frog: "#5ec24e",
  frogDark: "#3d8f33",
  duck: "#f7d038",
  duckBill: "#f08a24",
  otter: "#a5693a",
  otterBelly: "#d9a86c",
  penguin: "#2b2f45",
  penguinBelly: "#e8ecf5",
  cat: "#9aa0b5",
  catDark: "#6d7288",
  raccoon: "#8a8075",
  raccoonMask: "#2e2a26",
  turtle: "#4ea86b",
  turtleShell: "#2f6f45",
  capybara: "#c09159",
  capyDark: "#96703f",
  pink: "#ff7aa8",
} as const;

export type PalColor = (typeof PAL)[keyof typeof PAL];
