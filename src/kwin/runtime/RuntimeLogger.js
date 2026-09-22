"use strict";

class RuntimeLogger {
    constructor(options) {
        this.tag = options.tag;
        this.enabled = Boolean(options.enabled);
        this.infoSink = options.infoSink;
        this.warnSink = options.warnSink;
    }

    setEnabled(enabled) {
        this.enabled = Boolean(enabled);
    }

    resolve(value) {
        return typeof value === "function" ? value() : String(value);
    }

    classify(message, requestedCategory) {
        if (requestedCategory) return requestedCategory;
        if (/^\[cc-adoption\]/.test(message)) return "adoption";
        if (/^\[cc-dock\]/.test(message)) return "dock";
        if (/^\[cc-presentation\]/.test(message)) return "presentation";
        if (/^\[cc-stability\].*EMERGENCY_RESTORE/.test(message)) return "recovery";
        if (/^\[cc-stability\]/.test(message)) return "stability";
        if (/^\[cc-scroll\].*(FLOAT|MANAGE|REMEMBER_FLOAT)/.test(message)) {
            return "floating";
        }
        if (/^\[cc-scroll\]/.test(message)) return "layout";
        if (/^(FULLSCREEN|NATIVE-TRANSFER)/.test(message)) return "lifecycle";
        if (/^(INVARIANT|RECOVERY|TIMEOUT|SCHEMA REJECT|QUEUE FULL)/.test(message)) {
            return "stability";
        }
        return "runtime";
    }

    stripLegacyPrefix(message) {
        return message.replace(/^\[cc-[^\]]+\]\s*/u, "");
    }

    format(category, message) {
        return `${this.tag} [${category}] ${this.stripLegacyPrefix(message)}`;
    }

    debug(value, category = "") {
        if (!this.enabled) return false;
        const message = this.resolve(value);
        this.infoSink(this.format(this.classify(message, category), message));
        return true;
    }

    warn(value, category = "") {
        const message = this.resolve(value);
        this.warnSink(this.format(this.classify(message, category), message));
        return true;
    }
}

/* cjs:start */
module.exports = { RuntimeLogger };
/* cjs:end */
