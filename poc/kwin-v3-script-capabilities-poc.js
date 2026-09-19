/* Temporary read-only probe for scripting globals relevant to transitions. */
const TAG = "[cc-niri-v3-capabilities-poc]";
console.info(`${TAG} animate=${typeof animate}` +
    ` setTimeout=${typeof setTimeout}` +
    ` callDBus=${typeof callDBus}` +
    ` effect=${typeof effect}` +
    ` sendClientToScreen=${typeof workspace.sendClientToScreen}`);
const sampleWindow = workspace.windowList().find(window => window.normalWindow);
if (sampleWindow) {
    console.info(`${TAG} window.setData=${typeof sampleWindow.setData}` +
        ` window.data=${typeof sampleWindow.data}` +
        ` window.setProperty=${typeof sampleWindow.setProperty}` +
        ` window.property=${typeof sampleWindow.property}` +
        ` window.internalId=${String(sampleWindow.internalId)}`);
}
