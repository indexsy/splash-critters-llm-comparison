import { BotDifficulty, LobbyState, RoomOptions, ThemeId } from '@splash/shared';
import { net } from '../net.js';
import { audio } from '../audio.js';
import { drawMiniIcon } from '../render/hud.js';
import { el, showApp, toast } from './common.js';

export function renderLobby(root: HTMLElement, go: (screen: string, data?: unknown) => void, mode?: string): void {
  showApp();
  let lobby: LobbyState | null = null;

  const offLobby = net.on('lobby_state', (msg) => {
    lobby = msg.lobby;
    drawLobby();
  });
  const offErr = net.on('error', (msg) => toast(msg.msg));
  cleanup.push(offLobby, offErr);

  if (mode === 'create' || mode === 'practice') {
    drawCreate(mode === 'practice');
    return;
  }
  drawWaiting();

  function drawCreate(practice: boolean): void {
    root.innerHTML = '';
    const panel = el('div', { class: 'panel col' });
    panel.append(el('h2', {}, [practice ? 'PRACTICE VS BOTS' : 'CREATE ROOM']));

    const nameInput = el('input', { type: 'text', value: practice ? 'Practice' : `${net.profile?.nickname ?? 'My'}'s Room`, maxlength: '24' }) as HTMLInputElement;
    const sizeSel = el('select') as HTMLSelectElement;
    for (const s of [2, 4]) sizeSel.append(el('option', { value: String(s) }, [`${s}-player ${s === 2 ? '(Duel)' : '(FFA)'}`]));
    const privSel = el('select') as HTMLSelectElement;
    privSel.append(el('option', { value: 'public' }, ['Public (listed)']));
    privSel.append(el('option', { value: 'private' }, ['Private (code only)']));
    if (practice) privSel.querySelector('option[value="private"]')!.setAttribute('selected', 'true');
    const themeSel = el('select') as HTMLSelectElement;
    for (const t of ['random', 'backyard', 'beach', 'pool']) themeSel.append(el('option', { value: t }, [t[0]!.toUpperCase() + t.slice(1)]));
    const roundsSel = el('select') as HTMLSelectElement;
    for (const r of [2, 3, 5]) {
      const o = el('option', { value: String(r) }, [`First to ${r}`]);
      if (r === 3) o.setAttribute('selected', 'true');
      roundsSel.append(o);
    }
    const botFillSel = el('select') as HTMLSelectElement;
    botFillSel.append(el('option', { value: 'on' }, ['Bot fill: ON']));
    botFillSel.append(el('option', { value: 'off' }, ['Bot fill: OFF']));
    if (practice) privSel.setAttribute('disabled', 'true');

    panel.append(
      labeled('Room name', nameInput),
      labeled('Size', sizeSel),
      labeled('Visibility', privSel),
      labeled('Map theme', themeSel),
      labeled('Rounds to win', roundsSel),
      labeled('Bots', botFillSel),
    );

    const create = el('button', {}, [practice ? 'START PRACTICE' : 'CREATE']);
    create.onclick = () => {
      const opts: RoomOptions = {
        name: nameInput.value.trim() || 'Splash Room',
        size: parseInt(sizeSel.value, 10) as 2 | 4,
        isPublic: practice ? false : privSel.value === 'public',
        theme: themeSel.value as ThemeId | 'random',
        roundsToWin: parseInt(roundsSel.value, 10) as 2 | 3 | 5,
        botFill: botFillSel.value === 'on',
      };
      net.send({ t: 'create_room', opts });
    };
    const back = el('button', { class: 'secondary' }, ['BACK']);
    back.onclick = () => go('menu');
    panel.append(el('div', { class: 'row' }, [create, back]));
    root.append(panel);
  }

  function labeled(label: string, input: HTMLElement): HTMLElement {
    return el('div', { class: 'row' }, [el('span', { style: 'width:120px;font-size:12px;' }, [label]), input]);
  }

  function drawWaiting(): void {
    root.innerHTML = '';
    root.append(el('div', { class: 'dim' }, ['Joining room...']));
  }

  function drawLobby(): void {
    if (!lobby) return;
    root.innerHTML = '';
    const myId = net.playerId;
    const meSlot = lobby.slots.find((s) => s.playerId === myId);
    const isHost = meSlot?.isHost ?? false;

    const header = el('div', { class: 'row' }, [
      el('h2', {}, [lobby.name]),
      el('span', { class: 'tier-badge' }, [lobby.size === 2 ? 'DUEL' : 'FFA']),
      el('span', { class: 'tier-badge' }, [lobby.theme]),
      el('span', { class: 'tier-badge' }, [`FIRST TO ${lobby.roundsToWin}`]),
    ]);

    const link = el('div', { class: 'row' }, [
      el('span', { class: 'dim' }, ['Code: ']),
      el('span', { style: 'color:#ffd23c;font-weight:bold;font-size:18px;letter-spacing:3px;' }, [lobby.code]),
    ]);
    const copyBtn = el('button', { class: 'secondary', style: 'padding:4px 10px;font-size:10px;' }, ['COPY LINK']);
    copyBtn.onclick = () => {
      void navigator.clipboard?.writeText(`${location.origin}/#/room/${lobby!.code}`);
      toast('Link copied!');
    };
    link.append(copyBtn);

    const slotList = el('div', { class: 'col' });
    lobby.slots.forEach((s, i) => {
      const row = el('div', { class: `slot-row${s.isHost ? ' host' : ''}${s.playerId === myId ? ' me' : ''}` });
      const icon = document.createElement('canvas');
      icon.width = 12;
      icon.height = 12;
      icon.style.cssText = 'width:28px;height:28px;image-rendering:pixelated;';
      if (s.kind !== 'open') drawMiniIcon(icon, s.animal, s.hat);
      const name = el('span', { style: 'min-width:150px;' }, [
        s.kind === 'open' ? '— open —' : `${s.nickname}${s.kind === 'bot' ? ` (${s.botDifficulty})` : ''}${s.isHost ? ' ★' : ''}`,
      ]);
      row.append(icon, name);
      if (isHost && s.kind !== 'human') {
        const sel = el('select', { style: 'font-size:11px;' }) as HTMLSelectElement;
        for (const opt of ['open', 'easy', 'medium', 'hard']) {
          const o = el('option', { value: opt }, [opt === 'open' ? 'open slot' : `${opt} bot`]);
          if ((s.kind === 'open' && opt === 'open') || (s.kind === 'bot' && s.botDifficulty === opt)) o.setAttribute('selected', 'true');
          sel.append(o);
        }
        sel.onchange = () => {
          if (sel.value === 'open') net.send({ t: 'set_slot', slot: i, kind: 'open' });
          else net.send({ t: 'set_slot', slot: i, kind: 'bot', difficulty: sel.value as BotDifficulty });
        };
        row.append(sel);
      } else if (s.kind === 'human') {
        row.append(el('span', { class: s.ready ? 'good small' : 'dim small' }, [s.ready ? 'READY' : '']));
      }
      slotList.append(row);
    });

    const buttons = el('div', { class: 'row' });
    if (isHost) {
      const start = el('button', { class: 'good' }, ['START MATCH']);
      start.onclick = () => net.send({ t: 'start_match' });
      buttons.append(start);
    } else {
      const ready = el('button', {}, [meSlot?.ready ? 'UNREADY' : 'READY']);
      ready.onclick = () => net.send({ t: 'set_ready', ready: !meSlot?.ready });
      buttons.append(ready);
    }
    const leave = el('button', { class: 'danger' }, ['LEAVE']);
    leave.onclick = () => {
      net.send({ t: 'leave_room' });
      go('menu');
    };
    buttons.append(leave);

    root.append(header, link, slotList, buttons);
    audio.playMusic('menu');
  }
}

export const cleanup: (() => void)[] = [];
