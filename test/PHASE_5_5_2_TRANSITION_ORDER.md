# V3 Phase 5.5.2 Direction-Correct Transitions

Version: `3.0.0-alpha.6`

Alpha.5 still inferred incoming direction from its physical left-side parking position. Alpha.6 creates a logical transaction from `oldScrollOffsetX` and `newScrollOffsetX`; every column records `oldProjectedRect` and `newProjectedRect` before any real geometry changes.

The continuing visible column is committed first, so its real old/new coordinates equal the transaction's old/new projections. The Effect arms `scrollDeltaX` from that projection pair, then uses the same delta for incoming and outgoing columns. Parking coordinates never determine direction. The script remains the sole geometry writer, and all parked windows retain their existing geometry and output ownership.

Verified transition vectors:

```text
Meta+L:
  incoming:   parked -> right slot, visual source = +1260 px
  continuing: right slot -> left slot, visual source = +1260 px
  outgoing:   left slot -> parking, visual target = -1260 px

Meta+H:
  incoming:   parked -> left slot, visual source = -1260 px
  continuing: left slot -> right slot, visual source = -1260 px
  outgoing:   right slot -> parking, visual target = +1260 px
```

The off-screen right-parking POC was rejected by KWin (`x=9216` remained at the existing left parking coordinate), so the effect is required to correct presentation without moving real windows onto the secondary output.

Runtime verification on seven columns:

- Positive transactions consistently logged `delta=1260`, `ARM +1260`, incoming `+1260 -> 0`, and outgoing projected `24 -> -1236`.
- Negative transactions consistently logged `delta=-1260`, `ARM -1260`, incoming `-1260 -> 0`, and outgoing projected `1284 -> 2544`.
- Mixed navigation produced no sign mismatch between Script transaction and Effect animation.
- A focus change from the left visible column to the already-visible right column logged only `FOCUS`; it emitted no transaction and armed no animation.
- All seven real windows passed the Phase 5.5 snapshot: two visible, five left-parked, every window owned by `DP-1`, and zero output changes.
