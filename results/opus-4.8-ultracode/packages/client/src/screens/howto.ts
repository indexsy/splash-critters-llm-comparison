import { nav, type ScreenInstance } from '../router';
import { btn, h, screenEl } from '../ui';

export function mount(root: HTMLElement): ScreenInstance {
  const el = screenEl();
  el.append(
    h('div', { class: 'title', style: 'font-size:28px', text: 'How to Play' }),
    section('Move', 'WASD or Arrow keys glide your critter around the arena.'),
    section('Drop a balloon', 'Space or E drops a water balloon. Its fuse pops after 3 seconds into a cross-shaped splash.'),
    section('Chains', "A splash that touches another balloon bursts it too — line them up for DOUBLE and TRIPLE SPLASH!"),
    section('Sandcastles', 'Splashes wash away the first sandcastle they hit. Some castles hide power-ups.'),
    section('Power-ups', 'Extra Balloon (+1 balloon), Big Splash (+1 reach), Flippers (+speed), Rubber Boots (kick balloons).'),
    section('Rising Tide', 'At 2:00 the water floods inward from the edges. Stay off the flooded tiles!'),
    section('Emotes', 'Keys 1–4 fire critter-sound emotes. M mutes audio.'),
    section('Win', 'Last critter dry wins the round. First to the round target wins the match.'),
    h('div', { class: 'row', style: 'margin-top:12px' }, [btn('Back', { variant: 'primary', onclick: () => nav.go('title') })]),
  );
  root.append(el);
  return {
    unmount() {
      el.remove();
    },
  };
}

function section(title: string, body: string): HTMLElement {
  return h('div', { class: 'panel', style: 'padding:10px' }, [
    h('div', { class: 'tier', style: 'color:var(--accent)', text: title }),
    h('div', { class: 'small muted', text: body }),
  ]);
}
