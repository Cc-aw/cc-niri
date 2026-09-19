const TAG = "[cc-niri-v2-probe]";

function rectText(rect) {
    if (!rect) return "<none>";
    return `${rect.x},${rect.y} ${rect.width}x${rect.height}`;
}

function valueText(value) {
    if (value === undefined) return "<undefined>";
    if (value === null) return "<null>";
    return String(value);
}

function inspect(window, event) {
    if (!window) {
        console.info(`${TAG} ${event} window=<none>`);
        return;
    }
    const tile = window.tile;
    console.info(`${TAG} ${event}` +
        ` caption=${window.caption}` +
        ` output=${window.output ? window.output.name : "<none>"}` +
        ` geometry=${rectText(window.frameGeometry)}` +
        ` maximizeMode=${valueText(window.maximizeMode)}` +
        ` quickTileMode=${valueText(window.quickTileMode)}` +
        ` requestedQuickTileMode=${valueText(window.requestedQuickTileMode)}` +
        ` geometryRestore=${rectText(window.geometryRestore)}` +
        ` maximizeGeometryRestore=${rectText(window.maximizeGeometryRestore)}` +
        ` fullScreen=${window.fullScreen}` +
        ` tile=${tile ? "present" : "none"}` +
        (tile ? ` tileAbs=${rectText(tile.absoluteGeometryInScreen)}` +
            ` tileRelative=${rectText(tile.relativeGeometry)}` +
            ` tilePosition=${valueText(tile.positionInLayout)}` : ""));
}

function setup(window) {
    if (!window || !window.normalWindow) return;
    window.quickTileModeChanged.connect(() => inspect(window, "quickTileModeChanged"));
    window.tileChanged.connect(() => inspect(window, "tileChanged"));
    window.frameGeometryChanged.connect(oldGeometry => {
        console.info(`${TAG} frameGeometryChanged old=${rectText(oldGeometry)}`);
        inspect(window, "frameGeometryChanged-state");
    });
    window.outputChanged.connect(() => inspect(window, "outputChanged"));
    window.maximizedAboutToChange.connect(mode => {
        console.info(`${TAG} maximizedAboutToChange requested=${mode}`);
        inspect(window, "maximizedAboutToChange-state");
    });
    window.maximizedChanged.connect(() => inspect(window, "maximizedChanged"));
}

workspace.windowList().forEach(setup);
workspace.windowAdded.connect(setup);
registerShortcut("CCNiriV2ProbeInspect", "CC Niri V2 Probe Inspect", "", () => {
    inspect(workspace.activeWindow, "manual");
});

function withChatGPT(callback) {
    const window = workspace.windowList().find(candidate =>
        candidate.normalWindow && candidate.caption === "ChatGPT"
    );
    if (!window) return;
    workspace.activeWindow = window;
    callback();
}

registerShortcut("CCNiriV2ProbeLeft", "CC Niri V2 Probe Left", "", () => withChatGPT(() => workspace.slotWindowQuickTileLeft()));
registerShortcut("CCNiriV2ProbeRight", "CC Niri V2 Probe Right", "", () => withChatGPT(() => workspace.slotWindowQuickTileRight()));
registerShortcut("CCNiriV2ProbeTop", "CC Niri V2 Probe Top", "", () => withChatGPT(() => workspace.slotWindowQuickTileTop()));
registerShortcut("CCNiriV2ProbeBottom", "CC Niri V2 Probe Bottom", "", () => withChatGPT(() => workspace.slotWindowQuickTileBottom()));
registerShortcut("CCNiriV2ProbeTopLeft", "CC Niri V2 Probe Top Left", "", () => withChatGPT(() => workspace.slotWindowQuickTileTopLeft()));
registerShortcut("CCNiriV2ProbeTopRight", "CC Niri V2 Probe Top Right", "", () => withChatGPT(() => workspace.slotWindowQuickTileTopRight()));
registerShortcut("CCNiriV2ProbeBottomLeft", "CC Niri V2 Probe Bottom Left", "", () => withChatGPT(() => workspace.slotWindowQuickTileBottomLeft()));
registerShortcut("CCNiriV2ProbeBottomRight", "CC Niri V2 Probe Bottom Right", "", () => withChatGPT(() => workspace.slotWindowQuickTileBottomRight()));
console.info(`${TAG} loaded`);
