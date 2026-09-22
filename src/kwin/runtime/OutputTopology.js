"use strict";

class OutputTopology {
    constructor(options) {
        this.getScreens = options.getScreens;
        this.config = options.config;
        this.computeSafeRect = options.computeSafeRect;
        this.warn = options.warn;
        this.warnedMissingPrimary = false;
        this.warnedMissingSecondary = false;
    }

    ordered() {
        return this.getScreens().slice().sort((a, b) =>
            a.geometry.x === b.geometry.x
                ? a.geometry.y - b.geometry.y
                : a.geometry.x - b.geometry.x
        );
    }

    primary() {
        const outputs = this.ordered();
        if (!outputs.length) return null;
        if (this.config.targetOutputName) {
            const configured = outputs.find(output =>
                output.name === this.config.targetOutputName);
            if (configured) {
                this.warnedMissingPrimary = false;
                return configured;
            }
            if (!this.warnedMissingPrimary) {
                this.warn(`configured output ${this.config.targetOutputName}` +
                    " not found; using leftmost output");
                this.warnedMissingPrimary = true;
            }
        }
        return outputs[0];
    }

    secondary() {
        if (!this.config.manageSecondaryOutput) return null;
        const primary = this.primary();
        const candidates = this.ordered().filter(output => output !== primary);
        if (!candidates.length) return null;
        if (this.config.secondaryOutputName) {
            const configured = candidates.find(output =>
                output.name === this.config.secondaryOutputName);
            if (configured) {
                this.warnedMissingSecondary = false;
                return configured;
            }
            if (!this.warnedMissingSecondary) {
                this.warn(`configured secondary output ${this.config.secondaryOutputName}` +
                    " not found; using rightmost non-primary output");
                this.warnedMissingSecondary = true;
            }
        }
        return candidates[candidates.length - 1];
    }

    profile(output) {
        if (!output) return null;
        const primary = this.primary();
        if (output === primary) {
            const gaps = this.config.primary;
            return {
                role: "primary", output,
                top: gaps.top, bottom: gaps.bottom,
                left: gaps.left, right: gaps.right, inner: gaps.inner,
            };
        }
        const secondary = this.secondary();
        if (output === secondary) {
            const gaps = this.config.secondary;
            return {
                role: "secondary", output,
                top: gaps.top, bottom: gaps.bottom,
                left: gaps.left, right: gaps.right, inner: gaps.inner,
            };
        }
        return null;
    }

    managed() {
        const outputs = [this.primary(), this.secondary()].filter(Boolean);
        return outputs.filter((output, index) => outputs.indexOf(output) === index);
    }

    safeRect(output) {
        const profile = this.profile(output);
        return profile ? this.computeSafeRect(output.geometry, profile) : null;
    }
}

/* cjs:start */
module.exports = { OutputTopology };
/* cjs:end */
