"use strict";

/* cjs:start */
const { columnGeometrySameRect } = require("./ColumnGeometryPlan");
/* cjs:end */

// Event-driven configure/paint barrier, called only AFTER Native Arm ACK.
// No animation clock, interpolation, activation or parking authority here.
class ColumnGeometryClientGate {
    constructor(options) { Object.assign(this, options); }

    begin(envelope, commit, done) {
        const disposers = [], clients = [];
        let live = true, committing = true, painted = false;
        const dispose = () => {
            if (!live) return;
            live = false;
            disposers.splice(0).reverse().forEach(fn => { try { fn(); } catch (_error) { /* continue releasing */ } });
            clients.length = 0;
        };
        const finish = accepted => { if (live) { dispose(); done(accepted === true); } };
        const retain = unsubscribe => {
            if (typeof unsubscribe !== "function") throw new Error("missing geometry subscription disposer");
            if (live) disposers.push(unsubscribe); else unsubscribe();
        };
        const check = () => {
            if (!live || committing) return;
            try {
                if (!this.isCurrent(envelope)) { finish(false); return; }
                for (const client of clients) {
                    if (!this.eligible(client.window, envelope)) { finish(false); return; }
                    if (!columnGeometrySameRect(this.readFrame(client.window), client.target)) { painted = false; return; }
                }
                if (painted) finish(true);
            } catch (_error) { finish(false); }
        };
        try {
            if (!envelope || envelope.type !== "COLUMN_GEOMETRY" || envelope.protocol !== 4 ||
                    !Array.isArray(envelope.entries) || !envelope.entries.length || envelope.entries.length > 256 ||
                    !this.isCurrent(envelope)) throw new Error("invalid geometry request");
            const ids = new Set();
            // Resolve all clients and observe before writing any frame. This
            // catches synchronous ACK/close callbacks without a configure race.
            for (const entry of envelope.entries) {
                const window = this.resolve(entry.windowId);
                if (ids.has(entry.windowId) || !window || !this.eligible(window, envelope) ||
                        !columnGeometrySameRect(entry.committedTargetRect, entry.committedTargetRect) ||
                        !columnGeometrySameRect(this.readFrame(window), entry.oldFrameRect)) throw new Error("client source changed");
                ids.add(entry.windowId);
                clients.push({ window, source: entry.oldFrameRect, target: entry.committedTargetRect });
                retain(this.observeClient(window, () => check(), () => finish(false)));
                if (!live) break;
            }
            if (live) retain(this.observeCompletion(envelope, sample => {
                if (!live || !sample || sample.protocol !== 4 || sample.type !== "COLUMN_GEOMETRY_COMPLETION" ||
                        !["sessionId", "workspaceId", "targetOutput", "scopeRevision", "epoch"].every(k => sample[k] === envelope[k]) ||
                        sample.completed !== true || sample.painted !== true || !Number.isSafeInteger(sample.sampleSerial) ||
                        sample.sampleSerial <= envelope.sourceSampleSerial) return;
                painted = true;
                check();
            }));
            if (live) {
                // Revalidate after subscriptions: a reentrant close or scope
                // change during hookup must not write a newer transaction's frame.
                if (!this.isCurrent(envelope) || clients.some(c => !this.eligible(c.window, envelope) ||
                        !columnGeometrySameRect(this.readFrame(c.window), c.source))) {
                    finish(false);
                } else {
                    // The batch writer must check this before each client
                    // write: a configure callback can synchronously close a
                    // window or start a newer layout in the middle of a batch.
                    commit(() => live && this.isCurrent(envelope));
                    committing = false;
                    check();
                }
            }
        } catch (_error) { finish(false); }
        return dispose;
    }
}

/* cjs:start */
module.exports = { ColumnGeometryClientGate };
/* cjs:end */
