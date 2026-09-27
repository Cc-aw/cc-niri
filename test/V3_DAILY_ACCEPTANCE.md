# CC Niri V3 daily acceptance

Use this checklist on the installed desktop before declaring `3.0.0-beta.1` ready. Record the actual environment and mark each case PASS, FAIL, or BLOCKED. A written checklist alone is not an acceptance pass.

## Environment and evidence

| Item | Expected baseline | Actual |
| --- | --- | --- |
| OS | Fedora 44 | Fedora 44 (package query, 2026-09-27) |
| Plasma / KWin | Plasma Wayland / KWin 6.7.5 | Plasma 6.7.5 / KWin 6.7.5 / Wayland |
| Primary | DP-1, 2560×1440 logical, 150% | DP-1 enabled, 3840×2160 physical, 2560×1440 logical, 150% |
| Secondary | HDMI-A-1, 2560×1440 logical, 100% | HDMI-A-1 enabled, 2560×1440 logical, 100%; eDP-1 disabled |
| Build / commit | Installed V3 build | Pending |
| Date / tester | — | Pending |

Use Konsole, Dolphin, Firefox, an Electron app (Typora or VS Code), System Settings, and a modal file chooser. If the display topology or KWin version changes, record it and rerun the smoke test.

For every case, check that no window remains hidden or stuck, no window appears on the wrong output, opacity and script-owned minimization are cleared, focus does not loop, Bridge loss does not freeze controls, and animation does not leak across displays. Record failures with the case ID, exact steps, KWin/Bridge logs, and a screenshot or short recording.

## Full acceptance matrix

| ID | Steps | Required result | Result / evidence |
| --- | --- | --- | --- |
| A1 | Log in to an empty desktop with CC Niri enabled. | Script, Bridge, native clip, effect, and Dock start; no hidden window or repeated journal error. | Partial: live reload and Bridge snapshot succeeded; clean login and visual checks pending. |
| A2 | Open one Konsole. | One correctly sized active Column; Dock UUID matches. | Pending |
| A3 | Open Konsole, Firefox, Dolphin, Electron app in order. | Logical order and `1|2 → 2|3 → 3|4` viewport progression are correct. | Pending |
| A4 | Repeat opening Firefox and Electron app slowly and rapidly. | Each window is adopted once after mapping; no ghost Column or bad parking. | Pending |
| B1 | With five Columns, press L from `1|2` through `4|5`, then H back. | One step per press, no wrap, correct focus and offset, no secondary display leak. | Partial: 2026-09-27 live indices `2→3→4→5→4→3`, then preferred Wide at 3 and a further H to 2; all UUIDs stayed ordered. Full edge/no-wrap sweep pending. |
| C1 | Press `L L L`, `L L H`, and `H L H L` rapidly. | Motion retargets from painted position; no snap, opacity/scale residue, or stale animation. | Partial: rapid `L L H` settled on intended preferred Wide Column; screenshot after settle showed no visible ghost/opacity residue on either output. Other sequences and in-motion observation pending. |
| D1 | From `1|2`, focus 1 and toggle Wide; toggle again. | 1 becomes centered 72% Wide, then original Pair geometry and neighbor return. | PASS for live focused Column 3: Meta+Z produced 72% centered Wide, second press restored a clean two-column Pair; focus and order stayed unchanged in Bridge snapshots. |
| D2 | From `1(Wide preference)|2` with focus 2, press H. | 1 becomes Wide. | Pending |
| D3 | From `2|3` with offscreen 1 set Wide, press H twice. | First H shows `1|2`; second H centers 1 as Wide. | Pending |
| D4 | From a focused Wide Column, navigate toward its visible neighbor. | Direction and destination are correct. | PASS for live Column 4 Wide → H → Column 3 Pair; reverse L returned to Column 4 Wide. |
| E1 | Open Firefox file chooser, Dolphin Properties, Settings/About/modal dialogs. | Dialogs, transient, utility, toolbar, popup, menu, splash, and skipTaskbar windows do not enter Columns or change Dock order; parent viewport/focus survives close. | Pending |
| F1 | Detach and reattach a managed window with `Meta+Shift+Enter`. | Detach preserves geometry/focus; reattach inserts right of focused Column and syncs Dock. | Pending |
| F2 | Interactively drag a managed window, then reattach. | Drag detaches without forced geometry or jump; reattach succeeds. | Pending |
| F3 | With remembered floating window, focus a dialog and press the shortcut. | Dialog does not attach the remembered window. | Pending |
| G1 | Click visible Column 1 in Dock from `1|2`. | Only focus changes; viewport does not scroll. | Pending |
| G2 | Click hidden Column 5 in Dock from `1|2`. | Viewport advances one Pair at a time to `4|5`, then activates 5. | Pending |
| G3 | Drag Dock item 5 to position 2. | UUID set, generation, focus, order, viewport, and authoritative Dock state agree. | Pending |
| G4 | Inject a stale Dock reorder generation with a debug helper/test. | Command is rejected and Dock receives authoritative resync. | Pending |
| H1 | Close focused left Column in Pair. | Right neighbor takes focus. | Pending |
| H2 | Close focused right Column in Pair. | Right neighbor is preferred; otherwise left neighbor. | Pending |
| H3 | Close an unfocused Column. | Existing focus remains. | Pending |
| I1 | Enter/exit fullscreen from Pair and Wide. | Previous Pair/Wide layout returns. | Pending |
| I2 | Use KDE native maximize then restore. | Safe-area maximize and original geometry return. | Pending |
| J1 | Drag managed Column from primary to secondary. | Removed from primary model; native behavior on secondary. | Pending |
| J2 | Move window from secondary to primary while inactive, then activate. | Adoption happens on first activation, not before. | Pending |
| J3 | On mixed DPI displays, press H/L repeatedly. | Native clipping prevents ghosts or movement on secondary. | Partial: settled screenshots after Wide/Pair and rapid L-L-H showed no cross-output ghost; in-motion visual check pending. |
| K1 | Set order `1,2,3,4,5`, viewport `3|4`; reload KWin script. | Order/anchor/focus and parked windows restore correctly. | Partial: 9-Column UUID order survived two live `install.sh` reloads; fixed `3|4` anchor, focus, and parked-window visuals pending. |
| K2 | Restart `cc-scroll-dock-bridge` user service, then navigate. | H/L works during timeout fallback and Dock IPC reconnects. | Partial: service restarted and Bridge republished the same 9-Column snapshot; navigation during restart not observed. |
| K3 | Stop Bridge service, then use H/L, Wide, Pair. | Basic desktop control continues. Restart service after case. | PASS for controlled L: with Bridge stopped, focus moved from Column index 2 to 3; after service restart the authoritative snapshot showed index 3 Wide. H restored index 2 Pair. Wide/Pair commands during outage pending. |
| K4 | Temporarily unload native clip effect. | Full-delta is disabled; safe 20 px fallback works without cross-output leak. Restore effect after case. | Pending |
| K5 | Disable/uninstall script in a disposable test installation. | Parked windows, opacity, and script-owned minimize restore; user-minimized windows stay minimized. Reinstall afterward. | Pending |
| K6 | Trigger Emergency Restore via the supported debug path. | Layout disables first; every managed window returns to visible valid screen geometry without recovery loop. | Partial: Bridge accepted restore request, command pump invoked, then reinstallation yielded a new script session and 9-Column snapshot; window geometry/visibility still needs visual verification. |

