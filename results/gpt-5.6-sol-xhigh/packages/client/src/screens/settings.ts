import type { AppCtx, Screen, ScreenHandle, ScreenParams } from "../main.js";
import { HAT_LIST, ANIMAL_LIST, button, el, field, keyCap, panel, select, slider, toggle, animalLabel, hatLabel } from "../ui.js";
import { DEFAULT_KEYBINDS, type ColorblindMode, type Keybinds } from "./state.js";

const KEYBIND_LABELS: Array<{ key: keyof Keybinds; label: string }> = [
  { key: "up", label: "MOVE UP" },
  { key: "down", label: "MOVE DOWN" },
  { key: "left", label: "MOVE LEFT" },
  { key: "right", label: "MOVE RIGHT" },
  { key: "balloon", label: "DROP BALLOON" },
  { key: "revenge", label: "REVENGE LOB" },
  { key: "ready", label: "TOGGLE READY" },
  { key: "emote1", label: "EMOTE 1" },
  { key: "emote2", label: "EMOTE 2" },
  { key: "emote3", label: "EMOTE 3" },
  { key: "emote4", label: "EMOTE 4" }
];

export function createSettingsScreen(): Screen {
  return {
    id: "settings",
    mount(ctx: AppCtx, params: ScreenParams): ScreenHandle {
      const audio = ctx.audio;
      const back = (params["back"] as string | undefined) ?? "menu";
      const initial = ctx.settings.get();
      const { root, body } = panel("SETTINGS", "TUNE YOUR SPLASH PAD", true);

      const masterSlider = slider({ min: 0, max: 100, step: 1, value: Math.round(initial.master * 100), onChange: (v) => { ctx.settings.update({ master: v / 100 }); audio.play("tick", { gain: 0.5 }); } });
      const sfxSlider = slider({ min: 0, max: 100, step: 1, value: Math.round(initial.sfx * 100), onChange: (v) => { ctx.settings.update({ sfx: v / 100 }); audio.play("tick", { gain: 0.5 }); } });
      const musicSlider = slider({ min: 0, max: 100, step: 1, value: Math.round(initial.music * 100), onChange: (v) => { ctx.settings.update({ music: v / 100 }); audio.play("tick", { gain: 0.5 }); } });
      const muteToggle = toggle(initial.muted, (v) => { ctx.settings.update({ muted: v }); audio.play("tab"); });
      const shakeToggle = toggle(initial.reducedShake, (v) => { ctx.settings.update({ reducedShake: v }); audio.play("tab"); });
      const colorblindSel = select<ColorblindMode>(
        [{ value: "off", label: "OFF" }, { value: "protan", label: "PROTANOPIA" }, { value: "deutan", label: "DEUTERANOPIA" }, { value: "tritan", label: "TRITANOPIA" }],
        initial.colorblind,
        (v) => { ctx.settings.update({ colorblind: v }); audio.play("tab"); }
      );

      body.append(
        field("MASTER VOLUME", masterSlider),
        field("SFX VOLUME", sfxSlider),
        field("MUSIC VOLUME", musicSlider),
        el("div", { class: ["sc-row", "between"] }, [
          el("span", { class: ["sc-tiny", "sc-dim"], text: "MUTE ALL" }),
          muteToggle.root
        ]),
        el("div", { class: ["sc-row", "between"] }, [
          el("span", { class: ["sc-tiny", "sc-dim"], text: "REDUCED SCREEN SHAKE" }),
          shakeToggle.root
        ]),
        field("COLORBLIND PALETTE", colorblindSel)
      );

      body.append(el("div", { class: ["sc-divider"] }));
      body.append(el("div", { class: ["sc-title"], text: "KEYBINDS", style: { fontSize: "13px" } }));
      const keyGrid = el("div", { class: ["sc-grid", "cols-2"] });
      for (const kb of KEYBIND_LABELS) {
        const cap = keyCap(initial.keybinds[kb.key], (next) => {
          ctx.settings.updateKeybind(kb.key, next);
          audio.play("confirm");
        });
        keyGrid.append(field(kb.label, cap.root));
      }
      body.append(keyGrid);

      const resetBtn = button("RESET KEYBINDS", () => {
        for (const k of Object.keys(DEFAULT_KEYBINDS) as (keyof Keybinds)[]) {
          ctx.settings.updateKeybind(k, DEFAULT_KEYBINDS[k]);
        }
        audio.play("back");
        ctx.toast("KEYBINDS RESET");
        ctx.go("settings", { back });
      }, { variant: "ghost", size: "tiny" });
      body.append(resetBtn);

      body.append(el("div", { class: ["sc-divider"] }));
      body.append(el("div", { class: ["sc-title"], text: "ACCOUNT", style: { fontSize: "13px" } }));
      const accountCard = el("div", { class: ["sc-card"], style: { background: "rgba(255,93,93,0.10)" } });
      body.append(accountCard);

      function refreshAccount(): void {
        const token = ctx.net.loadToken();
        const profile = ctx.profile();
        const masked = token ? `${token.slice(0, 6)}…${token.slice(-4)}` : "—";
        const ack = ctx.settings.get().acknowledgedToken;
        const warn = !ack;
        const items: HTMLElement[] = [
          el("div", { class: ["sc-row", "between"] }, [
            el("span", { class: ["sc-tiny", "sc-dim"], text: "PLAYER ID" }),
            el("span", { class: ["sc-mono-num", "sc-tiny"], text: profile?.id ?? "—" })
          ]),
          el("div", { class: ["sc-row", "between"] }, [
            el("span", { class: ["sc-tiny", "sc-dim"], text: "SESSION TOKEN" }),
            el("span", { class: ["sc-mono-num", "sc-tiny"], text: masked })
          ])
        ];
        if (warn) {
          items.push(el("div", { class: ["sc-card"], style: { background: "rgba(255, 216, 61, 0.12)", padding: "8px", fontSize: "10px" } }, [
            el("div", { class: ["sc-row"], style: { gap: "6px", alignItems: "center" } }, [
              el("span", { class: ["sc-tag", "host"], text: "TOKEN WARNING" }),
              el("span", { class: ["sc-tiny"], text: "TOKEN IS STORED IN localStorage FOR RECONNECT" })
            ]),
            el("div", { class: ["sc-muted", "sc-tiny"], style: { marginTop: "6px" }, text: "Anyone with this browser session can act as you. Clear it on shared devices." })
          ]));
          items.push(el("div", { class: ["sc-row"], style: { gap: "6px", marginTop: "6px" } }, [
            button("I UNDERSTAND", () => { ctx.settings.update({ acknowledgedToken: true }); audio.play("confirm"); refreshAccount(); }, { variant: "mint", size: "tiny" })
          ]));
        }
        items.push(el("div", { class: ["sc-row"], style: { gap: "6px", marginTop: "8px" } }, [
          button("COPY TOKEN", async () => {
            try { await navigator.clipboard.writeText(token ?? ""); ctx.toast("TOKEN COPIED", "good"); } catch { ctx.toast("COPY FAILED", "bad"); }
          }, { variant: "ghost", size: "tiny" }),
          button("SIGN OUT / RESET", () => {
            ctx.net.clearToken();
            ctx.toast("TOKEN CLEARED · RELOADING", "bad");
            audio.play("back");
            window.setTimeout(() => window.location.reload(), 600);
          }, { variant: "coral", size: "tiny" })
        ]));
        accountCard.replaceChildren(...items);
      }
      refreshAccount();
      const accInterval = window.setInterval(refreshAccount, 2000);

      body.append(el("div", { class: ["sc-divider"] }));
      body.append(el("div", { class: ["sc-btn-row", "between"] }, [
        button("BACK", () => { audio.play("back"); ctx.go(back as never); }, { variant: "ghost" }),
        button("TEST SFX", () => { audio.resume(); audio.play("splash"); audio.play("chain"); }, { variant: "pink" })
      ]));

      void ANIMAL_LIST; void HAT_LIST; void animalLabel; void hatLabel;

      return {
        root,
        unmount() { window.clearInterval(accInterval); }
      };
    }
  };
}
