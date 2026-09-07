import { button, icon, type UIState } from "../ui.js";
export const TRAINING = [
  {
    id: "move",
    title: "Meet Your Flippers.",
    text: "Move with WASD or the arrow keys. Take a little stroll around your spawn.",
  },
  {
    id: "castle",
    title: "Drop. Dodge. Splash.",
    text: "Walk toward the sandcastle on the top lane. Drop a balloon with Space or E, then turn a corner before its 3-second fuse runs out.",
  },
  {
    id: "pickup",
    title: "A Little Extra Oomph.",
    text: "Wait for the splash to disappear, then collect the glowing power-up the castle left behind.",
  },
  {
    id: "chain",
    title: "Better Together.",
    text: "You have three balloons in training. Place two within two tiles of each other, then escape around a corner. One burst triggers the other!",
  },
  {
    id: "soak",
    title: "Your First Rival.",
    text: "Find Waddles in the opposite corner. Place a balloon in their path, make a safe exit, and let the water do the rest.",
  },
];
export function tutorialPanel(state: UIState): string {
  const step = TRAINING.find((s) => !state.tutorialGoals.has(s.id));
  return `<div class="tutorial-panel"><div class="tutorial-progress">${TRAINING.map((s, i) => `<span class="${state.tutorialGoals.has(s.id) ? "done" : step?.id === s.id ? "current" : ""}">${state.tutorialGoals.has(s.id) ? icon("check", 12) : i + 1}</span>`).join("")}</div><div><span class="eyebrow">SPLASH SCHOOL / ${state.tutorialGoals.size} OF 5</span><h3>${step?.title ?? "Officially a Splash Critter."}</h3><p>${step?.text ?? "Five new skills. One very wet rival. Your first 50 XP is waiting."}</p></div>${button(step ? "Skip Tutorial" : "Collect 50 XP", step ? "skip-tutorial" : "complete-tutorial", step ? "text" : "primary")}</div>`;
}
