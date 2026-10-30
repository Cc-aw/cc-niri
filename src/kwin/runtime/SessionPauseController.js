"use strict";

// Session facts are observed by Native. This JS owner sequences layout pause /
// release / reconciliation; it never samples presentation or polls while idle.
class SessionPauseController {
    constructor(options) {
        Object.assign(this, options);
        this.phase = "checking";
        this.reason = "startup";
        this.sequence = 0;
        this.token = 0;
        this.timer = null;
        this.reading = false;
        this.queuedReason = null;
        this.native = null;
        this.paused = true;
        this.stopped = false;
        this.terminal = false;
        this.faultReason = null;
        this.sawLock = false;
        this.deadlineMs = options.deadlineMs || 500;
        this.resume = null;
        this.resumeTimer = null;
        this.resumeAttempts = 0;
        this.resumeDeadlineMs = options.resumeDeadlineMs || 4000;
    }

    report(state, reason) {
        this.phase = state; this.reason = String(reason).slice(0, 256);
        this.publish();
    }
    publish() { this.health({ state: this.phase, reason: this.reason, sequence: ++this.sequence }); }
    clear() { if (this.timer) this.clearTimer(this.timer); this.timer = null; }
    retireResume() {
        this.resume = null;
        if (this.resumeTimer) this.clearTimer(this.resumeTimer);
        this.resumeTimer = null;
    }
    current(resume) { return !this.stopped && !this.terminal && this.resume === resume; }
    pause() {
        if (this.paused) return;
        this.paused = true;
        this.onPause();
    }
    block(reason) {
        ++this.token; this.reading = false; this.queuedReason = null;
        this.retireResume();
        this.clear(); this.pause(); this.report("blocked", reason);
        this.warn(`[cc-session] blocked reason=${reason}`);
    }
    query(token, done) {
        this.clear();
        let live = true;
        const finish = raw => {
            if (!live || token !== this.token || this.stopped) return;
            live = false; this.reading = false; this.clear();
            if (this.queuedReason !== null) {
                const reason = this.queuedReason; this.queuedReason = null;
                this.refresh(reason); return;
            }
            let facts;
            try { facts = typeof raw === "string" ? JSON.parse(raw) : raw; } catch (_error) { facts = null; }
            if (!facts || facts.protocol !== 1 || facts.type !== "session-state" ||
                    typeof facts.locked !== "boolean" || typeof facts.instanceId !== "string" ||
                    !facts.instanceId || facts.instanceId.length > 64 ||
                    !Number.isSafeInteger(facts.sequence) || facts.sequence < 0) {
                this.block(raw === null ? "session-query-deadline" : "invalid-session-state"); return;
            }
            if (this.native && facts.instanceId !== this.native.instanceId) {
                this.terminal = true; this.block("native-instance-replaced"); return;
            }
            if (this.native && facts.sequence < this.native.sequence) { this.block("session-sequence-regressed"); return; }
            // A coalesced unlock wake can be the first delivered event after
            // global shortcuts were disabled. A higher sequence proves a cycle.
            if (this.native && facts.sequence > this.native.sequence) {
                this.resumeAttempts = 0;
                this.sawLock = true;
            }
            if (facts.locked) this.sawLock = true;
            this.native = facts;
            done(facts);
        };
        this.reading = true;
        this.timer = this.setTimer(() => finish(null), this.deadlineMs);
        try { this.readState(finish); } catch (_error) { finish(null); }
    }
    refresh(reason = "session-event") {
        if (this.stopped || this.terminal) return false;
        if (this.reading) { this.queuedReason = reason; return true; }
        const token = ++this.token;
        this.query(token, facts => {
            if (facts.locked) {
                this.retireResume();
                this.pause(); this.report("locked", reason);
                this.release(() => {}, this.deadlineMs);
                return;
            }
            if (this.faultReason && !this.sawLock) {
                this.terminal = true;
                this.block(this.faultReason); this.onFault(this.faultReason, this.faultCancelled);
                return;
            }
            const resume = this.resume;
            if (resume) {
                if (facts.sequence !== resume.sequence) {
                    this.retireResume(); this.pause();
                } else {
                    if (resume.stage === "released") this.reconcile(resume);
                    else if (resume.stage === "verified-layout") {
                        this.retireResume(); this.resumeAttempts = 0;
                        this.sawLock = false; this.faultReason = null;
                        this.report("running", "session-ready");
                    }
                    return;
                }
            }
            if (this.phase === "running" && !this.sawLock) return;
            this.pause(); this.report("resuming", reason);
            this.attempt();
        });
        return true;
    }
    attempt() {
        if (this.resumeAttempts >= 3) { this.block("resume-attempts-exhausted"); return; }
        ++this.resumeAttempts;
        const resume = { sequence: this.native.sequence, stage: "release" };
        this.resume = resume;
        this.release(confirmed => {
            if (!this.current(resume) || resume.stage !== "release") return;
            if (!confirmed) {
                if (this.resumeAttempts >= 3) { this.block("release-unconfirmed"); return; }
                resume.stage = "retry";
                this.resumeTimer = this.setTimer(() => {
                    if (!this.current(resume)) return;
                    this.resumeTimer = null;
                    this.attempt();
                }, 0);
                return;
            }
            resume.stage = "released";
            this.refresh("release-confirmed");
        }, this.deadlineMs);
    }
    reconcile(resume) {
        resume.stage = "layout";
        this.paused = false;
        // The existing coordinator supplies the first current-epoch completion.
        // Keep lock provenance until that proof and a final fresh session read.
        const finish = confirmed => {
            if (!this.current(resume) || resume.stage !== "layout") return;
            if (this.resumeTimer) this.clearTimer(this.resumeTimer);
            this.resumeTimer = null;
            if (confirmed !== true) { this.fault("layout-resume-rejected", false); return; }
            resume.stage = "verified-layout";
            this.refresh("layout-confirmed");
        };
        this.resumeTimer = this.setTimer(() => {
            if (!this.current(resume)) return;
            this.resumeTimer = null;
            this.fault("layout-resume-deadline", false);
        }, this.resumeDeadlineMs);
        // Empty layouts may confirm synchronously. Finish only after all mount
        // work returns, so a subsequent rejection cannot publish a false ready.
        let invoking = true, completed = false, completion;
        const complete = confirmed => {
            if (!invoking) { finish(confirmed); return; }
            if (!completed) { completed = true; completion = confirmed; }
        };
        let accepted;
        try { accepted = this.onResume(complete); }
        catch (_error) { accepted = false; }
        invoking = false;
        if (accepted === false) finish(false);
        else if (completed) finish(completion);
    }
    fault(reason, cancelled) {
        if (this.stopped || this.terminal) return;
        this.faultReason = String(reason).slice(0, 256);
        this.faultCancelled = cancelled;
        this.retireResume();
        this.pause(); this.report("checking", this.faultReason);
        this.refresh("fault-session-check");
    }
    stop() {
        if (this.stopped) return;
        this.stopped = true; ++this.token; this.clear(); this.pause();
        this.retireResume();
        this.queuedReason = null;
        this.report("stopped", "runtime-stop");
    }
}

/* cjs:start */
module.exports = { SessionPauseController };
/* cjs:end */
