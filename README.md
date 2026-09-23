# CC Niri Maximize

CC Niri Maximize V3 is being implemented in phases on top of the working V2 safe-area script. Version `3.0.0-alpha.39` hardens Contextual Wide runtime transitions and continuous Wide/Pair motion. Alpha.38 introduced native-clipped full-delta ordinary scrolling.

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
- Ordinary scrolling uses the complete logical offset for continuing, incoming, and outgoing Columns, with Translation only (`Scale=1`, `Opacity=1`). No-op channels are discarded, repeated input shortens retarget duration according to remaining distance, and grouped continuing/incoming/outgoing windows share an explicit Motion Transaction. Close-refill motion keeps the subtle `0.985 → 1.0` Scale and `0.85 → 1.0` Opacity assist.
- Phase 4B adds the native `cc-niri-viewport-clip` KWin effect. The scripted motion effect publishes each active transaction's logical safe viewport through `EffectWindow` data role `1001`; the native effect converts it with KWin's `RenderViewport::mapToDeviceCoordinates()` and intersects the device paint region. Phase 5 advertises native availability through role `1002` and enables full-delta right-edge motion only after observing that marker on the affected window. If the native effect is absent or unloaded, right-edge motion automatically falls back to the existing 20 px in-slot reveal. The transaction marker is removed on completion or cancellation, and direct scanout is blocked only while marked motion windows exist.
- The Dock task context menu adds a compact `CC Scroll` section with Normal, Focus Wide, and Maximize in Safe Area. Wide is exactly 72% of the safe area and centered; Wide and Maximize park all neighboring managed windows without changing logical or Dock order.
- KDE's native maximize button and the Dock's Maximize in Safe Area action enter the same presentation state; restore returns to the exact two-column layout.
- Focus Wide is a persistent per-Column preference for the current KWin session, not permanent geometry. Pair always displays `1 (50%) | 2 (50%)`, even if column 1 prefers Wide. From `1|2` with focus on 2, `Meta+H` expands preferred column 1 to a centered 72% view with empty sides. An off-screen preferred column takes two key presses: from `2|3`, the first `Meta+H` reveals and focuses column 1 at 50%, stopping at `1|2`; the second `Meta+H` expands column 1 to 72%. `Meta+L` behaves symmetrically. The same rule applies between two preferred Wide columns: `3 (72%) → 3|4 → 4 (72%)` takes two `Meta+L` presses, even if the underlying scroll offset does not change. Opposite navigation or another focus/command cancels the pending expansion. Pointer, Dock, and Alt+Tab activation focus the column and keep Pair mode. Once column 2 is pointer-focused in Pair, the first directional key such as `Meta+L` centers preferred column 2 at 72%; the next `Meta+L` moves to column 3. The neighbor moves with the Wide animation and parks after completion. `Meta+Z` explicitly enters Wide from Pair or clears the preference and returns an active Wide column to Pair.
- `Meta+Shift+Enter` toggles the active primary-screen window between the managed Column model and Floating. Both the main keyboard Return key and keypad Enter are registered because Qt treats them as different keys. Starting an interactive move or resize on a managed Column also detaches it automatically without rewriting that window's geometry. Mouse-detached windows remain the shortcut's pending reattachment target until they return or close, even if another primary Column or the secondary output owns focus; reattachment inserts the window to the right of the currently focused Column.
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

No root privileges are used by the installer. It requires the matching KWin
development package (`kwin-devel` on Fedora), builds the native viewport clip
plugin into `~/.local/lib64/qt6/plugins`, and installs the current user's KWin
script, direction-correction effect, D-Bus bridge service, and `CC Scroll Tasks`
Plasma applet. It disables both the obsolete custom Focus Ring and the global
Dim Inactive effect, reloads KWin components, and restarts Plasma Shell so the
compiled applet is loaded.

KWin can retain an already loaded native effect library across an in-place
upgrade. Until the next Plasma login loads the new binary, capability role
`1002` remains absent and scrolling safely uses the 20 px right-edge fallback;
no full-delta motion is enabled on an unconfirmed clip implementation.

The third-party `Geometry Change` KWin effect also animates every script-driven
parking jump and is incompatible with the Column transition effect. Installation
temporarily disables it (without uninstalling it); uninstall restores it when it
was enabled before CC Niri Maximize was installed.

