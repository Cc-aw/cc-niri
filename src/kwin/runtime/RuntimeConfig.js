"use strict";

function loadRuntimeConfig(readValue) {
    const number = (key, fallback) =>
        Math.max(0, Number(readValue(key, fallback)) || 0);
    return {
        targetOutputName: String(readValue("TargetOutputName", "")).trim(),
        primary: {
            top: number("GapTop", 50),
            bottom: number("GapBottom", 70),
            left: number("GapLeft", 24),
            right: number("GapRight", 24),
            inner: number("InnerGap", 8),
        },
        manageSecondaryOutput: Boolean(
            readValue("ManageSecondaryOutput", true)
        ),
        secondaryOutputName: String(
            readValue("SecondaryOutputName", "HDMI-A-1")
        ).trim(),
        secondary: {
            top: number("SecondaryGapTop", 24),
            bottom: number("SecondaryGapBottom", 24),
            left: number("SecondaryGapLeft", 24),
            right: number("SecondaryGapRight", 24),
            inner: number("SecondaryInnerGap", 8),
        },
        includeDialogs: Boolean(readValue("IncludeDialogs", false)),
        debugLogging: Boolean(readValue("DebugLogging", false)),
    };
}

/* cjs:start */
module.exports = { loadRuntimeConfig };
/* cjs:end */
