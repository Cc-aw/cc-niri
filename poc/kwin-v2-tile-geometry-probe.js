const TAG = "[cc-niri-v2-tile-geometry-probe]";
const connected = new Map();

function rectText(rect) {
    return rect ? `${rect.x},${rect.y} ${rect.width}x${rect.height}` : "none";
}

function connectTile(window) {
    const tile = window.tile;
    if (!tile || connected.get(window) === tile) return;
    connected.set(window, tile);
    const log = signal => console.info(`${TAG} ${signal} caption=${window.caption}` +
        ` frame=${rectText(window.frameGeometry)}` +
        ` absolute=${rectText(tile.absoluteGeometryInScreen)}` +
        ` relative=${rectText(tile.relativeGeometry)}`);
    tile.windowGeometryChanged.connect(() => log("windowGeometryChanged"));
    tile.absoluteGeometryChanged.connect(() => log("absoluteGeometryChanged"));
    tile.relativeGeometryChanged.connect(() => log("relativeGeometryChanged"));
    console.info(`${TAG} connected caption=${window.caption}`);
}

workspace.windowList().forEach(window => {
    connectTile(window);
    window.tileChanged.connect(() => connectTile(window));
});
console.info(`${TAG} loaded`);