KWin 6.7 exposes per-window minimize/unminimize grab roles, which the Column
effect now holds only for CC-owned parking motion. The bundled Squash and Magic
Lamp effects in 6.7 do not honor those roles, so installation applies the
compatibility fallback of disabling the active minimize effect. Its previous
enabled state is recorded and restored by `uninstall.sh`. Consequently, native
user-triggered minimize animation is unavailable while this fallback is active;
the window operation itself remains unchanged.

Open System Settings → Window Management → KWin Scripts to configure both output names, each monitor's outer and inner gaps, dialog handling, and debug logging.

## Shortcut

Current V3 alpha shortcuts:

- `Meta+H`: focus the previous managed column.
- `Meta+L`: focus the next managed column.
- `Meta+Z`: toggle Focus Wide for the active managed column.
- `Meta+Shift+H`: move the current column one position left.
- `Meta+Shift+L`: move the current column one position right.
- `Meta+Shift+Enter`: toggle the active window between managed Column and Floating; main Return and keypad Enter are both supported.

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

The viewport-clipping proof of concept is deliberately disabled by default. To
validate KWin's fragment-coordinate mapping, enable its non-destructive red tint:

```bash
kwriteconfig6 --file kwinrc \
  --group Effect-cc-niri-maximize-scroll-transition \
  --key DebugViewportClipTint --type bool true
qdbus6 org.kde.KWin /KWin org.kde.KWin.reconfigure
```

During H/L motion, pixels that the shader considers outside the primary safe
viewport are tinted red; they are not discarded. Check all four edges with the
primary output at 150% and the adjacent output at 100%. Disable the key after
the test. This shader remains diagnostic and is not part of the production
clipping or capability decision.

The 2026-09-22 mixed-DPI validation did **not** pass that gate. KWin 6.7.5
successfully loaded and bound the shader, and the debug-only full-delta probe
painted across both outputs, but `gl_FragCoord` produced a visibly displaced
boundary inside the primary viewport. The effect therefore keeps the tint and
never enables fragment discard. Production full-delta motion instead uses the
native effect's RenderViewport-aware device-space clip; the safe-edge fallback
is selected only when that native capability is unavailable.

The Phase 4B native replacement can be observed with:

```bash
journalctl --user -b -f | grep VIEWPORT_CLIP_NATIVE
```

On the tested layout, the same logical safe rect `24,50 2512x1320` maps to
device rect `36,75 3768x1980` on the 150% primary render viewport. During the
secondary render pass it maps completely outside that output, so intersection
produces no secondary paint. This conversion comes from KWin's RenderViewport,
not from project-owned scale compensation.

## Development

State owners live under `src/kwin/model/`, and pure layout calculations live
under `src/kwin/layout/`. KWin still loads the single generated script at
`package/contents/code/main.js`.

Runtime configuration, output topology, categorized logging, signal/shortcut
lifecycle, controller ownership, and the top-level `CCNiri` façade live under
`src/kwin/runtime/`. The generated entry now finishes with explicit
`const app = new CCNiri(...)` and `app.start()` calls; `app.stop()` performs the
recovery hook before disconnecting script-owned workspace signals.

`LayoutEngine.computeLayoutPlan()` is side-effect free. Its `LayoutPlan` is
applied by `GeometryCommitter`, which owns managed Column geometry and delegates
opacity and parking minimization ownership to `ParkingManager`.

Layout transactions, invariant auditing, parking ownership, and emergency
recovery live under `src/kwin/stability/`. Signal handlers query the shared
transaction instead of maintaining independent depth or epoch flags.

Runtime window adoption is owned by `src/kwin/lifecycle/AdoptionController.js`.
KWin lifecycle signals enter through its event methods; layout settlement is
provided as a dependency, so adoption does not publish Dock or Presentation
state directly.

Managed-to-floating transitions, shortcut reattachment, drag detach, and the
short focus-redirection guard are owned by
`src/kwin/lifecycle/FloatingController.js`. The remembered drag target does not
expire before the user explicitly reattaches or closes it.

Cross-output ownership and fullscreen entry/exit recovery are owned by
`OutputController` and `FullscreenController`. `ContextualViewport` alone writes
Pair/Wide Focus viewport state and owns directional focus intent and pending
reveal confirmation. `PresentationController` owns Normal/Safe Maximize and
explicit Wide preference commands; it changes viewport through that owner.
`ContextualWideCoordinator` owns runtime Wide/Pair transition state, geometry
acknowledgements, motion completion, parking, and deferred activation.

