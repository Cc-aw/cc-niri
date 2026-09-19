/* Phase 8.5 read-only UUID identity and event wakeup probe. */
const TAG = "[cc-scroll-phase85-poc]";

function normalizeUuid(value) {
    return String(value || "").toLowerCase().replace(/^\{/, "").replace(/\}$/, "");
}

workspace.windowList().filter(window => window.normalWindow).forEach(window => {
    console.info(`${TAG} WINDOW uuid=${normalizeUuid(window.internalId)}` +
        ` caption=${window.caption}` +
        ` class=${window.resourceClass}` +
        ` output=${window.output ? window.output.name : "<none>"}`);
});

registerShortcut(
    "CCScrollDockCommandPumpPOC",
    "CC Scroll: Dock Command Pump POC",
    "",
    () => console.info(`${TAG} WAKEUP callback-fired`)
);

console.info(`${TAG} READY`);
