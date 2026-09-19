# CC Niri Maximize V2 test plan

## Automated geometry test

Run:

```bash
node test/geometry-v2.test.js
```

It verifies the configured `2560x1440` safe rectangle, all eight Quick Tile rectangles, exact 8 px seams, and absence of overlap or unassigned pixels.
It also verifies the secondary `24/24/24/24` profile and its Left/Right tile geometry.

## Live POC and installed-package results on KWin 6.7.4

- Normal `380,170 1800x1100` → maximize `24,50 2512x1320` → normal restore passed.
- Left `24,50 1252x1320` and Right `1284,50 1252x1320` passed with an 8 px inner seam.
- Top `24,50 2512x656`, Bottom `24,714 2512x656`, and all four `1252x656` corner layouts passed.
- `Normal → Maximize → Left → Right → TopLeft → Maximize → Normal` preserved the original restore rectangle.
- Fullscreen used `0,0 2560x1440`; exit returned to `24,50 2512x1320`.
- Before V2.1, secondary native maximize remained `2560,0 2560x1440`; V2.1 replaces this with a dedicated smaller-gap profile.
- Restore geometry translated `2940,170 ↔ 380,170` when crossing output origins.
- Bottom panel ID 112 was tested in `autohide`, `none`, and restored `dodgewindows` modes; safe maximize stayed `24,50 2512x1320` throughout.
- Temporary probes and POCs were unloaded after testing.

## Manual acceptance matrix

1. Maximize several normal apps on `DP-1`; confirm `24/50/24/70` outer gaps.
2. Restore each app and confirm its original free-window rectangle.
3. Exercise Left, Right, Top, Bottom, and four corners on `DP-1`.
4. Place two adjacent windows and confirm one 8 px inner seam with no overlap.
5. Test `Maximize → Left → Right → corner → Maximize → Restore`.
6. Press F11 from maximize and from a tile; confirm true fullscreen and correct return layout.
7. Maximize on `HDMI-A-1`; confirm `2584,24 2512x1392`.
8. Exercise all Quick Tile modes on `HDMI-A-1`; confirm 24 px outer gaps and an 8 px inner seam.
9. Move maximized and tiled windows between `DP-1` and `HDMI-A-1`; confirm each destination profile is applied.
10. Hide/show the bottom Dock while maximize and a tile are active; confirm geometry is unchanged.
11. Enter and leave Plasma desktop edit mode while a target tile is active; confirm the safe-area tile geometry is restored after every native strut recalculation.
12. Begin an interactive move/resize; confirm custom state clears without a jump to stale geometry.
13. If practical, disconnect/reconnect the secondary display and confirm correct target resolution.
14. Log out and back in; confirm the script remains enabled and configuration persists.

## Log checks

With debug logging enabled, verify there is no repeated geometry output, recursion, signal storm, or KWin scripting exception:

```bash
journalctl --user -b -f | grep cc-niri-maximize
```
