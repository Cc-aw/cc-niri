const PREFIX = "[cc-niri-dock-probe] ";

function rectText(rect) {
    return `${rect.x},${rect.y} ${rect.width}x${rect.height}`;
}

function inspectDocks() {
    workspace.windowList().filter(window => window.dock).forEach((window, index) => {
        console.info(PREFIX + `dock[${index}] geometry=${rectText(window.frameGeometry)}` +
            ` opacity=${window.opacity}` +
            ` hidden=${window.hidden}` +
            ` minimized=${window.minimized}` +
            ` active=${window.active}`);
    });
}

registerShortcut("CCNiriPOCInspectDocks", "CC Niri POC Inspect Docks", "", inspectDocks);
inspectDocks();
