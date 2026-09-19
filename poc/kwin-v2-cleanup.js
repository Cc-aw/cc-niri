const TAG = "[cc-niri-v2-cleanup]";

const chatgpt = workspace.windowList().find(window =>
    window.normalWindow && window.caption === "ChatGPT"
);

function rectText(rect) {
    return `${rect.x},${rect.y} ${rect.width}x${rect.height}`;
}

if (chatgpt) {
    workspace.activeWindow = chatgpt;
    // A maximize -> restore round-trip is the public KWin operation that
    // reliably detaches a window from its native quick-tile object.
    chatgpt.setMaximize(true, true);
    chatgpt.setMaximize(false, false);
    chatgpt.frameGeometry = { x: 380, y: 170, width: 1800, height: 1100 };
    console.info(`${TAG} geometry=${rectText(chatgpt.frameGeometry)}` +
        ` tile=${chatgpt.tile ? rectText(chatgpt.tile.relativeGeometry) : "none"}`);
}
