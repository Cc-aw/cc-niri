# CC Niri Maximize

CC Niri Maximize V3 is being implemented in phases on top of the working V2 safe-area script. Version `3.0.0-alpha.18` adds bidirectional order synchronization between the primary-screen logical Column model and the `CC Scroll Tasks` Dock applet; V2 maximize, Quick Tile, fullscreen, and per-output safe areas remain present.

## Current V3 phase

Implemented in this alpha:

- One normal window per managed column on the primary output.
- Derived logical positions and a single `relayout()` geometry writer.
- Gap-aware half-width columns: two `1252 px` columns plus the existing `8 px` inner gap exactly fill the `2512 px` primary safe area.
- `Meta+H` / `Meta+L` focus previous/next without wrapping.
- Logical projection transactions record old/new scroll offsets and per-column old/new projected rectangles. `Meta+L` enters from the right and moves the strip left; `Meta+H` enters from the left and moves the strip right.
- Minimal reveal scrolling: already visible columns do not move, and hidden columns scroll only far enough to become visible.
- Output-stable viewport projection: only columns fully contained by the primary safe area are displayed.
- Partial and off-screen columns are parked left of the complete virtual desktop, so internal scrolling cannot transfer ownership to the right-hand secondary output.
- Existing primary-output Quick Tile windows are detached from their native tile association during startup adoption and enter the same Column model, preventing fixed windows underneath the scrolling viewport.
- Once mapped and activated, newly opened eligible normal windows on the primary output are inserted to the right of the focused column, focused in the model, and minimally revealed. Dialogs and secondary-output windows remain native/floating.
- Inactive session-restored windows are adopted event-by-event at the end of the Column list without stealing focus. A Column window restored or moved away from the primary output is removed immediately from the primary model while remaining native on its destination output.
- New-window adoption remains pending until KWin confirms the requested visible Column geometry, with activation, ready-for-painting, and geometry-change retries for slow-mapping applications such as Electron windows.
- Closing a managed window removes its Column, preserves an unrelated focused window, or focuses the right neighbor of a closed focused Column (falling back to the left neighbor), and minimally reveals the successor.
- Activating a managed column (including clicking it or selecting it through Alt+Tab) synchronizes the focused column and minimally reveals it.
- `Meta+Shift+H/L`, window insertion, and window removal publish the canonical `columns[]` order to the Dock by exact KWin `internalId` / TaskManager `WinIdList` UUID.
- Dragging a managed task in `CC Scroll Tasks` sends a generation-checked reorder request back to KWin. KWin validates the complete UUID set, reorders the existing Column objects, preserves focus, performs minimal reveal, and republishes the committed state.
- Pinned launchers are kept in a separate launcher section, while managed windows use `SortManual` and `GroupDisabled`.
- Stale, mismatched-session, incomplete, or duplicate reorder requests are rejected and followed by an authoritative resync.
- No polling. The event-driven companion bridge is only an IPC relay; KWin remains the geometry and logical-order authority. A small KWin effect animates scrolling-column position changes without changing geometry or output ownership.

Later V3 work intentionally not included here includes tabbed/multi-window Columns, Overview integration, session persistence, and secondary-screen bidirectional ordering.

## Tested environment

- Fedora 44, Plasma and KWin 6.7.4, Wayland
- Target `DP-1`: logical `2560x1440`, scale 1.5
- Secondary `HDMI-A-1`: logical `2560x1440`, scale 1.0

All values are logical pixels. Output scale is never multiplied into a gap.

## Behavior

