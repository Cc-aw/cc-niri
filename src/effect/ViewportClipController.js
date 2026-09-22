"use strict";

class ViewportClipController {
    constructor(options) {
        this.effect = options.effect;
        this.mapTextureTrait = options.mapTextureTrait;
        this.debug = options.debug;
        this.enabled = false;
        this.shaderId = 0;
        this.failed = false;
    }

    setEnabled(enabled) {
        this.enabled = Boolean(enabled);
        if (this.enabled) this.ensureShader();
    }

    ensureShader() {
        if (this.shaderId || this.failed) return this.shaderId;
        try {
            this.shaderId = Number(this.effect.addFragmentShader(
                this.mapTextureTrait,
                "viewport_clip.frag"
            )) || 0;
        } catch (error) {
            this.failed = true;
            this.debug(`[VIEWPORT_CLIP] shader-load-failed error=${String(error)}`);
            return 0;
        }
        if (!this.shaderId) {
            this.failed = true;
            this.debug("[VIEWPORT_CLIP] shader-load-failed id=0");
            return 0;
        }
        this.effect.setUniform(this.shaderId, "debugTint", 1.0);
        this.debug(`[VIEWPORT_CLIP] shader-loaded id=${this.shaderId}`);
        return this.shaderId;
    }

    shaderFor(viewport) {
        if (!this.enabled || !viewport) return 0;
        const shaderId = this.ensureShader();
        if (!shaderId) return 0;
        this.effect.setUniform(shaderId, "viewportRect", [
            Number(viewport.x),
            Number(viewport.y),
            Number(viewport.width),
            Number(viewport.height),
        ]);
        this.debug(`[VIEWPORT_CLIP] tint viewport=${viewport.x},${viewport.y}` +
            ` ${viewport.width}x${viewport.height}`);
        return shaderId;
    }
}

/* cjs:start */
module.exports = { ViewportClipController };
/* cjs:end */
