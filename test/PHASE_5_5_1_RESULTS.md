# V3 Phase 5.5.1 Fix Results

Version: `3.0.0-alpha.3`

## Startup Quick Tile adoption

The previously fixed primary-output windows were all adopted into the Column model:

- WeChat: `tile=none`, parked as a `1252x1320` column.
- Primary Kitty: `tile=none`, parked as a `1252x1320` column.
- ChatGPT: `tile=none`, visible as a `1252x1320` column.

No pre-existing Quick Tile window remained underneath the viewport.

## Gap-aware scrolling

For a `2512 px` safe area and `8 px` inner gap:

```text
half width = floor((2512 - 8) / 2) = 1252
step       = 1252 + 8 = 1260
```

Observed viewport pairs:

```text
Zen + ChatGPT
→ ChatGPT + Typora
→ Zen + ChatGPT
```

Every snapshot contained exactly two fully visible columns at:

```text
left:  24,50 1252x1320
right: 1284,50 1252x1320
```

All other columns were fully parked left of the virtual desktop. Five runtime snapshots passed and produced zero managed-window `outputChanged` events.
