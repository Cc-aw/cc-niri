"use strict";

function loadRuntimeConfig(readValue) {
    const number = (key, fallback) =>
        Math.max(0, Number(readValue(key, fallback)) || 0);
    const requestedScrollGap = Number(readValue("ScrollLayoutGap", 16));
    const requestedTopGap = Number(readValue("ScrollLayoutTopGap", -1));
    return {
        targetOutputName: String(readValue("TargetOutputName", "")).trim(),
        dockIntegration: Boolean(readValue("EnableDockIntegration", false)),
        alwaysCenterSingleColumn: Boolean(readValue("AlwaysCenterSingleColumn", false)),
        scrollLayoutV2Enabled: Boolean(readValue("ScrollLayoutV2Enabled", false)),
        scrollLayoutTopGap: Number.isFinite(requestedTopGap)
            ? Math.min(1000, Math.max(-1, Math.floor(requestedTopGap))) : -1,
        scrollLayoutGap: Number.isFinite(requestedScrollGap)
            ? Math.min(1000, Math.max(0, Math.floor(requestedScrollGap))) : 16,
        dynamicTrailingWorkspace: Boolean(readValue("DynamicTrailingWorkspace", false)),
        autoRecycleWorkspaces: Boolean(readValue("AutoRecycleWorkspaces", false)),
        primary: {
            top: number("GapTop", 50),
            bottom: number("GapBottom", 8),
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
        debugLogging: Boolean(readValue("DebugLogging", false)),
    };
}

/* cjs:start */
module.exports = { loadRuntimeConfig };
/* cjs:end */
