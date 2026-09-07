import {
  button,
  escapeHtml,
  icon,
  pageHeading,
  themeName,
  type UIState,
} from "../ui.js";
export function browserScreen(state: UIState): string {
  return `${pageHeading("THE PUBLIC POND", "Find Your People.", "A room full of new friends. A suspicious number of water balloons.", button(`${icon("plus")} Create a Room`, "create-room"))}
    <div class="toolbar"><div class="segmented"><button data-action="filter-all" class="active">All Rooms</button><button data-action="filter-duel">Duel <small>2P</small></button><button data-action="filter-ffa">Free-for-All <small>4P</small></button></div><div class="toolbar-actions">${button(`${icon("copy", 16)} Join by Code`, "join-code", "secondary")}${button(icon("refresh"), "refresh-rooms", "icon-button", 'aria-label="Refresh rooms"')}</div></div>
    <div class="room-table"><div class="table-head"><span>ROOM / HOST</span><span>ARENA</span><span>PLAYERS</span><span></span></div>
    ${state.rooms.length ? state.rooms.map((r) => `<div class="room-row"><div><span class="room-dot"></span><div><h3>${escapeHtml(r.name)}</h3><p>Hosted by ${escapeHtml(r.host)}</p></div></div><div><span class="theme-swatch ${r.theme}"></span>${themeName(r.theme)}<small>${r.mode === "duel" ? "Duel" : "Free-for-All"}</small></div><div class="room-count">${r.players + r.bots}<span> / ${r.max}</span><small>${r.bots ? `${r.bots} bot${r.bots === 1 ? "" : "s"} in the mix` : "Humans only"}</small></div><div>${button(`Jump In ${icon("arrow", 16)}`, "join-room", "secondary", `data-code="${r.code}"`)}</div></div>`).join("") : `<div class="empty-state"><div class="empty-pixel">${icon("users", 42)}</div><h2>A Quiet Little Pond.</h2><p>No open rooms right now. Be the first to stir things up.<br>Make a room and send a friend the invite link.</p>${button("Start a Room", "create-room")}</div>`}</div>
    <div class="subtle-note">${icon("lock", 16)} Private rooms are invite-only. Got a code? You're already on the guest list.</div>`;
}
