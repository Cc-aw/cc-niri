"use strict";
// Protocol integration fixture only. These facts simulate the future Native
// source capability; they are not evidence of KWin configure or GPU painting.
const assert = require("node:assert/strict");
const { createV2Runtime } = require("./scroll-layout-v2-runtime");
const { createColumnGeometryPlan } = require("../../src/kwin/layout/ColumnGeometryPlan");
const r = createV2Runtime();
r.controller.sessionId = "single-center";
r.getPrimary().name = "eDP-1";
r.transaction.epoch = 6;
const ids = process.argv.slice(2);
assert.equal(ids.length, 2);
r.mount(ids.map((id, i) => ({ window: r.window(id), widthMode: i ? "half" : "twoThirds" })),
    {}, r.geometry(2560, 16, 50));
const before = r.controller.lastTarget, sample = r.paint();
const observation = { protocol: 4, type: "COLUMN_GEOMETRY_SOURCE", sessionId: before.sessionId,
    workspaceId: before.workspaceId, targetOutput: before.targetOutput, scopeRevision: before.scopeRevision,
    epoch: sample.epoch, sampleSerial: 10, cameraX: sample.cameraX, maxCamera: before.maxCamera,
    viewport: before.geometry.outputRect, layoutRect: { x: 0, y: 66, width: 2560, height: 1358 },
    entries: before.entries.map(e => ({ windowId: e.uuid, columnId: e.columnId, logicalX: e.logicalX,
        visualRect: e.visualRect, frameRect: { ...e.visualRect, x: Math.max(0, Math.min(2560 - e.pixelWidth, e.visualRect.x)) },
        owned: true, painted: true, acknowledged: true })) };
sample.sampleSerial = 10;
r.controller.setWidth(r.state.columns[0], "full");
const plan = createColumnGeometryPlan(r.controller.lastTarget, { observation, issuedAt: 1005,
    capability: { protocol: 4, type: "COLUMN_GEOMETRY", enabled: true,
        inputPolicy: "two-click", sourcePolicy: "painted-client-frames" } });
assert.ok(plan);
process.stdout.write(JSON.stringify(plan));
