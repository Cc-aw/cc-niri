"use strict";

class DockGateway {
    constructor(options) {
        this.invoke = options.invoke;
        this.service = options.service;
        this.path = options.path;
        this.interfaceName = options.interfaceName;
        this.snapshotProvider = options.snapshotProvider;
        this.handlers = options.handlers;
        this.generationAgnosticTypes = new Set(
            options.generationAgnosticTypes || []
        );
        this.debug = options.debug;
        this.warn = options.warn;
        this.protocol = options.protocol || 1;
        this.sessionIdValue = options.sessionId ||
            `${options.now().toString(16)}-` +
            `${Math.floor(options.random() * 0x100000000).toString(16)}`;
        this.generationValue = 0;
    }

    sessionId() {
        return this.sessionIdValue;
    }

    generation() {
        return this.generationValue;
    }

    envelopeSnapshot(snapshot) {
        return Object.assign({}, snapshot, {
            protocol: this.protocol,
            sessionId: this.sessionIdValue,
            generation: this.generationValue,
        });
    }

    publish(snapshot, reason) {
        const envelope = this.envelopeSnapshot(snapshot);
        this.invoke(
            this.service,
            this.path,
            this.interfaceName,
            "PublishState",
            JSON.stringify(envelope),
            accepted => this.debug(`[cc-dock] PUBLISH reason=${reason}` +
                ` generation=${this.generationValue}` +
                ` columns=${envelope.columns.length} accepted=${accepted}`)
        );
        return envelope;
    }

    commit(snapshot, reason) {
        this.generationValue += 1;
        return this.publish(snapshot, reason);
    }

    publishMotionPlan(plan, callback) {
        const envelope = Object.assign({}, plan, {
            protocol: this.protocol,
            sessionId: this.sessionIdValue,
        });
        this.invoke(this.service, this.path, this.interfaceName,
            "PublishMotionPlan", JSON.stringify(envelope), callback);
        return envelope;
    }

    reportMotionParked(completion, callback) {
        const envelope = Object.assign({}, completion, {
            protocol: this.protocol,
            sessionId: this.sessionIdValue,
        });
        this.invoke(this.service, this.path, this.interfaceName,
            "ReportMotionParked", JSON.stringify(envelope), callback);
        return envelope;
    }

    reject(command, reason) {
        this.warn(`[cc-dock] REJECT reason=${reason}`);
        return this.publish(this.snapshotProvider(), `reject-${reason}`);
    }

    commandEnvelope(command) {
        const baseGeneration = command.baseGeneration === undefined
            ? this.generationValue
            : command.baseGeneration;
        return Object.assign({}, command, {
            protocol: this.protocol,
            sessionId: this.sessionIdValue,
            baseGeneration,
        });
    }

    requestDeferred(command, delayMs, callback) {
        const envelope = this.commandEnvelope(command);
        this.invoke(
            this.service,
            this.path,
            this.interfaceName,
            "RequestDeferredCommand",
            JSON.stringify(envelope),
            delayMs,
            callback
        );
        return envelope;
    }

    validEnvelope(command) {
        return Boolean(command && command.protocol === this.protocol &&
            command.commandId && Object.prototype.hasOwnProperty.call(
                this.handlers,
                command.type
            ));
    }

    dispatch(command) {
        if (!this.validEnvelope(command)) {
            this.reject(command, "invalid-schema");
            return false;
        }
        if (String(command.sessionId) !== this.sessionIdValue) {
            this.reject(command, "session-mismatch");
            return false;
        }
        if (Number(command.baseGeneration) !== this.generationValue &&
                !this.generationAgnosticTypes.has(command.type)) {
            this.reject(command, "stale-generation");
            return false;
        }
        return this.handlers[command.type](command) !== false;
    }

    acceptPendingJson(json) {
        if (!json) return false;
        let command;
        try {
            command = JSON.parse(String(json));
        } catch (error) {
            this.reject(null, "invalid-json");
            return false;
        }
        return this.dispatch(command);
    }

    takePendingCommand() {
        this.invoke(
            this.service,
            this.path,
            this.interfaceName,
            "TakePendingCommand",
            json => this.acceptPendingJson(json)
        );
    }
}

/* cjs:start */
module.exports = { DockGateway };
/* cjs:end */
