const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const mainSource = fs.readFileSync(
    path.join(root, "package/contents/code/main.js"), "utf8");
const bridgeSource = fs.readFileSync(
    path.join(root, "bridge/src/ScrollDockBridge.cpp"), "utf8");
const nativeSource = fs.readFileSync(
    path.join(root, "native/viewport-clip/ViewportClipEffect.cpp"), "utf8");
const coordinatorSource = fs.readFileSync(
    path.join(root, "src/kwin/presentation/ContextualWideCoordinator.js"), "utf8");

assert.equal(mainSource.includes("class WideTransition"), false);
assert.equal(mainSource.includes("WIDE_REVEAL_PHASE_AWAITING_STEP"), false);
assert.equal(mainSource.includes("wideTransition.beginStepIfPending"), false);
assert.ok(mainSource.includes("contextualViewport.select(column"));
assert.ok(mainSource.includes("source: wideStepDirection ? FocusSource.DIRECTIONAL"));

const parkSource = coordinatorSource.slice(
    coordinatorSource.indexOf("prepareLayoutTransition(target)"),
    coordinatorSource.indexOf("requestExit(pending"));
assert.ok(parkSource.includes("RETAIN_PAIR_NEIGHBOR"));
assert.ok(parkSource.includes("sameRectNear(pending.target.window.frameGeometry"));
assert.ok(parkSource.includes("pending.geometryAcknowledged = true"));
assert.ok(parkSource.includes("this.parkGraceMs"));
assert.ok(parkSource.includes("this.pendingPark = null"));
assert.ok(parkSource.includes('this.relayout("contextual-wide-park"'));
assert.ok(parkSource.indexOf('this.relayout("contextual-wide-park"') <
    parkSource.indexOf("this.gateway.reportMotionParked({"),
"the repaint handoff is emitted only after neighbor parking commits");

const exitSource = coordinatorSource.slice(
    coordinatorSource.indexOf("requestExit(pending"));
assert.ok(exitSource.includes("sameRectNear(pending.target.window.frameGeometry"));
assert.ok(exitSource.includes('this.relayout("contextual-wide-exit-ack"'));
assert.ok(bridgeSource.includes('QStringLiteral("finalize-contextual-wide")'));
assert.ok(bridgeSource.includes('QStringLiteral("finalize-contextual-wide-exit")'));
assert.ok(bridgeSource.includes("bool ScrollDockBridge::PublishMotionPlan("));
assert.ok(bridgeSource.includes("Q_EMIT MotionPlanChanged("));
assert.ok(bridgeSource.includes("bool ScrollDockBridge::ReportMotionComplete("));
assert.ok(bridgeSource.includes("bool ScrollDockBridge::ReportMotionParked("));
assert.ok(bridgeSource.includes("Q_EMIT MotionParked("));
assert.ok(nativeSource.includes("window->setData(MotionPlanDataRole, marker)"));
assert.ok(nativeSource.includes("void CcNiriViewportClipEffect::onMotionParked("));
assert.ok(nativeSource.includes("effects->addRepaintFull()"));
assert.ok(mainSource.includes("dockGateway.publishMotionPlan(envelope"));
assert.ok(coordinatorSource.includes("if (command.motionCompleted) pending.motionCompleted = true"));
assert.ok(mainSource.indexOf("dockGateway.publishMotionPlan(envelope") <
    mainSource.indexOf("commitLayoutPlan(plan, wideExitColumn,"),
"the native Effect receives the plan before geometry changes");

console.log("PASS contextual Wide uses guarded geometry ACK and deferred parking");
