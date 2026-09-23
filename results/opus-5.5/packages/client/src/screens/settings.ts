// Settings: three tabs. Sound & Display (volumes, mute, colorblind splashes, reduced shake,
// ping), Controls (remap every action) and Account (identity + the no-password note). Every
// change applies and persists immediately through settings.ts.
import { navigate } from '../app';
import { audio } from '../audio';
import { h, segmented } from '../ui';
import type { Screen } from './index';
import { focusInitial, installArrowNav } from './parts/arrowNav';
import { runMenuBackdrop } from './parts/backdrop';
import { keybindTable } from './parts/keybindTable';
import { Scope } from './parts/scope';
import { accountSettings } from './parts/settingsAccount';
import { generalSettings } from './parts/settingsGeneral';
import { screenShell } from './parts/shell';
import './parts/styles/settings.css';

type Tab = 'general' | 'controls' | 'account';

const TABS: Record<Tab, (s: Scope) => HTMLElement> = {
  general: generalSettings,
  controls: keybindTable,
  account: accountSettings,
};

let scope: Scope | null = null;
/** Reopen the tab the player last used (this session). */
let lastTab: Tab = 'general';

export const screen: Screen = {
  mount(root) {
    const s = new Scope();
    scope = s;
    audio.music('menu');
    runMenuBackdrop(s);
    const panel = h('div', { class: 'settings-panel scroll' });
    let tabScope: Scope | null = null;
    s.add(() => tabScope?.dispose());

    const show = (tab: Tab) => {
      lastTab = tab;
      tabScope?.dispose();
      tabScope = new Scope();
      panel.replaceChildren(TABS[tab](tabScope));
      panel.scrollTop = 0;
    };

    const tabs = segmented<Tab>(
      [
        { value: 'general', label: 'Sound & Display' },
        { value: 'controls', label: 'Controls' },
        { value: 'account', label: 'Account' },
      ],
      lastTab,
      show,
      'Settings section',
    );
    tabs.el.classList.add('settings-tabs');
    tabs.el.querySelector<HTMLElement>('[aria-checked="true"]')?.setAttribute('data-autofocus', '');

    root.append(screenShell({ title: 'Settings', onBack: () => navigate('/menu') }, tabs.el, panel));
    show(lastTab);
    s.add(installArrowNav(root));
    focusInitial(root);
  },

  unmount() {
    scope?.dispose();
    scope = null;
  },
};