- An empty target output name selects the leftmost enabled output.
- Maximize on either configured monitor becomes safe-area pseudo maximize.
- Left, Right, Top, Bottom, and all four corner Quick Tile modes are recalculated inside the same safe area.
- Adjacent tiles use one configurable inner gap; it is not added around every edge.
- Fullscreen remains true physical fullscreen. Leaving fullscreen restores the preceding safe-area layout.
- The primary and secondary outputs have independent outer and inner gaps.
- Moving a maximized or Quick-Tiled window between configured outputs recalculates it with the destination profile.
- Outputs not configured as primary or secondary retain native KWin behavior.
- Restore geometry is preserved across Maximize ↔ Quick Tile transitions and translated between output origins.
- Beginning an interactive move or resize exits custom layout state without jumping backward.
- Dock visibility does not affect layout geometry because calculations use `output.geometry`, never `MaximizeArea`.
- Entering and leaving Plasma desktop edit mode cannot leave tiled windows at KWin's temporary native geometry.
- The implementation is signal-driven; the user service is an event-driven D-Bus relay and has no polling loop.

## Defaults

Primary output:

- Top: 50 px
- Bottom: 70 px
- Left: 24 px
- Right: 24 px
- Inner tile gap: 8 px
- Target output: empty, meaning leftmost

Secondary output:

- Enabled on `HDMI-A-1`
- Top / Bottom / Left / Right: 24 px
- Inner tile gap: 8 px
- Dialogs: excluded
- Debug logging: disabled

On the tested `2560x1440` target this produces:

- Maximize: `24,50 2512x1320`
- Left: `24,50 1252x1320`
- Right: `1284,50 1252x1320`
- Top / Bottom height: `656`, separated by 8 px
- Corner tiles: `1252x656`

On the `2560x1440` secondary this produces maximize `2584,24 2512x1392`, with Left and Right tiles measuring `1252x1392` and separated by 8 px.

## Install

```bash
./install.sh
```

No root privileges are used. The installer builds and installs the current user's KWin script, direction-correction effect, D-Bus bridge service, and `CC Scroll Tasks` Plasma applet. It enables the service, reloads KWin components, and restarts Plasma Shell so the compiled applet is loaded.

The third-party `Geometry Change` KWin effect also animates every script-driven
parking jump and is incompatible with the Column transition effect. Installation
temporarily disables it (without uninstalling it); uninstall restores it when it
was enabled before CC Niri Maximize was installed.

Open System Settings → Window Management → KWin Scripts to configure both output names, each monitor's outer and inner gaps, dialog handling, and debug logging.

## Shortcut

`Meta+Ctrl+M` toggles safe-area maximize for the active eligible window on either configured output. KDE's standard maximize and Quick Tile shortcuts continue to work.

Current V3 alpha shortcuts:

- `Meta+H`: focus the previous managed column.
- `Meta+L`: focus the next managed column.
- `Meta+Shift+H`: move the current column one position left.
- `Meta+Shift+L`: move the current column one position right.

## Maximize button limitation

Safe-area maximized windows are internally unmaximized so KWin does not force them back to its native maximize area. Some decorations therefore continue to display a maximize icon. Clicking it again still restores the saved free-window geometry.

## Debugging

Enable debug logging in the script configuration, then follow KWin logs:

```bash
journalctl --user -b -f | grep cc-niri-maximize
```

## Uninstall

```bash
./uninstall.sh
```

The uninstaller disables the bridge and removes only `cc-niri-maximize` and its companion transition effect. It does not rewrite Plasma panels, remove the installed `CC Scroll Tasks` applet, touch shortcuts belonging to other scripts, or modify other KWin packages.

## Design

Each window tracks its layout mode, original free-window geometry, the output associated with that restore geometry, its pre-fullscreen mode, pending native action, and an internal-change guard. KWin's native tile association is detected through `window.tile.relativeGeometry`, which is the API verified on KWin 6.7.4; this version does not expose usable `quickTileMode` or `geometryRestore` properties to JavaScript.

`safeRectFor(output)` selects the output profile and `rectForLayout(mode, safeRect, innerGap)` is the shared layout calculation. `frameGeometryChanged(oldGeometry)` captures pre-tile restore geometry and narrowly corrects the recognizable native-tile reset caused by Plasma edit-mode strut changes; arbitrary geometry changes are not forced.
