# V3 Phase 5.5 Runtime Results

Environment: Fedora 44, KWin 6.7.4 Wayland, `DP-1` at `0,0 2560x1440`, `HDMI-A-1` at `2560,0 2560x1440`.

## Parking POC

Zen Browser was moved and observed after a delay at each coordinate:

| Requested X | Actual X | Output | Result |
|---:|---:|---|---|
| -2500 | -2500 | DP-1 | PASS |
| -5000 | -5000 | DP-1 | PASS |
| -10000 | -10000 | DP-1 | PASS |

At `x=-10000`, an actual `Walk Through Windows` (Alt+Tab path) activated Zen. `workspace.windowActivated` fired once for the activation and the window remained on `DP-1`.

## Projection and scrolling

- Initial visible column: `24,50 1256x1320`, output `DP-1`.
- Initial parking positions included `-5352`, `-6616`, `-7880`, and `-9144`; every parked window remained on `DP-1`.
- Seven snapshots covering a multi-column rightward and leftward focus traversal passed.
- Every managed window was either fully contained by the main safe area or fully left of the virtual desktop.
- Observed managed-window `outputChanged` events during the complete traversal: **0**.
- A projection-parked Konsole at `-5352,50 1256x1320` remained activatable through the real Alt+Tab path, with zero output changes.

## Native transfer and secondary output

- Native DP-1 → HDMI-A-1 transfer of the non-Column ChatGPT window passed: `3844,24 1252x1392`, output `HDMI-A-1`.
- Native HDMI-A-1 → DP-1 return passed: `1284,50 1252x1320`, output `DP-1`.
- The secondary Kitty/SSH window remained unchanged at `2584,24 2512x1392` throughout.

## V2 regression

- Safe-area and all Quick Tile geometry unit tests passed.
- ChatGPT entered true fullscreen at `0,0 2560x1440` and exited back to the right Safe-Area Quick Tile at `1284,50 1252x1320`.
- No polling or continuous `frameGeometryChanged` correction was added.
- No sustained KWin scripting errors were observed.
