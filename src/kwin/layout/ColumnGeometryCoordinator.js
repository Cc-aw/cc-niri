"use strict";

/* cjs:start */
const { createColumnGeometryPlan, columnGeometrySameRect } = require("./ColumnGeometryPlan");
const { createPartialScrollPlan, partialScrollSafeTargets } = require("./PartialScrollPlan");
const { ColumnGeometryClientGate } = require("./ColumnGeometryClientGate");
const { ScrollPlanCommitGate } = require("./ScrollPlanCommitGate");
/* cjs:end */

// Event-driven P4 composition. Layout/epochs remain in the existing controller;
// this owner only sequences its targets through the existing ACK/cancel gate.
// No presentation sampling, animation timer, frame polling or second model.
class ColumnGeometryCoordinator {
    constructor(options) {
        Object.assign(this, options);
        this.serial = 0;
        this.intent = null;
        this.geometry = null;
        this.observed = null;
        this.bootstrap = null;
        this.sourceWait = null;
        this.listener = null;
        this.stopped = false;
        this.quarantined = false;
        this.recovering = false;
        const publishState = options.prepare;
        this.preparedEpoch = null;
        this.releaseEpoch = null;
        this.prepare = (intent, done) => {
            if (this.preparedEpoch === intent.epoch) { done(true); return; }
            publishState(intent, accepted => {
                if (!this.isCurrent(intent)) return;
                if (accepted === true) this.preparedEpoch = intent.epoch;
                done(accepted === true);
            });
        };
        this.capability = null;
        this.partialCapability = null;
        this.clear = handle => { if (handle) this.clearTimer(handle); };
        this.clients = new ColumnGeometryClientGate({
            resolve: id => { const c = this.columnFor(id); return c && c.window; },
            eligible: (w, e) => this.isCurrent(e) && this.eligible(w, e),
            readFrame: w => w.frameGeometry,
            isCurrent: e => this.isCurrent(e),
            observeClient: (w, change, close) => this.watch(w, change, close),
            observeCompletion: (e, callback) => this.observeCompletion(e, callback),
        });
        this.gate = new ScrollPlanCommitGate({
            currentEpoch: () => this.currentEpoch(),
            prepare: (context, done) => this.prepare(context.intent, done),
            publish: (e, done) => this.bridge.publishMotionPlan(e, done),
            arm: (e, done) => this.bridge.armScrollPlan(e, done),
            disarm: (epoch, done) => this.bridge.disarmColumnGeometry(epoch, done),
            columnGeometry: this.clients,
            commitColumnGeometry: (plan, _context, guard) => this.writeGeometry(plan, guard),
            activateColumnGeometry: (w, plan) => { if (this.isCurrent(plan)) this.activate(w, plan); },
            completeColumnGeometry: plan => this.settle(plan),
            onColumnGeometryFailure: (plan, _context, proof) => this.failed(plan, proof),
            setTimer: this.setTimer, clearTimer: this.clear,
            warn: this.warn, timeoutMs: this.ackTimeoutMs || 150,
            geometryTimeoutMs: this.deadlineMs || 3500,
        });
        this.wakeHandler = command => this.completionWake(command);
        this.bridge.handlers["scroll-frame-ready"] = this.wakeHandler;
        this.bridge.generationAgnosticTypes.add("scroll-frame-ready");
    }
    parse(raw) { try { return typeof raw === "string" ? JSON.parse(raw) : raw; } catch (_error) { return null; } }
    isCurrent(plan) {
        return Boolean(!this.stopped && !this.quarantined && this.intent && plan &&
            plan.epoch === this.currentEpoch() && plan.epoch === this.intent.epoch &&
            ["sessionId", "workspaceId", "targetOutput", "scopeRevision"].every(k => plan[k] === this.intent[k]) &&
            this.isScope(this.intent));
    }
    watch(window, change, close) {
        if (this.observeClient) return this.observeClient(window, change, close);
        window.frameGeometryChanged.connect(change); window.closed.connect(close);
        let live = true;
        return () => { if (!live) return; live = false;
            try { window.frameGeometryChanged.disconnect(change); } catch (_error) { /* destroyed */ }
            try { window.closed.disconnect(close); } catch (_error) { /* destroyed */ }
        };
    }
    cancelLease() {
        this.clear(this.flight); this.flight = null;
        if (this.bootstrap) this.bootstrap.dispose();
        this.bootstrap = null;
        if (this.sourceWait) this.clear(this.sourceWait.timer);
        this.sourceWait = null; this.listener = null;
    }
    submit(intent) {
        if (this.stopped || this.quarantined) return false;
        this.serial++; this.cancelLease(); this.gate.supersede(); this.intent = intent;
        if (!this.isCurrent(intent)) return false;
        if (!intent.entries.length) {
            this.prepare(intent, accepted => {
                if (!this.isCurrent(intent)) return;
                if (accepted !== true) {this.failed(intent,{cancelled:false,reason:"empty-membership"});return;}
                this.gate.abort(intent.epoch, cancelled => {
                    if (!this.isCurrent(intent)) return;
                    if (cancelled !== true) {this.failed(intent,{cancelled:false,reason:"empty-disarm"});return;}
                    this.geometry=null;this.observed=null;
                    if(this.onComplete)this.onComplete(intent,{empty:true});
                });
            });
            return true;
        }
        const token = this.serial;
        const guard = () => token === this.serial && this.isCurrent(intent);
        this.flight = this.setTimer(() => { if (guard()) this.cancelThenRecover(intent, "request-deadline"); }, this.deadlineMs || 3500);
        const ready = () => {
            if (!guard()) return;
            if (!this.capability || this.capability.protocol !== 4 || this.capability.type !== "COLUMN_GEOMETRY" ||
                    this.capability.enabled !== true || this.capability.inputPolicy !== "two-click" ||
                    this.capability.sourcePolicy !== "painted-client-frames" || !this.partialCapability ||
                    this.partialCapability.protocol !== 3 || this.partialCapability.enabled !== true) {
                this.failed(intent, { cancelled: false, reason: "missing-capability" }); return;
            }
            if (this.recovering || (this.geometry && !this.sameGeometry(this.geometry, intent.geometry))) {
                this.hydrate(intent, guard); return;
            }
            this.querySource(intent, guard);
        };
        const prepare = () => this.prepare(intent, accepted => {
            if (!guard()) return;
            if (accepted !== true) { this.cancelThenRecover(intent, "membership"); return; }
            ready();
        });
        if (this.capability && this.partialCapability) prepare();
        else this.bridge.columnGeometryCapability(raw => {
            if (!guard()) return; this.capability = this.parse(raw);
            this.bridge.partialScrollCapability(p => { if (guard()) { this.partialCapability = this.parse(p); prepare(); } });
        });
        return true;
    }
    sameGeometry(a, b) {
        return Boolean(a && b && a.gap === b.gap && a.physicalScale === b.physicalScale &&
            ["outputRect", "workingArea"].every(r => columnGeometrySameRect(a[r], b[r])));
    }
    entries(plan) { return plan.entries.map(e => ({ windowId: e.uuid, columnId: e.columnId })); }
    remember(source, geometry) {
        this.observed = Object.assign({}, source, { entries: source.entries.filter(e => e.owned === true)
            .map(e => ({ uuid: e.windowId, visualRect: e.visualRect })) });
        this.geometry = geometry;
    }
    getPainted() { return this.observed; }
    querySource(intent, guard) {
        this.bridge.columnGeometrySource(this.entries(intent), raw => {
            if (!guard()) return;
            const source = this.parse(raw);
            if (source && source.valid === true && ["sessionId", "workspaceId", "targetOutput", "scopeRevision"].every(k => source[k] === intent[k])) {
                const oldGeometry = this.geometry || intent.geometry;
                const rebased = Object.assign({}, intent, { continuity: "observed", source: {
                    epoch: source.epoch, sampleSerial: source.sampleSerial, cameraX: source.cameraX, geometry: oldGeometry,
                    entries: source.entries.filter(e => e.owned === true).map(e => ({ uuid: e.windowId, visualRect: e.visualRect })) } });
                const envelope = createColumnGeometryPlan(rebased, { observation: source, capability: this.capability, issuedAt: this.now() });
                if (envelope) {
                    this.clear(this.flight); this.flight = null;
                    if (this.sourceWait) this.clear(this.sourceWait.timer); this.sourceWait = null;
                    this.remember(source, oldGeometry);
                    const focus = this.columnFor(intent.focusedUuid);
                    this.gate.schedule(Object.assign({}, intent, { envelope }), envelope,
                        { intent, activationWindow: focus && focus.window });
                    return;
                }
            }
            // A configure ACK can precede that client's first actual draw.
            // Native arranges one source-ready wakeup after the next real pass.
            if (this.geometry && this.sameGeometry(this.geometry, intent.geometry)) {
                if (!this.sourceWait) {
                    this.clear(this.flight); this.flight = null;
                    const waiting = { intent, guard, timer: null }; this.sourceWait = waiting;
                    waiting.timer = this.setTimer(() => {
                        if (this.sourceWait !== waiting || !guard()) return;
                        this.sourceWait = null;
                        this.cancelThenRecover(intent, "source-deadline");
                    }, this.deadlineMs || 3500);
                }
            } else this.hydrate(intent, guard);
        });
    }
    observeCompletion(envelope, callback) {
        const listener = { envelope, callback }; this.listener = listener;
        this.readCompletion(listener);
        return () => { if (this.listener === listener) this.listener = null; };
    }
    readCompletion(listener) {
        this.bridge.columnGeometryCompletion(raw => {
            if (this.listener !== listener || !this.isCurrent(listener.envelope)) return;
            const proof = this.parse(raw);
            if (proof && proof.completed === true && proof.painted === true) {
                this.lastCompletion = proof; listener.callback(proof);
            }
        });
    }
    completionWake(command) {
        if (!command || !this.intent || !["sessionId", "workspaceId", "targetOutput", "scopeRevision"].every(k => command[k] === this.intent[k])) return false;
        if (this.sourceWait) { const w = this.sourceWait; this.querySource(w.intent, w.guard); return true; }
        if (this.bootstrap && this.bootstrap.phase === "paint") { this.bootstrap.readSource(); return true; }
        if (this.listener) { this.readCompletion(this.listener); return true; }
        return false;
    }
    writeGeometry(plan, guard) {
        for (const entry of plan.envelope.entries) {
            if (!guard() || !this.isCurrent(plan)) return;
            const column = this.columnFor(entry.windowId);
            if (!column || !this.eligible(column.window, plan)) throw new Error("geometry client left scope");
            if (this.prepareClient) this.prepareClient(column.window);
            this.committer.commitGeometry(column, entry.committedTargetRect, plan.reason, guard);
            // Ownership already covers exact source and target frames, including
            // hidden incoming/transit. No legacy fade/scale or pending park here.
            if (guard()) this.setVisibility(column.window, true);
        }
    }
    settle(plan) {
        if (!this.isCurrent(plan)) return;
        for (const entry of plan.envelope.entries) {
            if (!this.isCurrent(plan)) return;
            const column = this.columnFor(entry.windowId);
            if (column && entry.newPlacement === "parked") this.setVisibility(column.window, false);
        }
        this.geometry = plan.geometry; this.recovering = false;
        this.bridge.columnGeometrySource(this.entries(plan), raw => {
            if (!this.isCurrent(plan)) return;
            const source=this.parse(raw);
            if(source && source.valid===true && source.epoch===plan.epoch) this.remember(source,plan.geometry);
            if (this.onComplete) this.onComplete(plan, this.lastCompletion);
        });
    }
    hydrate(intent, guard) {
        // Unknown/different basis is a static bootstrap, after confirmed disarm.
        // Reveal fully fitting clients as their individual configure ACKs arrive.
        this.clear(this.flight); this.flight = null;
        const initial = Object.assign({}, intent, { continuity: "initial", source: null });
        const envelope = createPartialScrollPlan(initial, { capability: this.partialCapability, issuedAt: this.now() });
        if (!envelope) { this.failed(intent, { cancelled: false, reason: "invalid-bootstrap" }); return; }
        envelope.geometryBootstrap = true;
        const targets = partialScrollSafeTargets(envelope), disposers = [];
        // Partial clients use clamped real anchors. Showing those before Native
        // owns the projection would expose the wrong region of the window.
        const revealTargets = targets.filter(target => {
            const entry = intent.entries.find(row => row.uuid === target.windowId);
            return entry && columnGeometrySameRect(entry.visualRect, target.rect);
        });
        const lease = { intent, phase: "cancel", timer: null, live: true, committing: false };
        lease.dispose = () => {
            if (!lease.live) return; lease.live = false; this.clear(lease.timer);
            disposers.splice(0).reverse().forEach(fn => { try { fn(); } catch (_error) { /* release all */ } });
        };
        const fail = reason => {
            if (!lease.live || !guard()) return; lease.dispose(); this.bootstrap = null;
            this.cancelThenRecover(intent, reason);
        };
        this.bootstrap = lease;
        lease.timer = this.setTimer(() => fail("bootstrap-deadline"), this.deadlineMs || 3500);
        lease.readSource = () => this.bridge.columnGeometrySource(this.entries(intent), raw => {
            if (!lease.live || !guard()) return;
            const source = this.parse(raw);
            if (!source || source.valid !== true || source.epoch !== intent.epoch ||
                    !["sessionId", "workspaceId", "targetOutput", "scopeRevision"].every(k => source[k] === intent[k])) return;
            this.remember(source, intent.geometry);
            lease.dispose(); this.bootstrap = null; this.recovering = false; this.gate.activeEpoch = intent.epoch;
            const focus = this.columnFor(intent.focusedUuid);
            if (focus) this.activate(focus.window, intent);
            if (guard() && this.onComplete) this.onComplete(intent, { bootstrap: true, sampleSerial: source.sampleSerial });
        });
        const check = () => {
            if (!lease.live || !guard() || lease.committing || lease.phase !== "configure") return;
            lease.committing = true;
            try {
                for (const target of revealTargets) {
                    if (!lease.live || !guard()) return;
                    const column = this.columnFor(target.windowId);
                    if (target.revealed || !column || !this.eligible(column.window, intent) ||
                            !columnGeometrySameRect(column.window.frameGeometry, target.rect)) continue;
                    // Unminimize can emit synchronous signals. Mark first and
                    // keep the lease guarded through that callback boundary.
                    target.revealed = true;
                    this.setVisibility(column.window, true);
                }
            } catch (_error) { fail("bootstrap-reveal"); return; }
            finally { lease.committing = false; }
            if (!lease.live || !guard()) return;
            if (!targets.every(t => { const c = this.columnFor(t.windowId); return c && this.eligible(c.window, intent) && columnGeometrySameRect(c.window.frameGeometry, t.rect); })) return;
            lease.phase = "publish";
            this.bridge.publishMotionPlan(envelope, accepted => {
                if (!lease.live || !guard()) return;
                if (accepted !== true) { fail("bootstrap-publish"); return; }
                this.bridge.armScrollPlan(envelope, armed => {
                    if (!lease.live || !guard()) return;
                    if (armed !== true) { fail("bootstrap-arm"); return; }
                    lease.phase = "paint";
                    targets.forEach(t => { const c = this.columnFor(t.windowId); if (c && guard()) this.setVisibility(c.window, true); });
                    lease.readSource();
                });
            });
        };
        this.bridge.scrollMotionStatus(raw => {
            if (!lease.live || !guard()) return;
            const status = this.parse(raw);
            if (!status || status.sessionId !== intent.sessionId || !Number.isSafeInteger(status.epoch) || status.epoch >= intent.epoch) { fail("bootstrap-scope"); return; }
            this.bridge.disarmColumnGeometry(Math.max(0, status.epoch), confirmed => {
                if (!lease.live || !guard()) return;
                if (confirmed !== true) { fail("bootstrap-disarm"); return; }
                this.prepare(intent, accepted => {
                    if (!lease.live || !guard()) return;
                    if (accepted !== true) { fail("bootstrap-membership"); return; }
                    lease.phase = "configure"; lease.committing = true;
                    try {
                        targets.forEach(t => { const c = this.columnFor(t.windowId); if (!c || !this.eligible(c.window, intent)) throw new Error("bootstrap client missing");
                            disposers.push(this.watch(c.window, check, () => fail("bootstrap-close"))); });
                        for (const entry of intent.entries) {
                            if (!guard() || !lease.live) return;
                            const c = this.columnFor(entry.uuid); if (!c) continue;
                            if (entry.uuid !== intent.focusedUuid) this.setVisibility(c.window, false);
                        }
                        targets.forEach(t => {
                            if (!guard() || !lease.live) return;
                            const c = this.columnFor(t.windowId);
                            if (this.prepareClient) this.prepareClient(c.window);
                            this.committer.commitGeometry(c, t.rect, intent.reason, () => guard() && lease.live);
                        });
                        lease.committing = false; check();
                    } catch (_error) { fail("bootstrap-write"); }
                });
            });
        });
    }
    cancelThenRecover(intent, reason) {
        this.gate.abort(intent.epoch, cancelled => { if (this.isCurrent(intent)) this.failed(intent, { cancelled, reason }); });
    }
    failed(intent, proof) {
        if (!this.isCurrent(intent)) return;
        this.cancelLease(); this.gate.supersede();
        if (proof.cancelled === true && !this.recovering && this.reissue) {
            this.recovering = true;
            if (this.reissue(intent) !== false) return;
        }
        // Global restoration is JS authority. It may only write after a proven
        // disarm; an unknown ownership result quarantines further geometry.
        this.quarantined = true;
        this.recover(intent, proof);
    }
    releaseForWorkspace() {
        if (this.intent) this.releaseEpoch = Math.max(this.releaseEpoch ?? 0, this.intent.epoch);
        this.serial++; this.cancelLease(); this.gate.releaseForWorkspace();
        this.geometry = null; this.observed = null; this.intent = null;
    }
    pause() {
        // Retire callbacks before waiting; no static host write until Native has
        // confirmed both motion and retained handoff ownership are gone.
        const epoch = this.intent && this.intent.epoch;
        if (epoch !== null && epoch !== undefined) this.releaseEpoch = Math.max(this.releaseEpoch ?? 0, epoch);
        this.serial++; this.cancelLease(); this.gate.supersede();
        this.intent = null; this.geometry = null; this.observed = null;
        this.lastCompletion = null; this.preparedEpoch = null;
    }
    suspend(done = () => {}, timeoutMs = this.gate.timeoutMs) {
        this.pause();
        if (this.releaseEpoch === null) { done(true); return; }
        this.gate.activeEpoch = null;
        const releasing = this.releaseEpoch;
        this.gate.abort(releasing, confirmed => {
            if (confirmed === true && this.releaseEpoch === releasing) this.releaseEpoch = null;
            done(confirmed === true);
        }, timeoutMs);
    }
    stop(done = () => {}) {
        const epoch = this.intent && this.intent.epoch;
        if (epoch !== null && epoch !== undefined) this.releaseEpoch = Math.max(this.releaseEpoch ?? 0, epoch);
        this.serial++; this.cancelLease(); this.gate.supersede(); this.stopped = true;
        if (this.bridge.handlers["scroll-frame-ready"] === this.wakeHandler) {
            delete this.bridge.handlers["scroll-frame-ready"];
            this.bridge.generationAgnosticTypes.delete("scroll-frame-ready");
        }
        this.intent = null; this.geometry = null; this.observed = null;
        this.lastCompletion = null; this.preparedEpoch = null;
        if (this.releaseEpoch === null) { done(true); return; }
        this.gate.activeEpoch=null;
        const releasing = this.releaseEpoch;
        this.gate.abort(releasing, confirmed => {
            if (confirmed === true && this.releaseEpoch === releasing) this.releaseEpoch = null;
            done(confirmed === true);
        });
    }
}

/* cjs:start */
module.exports = { ColumnGeometryCoordinator };
/* cjs:end */