## Daily smoke (3–5 minutes)

Open five windows; navigate H/L five times; press `L L H`; enter/exit Wide; open a dialog; detach/reattach; enter/exit fullscreen; click a hidden Dock item; close the focused window; restart Bridge. Record date, build, display topology, and PASS/FAIL here:

| Date | Build | Displays / KWin | Result | Notes |
| --- | --- | --- | --- | --- |
| Pending | Pending | Pending | Pending | — |

## Automated verification record

On 2026-09-27, `node tools/check.js --native` passed 49/49 Node tests and all three native builds on existing build trees. Separate fresh CMake configure and build runs passed for Bridge, Viewport Clip, and Plasmoid under Fedora 44 / KWin 6.7.5. `install.sh` completed twice after fixing its KWin development-file probe. The Fedora CI job now builds each configured component directly; the separate JS job runs the regression and whitespace gate. [GitHub Actions run 36290005455](https://github.com/Cc-aw/cc-niri/actions/runs/36290005455) passed both `js-regression` and `native-build`, including fresh Bridge, Viewport Clip, and Plasmoid builds. The full interactive matrix remains pending.

### Live invariant fault injection, 2026-09-27

A temporary, uncommitted KWin shortcut probe changed Column 1 `logicalX` by 17. The installed supervisor logged `INVARIANT_FAIL epoch=5` followed by `SELF_HEAL epoch=5`, without `FAIL_SAFE` during the observation interval. A second probe changed Column 1's state ownership. KWin logged `INVARIANT_FAIL epoch=6` then one `FAIL_SAFE epoch=6`; repeating the shortcut produced no second fail-safe. The probe was removed from source and the installed package, its shortcut configuration was deleted, and the normal script was reinstalled with a new Bridge session. This verifies the live self-heal and fail-safe paths and latch. Visual confirmation that every parked window was restored remains pending.

### Controlled mixed-DPI desktop run, 2026-09-27

The active layout used DP-1 at 3840×2160 physical / 2560×1440 logical / 150%, HDMI-A-1 at 2560×1440 / 100%, and disabled eDP-1. Bridge reported eight ordered Columns. With the primary screen free of other input, the focused index started at 2 in Pair, returned to index 2 in Pair after all checks, and retained the original UUID order. Screenshots after Wide, Pair, and rapid retarget settlement showed correctly sized primary windows and no visible secondary ghost. The user was free to use the secondary display during the run, so secondary content itself changed independently. The KWin journal contained no `INVARIANT_FAIL`, `FAIL_SAFE`, `EMERGENCY_RESTORE`, `TypeError`, or `ReferenceError` entries for the test interval. Full acceptance remains open for the untested rows above.

## Release gate

Full acceptance requires all core cases to pass on the recorded mixed DPI Wayland desktop, with no hidden/stuck windows, wrong-output windows, permanent opacity zero, stale script-owned minimize, focus loop, Bridge-induced freeze, or cross-monitor animation leak. Rerun the full matrix after Phase C. Do not mark this gate complete from automated tests alone.
