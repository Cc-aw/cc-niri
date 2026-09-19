# Phase 8.5 integration results

Validated on 2026-09-19 in the target Plasma Wayland session.

## POCs

- KWin `internalId` maps exactly to TaskManager `WinIdList` after lowercase/brace normalization.
- `SortManual` and `GroupDisabled` expose one task per window.
- Two independent TasksModel instances do not share manual ordering; this justified the native `CC Scroll Tasks` fork instead of externally controlling the stock Icons-only Task Manager.
- The no-key `CCScrollApplyDockCommand` KGlobalAccel action is listed by KWin and can be invoked over D-Bus.

## One-way synchronization

- KWin publishes protocol/session/generation/focused UUID/ordered Column UUIDs through the bridge.
- `Meta+Shift+H` advanced generation 5 → 6 and the Dock applied the new order.
- `Meta+Shift+L` restored the order at generation 7.
- Plasma Shell restart restored generation 5 from the bridge without polling.

## Bidirectional synchronization

- A valid Dock-order request swapped two non-focused Columns at generation 7 → 8.
- Focused UUID remained unchanged.
- Restoring the order committed generation 8 → 9.
- A stale request based on generation 1 was rejected: order and generation 2 remained unchanged and the authority state was republished.
- Bridge restart recovered the current KWin state automatically.

## Launcher isolation regression

An initial run exposed `TasksModel.move failed` when a running pinned application occupied its launcher slot. `launchInPlace` is now disabled so pinned launchers and managed Column windows are separate sections. After rebuilding and restarting Plasma Shell, both synchronization directions completed without further move failures.

## Automated tests

- `dock-sync-schema.test.js`
- `geometry-v2.test.js`
- `scroll-layout-v3.test.js`
- `scroll-transition-v3.test.js`

All passed. The installed KWin package version is `3.0.0-alpha.18`.

## Secondary-output flash regression

The obsolete `cc-niri-v3-scroll-transition-poc` effect was still enabled in
parallel with the production effect, so both effects animated every H/L
geometry transaction. The installer now disables, unloads, and removes that
POC during migration.

The production effect also avoids drawing logical right-edge transition frames
on a physically adjacent output: Meta+L incoming windows fade into the primary
right slot, and Meta+H outgoing windows remain in that slot while fading out.
Runtime logs confirmed `INCOMING_RIGHT_FADE` for `delta=1260` and
`OUTGOING_RIGHT_FADE` for `delta=-1260`; the old POC emitted no events.

H/L now also commits `relayout()` before assigning `workspace.activeWindow`.
This prevents KWin from composing a parked target during the activation-to-
geometry gap. A runtime L/L/H/H trace showed every PROJECT and PARK operation
remaining owned by `DP-1`, with focus committed only after each transaction.

The user-installed `kwin4_effect_geometry_change` was also enabled. It
independently animated every parking geometry jump from the far-left physical
coordinate, overriding L's logical direction and creating the remaining
secondary-output flash. The installer now records its prior enabled state,
disables/unloads it while CC Niri Maximize is installed, and the uninstaller
restores it. It is not removed.

With Geometry Change absent from KWin's loaded effect list, runtime L/L/H/H
traces contain only the production effect. L logs `INCOMING_RIGHT_SAFE` and
uses a 20 px right-to-left reveal inside the primary screen's 24 px margin;
H logs `OUTGOING_RIGHT_SAFE` for the symmetric exit.

## Session-restore Column membership regression

Cold startup exposed two model-membership errors rather than a Dock sorting
error. A kitty window was adopted while initially on DP-1 and remained in
`columns[]` after session restore moved it to HDMI-A-1. Conversely, inactive
restored DP-1 windows such as WeChat and Vivado never entered `columns[]`
because pending adoption retried only for active windows.

Inactive windows now retry adoption on ready-for-painting and window-shown
events, append without stealing focus, and settle without requesting a visible
slot. Any existing Column that leaves the primary output is removed immediately
without activating a successor. After bridge and Plasma Shell restart, the
authoritative state contained exactly the five current DP-1 UUIDs, excluded the
secondary kitty UUID, and the Dock logged `applied generation=1 columns=5`.
