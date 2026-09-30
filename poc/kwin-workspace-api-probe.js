/* W0 read-only KWin Virtual Desktop probe. Load directly; never package.
 * TargetOutputName uses this probe's own KWin config group. With no override,
 * select the leftmost/topmost output, matching cc-niri OutputTopology.
 * See poc/WORKSPACE_API_PROBE.md for loading and manual acceptance.
 */
"use strict";

(function () {
    const TAG = "[cc-niri-workspace-api]";
    const configuredTarget = typeof readConfig === "function"
        ? String(readConfig("TargetOutputName", "")).trim() : "";
    const observedWindows = new Set();
    let sequence = 0;

    function log(event, data) {
        console.info(TAG + " " + JSON.stringify(Object.assign({
            sequence: ++sequence, time: Date.now(), event,
        }, data)));
    }

    function desktopData(desktop, index) {
        if (!desktop) return null;
        return {
            id: String(desktop.id), name: String(desktop.name),
            order: index === undefined ? workspace.desktops.indexOf(desktop) : index,
            x11DesktopNumber: desktop.x11DesktopNumber,
        };
    }

    function outputName(output) {
        return output ? String(output.name) : null;
    }

    function targetOutput() {
        const outputs = workspace.screens.slice().sort((a, b) =>
            a.geometry.x - b.geometry.x || a.geometry.y - b.geometry.y);
        return outputs.find(output => output.name === configuredTarget) || outputs[0] || null;
    }

    function inspectCurrent(reason) {
        const target = targetOutput();
        const perOutput = typeof workspace.currentDesktopForScreen === "function";
        log("target", {
            reason, configuredTarget, output: outputName(target),
            configuredTargetMissing: Boolean(configuredTarget &&
                (!target || target.name !== configuredTarget)),
        });
        if (!workspace.screens.length) {
            log("current", { reason, output: null, desktop: desktopData(workspace.currentDesktop),
                source: "currentDesktop (global fallback)" });
        }
        workspace.screens.forEach(output => {
            try {
                log("current", {
                    reason, output: outputName(output), isTargetOutput: output === target,
                    source: perOutput ? "currentDesktopForScreen" : "currentDesktop (global fallback)",
                    desktop: desktopData(perOutput
                        ? workspace.currentDesktopForScreen(output) : workspace.currentDesktop),
                });
            } catch (error) {
                log("read-error", { api: "currentDesktopForScreen", output: outputName(output), error: String(error) });
            }
        });
    }

    function inspectDesktops(reason) {
        log("desktops", { reason, desktops: workspace.desktops.map((desktop, index) => desktopData(desktop, index)) });
    }

    function inspectWindow(event, window) {
        log(event, {
            uuid: String(window.internalId), caption: String(window.caption),
            output: outputName(window.output),
            desktops: window.desktops.map(desktop => desktopData(desktop)),
            onAllDesktops: window.onAllDesktops,
        });
    }

    function connect(object, name, callback, scope) {
        const signal = object[name];
        if (!signal || typeof signal.connect !== "function") {
            log("missing-signal", { signal: scope + "." + name });
            return;
        }
        signal.connect(callback);
    }

    function observeWindow(window) {
        if (!window || observedWindows.has(window)) return;
        observedWindows.add(window);
        inspectWindow("window", window);
        connect(window, "desktopsChanged", function () {
            inspectWindow("window.desktopsChanged", window);
        }, "window");
    }

    log("loaded", { currentDesktopForScreen: typeof workspace.currentDesktopForScreen,
        configuredTarget });
    connect(workspace, "currentDesktopChanged", function (previous, current, output) {
        log("currentDesktopChanged", {
            argumentCount: arguments.length,
            previous: desktopData(previous), current: desktopData(current),
            output: outputName(output),
            isTargetOutput: output ? output === targetOutput() : null,
        });
        inspectCurrent("currentDesktopChanged");
    }, "workspace");
    connect(workspace, "desktopsChanged", function () {
        inspectDesktops("desktopsChanged");
        inspectCurrent("desktopsChanged");
    }, "workspace");
    connect(workspace, "screensChanged", function () {
        inspectCurrent("screensChanged");
    }, "workspace");
    connect(workspace, "windowAdded", observeWindow, "workspace");
    connect(workspace, "windowRemoved", function (window) {
        observedWindows.delete(window);
    }, "workspace");
    inspectDesktops("startup");
    inspectCurrent("startup");
    workspace.windowList().forEach(observeWindow);
}());