The motion pipeline is `ContextualViewport → LayoutEngine → LayoutSnapshot →
Viewport Motion Plan → MotionPlanCommitGate → Bridge.PublishMotionPlan → Native
Viewport Effect → EffectWindow role 1003 → geometry commit → Scripted Effect →
role 1004 completion → Native Effect → Bridge → ContextualWideCoordinator →
final park`. `MotionPlanCommitGate` commits safe geometry after a 150 ms local
handoff timeout if the Bridge callback never arrives. A late ACK cannot commit
the same plan twice.

Dock session identity, generation checks, state envelopes, command schema
validation, dispatch, and all Bridge D-Bus traffic are owned by
`src/kwin/integration/DockGateway.js`. Navigation and reorder handlers remain
separate business dependencies of that gateway.

Stepwise Dock navigation, its pending token, adjacent viewport offsets,
deferred Bridge steps, and final geometry-before-activation ordering are owned
by `src/kwin/navigation/DockScrollController.js`.

Keyboard and Dock-driven Column reordering, complete UUID-set validation,
focus preservation, minimal reveal, and the resulting Dock commit are owned by
`src/kwin/navigation/ReorderController.js`.

Effect animation constants, curves, and motion kinds are owned by
`src/effect/MotionTokens.js`; pure interpolation, retargeting, and visual-state
sampling are owned by `src/effect/MotionSampler.js`. Animation lifecycle and
retargetable state are owned by `src/effect/MotionController.js`; geometry
classification is owned by `src/effect/MotionClassifier.js`. KWin still loads
the generated Effect script at `effect/contents/code/main.js`.

`ViewportClipController` owns the opt-in diagnostic shader and injects each
MotionTransaction's reconstructed safe viewport. The current shader only tints
out-of-viewport fragments. `MotionController` adds an explicit `Effect.Shader`
animation so KWin actually binds it. Mixed-DPI visual verification showed that
fragment coordinates are not global logical coordinates, so production discard
remains blocked. The shader is diagnostic only and does not authorize full-delta
motion.

The native effect lives in `native/viewport-clip/`. It clips role `1001` marked
windows in RenderViewport device space, advertises capability role `1002`,
receives motion metadata through role `1003`, relays completion from role `1004`,
clears parked markers, and requests repaints. The scripted effect requires the
capability marker before full-delta right-edge motion. Layout, focus, Column
order, viewport decisions, and Dock state remain in their respective owners.

Scroll batches are represented by `src/effect/MotionTransaction.js`, with a
stable id/epoch, motion type, delta, and grouped continuing, incoming, and
outgoing windows. A critically damped spring was evaluated after this state
became explicit, but remains deferred: OutCubic has deterministic KWin group
completion and already preserves position continuity with distance-aware
retargeting.

The Task Manager fork keeps CC-specific QML under
`plasmoid/com.cc.scrolltasks/qml/cc/`: Dock state validation, Bridge IPC,
logical order, Presentation commands, and active-task appearance are separate
components behind `DockController`. KDE-derived QML files contain only thin
controller calls and visual bindings.

After changing a source module, regenerate and verify both runtime bundles with:

```bash
node tools/build.js
node tools/build.js --check
node --test test/*.test.js
```

The Phase 13 regression gate combines generated-bundle validation, all
production-module tests, and whitespace checks:

```bash
node tools/check.js
```

On the configured Fedora development host, include the native Bridge and
Plasmoid builds with:

```bash
node tools/check.js --native
```

The same portable gate runs in `.github/workflows/regression.yml` for pushes
and pull requests. Native KDE builds remain part of the local gate because the
hosted runner does not provide the project’s Plasma/KF development stack.

The regression tests import the production modules directly. The
generated-package test fails when either committed runtime script is stale.

## Uninstall

```bash
./uninstall.sh
```

The uninstaller disables the bridge and removes only `cc-niri-maximize` and its companion transition effect. It does not rewrite Plasma panels, remove the installed `CC Scroll Tasks` applet, touch shortcuts belonging to other scripts, or modify other KWin packages.

## Design

Each window tracks its layout mode, original free-window geometry, the output associated with that restore geometry, its pre-fullscreen mode, pending native action, and an internal-change guard. KWin's native tile association is detected through `window.tile.relativeGeometry`, which is the API verified on KWin 6.7.5; this version does not expose usable `quickTileMode` or `geometryRestore` properties to JavaScript.

`safeRectFor(output)` selects the output profile and `rectForLayout(mode, safeRect, innerGap)` is the shared layout calculation. `frameGeometryChanged(oldGeometry)` captures pre-tile restore geometry and narrowly corrects the recognizable native-tile reset caused by Plasma edit-mode strut changes; arbitrary geometry changes are not forced.
