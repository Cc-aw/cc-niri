# CC Niri Maximize

CC Niri Maximize V3 is being implemented in phases on top of the working V2 safe-area script. Version `3.0.0-alpha.32` adds shared Motion tokens and retargetable Column scrolling while retaining compact stepwise Dock navigation, Phase 9.5 Presentation modes, and Phase 8.5 bidirectional Dock order synchronization.

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
- Windows already present when the script loads are adopted from one synchronous startup snapshot. Later windows use an explicit adoption state machine: inactive windows wait for their first activation, secondary-output windows wait until they enter the primary output, and Fullscreen/Quick Tile/maximized windows wait until they return to Normal. An eligible active window is inserted to the right of the focused column exactly once. Dialogs and secondary-output windows remain native/floating while ineligible.
- Inactive session-restored windows already present in the startup snapshot are adopted without stealing focus. A late restored window remains native until its first activation. A Column window moved away from the primary output is removed immediately from the primary model while remaining native on its destination output, and waits for an active return before rejoining.
- New-window adoption remains pending until KWin confirms the requested visible Column geometry, with activation, ready-for-painting, and geometry-change retries for slow-mapping applications such as Electron windows.
- Closing a managed window removes its Column, preserves an unrelated focused window, or focuses the right neighbor of a closed focused Column (falling back to the left neighbor), and minimally reveals the successor.
- Activating a managed column (including clicking it or selecting it through Alt+Tab) synchronizes the focused column and minimally reveals it.
- Left-clicking a hidden managed task in `CC Scroll Tasks` traverses each adjacent viewport before activating the target: for example, `1|2 → 2|3 → 3|4 → 4|5`. Its compact 140 ms cadence overlaps successive movements into a short continuous scroll without losing direction information. The target finishes at the right side of the safe-area viewport; the first Column still clamps to the left edge. Clicking an already visible task focuses it without moving the viewport. Keyboard focus and Alt+Tab retain minimal-reveal behavior.
- `Meta+Shift+H/L`, window insertion, and window removal publish the canonical `columns[]` order to the Dock by exact KWin `internalId` / TaskManager `WinIdList` UUID.
- Dragging a managed task in `CC Scroll Tasks` sends a generation-checked reorder request back to KWin. KWin validates the complete UUID set, reorders the existing Column objects, preserves focus, performs minimal reveal, and republishes the committed state.
- Pinned launchers are kept in a separate launcher section, while managed windows use `SortManual` and `GroupDisabled`.
- Stale, mismatched-session, incomplete, or duplicate reorder requests are rejected and followed by an authoritative resync.
- No polling. The event-driven companion bridge is only an IPC relay; KWin remains the geometry and logical-order authority. A small KWin effect animates scrolling-column position changes without changing geometry or output ownership.
- Column motion uses the shared `220 ms` spatial token and an `OutCubic` deceleration curve. Repeated or reversed `Meta+H/L` input samples the current visual translation, compensates for the newly committed real geometry, and retargets from that painted position instead of snapping and restarting. Each window has an independent Motion epoch, and completion clears all temporary Translation, Scale, and Opacity state.
- The Dock task context menu adds a compact `CC Scroll` section with Normal, Focus Wide, and Maximize in Safe Area. Wide is exactly 72% of the safe area and centered; Wide and Maximize park all neighboring managed windows without changing logical or Dock order.
- KDE's native maximize button and the Dock's Maximize in Safe Area action enter the same presentation state; restore returns to the exact two-column layout.
- Focus Wide is a persistent per-Column property for the current KWin session. `Meta+H/L` treats a return to Wide as two discrete navigation steps rather than one timed transition: from `1|2`, the first `Meta+L` stops indefinitely at `2|3`; the second `Meta+L` expands focused column 3 to 72%. The reverse direction behaves symmetrically with `Meta+H`. During expansion, the neighbor remains visible until the target accepts its real geometry and finishes the paint animation. Dock activation retains its automatic guarded transition. Pressing `Meta+Z` on Wide restores 50% pairing. Presentation never permanently changes the normal scroll offset.
- `Meta+Shift+Enter` toggles the active primary-screen window between the managed Column model and Floating. Starting an interactive move or resize on a managed Column also detaches it automatically without rewriting that window's geometry; toggling it back inserts it to the right of the currently focused Column.
- Custom Focus Ring rendering has been removed. The Dock now uses TaskManager's native per-window `IsActive`: inactive running-window icons are 90% opaque, while the active icon gets a subtle translucent green background and a centered 3 px green indicator. KWin's global Dim Inactive effect remains disabled because KWin 6.7.5 cannot exclude the secondary output.

Later V3 work intentionally not included here includes tabbed/multi-window Columns, Overview integration, session persistence, and secondary-screen bidirectional ordering.

## Tested environment

- Fedora 44, Plasma and KWin 6.7.5, Wayland
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

No root privileges are used. The installer builds and installs the current user's KWin script, direction-correction effect, D-Bus bridge service, and `CC Scroll Tasks` Plasma applet. It disables both the obsolete custom Focus Ring and the global Dim Inactive effect, reloads KWin components, and restarts Plasma Shell so the compiled applet is loaded.

The third-party `Geometry Change` KWin effect also animates every script-driven
parking jump and is incompatible with the Column transition effect. Installation
temporarily disables it (without uninstalling it); uninstall restores it when it
was enabled before CC Niri Maximize was installed.

Open System Settings → Window Management → KWin Scripts to configure both output names, each monitor's outer and inner gaps, dialog handling, and debug logging.

## Shortcut

Current V3 alpha shortcuts:

- `Meta+H`: focus the previous managed column.
- `Meta+L`: focus the next managed column.
- `Meta+Z`: toggle Focus Wide for the active managed column.
- `Meta+Shift+H`: move the current column one position left.
- `Meta+Shift+L`: move the current column one position right.
- `Meta+Shift+Enter`: toggle the active window between managed Column and Floating.

The former custom maximize binding is removed during installation. Focus Wide
has the single `Meta+Z` convenience toggle; Dock actions and the native window
maximize button remain the complete presentation controls.

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

Each window tracks its layout mode, original free-window geometry, the output associated with that restore geometry, its pre-fullscreen mode, pending native action, and an internal-change guard. KWin's native tile association is detected through `window.tile.relativeGeometry`, which is the API verified on KWin 6.7.5; this version does not expose usable `quickTileMode` or `geometryRestore` properties to JavaScript.

`safeRectFor(output)` selects the output profile and `rectForLayout(mode, safeRect, innerGap)` is the shared layout calculation. `frameGeometryChanged(oldGeometry)` captures pre-tile restore geometry and narrowly corrects the recognizable native-tile reset caused by Plasma edit-mode strut changes; arbitrary geometry changes are not forced.
