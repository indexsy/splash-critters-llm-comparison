import {
  button,
  escapeHtml,
  icon,
  pageHeading,
  portrait,
  themeName,
  type UIState,
} from "../ui.js";
export function lobbyScreen(state: UIState): string {
  const room = state.lobby;
  if (!room) return "";
  const host = room.hostId === state.profile?.id;
  return `${pageHeading(room.opts.isPublic ? "OPEN TO THE WHOLE POND" : "YOUR PRIVATE POND", escapeHtml(room.opts.name), `${themeName(room.opts.theme)} / ${room.opts.mode === "duel" ? "Duel" : "Free-for-All"} / First to ${room.opts.roundsToWin}`, button(`${icon("back")} Leave Room`, "leave", "secondary"))}
    <div class="invite-strip"><div><span class="eyebrow">GOOD TIMES HAVE A CODE</span><strong class="pixel">${room.code}</strong></div><p>Send a friend your invite.<br>Bring a towel. Or don't.</p>${button(`${icon("copy")} Copy Invite Link`, "copy-invite", "secondary")}</div>
    <section class="lobby-slots">${room.slots
      .map(
        (
          s,
        ) => `<article class="lobby-slot ${s.kind === "open" ? "open-slot" : ""}"><div class="slot-number pixel">P${s.slot + 1}<span>${s.playerId === room.hostId ? "HOST" : s.kind === "bot" ? "BOT" : ""}</span></div>${s.kind === "open" ? `<div class="open-avatar">+</div><h3>Room for a Friend.</h3><p>Or a delightfully sneaky bot.</p>` : `${portrait(s.animal, s.hat)}<h3>${escapeHtml(s.nickname.split("#")[0])}</h3><p>${s.kind === "bot" ? "Powered by pure mischief" : s.connected ? (s.playerId === state.profile?.id ? "That's you. Looking good." : "Ready to make waves") : "Reconnecting (15s grace)"}</p>`}
    ${host && s.kind !== "human" ? `<select data-slot="${s.slot}" data-change="slot" aria-label="Player ${s.slot + 1} bot difficulty"><option value="open" ${s.kind === "open" ? "selected" : ""}>Open slot</option value="easy" ${s.kind === "bot" && s.difficulty === "easy" ? "selected" : ""}>Easy Bot</option><option value="medium" ${s.kind === "bot" && s.difficulty === "medium" ? "selected" : ""}>Medium Bot</option><option value="hard" ${s.kind === "bot" && s.difficulty === "hard" ? "selected" : ""}>Hard Bot</option></select>` : `<span class="ready-label ${s.ready ? "is-ready" : ""}">${s.ready ? `${icon("check", 15)} Ready to Splash` : "Getting their flippers on..."}</span>`}</article>`,
      )
      .join("")}</section>
    <div class="lobby-footer"><p>${room.opts.botFill ? "Empty slots will be filled with Medium bots." : "Fill every slot with a friend or a bot to start."}</p>${host ? button(`Everybody In? Let's Splash ${icon("arrow")}`, "start-match") : button(`${icon("check")} ${room.slots.find((s) => s.playerId === state.profile?.id)?.ready ? "Not Ready Yet" : "I'm Ready"}`, "ready")}</div>`;
}
