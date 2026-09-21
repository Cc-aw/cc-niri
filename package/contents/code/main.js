/* SPDX-License-Identifier: MIT
 * CC Niri Maximize V3 - V2 safe areas plus main-output scrollable columns.
 */

const TAG = "[cc-niri-maximize]";
const FULL_MAXIMIZE_MODE = 3;
const NORMAL_MODE = "normal";
const MAXIMIZE_MODE = "maximize";
const PRESENTATION_NORMAL = "normal";
const PRESENTATION_WIDE = "wide";
const PRESENTATION_MAXIMIZED = "maximized";
const WIDE_RATIO = 0.72;
const COLUMN_WIDTH_THIRD = "third";
const COLUMN_WIDTH_HALF = "half";
const COLUMN_WIDTH_TWO_THIRDS = "twoThirds";
const PARKING_MARGIN = 4096;
const FLOATING_FOCUS_GUARD_MS = 1200;
const FLOATING_REATTACH_GRACE_MS = 10000;
const WIDE_SCROLL_PHASE_MS = 220;
const WIDE_PAIR_HOLD_MS = 180;
const WIDE_EXPANSION_PHASE_MS = 240;
const WIDE_GEOMETRY_RETRY_MS = 50;
const WIDE_GEOMETRY_MAX_ATTEMPTS = 20;
const DOCK_SCROLL_STEP_MS = 140;
const WIDE_REVEAL_PHASE_SCROLLING = "scrolling-to-normal-pair";
const WIDE_REVEAL_PHASE_AWAITING_STEP = "awaiting-wide-step";
const WIDE_REVEAL_PHASE_SETTLED = "settled-normal-pair";
const WIDE_REVEAL_PHASE_EXPANDING = "expanding-wide";
const WIDE_REVEAL_PHASE_ANIMATING = "animating-wide";
const ADOPTION_UNTRACKED = "untracked";
const ADOPTION_WAITING_ACTIVATION = "waiting-activation";
const ADOPTION_WAITING_PRIMARY = "waiting-primary";
const ADOPTION_WAITING_ELIGIBLE = "waiting-eligible";
const ADOPTION_WAITING_NORMAL = "waiting-normal";
const ADOPTION_ADOPTING = "adopting";
const ADOPTION_SETTLING = "settling";
const ADOPTION_MANAGED = "managed";
const ADOPTION_FLOATING = "floating";
const ADOPTION_IGNORED = "ignored";
const DOCK_BRIDGE_SERVICE = "org.cc.ScrollDockBridge";
const DOCK_BRIDGE_PATH = "/ScrollDock";
const DOCK_BRIDGE_INTERFACE = "org.cc.ScrollDockBridge1";
const dockSessionId = `${Date.now().toString(16)}-` +
    `${Math.floor(Math.random() * 0x100000000).toString(16)}`;
let dockGeneration = 0;

const states = new Map();
const mainScreenState = {
    targetOutput: null,
    safeRect: null,
    columns: [],
    focusedColumnIndex: -1,
    scrollOffsetX: 0,
    innerGap: 8,
    enabled: true,
    nextColumnId: 1,
    presentation: {
        windowUuid: null,
        mode: PRESENTATION_NORMAL,
    },
};
let configuredOutputName = "";
let gapTop = 50;
let gapBottom = 70;
let gapLeft = 24;
let gapRight = 24;
let innerGap = 8;
let manageSecondaryOutput = true;
let secondaryOutputName = "HDMI-A-1";
let secondaryGapTop = 24;
let secondaryGapBottom = 24;
let secondaryGapLeft = 24;
let secondaryGapRight = 24;
let secondaryInnerGap = 8;
let includeDialogs = false;
let debugLogging = false;
let warnedMissingOutput = false;
let warnedMissingSecondaryOutput = false;
let connectedManagedOutputs = new Set();
let scrollLayoutInitialized = false;
let lastShortcutFloatingWindow = null;
let lastShortcutDetachedAt = 0;
let floatingFocusGuardUntil = 0;
let layoutTransactionDepth = 0;
let layoutEpoch = 0;
let activeLayoutReason = "";
let lastInvariantWarning = "";
let pendingWideTransition = null;
let nextWideTransitionToken = 1;
let pendingDockScroll = null;
let nextDockScrollToken = 1;

function debug(message) {
    if (debugLogging) console.info(`${TAG} ${message}`);
}

function warn(message) {
    console.warn(`${TAG} ${message}`);
}

function normalizeWindowUuid(value) {
    return String(value || "").toLowerCase().replace(/^\{/, "").replace(/\}$/, "");
}

function publishDockState(reason) {
    const focusedColumn = mainScreenState.columns[mainScreenState.focusedColumnIndex] || null;
    const snapshot = {
        protocol: 1,
        sessionId: dockSessionId,
        generation: dockGeneration,
        targetOutput: mainScreenState.targetOutput ? mainScreenState.targetOutput.name : "",
        focusedUuid: focusedColumn
            ? normalizeWindowUuid(focusedColumn.window.internalId)
            : "",
        presentation: {
            windowUuid: mainScreenState.presentation.windowUuid || null,
            mode: mainScreenState.presentation.mode,
        },
        columns: mainScreenState.columns.map(column => ({
            uuid: normalizeWindowUuid(column.window.internalId),
            widthMode: column.widthMode,
        })),
    };
    callDBus(
        DOCK_BRIDGE_SERVICE,
        DOCK_BRIDGE_PATH,
        DOCK_BRIDGE_INTERFACE,
        "PublishState",
        JSON.stringify(snapshot),
        accepted => debug(`[cc-dock] PUBLISH reason=${reason}` +
            ` generation=${dockGeneration} columns=${snapshot.columns.length}` +
            ` accepted=${accepted}`)
    );
}

function commitDockState(reason) {
    dockGeneration += 1;
    publishDockState(reason);
}

function rejectDockCommand(reason) {
    warn(`[cc-dock] REJECT reason=${reason}`);
    publishDockState(`reject-${reason}`);
}

function applyPendingDockCommand() {
    callDBus(
        DOCK_BRIDGE_SERVICE,
        DOCK_BRIDGE_PATH,
        DOCK_BRIDGE_INTERFACE,
        "TakePendingCommand",
        json => {
            if (!json) return;

            let command;
            try {
                command = JSON.parse(String(json));
            } catch (error) {
                rejectDockCommand("invalid-json");
                return;
            }

            if (command.protocol !== 1 || !command.commandId ||
                    (command.type !== "set-column-order" &&
                    command.type !== "set-presentation-mode" &&
                    command.type !== "focus-column-right" &&
                    command.type !== "advance-dock-scroll" &&
                    command.type !== "emergency-restore" &&
                    command.type !== "settle-wide-transition" &&
                    command.type !== "check-wide-transition" &&
                    command.type !== "finalize-wide-transition" &&
                    command.type !== "complete-wide-transition")) {
                rejectDockCommand("invalid-schema");
                return;
            }
            if (String(command.sessionId) !== dockSessionId) {
                rejectDockCommand("session-mismatch");
                return;
            }
            if (Number(command.baseGeneration) !== dockGeneration) {
                rejectDockCommand("stale-generation");
                return;
            }

            if (command.type === "emergency-restore") {
                emergencyRestoreAllWindows("bridge-unload");
                return;
            }

            if (command.type === "settle-wide-transition") {
                settlePendingWideTransition(command);
                return;
            }

            if (command.type === "complete-wide-transition") {
                completePendingWideTransition(command);
                return;
            }

            if (command.type === "finalize-wide-transition") {
                finalizePendingWideTransitionCommand(command);
                return;
            }

            if (command.type === "check-wide-transition") {
                checkPendingWideGeometry(command);
                return;
            }

            if (command.type === "advance-dock-scroll") {
                advancePendingDockScroll(command);
                return;
            }

            if (command.type === "set-presentation-mode") {
                const windowUuid = normalizeWindowUuid(command.windowUuid);
                const mode = String(command.mode || "");
                const column = mainScreenState.columns.find(item =>
                    normalizeWindowUuid(item.window.internalId) === windowUuid);
                if (!column || column.window.output !== mainScreenState.targetOutput ||
                        !isPresentationMode(mode)) {
                    rejectDockCommand("invalid-presentation-target");
                    return;
                }
                setPresentationMode(windowUuid, mode, "dock-presentation");
                return;
            }

            if (command.type === "focus-column-right") {
                const windowUuid = normalizeWindowUuid(command.windowUuid);
                const index = mainScreenState.columns.findIndex(item =>
                    normalizeWindowUuid(item.window.internalId) === windowUuid);
                const column = index >= 0 ? mainScreenState.columns[index] : null;
                if (!column || column.window.output !== mainScreenState.targetOutput) {
                    rejectDockCommand("invalid-focus-target");
                    return;
                }

                beginDockScroll(column, "dock-focus-right");
                return;
            }

            if (!Array.isArray(command.order)) {
                rejectDockCommand("invalid-column-order");
                return;
            }
            const requested = command.order.map(normalizeWindowUuid);
            const current = mainScreenState.columns.map(column =>
                normalizeWindowUuid(column.window.internalId));
            const requestedSet = new Set(requested);
            const currentSet = new Set(current);
            if (requested.length !== current.length ||
                    requestedSet.size !== requested.length ||
                    requested.some(uuid => !uuid || !currentSet.has(uuid))) {
                rejectDockCommand("invalid-column-set");
                return;
            }

            const columnsByUuid = new Map(mainScreenState.columns.map(column => [
                normalizeWindowUuid(column.window.internalId),
                column,
            ]));
            cancelPendingDockScroll("dock-reorder");
            const focusedColumn = mainScreenState.columns[
                mainScreenState.focusedColumnIndex
            ] || null;
            const oldScrollOffsetX = mainScreenState.scrollOffsetX;
            mainScreenState.columns = requested.map(uuid => columnsByUuid.get(uuid));
            mainScreenState.focusedColumnIndex = focusedColumn
                ? mainScreenState.columns.indexOf(focusedColumn)
                : -1;
            recomputeLogicalLayout();
            if (focusedColumn) ensureColumnVisible(focusedColumn);
            const newScrollOffsetX = mainScreenState.scrollOffsetX;
            relayout("dock-reorder", {
                oldScrollOffsetX,
                newScrollOffsetX,
            });
            debug(`[cc-dock] APPLY command=${command.commandId}` +
                ` generation=${dockGeneration} columns=${requested.length}`);
            commitDockState("dock-reorder");
        }
    );
}

function rectCopy(rect) {
    return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
}

function rectText(rect) {
    return rect ? `${rect.x},${rect.y} ${rect.width}x${rect.height}` : "<none>";
}

function sameRect(a, b) {
    return a && b && a.x === b.x && a.y === b.y &&
        a.width === b.width && a.height === b.height;
}

function sameRectNear(a, b) {
    return a && b && Math.abs(a.x - b.x) < 1 &&
        Math.abs(a.y - b.y) < 1 &&
        Math.abs(a.width - b.width) < 1 &&
        Math.abs(a.height - b.height) < 1;
}

function sameSizeNear(a, b) {
    return a && b && Math.abs(a.width - b.width) < 1 &&
        Math.abs(a.height - b.height) < 1;
}

function loadConfig() {
    const number = (key, fallback) => Math.max(0, Number(readConfig(key, fallback)) || 0);
    configuredOutputName = String(readConfig("TargetOutputName", "")).trim();
    gapTop = number("GapTop", 50);
    gapBottom = number("GapBottom", 70);
    gapLeft = number("GapLeft", 24);
    gapRight = number("GapRight", 24);
    innerGap = number("InnerGap", 8);
    manageSecondaryOutput = Boolean(readConfig("ManageSecondaryOutput", true));
    secondaryOutputName = String(readConfig("SecondaryOutputName", "HDMI-A-1")).trim();
    secondaryGapTop = number("SecondaryGapTop", 24);
    secondaryGapBottom = number("SecondaryGapBottom", 24);
    secondaryGapLeft = number("SecondaryGapLeft", 24);
    secondaryGapRight = number("SecondaryGapRight", 24);
    secondaryInnerGap = number("SecondaryInnerGap", 8);
    includeDialogs = Boolean(readConfig("IncludeDialogs", false));
    debugLogging = Boolean(readConfig("DebugLogging", false));
}

function orderedOutputs() {
    return workspace.screens.slice().sort((a, b) =>
        a.geometry.x === b.geometry.x
            ? a.geometry.y - b.geometry.y
            : a.geometry.x - b.geometry.x
    );
}

function resolveTargetOutput() {
    const outputs = orderedOutputs();
    if (!outputs.length) return null;
    if (configuredOutputName) {
        const configured = outputs.find(output => output.name === configuredOutputName);
        if (configured) {
            warnedMissingOutput = false;
            return configured;
        }
        if (!warnedMissingOutput) {
            warn(`configured output ${configuredOutputName} not found; using leftmost output`);
            warnedMissingOutput = true;
        }
    }
    return outputs[0];
}

function resolveSecondaryOutput() {
    if (!manageSecondaryOutput) return null;
    const primary = resolveTargetOutput();
    const candidates = orderedOutputs().filter(output => output !== primary);
    if (!candidates.length) return null;
    if (secondaryOutputName) {
        const configured = candidates.find(output => output.name === secondaryOutputName);
        if (configured) {
            warnedMissingSecondaryOutput = false;
            return configured;
        }
        if (!warnedMissingSecondaryOutput) {
            warn(`configured secondary output ${secondaryOutputName} not found; using rightmost non-primary output`);
            warnedMissingSecondaryOutput = true;
        }
    }
    return candidates[candidates.length - 1];
}

function profileForOutput(output) {
    if (!output) return null;
    const primary = resolveTargetOutput();
    if (output === primary) {
        return {
            role: "primary", output,
            top: gapTop, bottom: gapBottom, left: gapLeft, right: gapRight,
            inner: innerGap,
        };
    }
    const secondary = resolveSecondaryOutput();
    if (output === secondary) {
        return {
            role: "secondary", output,
            top: secondaryGapTop, bottom: secondaryGapBottom,
            left: secondaryGapLeft, right: secondaryGapRight,
            inner: secondaryInnerGap,
        };
    }
    return null;
}

function managedOutputs() {
    const outputs = [resolveTargetOutput(), resolveSecondaryOutput()].filter(Boolean);
    return outputs.filter((output, index) => outputs.indexOf(output) === index);
}

function safeRectFor(output) {
    const profile = profileForOutput(output);
    if (!profile) return null;
    const screen = output.geometry;
    return {
        x: screen.x + Math.min(profile.left, Math.max(0, screen.width - 1)),
        y: screen.y + Math.min(profile.top, Math.max(0, screen.height - 1)),
        width: Math.max(1, screen.width - profile.left - profile.right),
        height: Math.max(1, screen.height - profile.top - profile.bottom),
    };
}

function isPlasmaShellWindow(window) {
    if (!window) return false;
    const shellIdentities = new Set([
        "plasmashell",
        "org.kde.plasmashell",
        "org.kde.plasma.desktop",
    ]);
    return [window.resourceClass, window.resourceName, window.desktopFileName]
        .map(value => String(value || "").trim().toLowerCase())
        .some(value => shellIdentities.has(value));
}

function scrollEligible(window) {
    return Boolean(window && window.managed && window.normalWindow &&
        window.moveable && window.resizeable &&
        !window.specialWindow && !window.fullScreen &&
        !isPlasmaShellWindow(window));
}

function refreshMainScreenState() {
    mainScreenState.targetOutput = resolveTargetOutput();
    mainScreenState.safeRect = mainScreenState.targetOutput
        ? safeRectFor(mainScreenState.targetOutput)
        : null;
    mainScreenState.innerGap = innerGap;
}

function widthForMode(mode) {
    const safeRect = mainScreenState.safeRect;
    if (!safeRect) return 1;
    const gap = Math.min(mainScreenState.innerGap, Math.max(0, safeRect.width - 1));
    if (mode === COLUMN_WIDTH_THIRD) {
        return Math.max(1, Math.floor((safeRect.width - 2 * gap) / 3));
    }
    if (mode === COLUMN_WIDTH_TWO_THIRDS) {
        const third = Math.max(1, Math.floor((safeRect.width - 2 * gap) / 3));
        return Math.max(1, safeRect.width - gap - third);
    }
    return Math.max(1, Math.floor((safeRect.width - gap) / 2));
}

function recomputeLogicalLayout() {
    let logicalX = 0;
    mainScreenState.columns.forEach(column => {
        column.pixelWidth = widthForMode(column.widthMode);
        column.logicalX = logicalX;
        logicalX += column.pixelWidth + mainScreenState.innerGap;
    });
}

function stripWidth() {
    const columns = mainScreenState.columns;
    if (!columns.length) return 0;
    const last = columns[columns.length - 1];
    return last.logicalX + last.pixelWidth;
}

function clampScrollOffset() {
    const viewportWidth = mainScreenState.safeRect ? mainScreenState.safeRect.width : 0;
    const maximum = Math.max(0, stripWidth() - viewportWidth);
    mainScreenState.scrollOffsetX = Math.max(
        0,
        Math.min(mainScreenState.scrollOffsetX, maximum)
    );
}

function ensureColumnVisible(column) {
    if (!column || !mainScreenState.safeRect) return;
    const viewportLeft = mainScreenState.scrollOffsetX;
    const viewportRight = viewportLeft + mainScreenState.safeRect.width;
    const columnLeft = column.logicalX;
    const columnRight = column.logicalX + column.pixelWidth;
    const oldOffset = mainScreenState.scrollOffsetX;

    if (columnLeft < viewportLeft) {
        mainScreenState.scrollOffsetX = columnLeft;
    } else if (columnRight > viewportRight) {
        mainScreenState.scrollOffsetX = columnRight - mainScreenState.safeRect.width;
    }
    clampScrollOffset();
    if (oldOffset !== mainScreenState.scrollOffsetX) {
        debug(`[cc-scroll] SCROLL old=${oldOffset} new=${mainScreenState.scrollOffsetX}`);
    }
}

function projectedRectForColumnAtOffset(column, scrollOffsetX) {
    return {
        x: mainScreenState.safeRect.x + column.logicalX -
            scrollOffsetX,
        y: mainScreenState.safeRect.y,
        width: column.pixelWidth,
        height: mainScreenState.safeRect.height,
    };
}

function projectedRectForColumn(column) {
    return projectedRectForColumnAtOffset(column, mainScreenState.scrollOffsetX);
}

function isPresentationMode(mode) {
    return mode === PRESENTATION_NORMAL || mode === PRESENTATION_WIDE ||
        mode === PRESENTATION_MAXIMIZED;
}

function presentationColumn() {
    if (mainScreenState.presentation.mode === PRESENTATION_NORMAL ||
            !mainScreenState.presentation.windowUuid) return null;
    return mainScreenState.columns.find(column =>
        normalizeWindowUuid(column.window.internalId) ===
            mainScreenState.presentation.windowUuid) || null;
}

function wideRect() {
    const safeRect = mainScreenState.safeRect;
    const width = Math.max(1, Math.min(
        safeRect.width,
        Math.round(safeRect.width * WIDE_RATIO)
    ));
    return {
        x: safeRect.x + Math.floor((safeRect.width - width) / 2),
        y: safeRect.y,
        width,
        height: safeRect.height,
    };
}

function presentationRect() {
    return mainScreenState.presentation.mode === PRESENTATION_WIDE
        ? wideRect()
        : rectCopy(mainScreenState.safeRect);
}

function isFullyVisibleInSafeRect(rect) {
    const safeRect = mainScreenState.safeRect;
    return Boolean(safeRect &&
        rect.x >= safeRect.x &&
        rect.y >= safeRect.y &&
        rect.x + rect.width <= safeRect.x + safeRect.width &&
        rect.y + rect.height <= safeRect.y + safeRect.height);
}

function rectIntersects(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x &&
        a.y < b.y + b.height && a.y + a.height > b.y;
}

function isRectInsideAnyOutput(rect) {
    return workspace.screens.some(output => rectIntersects(rect, output.geometry));
}

function virtualScreenLeft() {
    const geometry = workspace.virtualScreenGeometry;
    if (geometry && Number.isFinite(Number(geometry.x))) return Number(geometry.x);
    return workspace.screens.reduce(
        (left, output) => Math.min(left, output.geometry.x),
        0
    );
}

function looksLikeInheritedParking(window) {
    const rect = window.frameGeometry;
    return Number(window.opacity) <= 0 && window.minimized && rect &&
        Number(rect.x) < virtualScreenLeft();
}

function parkingBaseX() {
    const maximumColumnWidth = mainScreenState.columns.reduce(
        (maximum, column) => Math.max(maximum, column.pixelWidth),
        0
    );
    return virtualScreenLeft() - PARKING_MARGIN - maximumColumnWidth;
}

function parkingRectForColumn(column, parkingIndex) {
    const rect = {
        x: parkingBaseX() - parkingIndex *
            (column.pixelWidth + mainScreenState.innerGap),
        y: mainScreenState.safeRect.y,
        width: column.pixelWidth,
        height: mainScreenState.safeRect.height,
    };
    if (isRectInsideAnyOutput(rect)) {
        warn(`[cc-scroll] invalid parking rect column=${column.id} rect=${rectText(rect)}`);
    }
    return rect;
}

function classifyColumnPlacement(column, parkingIndex) {
    const projectedRect = projectedRectForColumn(column);
    if (isFullyVisibleInSafeRect(projectedRect)) {
        return { kind: "visible", rect: projectedRect, projectedRect };
    }
    return {
        kind: "parked",
        rect: parkingRectForColumn(column, parkingIndex),
        projectedRect,
    };
}

function createScrollTransaction(oldScrollOffsetX, newScrollOffsetX) {
    const deltaX = newScrollOffsetX - oldScrollOffsetX;
    return {
        oldScrollOffsetX,
        newScrollOffsetX,
        deltaX,
        columns: mainScreenState.columns.map(column => {
            const oldProjectedRect = projectedRectForColumnAtOffset(
                column,
                oldScrollOffsetX
            );
            const newProjectedRect = projectedRectForColumnAtOffset(
                column,
                newScrollOffsetX
            );
            return {
                column,
                id: column.id,
                oldProjectedRect,
                newProjectedRect,
                oldPlacement: isFullyVisibleInSafeRect(oldProjectedRect)
                    ? "visible"
                    : "parked",
                newPlacement: isFullyVisibleInSafeRect(newProjectedRect)
                    ? "visible"
                    : "parked",
            };
        }),
    };
}

function applyColumnGeometry(column, target, reason) {
    const window = column.window;
    const windowState = stateFor(window);
    if (windowState.floating || window.fullScreen || isTileMode(windowState.layoutMode)) {
        return;
    }
    if (sameRect(window.frameGeometry, target)) return;
    windowState.internalChange = true;
    try {
        window.frameGeometry = target;
    } finally {
        windowState.internalChange = false;
    }
    debug(`[cc-scroll] LAYOUT reason=${reason} column=${column.id}` +
        ` physicalX=${target.x} width=${target.width}` +
        ` actual=${rectText(window.frameGeometry)}`);
}

function setColumnVisualVisibility(column, visible) {
    const window = column.window;
    const windowState = stateFor(window);
    if (windowState.scrollOriginalOpacity === null) {
        const currentOpacity = Number(window.opacity);
        /* A zero opacity can only be a marker left by an earlier script
         * instance. Preserve normal application opacity otherwise. */
        windowState.scrollOriginalOpacity = currentOpacity > 0
            ? currentOpacity
            : 1;
    }
    if (visible) {
        window.opacity = windowState.scrollOriginalOpacity;
        if (windowState.scrollParkingMinimized && window.minimized) {
            window.minimized = false;
        }
        windowState.scrollParkedByScript = false;
        windowState.scrollParkingMinimized = false;
        windowState.scrollVisuallyHidden = false;
        return;
    }

    /* Opacity alone is insufficient: KWin may clamp the parked geometry to
     * x=-612, leaving an invisible input surface behind the left Column.
     * Minimize only windows hidden by us, and remember ownership so a user's
     * own minimized state is never cleared accidentally. */
    window.opacity = 0;
    if (!window.minimized) {
        window.minimized = true;
        windowState.scrollParkingMinimized = true;
    }
    windowState.scrollParkedByScript = true;
    windowState.scrollVisuallyHidden = true;
}

function parkingRecoveryRect(windowState, fallbackIndex) {
    refreshMainScreenState();
    const safeRect = mainScreenState.safeRect;
    if (!safeRect) return null;
    const source = windowState.scrollLastVisibleGeometry;
    if (source) {
        const width = Math.max(1, Math.min(Number(source.width), safeRect.width));
        const height = Math.max(1, Math.min(Number(source.height), safeRect.height));
        return {
            x: Math.max(safeRect.x, Math.min(Number(source.x),
                safeRect.x + safeRect.width - width)),
            y: Math.max(safeRect.y, Math.min(Number(source.y),
                safeRect.y + safeRect.height - height)),
            width,
            height,
        };
    }

    const cascade = Math.max(0, Number(fallbackIndex) || 0) * 24;
    const width = Math.max(1, Math.floor(safeRect.width * 0.72));
    const height = Math.max(1, Math.floor(safeRect.height * 0.82));
    const availableX = Math.max(0, safeRect.width - width);
    const availableY = Math.max(0, safeRect.height - height);
    return {
        x: safeRect.x + Math.min(cascade, availableX),
        y: safeRect.y + Math.min(cascade, availableY),
        width,
        height,
    };
}

function releaseParkingOwnership(window, reason, ensureAccessible = false,
        fallbackIndex = 0) {
    const windowState = states.get(window);
    if (!windowState) return false;
    const owned = windowState.scrollParkedByScript ||
        windowState.scrollVisuallyHidden || windowState.scrollParkingMinimized;
    if (!owned) return false;

    if (ensureAccessible) {
        const target = parkingRecoveryRect(windowState, fallbackIndex);
        if (target) {
            windowState.internalChange = true;
            try {
                window.frameGeometry = target;
            } finally {
                windowState.internalChange = false;
            }
        }
    }
    window.opacity = windowState.scrollOriginalOpacity;
    if (windowState.scrollParkingMinimized && window.minimized) {
        window.minimized = false;
    }
    windowState.scrollParkedByScript = false;
    windowState.scrollParkingMinimized = false;
    windowState.scrollVisuallyHidden = false;
    debug(`[cc-stability] RELEASE_PARKING caption=${window.caption}` +
        ` accessible=${ensureAccessible} reason=${reason}`);
    return true;
}

function emergencyRestoreAllWindows(reason) {
    /* Stop future signal-driven relayout first. This entry point is invoked by
     * install/uninstall before KWin unloads the script instance. */
    mainScreenState.enabled = false;
    pendingWideTransition = null;
    cancelPendingDockScroll(reason);
    let restored = 0;
    mainScreenState.columns.forEach((column, index) => {
        if (releaseParkingOwnership(column.window, reason, true, index)) restored += 1;
    });
    states.forEach((windowState, window) => {
        if (columnIndexForWindow(window) >= 0) return;
        if (releaseParkingOwnership(window, reason, true, restored)) restored += 1;
    });
    debug(`[cc-stability] EMERGENCY_RESTORE count=${restored} reason=${reason}`);
}

function beginLayoutTransaction(reason) {
    if (layoutTransactionDepth === 0) {
        layoutEpoch += 1;
        activeLayoutReason = reason;
        debug(`[cc-stability] BEGIN epoch=${layoutEpoch} reason=${reason}`);
    }
    layoutTransactionDepth += 1;
    return layoutEpoch;
}

function validateLayoutInvariants(reason, epoch) {
    const errors = [];
    const columns = mainScreenState.columns;
    const windows = new Set();
    const uuids = new Set();
    let expectedLogicalX = 0;

    columns.forEach((column, index) => {
        const uuid = normalizeWindowUuid(column.window.internalId);
        if (windows.has(column.window)) errors.push(`duplicate-window:${index}`);
        windows.add(column.window);
        if (!uuid || uuids.has(uuid)) errors.push(`duplicate-uuid:${uuid || index}`);
        uuids.add(uuid);
        if (column.logicalX !== expectedLogicalX) {
            errors.push(`logical-x:${column.id}:${column.logicalX}:${expectedLogicalX}`);
        }
        if (!Number.isFinite(column.pixelWidth) || column.pixelWidth < 1) {
            errors.push(`invalid-width:${column.id}:${column.pixelWidth}`);
        }
        const windowState = states.get(column.window);
        const adoptionOwnsColumn = windowState &&
            (windowState.adoptionPhase === ADOPTION_MANAGED ||
             windowState.adoptionPhase === ADOPTION_SETTLING);
        if (!windowState || !windowState.managedByScrollLayout ||
                windowState.columnId !== column.id || windowState.floating ||
                !adoptionOwnsColumn) {
            errors.push(`state-ownership:${column.id}`);
        }
        if (mainScreenState.targetOutput &&
                column.window.output !== mainScreenState.targetOutput) {
            errors.push(`wrong-output:${column.id}`);
        }
        expectedLogicalX += column.pixelWidth + mainScreenState.innerGap;
    });

    if (!columns.length) {
        if (mainScreenState.focusedColumnIndex !== -1) errors.push("empty-focus");
    } else if (mainScreenState.focusedColumnIndex < 0 ||
            mainScreenState.focusedColumnIndex >= columns.length) {
        errors.push(`focus-index:${mainScreenState.focusedColumnIndex}`);
    }

    const maximumOffset = Math.max(0, stripWidth() -
        (mainScreenState.safeRect ? mainScreenState.safeRect.width : 0));
    if (mainScreenState.scrollOffsetX < 0 ||
            mainScreenState.scrollOffsetX > maximumOffset) {
        errors.push(`scroll-offset:${mainScreenState.scrollOffsetX}:${maximumOffset}`);
    }

    const presentation = mainScreenState.presentation;
    if (presentation.mode === PRESENTATION_NORMAL) {
        if (presentation.windowUuid) errors.push("normal-with-target");
    } else {
        const presentedIndex = columns.findIndex(column =>
            normalizeWindowUuid(column.window.internalId) === presentation.windowUuid);
        if (presentedIndex < 0) errors.push(`missing-presentation:${presentation.windowUuid}`);
        if (presentedIndex >= 0 && presentedIndex !== mainScreenState.focusedColumnIndex) {
            errors.push(`presentation-focus:${presentedIndex}:${mainScreenState.focusedColumnIndex}`);
        }
    }

    if (!errors.length) {
        if (lastInvariantWarning) {
            debug(`[cc-stability] RECOVERED epoch=${epoch} reason=${reason}`);
        }
        lastInvariantWarning = "";
        return true;
    }

    const signature = errors.join(",");
    if (signature !== lastInvariantWarning) {
        warn(`[cc-stability] INVARIANT epoch=${epoch} reason=${reason}` +
            ` errors=${signature}`);
        lastInvariantWarning = signature;
    }
    return false;
}

function endLayoutTransaction(reason, epoch) {
    layoutTransactionDepth = Math.max(0, layoutTransactionDepth - 1);
    if (layoutTransactionDepth !== 0) return;
    validateLayoutInvariants(reason, epoch);
    debug(`[cc-stability] END epoch=${epoch} reason=${activeLayoutReason}`);
    activeLayoutReason = "";
}

/* The only geometry writer for windows managed by the scrolling layout. */
function relayoutImpl(reason, scrollOffsets) {
    if (!mainScreenState.enabled || !mainScreenState.columns.length) return;
    refreshMainScreenState();
    if (!mainScreenState.safeRect) return;
    recomputeLogicalLayout();
    clampScrollOffset();

    const presentedColumn = presentationColumn();
    const transaction = !presentedColumn && scrollOffsets &&
        scrollOffsets.oldScrollOffsetX !== scrollOffsets.newScrollOffsetX
        ? createScrollTransaction(
            scrollOffsets.oldScrollOffsetX,
            scrollOffsets.newScrollOffsetX
        )
        : null;
    let parkingIndex = 0;
    const placements = (transaction ? transaction.columns : mainScreenState.columns)
        .map(item => {
            const column = transaction ? item.column : item;
            const projectedRect = transaction
                ? item.newProjectedRect
                : projectedRectForColumn(column);
            const isPresented = presentedColumn === column;
            const visible = presentedColumn
                ? isPresented
                : isFullyVisibleInSafeRect(projectedRect);
            const visibleRect = isPresented ? presentationRect() : projectedRect;
            const placement = visible
                ? { kind: "visible", rect: visibleRect, projectedRect: visibleRect }
                : {
                    kind: "parked",
                    rect: parkingRectForColumn(column, parkingIndex++),
                    projectedRect,
                };
            return {
                column,
                placement,
                oldPlacement: transaction ? item.oldPlacement : null,
                newPlacement: transaction ? item.newPlacement : null,
                oldProjectedRect: transaction ? item.oldProjectedRect : null,
                newProjectedRect: transaction ? item.newProjectedRect : projectedRect,
            };
        });

    /*
     * A scroll transaction commits its continuing visible column first. Its
     * old/new frame coordinates are also its old/new projected coordinates,
     * providing the Effect with the logical delta before incoming/outgoing
     * parked windows change geometry. Parking coordinates never define the
     * transition direction.
     */
    const transitionRank = item => {
        if (item.oldPlacement === "visible" && item.newPlacement === "visible") return 0;
        if (item.oldPlacement === "parked" && item.newPlacement === "visible") return 1;
        if (item.oldPlacement === "visible" && item.newPlacement === "parked") return 2;
        return 3;
    };
    const applyOrder = transaction
        ? placements.slice().sort((a, b) => transitionRank(a) - transitionRank(b))
        : placements;
    if (transaction) {
        debug(`[cc-scroll] TRANSACTION old=${transaction.oldScrollOffsetX}` +
            ` new=${transaction.newScrollOffsetX} delta=${transaction.deltaX}`);
    }
    applyOrder.forEach(item => {
        const column = item.column;
        const placement = item.placement;
        const windowState = stateFor(column.window);
        if (placement.kind === "parked" && !windowState.scrollVisuallyHidden &&
                isRectInsideAnyOutput(column.window.frameGeometry)) {
            windowState.scrollLastVisibleGeometry =
                rectCopy(column.window.frameGeometry);
        }
        /* A parked window is positioned while still hidden, then restored.
         * Continuing visible Columns retain the normal geometry-first
         * animation transaction used by H/L. */
        if (placement.kind === "visible" && windowState.scrollVisuallyHidden) {
            applyColumnGeometry(column, placement.rect, reason);
            setColumnVisualVisibility(column, true);
        } else {
            if (placement.kind === "visible") setColumnVisualVisibility(column, true);
            applyColumnGeometry(column, placement.rect, reason);
        }
        if (placement.kind === "parked") setColumnVisualVisibility(column, false);
        else windowState.scrollLastVisibleGeometry = rectCopy(placement.rect);
        const outputName = column.window.output ? column.window.output.name : "<none>";
        if (placement.kind === "visible") {
            debug(`[cc-scroll] PROJECT column=${column.id}` +
                ` logicalX=${column.logicalX}` +
                ` oldProjectedX=${item.oldProjectedRect ? item.oldProjectedRect.x : "<none>"}` +
                ` projectedX=${item.newProjectedRect.x}` +
                ` kind=visible output=${outputName}`);
        } else {
            debug(`[cc-scroll] PARK column=${column.id}` +
                ` logicalX=${column.logicalX}` +
                ` oldProjectedX=${item.oldProjectedRect ? item.oldProjectedRect.x : "<none>"}` +
                ` projectedX=${item.newProjectedRect.x}` +
                ` parkingX=${placement.rect.x} output=${outputName}`);
        }
    });
}

function relayout(reason, scrollOffsets) {
    const epoch = beginLayoutTransaction(reason);
    try {
        relayoutImpl(reason, scrollOffsets);
    } finally {
        endLayoutTransaction(reason, epoch);
    }
}

function columnIndexForWindow(window) {
    return mainScreenState.columns.findIndex(column => column.window === window);
}

function resetPresentedWindowLayoutState() {
    const column = presentationColumn();
    if (!column) return;
    const windowState = stateFor(column.window);
    if (windowState.layoutMode === MAXIMIZE_MODE) {
        setLayoutMode(windowState, NORMAL_MODE);
        windowState.pendingAction = null;
    }
}

function clearPresentationState() {
    resetPresentedWindowLayoutState();
    mainScreenState.presentation.windowUuid = null;
    mainScreenState.presentation.mode = PRESENTATION_NORMAL;
}

function cancelPendingDockScroll(reason) {
    if (!pendingDockScroll) return false;
    debug(`[cc-dock] SCROLL_CANCEL token=${pendingDockScroll.token}` +
        ` reason=${reason}`);
    pendingDockScroll = null;
    return true;
}

function boundedScrollOffset(offset) {
    const viewportWidth = mainScreenState.safeRect
        ? mainScreenState.safeRect.width
        : 0;
    const maximum = Math.max(0, stripWidth() - viewportWidth);
    return Math.max(0, Math.min(Number(offset) || 0, maximum));
}

function dockScrollOffsetsToTarget(column) {
    if (!column || !mainScreenState.safeRect) return [];
    recomputeLogicalLayout();
    clampScrollOffset();
    if (isFullyVisibleInSafeRect(projectedRectForColumn(column))) return [];

    const currentOffset = mainScreenState.scrollOffsetX;
    const targetOffset = boundedScrollOffset(
        column.logicalX + column.pixelWidth - mainScreenState.safeRect.width
    );
    if (targetOffset === currentOffset) return [];

    const direction = targetOffset > currentOffset ? 1 : -1;
    const offsets = [];
    const seen = new Set();
    mainScreenState.columns.forEach(item => {
        const offset = boundedScrollOffset(
            item.logicalX + item.pixelWidth - mainScreenState.safeRect.width
        );
        const between = direction > 0
            ? offset > currentOffset && offset <= targetOffset
            : offset < currentOffset && offset >= targetOffset;
        if (!between || seen.has(offset)) return;
        seen.add(offset);
        offsets.push(offset);
    });
    if (!seen.has(targetOffset)) offsets.push(targetOffset);
    offsets.sort((left, right) => direction > 0 ? left - right : right - left);
    return offsets;
}

function requestDeferredDockScrollStep(pending) {
    const command = {
        protocol: 1,
        commandId: `${dockSessionId}-dock-scroll-${pending.token}-` +
            `${pending.deferredSequence++}`,
        sessionId: dockSessionId,
        baseGeneration: dockGeneration,
        type: "advance-dock-scroll",
        transitionToken: pending.token,
        windowUuid: pending.windowUuid,
    };
    callDBus(
        DOCK_BRIDGE_SERVICE,
        DOCK_BRIDGE_PATH,
        DOCK_BRIDGE_INTERFACE,
        "RequestDeferredCommand",
        JSON.stringify(command),
        DOCK_SCROLL_STEP_MS,
        accepted => {
            if (accepted) return;
            debug(`[cc-dock] SCROLL_DEFER_FALLBACK token=${pending.token}`);
            advancePendingDockScroll(command);
        }
    );
}

function finishDockScroll(pending, column) {
    if (!pending || pendingDockScroll !== pending || !column) return false;
    const index = mainScreenState.columns.indexOf(column);
    if (index < 0 || column.window.output !== mainScreenState.targetOutput) {
        cancelPendingDockScroll("finish-target-missing");
        return false;
    }

    pendingDockScroll = null;
    const offset = mainScreenState.scrollOffsetX;
    mainScreenState.focusedColumnIndex = index;
    const presentationChanged = relayoutFocusedColumnTransition(
        column,
        `${pending.reason}-arrive`,
        offset,
        offset
    );
    if (column.window.minimized) column.window.minimized = false;
    workspace.activeWindow = column.window;
    debug(`[cc-dock] SCROLL_COMPLETE token=${pending.token}` +
        ` index=${index} offset=${offset} caption=${column.window.caption}`);
    if (presentationChanged) {
        commitDockState(`${pending.reason}-presentation`);
    } else {
        publishDockState(pending.reason);
    }
    return true;
}

function advancePendingDockScroll(command) {
    const token = String(command.transitionToken || "");
    const pending = pendingDockScroll;
    if (!pending || token !== pending.token ||
            normalizeWindowUuid(command.windowUuid) !== pending.windowUuid) {
        return false;
    }
    const column = mainScreenState.columns.find(item =>
        normalizeWindowUuid(item.window.internalId) === pending.windowUuid);
    if (!column || column.window.output !== mainScreenState.targetOutput) {
        cancelPendingDockScroll("advance-target-missing");
        return false;
    }
    if (!pending.offsets.length) return finishDockScroll(pending, column);

    const oldScrollOffsetX = mainScreenState.scrollOffsetX;
    mainScreenState.scrollOffsetX = pending.offsets.shift();
    clampScrollOffset();
    const newScrollOffsetX = mainScreenState.scrollOffsetX;
    relayout(`${pending.reason}-step`, {
        oldScrollOffsetX,
        newScrollOffsetX,
    });
    debug(`[cc-dock] SCROLL_STEP token=${pending.token}` +
        ` old=${oldScrollOffsetX} new=${newScrollOffsetX}` +
        ` remaining=${pending.offsets.length}`);
    if (pending.offsets.length) requestDeferredDockScrollStep(pending);
    else finishDockScroll(pending, column);
    return true;
}

function beginDockScroll(column, reason) {
    if (!column || !mainScreenState.safeRect) return false;
    cancelPendingDockScroll("superseded-by-dock-click");
    pendingWideTransition = null;
    const offsets = dockScrollOffsetsToTarget(column);

    if (offsets.length &&
            mainScreenState.presentation.mode !== PRESENTATION_NORMAL) {
        clearPresentationState();
        commitDockState(`${reason}-clear-presentation`);
    }

    const pending = {
        token: String(nextDockScrollToken++),
        windowUuid: normalizeWindowUuid(column.window.internalId),
        reason,
        offsets,
        deferredSequence: 1,
    };
    pendingDockScroll = pending;
    debug(`[cc-dock] SCROLL_BEGIN token=${pending.token}` +
        ` target=${pending.windowUuid} steps=${offsets.join(",") || "focus-only"}`);
    if (!offsets.length) return finishDockScroll(pending, column);
    return advancePendingDockScroll({
        transitionToken: pending.token,
        windowUuid: pending.windowUuid,
    });
}

function selectPersistentPresentation(column) {
    const oldWindowUuid = mainScreenState.presentation.windowUuid;
    const oldMode = mainScreenState.presentation.mode;
    clearPresentationState();
    if (column && column.persistentWide) {
        mainScreenState.presentation.windowUuid =
            normalizeWindowUuid(column.window.internalId);
        mainScreenState.presentation.mode = PRESENTATION_WIDE;
    }
    return oldWindowUuid !== mainScreenState.presentation.windowUuid ||
        oldMode !== mainScreenState.presentation.mode;
}

function pendingWideColumn(pending) {
    if (!pending) return null;
    const column = mainScreenState.columns.find(item =>
        normalizeWindowUuid(item.window.internalId) === pending.windowUuid);
    if (!column || !column.persistentWide ||
            mainScreenState.columns.indexOf(column) !==
                mainScreenState.focusedColumnIndex ||
            column.window.output !== mainScreenState.targetOutput) {
        return null;
    }
    return column;
}

function finalizePendingWideTransition(column) {
    const pending = pendingWideTransition;
    if (!pending || pending.phase !== WIDE_REVEAL_PHASE_ANIMATING ||
            !column || pendingWideColumn(pending) !== column) {
        return false;
    }
    pendingWideTransition = null;
    relayout(`${pending.reason}-finalize-wide`, {
        oldScrollOffsetX: mainScreenState.scrollOffsetX,
        newScrollOffsetX: mainScreenState.scrollOffsetX,
    });
    commitDockState(`${pending.reason}-finalize-wide`);
    debug(`[cc-presentation] DEFERRED_WIDE_COMPLETE token=${pending.token}` +
        ` uuid=${pending.windowUuid}`);
    return true;
}

function finalizePendingWideTransitionCommand(command) {
    const token = String(command.transitionToken || "");
    if (!pendingWideTransition || token !== pendingWideTransition.token ||
            pendingWideTransition.phase !== WIDE_REVEAL_PHASE_ANIMATING) {
        return false;
    }
    const column = pendingWideColumn(pendingWideTransition);
    if (!column || !sameRectNear(column.window.frameGeometry, presentationRect())) {
        pendingWideTransition = null;
        debug(`[cc-presentation] DEFERRED_WIDE_FINALIZE_CANCEL token=${token}`);
        return false;
    }
    return finalizePendingWideTransition(column);
}

function acknowledgePendingWideGeometry(column) {
    const pending = pendingWideTransition;
    if (!pending || pending.phase !== WIDE_REVEAL_PHASE_EXPANDING ||
            pendingWideColumn(pending) !== column ||
            !sameRectNear(column.window.frameGeometry, presentationRect())) {
        return false;
    }
    pending.phase = WIDE_REVEAL_PHASE_ANIMATING;
    requestDeferredWideStage(
        "finalize-wide-transition",
        pending,
        dockGeneration,
        WIDE_EXPANSION_PHASE_MS
    );
    debug(`[cc-presentation] DEFERRED_WIDE_ACK token=${pending.token}` +
        ` actual=${rectText(column.window.frameGeometry)}` +
        ` animation=${WIDE_EXPANSION_PHASE_MS}`);
    return true;
}

function checkPendingWideGeometry(command) {
    const token = String(command.transitionToken || "");
    if (!pendingWideTransition || token !== pendingWideTransition.token ||
            pendingWideTransition.phase !== WIDE_REVEAL_PHASE_EXPANDING) {
        return false;
    }
    const pending = pendingWideTransition;
    const column = pendingWideColumn(pending);
    if (!column) {
        pendingWideTransition = null;
        return false;
    }
    const target = presentationRect();
    if (sameRectNear(column.window.frameGeometry, target)) {
        return acknowledgePendingWideGeometry(column);
    }
    if (pending.geometryAttempts >= WIDE_GEOMETRY_MAX_ATTEMPTS) {
        warn(`[cc-presentation] WIDE_GEOMETRY_TIMEOUT token=${token}` +
            ` actual=${rectText(column.window.frameGeometry)}`);
        pendingWideTransition = null;
        clearPresentationState();
        relayout(`${pending.reason}-wide-timeout`, {
            oldScrollOffsetX: mainScreenState.scrollOffsetX,
            newScrollOffsetX: mainScreenState.scrollOffsetX,
        });
        return false;
    }
    pending.geometryAttempts += 1;
    applyColumnGeometry(column, target, `${pending.reason}-retry-wide`);
    requestDeferredWideStage(
        "check-wide-transition",
        pending,
        dockGeneration,
        WIDE_GEOMETRY_RETRY_MS
    );
    return true;
}

function beginPendingWideExpansion(pending, column, reason) {
    if (!pending || !column || pendingWideTransition !== pending ||
            pendingWideColumn(pending) !== column) return false;
    pending.reason = reason || pending.reason;
    selectPersistentPresentation(column);
    pending.phase = WIDE_REVEAL_PHASE_EXPANDING;
    pending.geometryAttempts = 1;
    const target = presentationRect();
    /* Wayland clients may acknowledge frameGeometry asynchronously. Keep the
     * normal-pair neighbor visible until the target really reaches 72%; the
     * frameGeometryChanged acknowledgement finalizes parking. */
    setColumnVisualVisibility(column, true);
    applyColumnGeometry(column, target, `${pending.reason}-request-wide`);
    debug(`[cc-presentation] DEFERRED_WIDE_REQUEST token=${pending.token}` +
        ` requested=${rectText(target)}` +
        ` actual=${rectText(column.window.frameGeometry)}`);
    if (sameRectNear(column.window.frameGeometry, target)) {
        acknowledgePendingWideGeometry(column);
    } else {
        requestDeferredWideStage(
            "check-wide-transition",
            pending,
            dockGeneration,
            WIDE_GEOMETRY_RETRY_MS
        );
    }
    return true;
}

function completePendingWideTransition(command) {
    const token = String(command.transitionToken || "");
    if (!pendingWideTransition || token !== pendingWideTransition.token ||
            pendingWideTransition.phase !== WIDE_REVEAL_PHASE_SETTLED) {
        return false;
    }
    const pending = pendingWideTransition;
    const column = pendingWideColumn(pending);
    if (!column) {
        pendingWideTransition = null;
        debug(`[cc-presentation] DEFERRED_WIDE_CANCEL token=${token}`);
        return false;
    }
    return beginPendingWideExpansion(pending, column, pending.reason);
}

function requestDeferredWideStage(type, pending, baseGeneration, delayMs) {
    const command = {
        protocol: 1,
        commandId: `${dockSessionId}-wide-${pending.token}-${type}-` +
            `${pending.deferredSequence++}`,
        sessionId: dockSessionId,
        baseGeneration,
        type,
        transitionToken: pending.token,
        windowUuid: pending.windowUuid,
    };
    callDBus(
        DOCK_BRIDGE_SERVICE,
        DOCK_BRIDGE_PATH,
        DOCK_BRIDGE_INTERFACE,
        "RequestDeferredCommand",
        JSON.stringify(command),
        delayMs,
        accepted => {
            if (accepted) return;
            debug(`[cc-presentation] DEFERRED_WIDE_FALLBACK` +
                ` token=${pending.token} type=${type}`);
            if (type === "settle-wide-transition") {
                settlePendingWideTransition(command);
            } else if (type === "check-wide-transition") {
                checkPendingWideGeometry(command);
            } else if (type === "finalize-wide-transition") {
                finalizePendingWideTransitionCommand(command);
            } else {
                completePendingWideTransition(command);
            }
        }
    );
}

function settlePendingWideTransition(command) {
    const token = String(command.transitionToken || "");
    if (!pendingWideTransition || token !== pendingWideTransition.token ||
            pendingWideTransition.phase !== WIDE_REVEAL_PHASE_SCROLLING) {
        return false;
    }
    const pending = pendingWideTransition;
    const column = mainScreenState.columns.find(item =>
        normalizeWindowUuid(item.window.internalId) === pending.windowUuid);
    if (!column || !column.persistentWide ||
            mainScreenState.columns.indexOf(column) !==
                mainScreenState.focusedColumnIndex ||
            column.window.output !== mainScreenState.targetOutput ||
            mainScreenState.presentation.mode !== PRESENTATION_NORMAL) {
        pendingWideTransition = null;
        debug(`[cc-presentation] DEFERRED_PAIR_CANCEL token=${token}`);
        return false;
    }

    /* Reassert the normal layout after the movement phase. This restores both
     * members of the destination pair even if an activation/minimize signal
     * raced with the initial reveal. No presentation window is selected yet. */
    relayout(`${pending.reason}-settle-pair`, {
        oldScrollOffsetX: mainScreenState.scrollOffsetX,
        newScrollOffsetX: mainScreenState.scrollOffsetX,
    });
    pending.phase = WIDE_REVEAL_PHASE_SETTLED;
    pending.revealWindowUuids = mainScreenState.columns
        .filter(item => isFullyVisibleInSafeRect(projectedRectForColumn(item)))
        .map(item => normalizeWindowUuid(item.window.internalId));
    requestDeferredWideStage(
        "complete-wide-transition",
        pending,
        Number(command.baseGeneration),
        WIDE_PAIR_HOLD_MS
    );
    debug(`[cc-presentation] DEFERRED_PAIR_SETTLED token=${token}` +
        ` visible=${pending.revealWindowUuids.join(",")}` +
        ` hold=${WIDE_PAIR_HOLD_MS}`);
    return true;
}

function schedulePersistentWideTransition(column, reason, baseGeneration) {
    const token = String(nextWideTransitionToken++);
    const windowUuid = normalizeWindowUuid(column.window.internalId);
    const revealWindowUuids = mainScreenState.columns
        .filter(item => isFullyVisibleInSafeRect(projectedRectForColumn(item)))
        .map(item => normalizeWindowUuid(item.window.internalId));
    pendingWideTransition = {
        token,
        windowUuid,
        reason,
        phase: WIDE_REVEAL_PHASE_SCROLLING,
        revealWindowUuids,
        deferredSequence: 1,
    };
    requestDeferredWideStage(
        "settle-wide-transition",
        pendingWideTransition,
        baseGeneration,
        WIDE_SCROLL_PHASE_MS
    );
    debug(`[cc-presentation] DEFERRED_WIDE_SCHEDULE token=${token}` +
        ` uuid=${windowUuid} phase=${WIDE_REVEAL_PHASE_SCROLLING}` +
        ` visible=${revealWindowUuids.join(",")}` +
        ` delay=${WIDE_SCROLL_PHASE_MS}`);
}

function armPersistentWideStep(column, reason, direction) {
    const token = String(nextWideTransitionToken++);
    const windowUuid = normalizeWindowUuid(column.window.internalId);
    pendingWideTransition = {
        token,
        windowUuid,
        reason,
        phase: WIDE_REVEAL_PHASE_AWAITING_STEP,
        entryDirection: direction,
        deferredSequence: 1,
    };
    debug(`[cc-presentation] WIDE_STEP_ARM token=${token}` +
        ` uuid=${windowUuid} direction=${direction}`);
}

function relayoutFocusedColumnTransition(column, reason, oldScrollOffsetX,
        newScrollOffsetX, wideStepDirection = 0) {
    const oldWindowUuid = mainScreenState.presentation.windowUuid;
    const oldMode = mainScreenState.presentation.mode;
    const columnUuid = column
        ? normalizeWindowUuid(column.window.internalId)
        : null;
    const alreadySelectedWide = Boolean(column && column.persistentWide &&
        oldMode === PRESENTATION_WIDE && oldWindowUuid === columnUuid);
    if (pendingWideTransition && pendingWideTransition.windowUuid !== columnUuid) {
        debug(`[cc-presentation] DEFERRED_WIDE_SUPERSEDE` +
            ` token=${pendingWideTransition.token} reason=${reason}`);
        pendingWideTransition = null;
    }
    if (pendingWideTransition &&
            pendingWideTransition.windowUuid === columnUuid &&
            column && column.persistentWide && !alreadySelectedWide) {
        debug(`[cc-presentation] DEFERRED_WIDE_REUSE` +
            ` token=${pendingWideTransition.token} reason=${reason}`);
        return oldWindowUuid !== mainScreenState.presentation.windowUuid ||
            oldMode !== mainScreenState.presentation.mode;
    }

    if (column && column.persistentWide && !alreadySelectedWide) {
        /* KWin cannot paint between two synchronous geometry commits. Reveal
         * the real 50% slot now, then let the Bridge request the 72% commit
         * after the scrolling effect has had time to render. */
        clearPresentationState();
        relayout(`${reason}-reveal-wide`, {
            oldScrollOffsetX,
            newScrollOffsetX,
        });
        if (wideStepDirection !== 0) {
            armPersistentWideStep(column, reason, wideStepDirection);
        } else {
            const presentationChangedNow = oldWindowUuid !==
                    mainScreenState.presentation.windowUuid ||
                oldMode !== mainScreenState.presentation.mode;
            schedulePersistentWideTransition(
                column,
                reason,
                dockGeneration + (presentationChangedNow ? 1 : 0)
            );
        }
    } else {
        selectPersistentPresentation(column);
        relayout(reason, {
            oldScrollOffsetX,
            newScrollOffsetX,
        });
    }

    return oldWindowUuid !== mainScreenState.presentation.windowUuid ||
        oldMode !== mainScreenState.presentation.mode;
}

function setPresentationMode(windowUuid, mode, reason) {
    if (!isPresentationMode(mode)) return false;
    const normalizedUuid = normalizeWindowUuid(windowUuid);
    const column = mainScreenState.columns.find(item =>
        normalizeWindowUuid(item.window.internalId) === normalizedUuid);
    if (!column || column.window.output !== mainScreenState.targetOutput) return false;

    cancelPendingDockScroll(reason);
    pendingWideTransition = null;

    resetPresentedWindowLayoutState();
    const oldScrollOffsetX = mainScreenState.scrollOffsetX;
    mainScreenState.focusedColumnIndex = mainScreenState.columns.indexOf(column);
    recomputeLogicalLayout();
    ensureColumnVisible(column);

    const targetState = stateFor(column.window);
    targetState.internalChange = true;
    try {
        column.window.setMaximize(false, false);
    } finally {
        targetState.internalChange = false;
    }

    if (mode === PRESENTATION_NORMAL) {
        column.persistentWide = false;
        mainScreenState.presentation.windowUuid = null;
        mainScreenState.presentation.mode = PRESENTATION_NORMAL;
    } else {
        if (mode === PRESENTATION_WIDE) column.persistentWide = true;
        mainScreenState.presentation.windowUuid = normalizedUuid;
        mainScreenState.presentation.mode = mode;
        if (mode === PRESENTATION_MAXIMIZED) {
            targetState.internalChange = true;
            try {
                setLayoutMode(targetState, MAXIMIZE_MODE);
                targetState.pendingAction = null;
            } finally {
                targetState.internalChange = false;
            }
        }
    }

    relayout(reason, {
        oldScrollOffsetX,
        newScrollOffsetX: mainScreenState.scrollOffsetX,
    });
    if (workspace.activeWindow !== column.window) {
        workspace.activeWindow = column.window;
    }
    debug(`[cc-presentation] SET mode=${mode} uuid=${normalizedUuid}` +
        ` reason=${reason}`);
    commitDockState(reason);
    return true;
}

function addColumnAt(window, insertionIndex, reason) {
    if (columnIndexForWindow(window) >= 0) return null;
    const windowState = stateFor(window);
    const column = {
        id: mainScreenState.nextColumnId++,
        window,
        widthMode: COLUMN_WIDTH_HALF,
        persistentWide: false,
        logicalX: 0,
        pixelWidth: 0,
    };
    windowState.managedByScrollLayout = true;
    windowState.columnId = column.id;
    windowState.floating = false;
    windowState.adoptionPhase = ADOPTION_MANAGED;
    const index = Math.max(0, Math.min(
        Number(insertionIndex),
        mainScreenState.columns.length
    ));
    mainScreenState.columns.splice(index, 0, column);
    debug(`[cc-scroll] ADD_WINDOW caption=${window.caption}` +
        ` column=${column.id} index=${index} width=${column.widthMode}` +
        ` reason=${reason}`);
    return column;
}

function addInitialColumn(window) {
    return addColumnAt(
        window,
        mainScreenState.columns.length,
        "startup"
    );
}

function prepareInitialColumn(window) {
    const windowState = stateFor(window);
    const tileMode = detectQuickTileMode(window);
    const hadLayoutOverride = isLayoutMode(windowState.layoutMode) ||
        Number(window.maximizeMode) === FULL_MAXIMIZE_MODE || isTileMode(tileMode);
    if (!hadLayoutOverride) return true;

    windowState.internalChange = true;
    try {
        if (isTileMode(tileMode)) {
            /*
             * KWin exposes no writable tile property. A maximize -> restore
             * round trip is the verified public operation that detaches the
             * native Quick Tile object before scroll-layout adoption.
             */
            window.setMaximize(true, true);
            window.setMaximize(false, false);
        } else {
            window.setMaximize(false, false);
        }
        clearLayoutState(windowState);
        windowState.layoutModeBeforeFullscreen = NORMAL_MODE;
        windowState.temporarilyMaximized = false;
        windowState.temporarilyQuickTiled = false;
    } finally {
        windowState.internalChange = false;
    }

    const detached = detectQuickTileMode(window) === NORMAL_MODE &&
        Number(window.maximizeMode) !== FULL_MAXIMIZE_MODE;
    if (!detached) {
        warn(`[cc-scroll] failed to detach startup layout caption=${window.caption}` +
            ` tile=${detectQuickTileMode(window)} maximize=${window.maximizeMode}`);
    } else {
        debug(`[cc-scroll] ADOPT_STARTUP_OVERRIDE caption=${window.caption}` +
            ` previous=${tileMode}`);
    }
    return detached;
}

function removeColumn(window, reason, activateSuccessor = true) {
    const index = columnIndexForWindow(window);
    if (index < 0) return;
    cancelPendingDockScroll(reason);
    const oldScrollOffsetX = mainScreenState.scrollOffsetX;
    const focusedColumn = mainScreenState.columns[mainScreenState.focusedColumnIndex] || null;
    const removedColumn = mainScreenState.columns[index];
    if (reason !== "window-closed") {
        const needsAccessibleGeometry = reason === "shortcut-toggle-floating" ||
            reason === "interactive-move-resize";
        releaseParkingOwnership(
            removedColumn.window,
            reason,
            needsAccessibleGeometry,
            index
        );
    }
    const removedGeometry = removedColumn.window.frameGeometry;
    const removedWasVisibleLeft = mainScreenState.safeRect &&
        isFullyVisibleInSafeRect(removedGeometry) &&
        removedGeometry.x + removedGeometry.width / 2 <
            mainScreenState.safeRect.x + mainScreenState.safeRect.width / 2;
    if (mainScreenState.presentation.windowUuid ===
            normalizeWindowUuid(removedColumn.window.internalId)) {
        clearPresentationState();
    }
    const removedFocusedColumn = focusedColumn === removedColumn;
    mainScreenState.columns.splice(index, 1);
    const windowState = states.get(window);
    if (windowState) {
        windowState.managedByScrollLayout = false;
        windowState.columnId = null;
        windowState.adoptionPhase = windowState.floating
            ? ADOPTION_FLOATING
            : ADOPTION_UNTRACKED;
    }
    if (!mainScreenState.columns.length) {
        mainScreenState.focusedColumnIndex = -1;
        mainScreenState.scrollOffsetX = 0;
        commitDockState(reason);
        return;
    }

    if (removedFocusedColumn) {
        // The column now at the removed index was its right neighbor. If the
        // removed column was last, the clamped index selects the left neighbor.
        mainScreenState.focusedColumnIndex = Math.min(
            index,
            mainScreenState.columns.length - 1
        );
    } else {
        // Removing a column to the left must not silently change which window
        // the model considers focused.
        const preservedIndex = mainScreenState.columns.indexOf(focusedColumn);
        mainScreenState.focusedColumnIndex = preservedIndex >= 0
            ? preservedIndex
            : Math.min(index, mainScreenState.columns.length - 1);
    }

    recomputeLogicalLayout();
    const nextFocusedColumn = mainScreenState.columns[mainScreenState.focusedColumnIndex];
    if (removedWasVisibleLeft && index > 0) {
        /* Keep the existing right-hand window fixed in its right slot. The
         * predecessor becomes the new left-hand window instead of shifting
         * the entire visible pair left after the left window closes. */
        mainScreenState.scrollOffsetX = oldScrollOffsetX -
            removedColumn.pixelWidth - mainScreenState.innerGap;
        clampScrollOffset();
    } else {
        ensureColumnVisible(nextFocusedColumn);
    }
    const newScrollOffsetX = mainScreenState.scrollOffsetX;
    relayout(reason, {
        oldScrollOffsetX,
        newScrollOffsetX,
    });

    if (activateSuccessor && removedFocusedColumn && nextFocusedColumn &&
            workspace.activeWindow !== nextFocusedColumn.window) {
        workspace.activeWindow = nextFocusedColumn.window;
    }
    debug(`[cc-scroll] REMOVE_WINDOW column=${removedColumn.id}` +
        ` index=${index} focused=${removedFocusedColumn}` +
        ` next=${nextFocusedColumn ? nextFocusedColumn.id : "<none>"}` +
        ` reason=${reason}`);
    commitDockState(reason);
}

function initializeScrollLayout() {
    /* This immutable startup snapshot is the only path allowed to adopt an
     * inactive window. Anything arriving later through windowAdded follows
     * the runtime state machine and waits for its first activation. */
    refreshMainScreenState();
    if (!mainScreenState.enabled || !mainScreenState.targetOutput) return;
    workspace.windowList().filter(window =>
        scrollEligible(window) &&
        window.output === mainScreenState.targetOutput
    ).filter(prepareInitialColumn).forEach(addInitialColumn);

    if (!mainScreenState.columns.length) return;
    const activeIndex = columnIndexForWindow(workspace.activeWindow);
    mainScreenState.focusedColumnIndex = activeIndex >= 0 ? activeIndex : 0;
    recomputeLogicalLayout();
    ensureColumnVisible(mainScreenState.columns[mainScreenState.focusedColumnIndex]);
    relayout("startup");
}

function adoptNewWindowAsColumn(window, reason, focusNew = true) {
    if (!scrollLayoutInitialized || !window) return false;
    refreshMainScreenState();
    if (!mainScreenState.enabled || !mainScreenState.targetOutput ||
            window.output !== mainScreenState.targetOutput ||
            !scrollEligible(window) || columnIndexForWindow(window) >= 0) {
        return false;
    }

    cancelPendingDockScroll(reason);
    const windowState = stateFor(window);
    if (windowState.floating || isLayoutMode(windowState.layoutMode) ||
            Number(window.maximizeMode) === FULL_MAXIMIZE_MODE ||
            isTileMode(detectQuickTileMode(window))) {
        return false;
    }

    if (focusNew && mainScreenState.presentation.mode !== PRESENTATION_NORMAL) {
        clearPresentationState();
    }

    const oldScrollOffsetX = mainScreenState.scrollOffsetX;
    const focusedIndex = mainScreenState.columns.length
        ? Math.max(0, Math.min(
            mainScreenState.focusedColumnIndex,
            mainScreenState.columns.length - 1
        ))
        : -1;
    const focusedColumn = focusedIndex >= 0
        ? mainScreenState.columns[focusedIndex]
        : null;
    const insertionIndex = focusNew
        ? focusedIndex + 1
        : mainScreenState.columns.length;
    const column = addColumnAt(window, insertionIndex, reason);
    if (!column) return false;

    mainScreenState.focusedColumnIndex = focusNew || !focusedColumn
        ? insertionIndex
        : mainScreenState.columns.indexOf(focusedColumn);
    recomputeLogicalLayout();
    if (focusNew || !focusedColumn) ensureColumnVisible(column);
    const newScrollOffsetX = mainScreenState.scrollOffsetX;
    relayout(reason, {
        oldScrollOffsetX,
        newScrollOffsetX,
    });
    debug(`[cc-scroll] ADOPT_NEW index=${insertionIndex}` +
        ` focused=${focusNew} caption=${window.caption}`);
    commitDockState(reason);
    return true;
}

function setAdoptionPhase(window, windowState, phase, reason) {
    const previous = windowState.adoptionPhase;
    windowState.adoptionPhase = phase;
    windowState.adoptionLastEvent = reason;
    if (previous !== phase) {
        debug(`[cc-adoption] PHASE ${previous}->${phase}` +
            ` caption=${window.caption} reason=${reason}`);
    }
}

function adoptionWaitPhase(window, windowState) {
    if (isPlasmaShellWindow(window)) return ADOPTION_IGNORED;
    if (windowState.floating) return ADOPTION_FLOATING;
    if (!mainScreenState.enabled || !mainScreenState.targetOutput ||
            window.output !== mainScreenState.targetOutput) {
        return ADOPTION_WAITING_PRIMARY;
    }
    if (window.fullScreen || isLayoutMode(windowState.layoutMode) ||
            Number(window.maximizeMode) === FULL_MAXIMIZE_MODE ||
            isTileMode(detectQuickTileMode(window))) {
        return ADOPTION_WAITING_NORMAL;
    }
    if (!scrollEligible(window)) return ADOPTION_WAITING_ELIGIBLE;
    if (!window.active) return ADOPTION_WAITING_ACTIVATION;
    return null;
}

function settleAdoptedWindow(window, windowState, reason) {
    const index = columnIndexForWindow(window);
    if (index < 0) {
        setAdoptionPhase(
            window,
            windowState,
            ADOPTION_WAITING_ELIGIBLE,
            `${reason}-missing-column`
        );
        return false;
    }
    if (!window.active) {
        setAdoptionPhase(window, windowState, ADOPTION_MANAGED,
            `${reason}-inactive-after-adopt`);
        return true;
    }
    const column = mainScreenState.columns[index];
    const oldScrollOffsetX = mainScreenState.scrollOffsetX;
    mainScreenState.focusedColumnIndex = index;
    recomputeLogicalLayout();
    ensureColumnVisible(column);
    const newScrollOffsetX = mainScreenState.scrollOffsetX;
    relayoutFocusedColumnTransition(
        column,
        `${reason}-settle`,
        oldScrollOffsetX,
        newScrollOffsetX
    );

    const expected = projectedRectForColumn(column);
    if (isFullyVisibleInSafeRect(expected) && sameRect(window.frameGeometry, expected)) {
        setAdoptionPhase(window, windowState, ADOPTION_MANAGED, reason);
        debug(`[cc-scroll] ADOPT_SETTLED column=${column.id}` +
            ` caption=${window.caption} geometry=${rectText(window.frameGeometry)}`);
        return true;
    }
    setAdoptionPhase(window, windowState, ADOPTION_SETTLING, reason);
    debug(`[cc-scroll] ADOPT_PENDING column=${column.id}` +
        ` caption=${window.caption} actual=${rectText(window.frameGeometry)}` +
        ` expected=${rectText(expected)} reason=${reason}`);
    return false;
}

function advanceWindowAdoption(window, reason) {
    if (!window || !states.has(window)) return false;
    const windowState = stateFor(window);
    if (windowState.adoptionPhase === ADOPTION_MANAGED) {
        return columnIndexForWindow(window) >= 0;
    }
    if (windowState.adoptionPhase === ADOPTION_FLOATING ||
            windowState.adoptionPhase === ADOPTION_IGNORED) return false;
    if (windowState.adoptionPhase === ADOPTION_SETTLING &&
            columnIndexForWindow(window) >= 0) {
        return settleAdoptedWindow(window, windowState, reason);
    }
    if (windowState.adoptionPhase === ADOPTION_UNTRACKED) return false;

    refreshMainScreenState();
    const waitPhase = adoptionWaitPhase(window, windowState);
    if (waitPhase) {
        setAdoptionPhase(window, windowState, waitPhase, reason);
        return false;
    }

    setAdoptionPhase(window, windowState, ADOPTION_ADOPTING, reason);
    windowState.adoptionAttempts += 1;
    if (!adoptNewWindowAsColumn(window, reason, true)) {
        setAdoptionPhase(window, windowState, ADOPTION_WAITING_ELIGIBLE,
            `${reason}-adopt-rejected`);
        return false;
    }
    setAdoptionPhase(window, windowState, ADOPTION_SETTLING, reason);
    return settleAdoptedWindow(window, windowState, reason);
}

function beginWindowAdoption(window, origin) {
    if (!window) return false;
    const windowState = stateFor(window);
    if (windowState.managedByScrollLayout || columnIndexForWindow(window) >= 0) {
        setAdoptionPhase(window, windowState, ADOPTION_MANAGED, origin);
        return true;
    }
    if (windowState.floating) {
        setAdoptionPhase(window, windowState, ADOPTION_FLOATING, origin);
        return false;
    }
    windowState.adoptionOrigin = origin;
    setAdoptionPhase(window, windowState, ADOPTION_WAITING_ELIGIBLE, origin);
    return advanceWindowAdoption(window, origin);
}

function onWindowActivatedForScrollLayout(window) {
    if (!window) return;
    if (layoutTransactionDepth > 0) {
        debug(`[cc-stability] SUPPRESS activation epoch=${layoutEpoch}` +
            ` caption=${window.caption}`);
        return;
    }
    if (lastShortcutFloatingWindow &&
            Date.now() <= floatingFocusGuardUntil &&
            states.has(lastShortcutFloatingWindow) &&
            stateFor(lastShortcutFloatingWindow).floating &&
            window !== lastShortcutFloatingWindow) {
        workspace.activeWindow = lastShortcutFloatingWindow;
        return;
    }
    if (Date.now() > floatingFocusGuardUntil) floatingFocusGuardUntil = 0;
    advanceWindowAdoption(window, "window-activated-after-add");

    const index = columnIndexForWindow(window);
    if (index < 0) return;
    if (pendingDockScroll) cancelPendingDockScroll("window-activated");
    const column = mainScreenState.columns[index];
    const windowUuid = normalizeWindowUuid(window.internalId);
    const deferredWideMatches = Boolean(pendingWideTransition &&
        pendingWideTransition.windowUuid === windowUuid);
    const presentationMatches = deferredWideMatches || (column.persistentWide
        ? mainScreenState.presentation.mode === PRESENTATION_WIDE &&
            mainScreenState.presentation.windowUuid === windowUuid
        : mainScreenState.presentation.mode === PRESENTATION_NORMAL);
    if (index === mainScreenState.focusedColumnIndex && presentationMatches) return;
    const oldScrollOffsetX = mainScreenState.scrollOffsetX;
    mainScreenState.focusedColumnIndex = index;
    recomputeLogicalLayout();
    ensureColumnVisible(column);
    const newScrollOffsetX = mainScreenState.scrollOffsetX;
    const presentationChanged = relayoutFocusedColumnTransition(
        column,
        "window-activated",
        oldScrollOffsetX,
        newScrollOffsetX
    );
    debug(`[cc-scroll] FOCUS_ACTIVE index=${index} caption=${window.caption}`);
    if (presentationChanged) commitDockState("focus-selected-presentation");
    else publishDockState("window-activated");
}

function focusRelativeColumn(delta) {
    const columns = mainScreenState.columns;
    if (!mainScreenState.enabled || !columns.length) return;
    cancelPendingDockScroll(delta < 0 ? "focus-previous" : "focus-next");
    const activeIndex = columnIndexForWindow(workspace.activeWindow);
    if (activeIndex >= 0) mainScreenState.focusedColumnIndex = activeIndex;
    const oldIndex = mainScreenState.focusedColumnIndex;
    const currentColumn = oldIndex >= 0 ? columns[oldIndex] : null;
    const currentUuid = currentColumn
        ? normalizeWindowUuid(currentColumn.window.internalId)
        : null;
    if (currentColumn && currentColumn.persistentWide &&
            pendingWideTransition &&
            pendingWideTransition.phase === WIDE_REVEAL_PHASE_AWAITING_STEP &&
            pendingWideTransition.windowUuid === currentUuid &&
            pendingWideTransition.entryDirection === delta) {
        beginPendingWideExpansion(
            pendingWideTransition,
            currentColumn,
            delta < 0 ? "focus-previous-wide-step" : "focus-next-wide-step"
        );
        debug(`[cc-scroll] WIDE_STEP index=${oldIndex} direction=${delta}`);
        return;
    }
    const nextIndex = Math.max(0, Math.min(columns.length - 1, oldIndex + delta));
    if (nextIndex === oldIndex) return;

    mainScreenState.focusedColumnIndex = nextIndex;
    const column = columns[nextIndex];
    recomputeLogicalLayout();
    const oldScrollOffsetX = mainScreenState.scrollOffsetX;
    ensureColumnVisible(column);
    const newScrollOffsetX = mainScreenState.scrollOffsetX;
    const presentationChanged = relayoutFocusedColumnTransition(
        column,
        delta < 0 ? "focus-previous" : "focus-next",
        oldScrollOffsetX,
        newScrollOffsetX,
        delta
    );
    /*
     * Never activate a window while its real geometry is still in the
     * off-screen parking area. KWin may compose one activation frame before
     * the following geometry transaction, which can surface on an adjacent
     * output. Commit the target's primary-screen slot first, then focus it.
     */
    workspace.activeWindow = column.window;
    debug(`[cc-scroll] FOCUS from=${oldIndex} to=${nextIndex}`);
    if (presentationChanged) {
        commitDockState(delta < 0 ? "focus-previous-presentation" :
            "focus-next-presentation");
    } else {
        publishDockState(delta < 0 ? "focus-previous" : "focus-next");
    }
}

function toggleFocusWide(window) {
    const index = columnIndexForWindow(window);
    if (!window || index < 0 || window.output !== mainScreenState.targetOutput ||
            window.fullScreen) return;
    const windowUuid = normalizeWindowUuid(window.internalId);
    const alreadyWide = mainScreenState.columns[index].persistentWide;
    setPresentationMode(
        windowUuid,
        alreadyWide ? PRESENTATION_NORMAL : PRESENTATION_WIDE,
        alreadyWide ? "shortcut-wide-to-normal" : "shortcut-focus-wide"
    );
}

function moveFocusedColumn(delta) {
    const columns = mainScreenState.columns;
    if (!mainScreenState.enabled || columns.length < 2) return;
    cancelPendingDockScroll(delta < 0 ? "move-column-left" : "move-column-right");
    const activeIndex = columnIndexForWindow(workspace.activeWindow);
    if (activeIndex >= 0) mainScreenState.focusedColumnIndex = activeIndex;
    const oldIndex = mainScreenState.focusedColumnIndex;
    if (oldIndex < 0 || oldIndex >= columns.length) return;
    const nextIndex = Math.max(0, Math.min(columns.length - 1, oldIndex + delta));
    if (nextIndex === oldIndex) return;

    const focusedColumn = columns[oldIndex];
    columns[oldIndex] = columns[nextIndex];
    columns[nextIndex] = focusedColumn;
    mainScreenState.focusedColumnIndex = nextIndex;
    recomputeLogicalLayout();
    ensureColumnVisible(focusedColumn);
    relayout(delta < 0 ? "move-column-left" : "move-column-right");
    debug(`[cc-scroll] MOVE column=${focusedColumn.id}` +
        ` from=${oldIndex} to=${nextIndex}`);
    commitDockState(delta < 0 ? "move-column-left" : "move-column-right");
}

function detachColumnToFloating(window, reason) {
    const index = columnIndexForWindow(window);
    if (!window || index < 0) return false;
    const windowState = stateFor(window);
    /* removeColumn() never writes the removed window's geometry. Mark it as
     * floating before relayout so no concurrent signal can re-adopt it. */
    windowState.floating = true;
    setAdoptionPhase(window, windowState, ADOPTION_FLOATING, reason);
    removeColumn(window, reason, false);
    if (window.minimized) window.minimized = false;
    if (workspace.activeWindow !== window) workspace.activeWindow = window;
    debug(`[cc-scroll] FLOAT caption=${window.caption}` +
        ` geometry=${rectText(window.frameGeometry)} reason=${reason}`);
    return true;
}

function attachFloatingToColumns(window, reason) {
    if (!window || window.fullScreen) return false;
    refreshMainScreenState();
    if (!mainScreenState.enabled || !mainScreenState.targetOutput ||
            window.output !== mainScreenState.targetOutput ||
            !scrollEligible(window) || columnIndexForWindow(window) >= 0) {
        return false;
    }

    const windowState = stateFor(window);
    if (!prepareInitialColumn(window)) {
        warn(`[cc-scroll] MANAGE rejected caption=${window.caption}` +
            ` reason=layout-detach-failed`);
        return false;
    }
    windowState.floating = false;
    if (!adoptNewWindowAsColumn(window, reason, true)) {
        windowState.floating = true;
        setAdoptionPhase(window, windowState, ADOPTION_FLOATING,
            `${reason}-rollback`);
        return false;
    }
    debug(`[cc-scroll] MANAGE caption=${window.caption}` +
        ` geometry=${rectText(window.frameGeometry)} reason=${reason}`);
    return true;
}

function toggleFloating(window) {
    const now = Date.now();
    const rememberedFloating = lastShortcutFloatingWindow &&
        states.has(lastShortcutFloatingWindow) &&
        stateFor(lastShortcutFloatingWindow).floating &&
        columnIndexForWindow(lastShortcutFloatingWindow) < 0;
    let target = window;
    if (rememberedFloating && target !== lastShortcutFloatingWindow &&
            (now - lastShortcutDetachedAt <= FLOATING_REATTACH_GRACE_MS ||
             !target || isPlasmaShellWindow(target))) {
        target = lastShortcutFloatingWindow;
    }
    if (!target) return;
    if (columnIndexForWindow(target) >= 0) {
        if (detachColumnToFloating(target, "shortcut-toggle-floating")) {
            lastShortcutFloatingWindow = target;
            lastShortcutDetachedAt = now;
            floatingFocusGuardUntil = now + FLOATING_FOCUS_GUARD_MS;
            workspace.activeWindow = target;
        }
        return;
    }
    if (attachFloatingToColumns(target, "shortcut-toggle-managed") &&
            target === lastShortcutFloatingWindow) {
        lastShortcutFloatingWindow = null;
        lastShortcutDetachedAt = 0;
        floatingFocusGuardUntil = 0;
    }
}

function rectForLayout(mode, safeRect, requestedInnerGap) {
    if (mode === MAXIMIZE_MODE) return rectCopy(safeRect);
    const gap = Math.min(
        Math.max(0, requestedInnerGap),
        Math.max(0, Math.min(safeRect.width, safeRect.height) - 2)
    );
    const leftWidth = Math.floor((safeRect.width - gap) / 2);
    const rightWidth = safeRect.width - gap - leftWidth;
    const topHeight = Math.floor((safeRect.height - gap) / 2);
    const bottomHeight = safeRect.height - gap - topHeight;
    const rightX = safeRect.x + leftWidth + gap;
    const bottomY = safeRect.y + topHeight + gap;
    const rects = {
        left: { x: safeRect.x, y: safeRect.y, width: leftWidth, height: safeRect.height },
        right: { x: rightX, y: safeRect.y, width: rightWidth, height: safeRect.height },
        top: { x: safeRect.x, y: safeRect.y, width: safeRect.width, height: topHeight },
        bottom: { x: safeRect.x, y: bottomY, width: safeRect.width, height: bottomHeight },
        topLeft: { x: safeRect.x, y: safeRect.y, width: leftWidth, height: topHeight },
        topRight: { x: rightX, y: safeRect.y, width: rightWidth, height: topHeight },
        bottomLeft: { x: safeRect.x, y: bottomY, width: leftWidth, height: bottomHeight },
        bottomRight: { x: rightX, y: bottomY, width: rightWidth, height: bottomHeight },
    };
    return rects[mode] ? rectCopy(rects[mode]) : null;
}

function detectQuickTileMode(window) {
    const relative = window.tile ? window.tile.relativeGeometry : null;
    if (!relative) return NORMAL_MODE;
    const key = [relative.x, relative.y, relative.width, relative.height]
        .map(value => Number(value).toFixed(2)).join(",");
    return ({
        "0.00,0.00,0.50,1.00": "left",
        "0.50,0.00,0.50,1.00": "right",
        "0.00,0.00,1.00,0.50": "top",
        "0.00,0.50,1.00,0.50": "bottom",
        "0.00,0.00,0.50,0.50": "topLeft",
        "0.50,0.00,0.50,0.50": "topRight",
        "0.00,0.50,0.50,0.50": "bottomLeft",
        "0.50,0.50,0.50,0.50": "bottomRight",
    })[key] || "unsupported";
}

function isTileMode(mode) {
    return mode !== NORMAL_MODE && mode !== MAXIMIZE_MODE && mode !== "unsupported";
}

function isLayoutMode(mode) {
    return mode === MAXIMIZE_MODE || isTileMode(mode);
}

function eligible(window) {
    if (!window || window.fullScreen || !window.resizeable || !window.maximizable ||
            isPlasmaShellWindow(window)) return false;
    return window.normalWindow || (includeDialogs && window.dialog);
}

function onManagedOutput(window) {
    return Boolean(window && profileForOutput(window.output));
}

function stateFor(window) {
    let state = states.get(window);
    if (!state) {
        const currentOpacity = Number(window.opacity);
        const inheritedParkingHidden = looksLikeInheritedParking(window);
        const currentGeometry = rectCopy(window.frameGeometry);
        state = {
            pseudoMaximized: false,
            layoutMode: NORMAL_MODE,
            layoutModeBeforeFullscreen: NORMAL_MODE,
            restoreGeometry: null,
            restoreOutput: null,
            pendingAction: null,
            internalChange: false,
            interactiveMoveResize: false,
            managedByScrollLayout: false,
            columnId: null,
            floating: false,
            adoptionPhase: ADOPTION_UNTRACKED,
            adoptionOrigin: "",
            adoptionLastEvent: "",
            adoptionAttempts: 0,
            temporarilyMaximized: false,
            temporarilyQuickTiled: false,
            scrollOriginalOpacity: currentOpacity > 0 ? currentOpacity : 1,
            scrollVisuallyHidden: inheritedParkingHidden,
            scrollParkedByScript: inheritedParkingHidden,
            scrollParkingMinimized: inheritedParkingHidden && window.minimized,
            scrollLastVisibleGeometry: inheritedParkingHidden
                ? null
                : currentGeometry,
        };
        states.set(window, state);
    }
    return state;
}

function setLayoutMode(state, mode) {
    state.layoutMode = mode;
    state.pseudoMaximized = mode === MAXIMIZE_MODE;
}

function clearLayoutState(state) {
    setLayoutMode(state, NORMAL_MODE);
    state.restoreGeometry = null;
    state.restoreOutput = null;
    state.pendingAction = null;
}

function rememberRestore(window, state, geometry) {
    if (state.restoreGeometry) return;
    state.restoreGeometry = rectCopy(geometry);
    state.restoreOutput = window.output;
    debug(`CAPTURE ${window.caption} restore=${rectText(state.restoreGeometry)}`);
}

function translateRestoreGeometry(state, newOutput) {
    if (!state.restoreGeometry || !newOutput) return;
    if (!state.restoreOutput) {
        state.restoreOutput = newOutput;
        return;
    }
    if (state.restoreOutput === newOutput) return;
    const oldScreen = state.restoreOutput.geometry;
    const newScreen = newOutput.geometry;
    state.restoreGeometry.x += newScreen.x - oldScreen.x;
    state.restoreGeometry.y += newScreen.y - oldScreen.y;
    state.restoreOutput = newOutput;
    debug(`TRANSLATE restore=${rectText(state.restoreGeometry)} output=${newOutput.name}`);
}

function applyLayoutGeometry(window, state, mode, reason) {
    const profile = profileForOutput(window.output);
    if (!profile || window.fullScreen) return false;
    const target = rectForLayout(mode, safeRectFor(window.output), profile.inner);
    if (!target) return false;
    state.internalChange = true;
    try {
        if (mode === MAXIMIZE_MODE) window.setMaximize(false, false);
        window.frameGeometry = target;
        setLayoutMode(state, mode);
        state.pendingAction = null;
    } finally {
        state.internalChange = false;
    }
    debug(`APPLY ${window.caption} reason=${reason} mode=${mode}` +
        ` geometry=${rectText(window.frameGeometry)} expected=${rectText(target)}` +
        ` restore=${rectText(state.restoreGeometry)}`);
    return sameRect(window.frameGeometry, target);
}

function leavePseudoMaximize(window, state, reason) {
    const restore = rectCopy(state.restoreGeometry);
    state.internalChange = true;
    try {
        window.setMaximize(false, false);
        if (restore) window.frameGeometry = restore;
        clearLayoutState(state);
    } finally {
        state.internalChange = false;
    }
    debug(`RESTORE ${window.caption} reason=${reason} geometry=${rectText(window.frameGeometry)}`);
}

function onFrameGeometryChanged(window, oldGeometry) {
    const state = stateFor(window);
    if (state.internalChange || state.interactiveMoveResize || window.fullScreen) return;
    if (pendingWideTransition &&
            pendingWideTransition.phase === WIDE_REVEAL_PHASE_EXPANDING &&
            pendingWideTransition.windowUuid ===
                normalizeWindowUuid(window.internalId) &&
            sameRectNear(window.frameGeometry, presentationRect())) {
        acknowledgePendingWideGeometry(
            mainScreenState.columns[columnIndexForWindow(window)]
        );
        return;
    }
    if (window.active && state.adoptionPhase !== ADOPTION_UNTRACKED &&
            state.adoptionPhase !== ADOPTION_MANAGED &&
            state.adoptionPhase !== ADOPTION_FLOATING &&
            state.adoptionPhase !== ADOPTION_IGNORED) {
        advanceWindowAdoption(window, "pending-geometry-changed");
        return;
    }
    const detectedMode = detectQuickTileMode(window);
    if (state.layoutMode === NORMAL_MODE) {
        if (isTileMode(detectedMode)) rememberRestore(window, state, oldGeometry);
        return;
    }

    /*
     * Plasma edit mode changes panel struts and KWin silently reapplies native
     * Quick Tile geometry without tileChanged/quickTileModeChanged. Correct
     * only that recognizable native-size reset; this is not a general geometry
     * enforcement path and interactive move/resize is excluded above.
     */
    if (isTileMode(state.layoutMode) && state.layoutMode === detectedMode &&
            onManagedOutput(window) && window.tile &&
            sameSizeNear(window.frameGeometry, window.tile.absoluteGeometryInScreen)) {
        const profile = profileForOutput(window.output);
        const expected = rectForLayout(
            state.layoutMode,
            safeRectFor(window.output),
            profile.inner
        );
        if (!sameRect(window.frameGeometry, expected)) {
            applyLayoutGeometry(window, state, state.layoutMode, "native-tile-geometry-reset");
        }
    }
}

function applyDetectedTile(window, signalName) {
    const state = stateFor(window);
    if (state.internalChange || state.interactiveMoveResize || window.fullScreen) return;
    const mode = detectQuickTileMode(window);
    const profile = profileForOutput(window.output);
    if (!profile) {
        if (isTileMode(mode)) {
            setLayoutMode(state, mode);
            debug(`NATIVE ${window.caption} mode=${mode} output=${window.output.name}`);
        } else if (mode === NORMAL_MODE && isTileMode(state.layoutMode)) {
            clearLayoutState(state);
        }
        return;
    }
    if (isTileMode(mode)) {
        applyLayoutGeometry(window, state, mode, signalName);
        return;
    }
    if (mode === NORMAL_MODE && isTileMode(state.layoutMode)) {
        if (state.pendingAction === "enterMaximize") return;
        const restore = rectCopy(state.restoreGeometry);
        state.internalChange = true;
        try {
            if (restore) window.frameGeometry = restore;
            clearLayoutState(state);
        } finally {
            state.internalChange = false;
        }
        debug(`RESTORE ${window.caption} reason=${signalName}-untile` +
            ` geometry=${rectText(window.frameGeometry)}`);
        advanceWindowAdoption(window, `${signalName}-untile`);
    }
}

function onMaximizedAboutToChange(window, mode) {
    const state = stateFor(window);
    if (state.internalChange || state.interactiveMoveResize || window.fullScreen) return;
    const onTarget = onManagedOutput(window);
    const managedColumn = columnIndexForWindow(window) >= 0 &&
        window.output === mainScreenState.targetOutput;
    if (Number(mode) === FULL_MAXIMIZE_MODE) {
        if (!managedColumn && state.layoutMode === NORMAL_MODE) {
            rememberRestore(window, state, window.frameGeometry);
        }
        if (onTarget && state.layoutMode === MAXIMIZE_MODE) {
            state.pendingAction = "leaveMaximize";
        } else {
            state.pendingAction = onTarget ? "enterMaximize" : "nativeMaximize";
        }
    } else if (!onTarget && state.layoutMode === MAXIMIZE_MODE) {
        state.pendingAction = "nativeRestore";
    }
}

function onMaximizedChanged(window) {
    const state = stateFor(window);
    if (state.internalChange || !state.pendingAction) return;
    const action = state.pendingAction;
    state.pendingAction = null;
    const managedColumn = columnIndexForWindow(window) >= 0 &&
        window.output === mainScreenState.targetOutput;
    if (managedColumn && action === "enterMaximize") {
        setPresentationMode(
            normalizeWindowUuid(window.internalId),
            PRESENTATION_MAXIMIZED,
            "native-maximize"
        );
        return;
    }
    if (managedColumn && action === "leaveMaximize") {
        const column = mainScreenState.columns[columnIndexForWindow(window)];
        setPresentationMode(
            normalizeWindowUuid(window.internalId),
            column && column.persistentWide
                ? PRESENTATION_WIDE
                : PRESENTATION_NORMAL,
            "native-restore"
        );
        return;
    }
    if (action === "enterMaximize") {
        applyLayoutGeometry(window, state, MAXIMIZE_MODE, "maximize-request");
    } else if (action === "leaveMaximize") {
        leavePseudoMaximize(window, state, "maximize-toggle");
    } else if (action === "nativeMaximize") {
        setLayoutMode(state, MAXIMIZE_MODE);
        debug(`NATIVE ${window.caption} mode=maximize output=${window.output.name}`);
    } else if (action === "nativeRestore") {
        clearLayoutState(state);
    }
    advanceWindowAdoption(window, `maximize-${action}`);
}

function onOutputChanged(window) {
    const state = stateFor(window);
    if (state.internalChange || state.interactiveMoveResize || window.fullScreen) return;
    const primary = resolveTargetOutput();
    if (columnIndexForWindow(window) >= 0 && window.output !== primary) {
        if (mainScreenState.presentation.windowUuid ===
                normalizeWindowUuid(window.internalId)) clearPresentationState();
        removeColumn(window, "output-left-primary", false);
        setAdoptionPhase(window, state, ADOPTION_WAITING_PRIMARY,
            "output-left-primary");
        debug(`[cc-scroll] LEAVE_PRIMARY caption=${window.caption}` +
            ` output=${window.output ? window.output.name : "<none>"}`);
        return;
    }
    if (window.output !== primary &&
            state.adoptionPhase !== ADOPTION_UNTRACKED &&
            state.adoptionPhase !== ADOPTION_FLOATING &&
            state.adoptionPhase !== ADOPTION_IGNORED) {
        setAdoptionPhase(window, state, ADOPTION_WAITING_PRIMARY,
            "output-wait-primary");
    }
    const profile = profileForOutput(window.output);
    translateRestoreGeometry(state, window.output);
    if (profile) {
        if (Number(window.maximizeMode) === FULL_MAXIMIZE_MODE ||
                state.layoutMode === MAXIMIZE_MODE) {
            applyLayoutGeometry(window, state, MAXIMIZE_MODE, "output-adopt-maximize");
        } else if (isTileMode(detectQuickTileMode(window))) {
            applyDetectedTile(window, "output-adopt-tile");
        } else if (window.output === primary) {
            if (state.adoptionPhase === ADOPTION_UNTRACKED) {
                beginWindowAdoption(window, "output-entered-primary");
            } else {
                advanceWindowAdoption(window, "output-entered-primary");
            }
        }
        return;
    }
    if (state.layoutMode === MAXIMIZE_MODE &&
            Number(window.maximizeMode) !== FULL_MAXIMIZE_MODE) {
        state.internalChange = true;
        try {
            window.setMaximize(true, true);
        } finally {
            state.internalChange = false;
        }
        debug(`NATIVE-TRANSFER ${window.caption} mode=maximize output=${window.output.name}` +
            ` geometry=${rectText(window.frameGeometry)}`);
        return;
    }
    const tileMode = detectQuickTileMode(window);
    if (isTileMode(tileMode)) {
        setLayoutMode(state, tileMode);
        debug(`NATIVE-TRANSFER ${window.caption} mode=${tileMode}` +
            ` output=${window.output.name} geometry=${rectText(window.frameGeometry)}`);
        return;
    }
}

function onFullScreenChanged(window) {
    const state = stateFor(window);
    if (state.internalChange) return;
    if (window.fullScreen) {
        state.layoutModeBeforeFullscreen = state.layoutMode;
        debug(`FULLSCREEN enter ${window.caption} prior=${state.layoutMode}`);
        return;
    }
    const prior = state.layoutModeBeforeFullscreen;
    state.layoutModeBeforeFullscreen = NORMAL_MODE;
    if (columnIndexForWindow(window) >= 0) {
        relayout("fullscreen-exit");
    } else if (onManagedOutput(window) && isLayoutMode(prior)) {
        applyLayoutGeometry(window, state, prior, "fullscreen-exit");
    } else {
        advanceWindowAdoption(window, "fullscreen-exit");
    }
}

function onInteractiveMoveResizeStarted(window) {
    const state = stateFor(window);
    if (columnIndexForWindow(window) >= 0) {
        state.interactiveMoveResize = true;
        detachColumnToFloating(window, "interactive-move-resize");
        return;
    }
    if (state.internalChange || !isLayoutMode(state.layoutMode)) return;
    state.interactiveMoveResize = true;
    clearLayoutState(state);
    debug(`CLEAR ${window.caption} reason=interactive-move-resize`);
}

function setupWindow(window) {
    if (!window || states.has(window)) return;
    const state = stateFor(window);
    window.frameGeometryChanged.connect(oldGeometry =>
        onFrameGeometryChanged(window, oldGeometry));
    window.tileChanged.connect(() => applyDetectedTile(window, "tileChanged"));
    window.quickTileModeChanged.connect(() => applyDetectedTile(window, "quickTileModeChanged"));
    window.maximizedAboutToChange.connect(mode => onMaximizedAboutToChange(window, mode));
    window.maximizedChanged.connect(() => onMaximizedChanged(window));
    window.outputChanged.connect(() => onOutputChanged(window));
    window.fullScreenChanged.connect(() => onFullScreenChanged(window));
    window.activeChanged.connect(() => {
        if (window.active && layoutTransactionDepth === 0) {
            advanceWindowAdoption(window, "active-changed");
        }
    });
    window.readyForPaintingChanged.connect(() => {
        advanceWindowAdoption(window, "ready-for-painting");
    });
    if (window.windowShown) {
        window.windowShown.connect(() => {
            advanceWindowAdoption(window, "window-shown");
        });
    }
    window.interactiveMoveResizeStarted.connect(() => onInteractiveMoveResizeStarted(window));
    window.interactiveMoveResizeFinished.connect(() => {
        stateFor(window).interactiveMoveResize = false;
    });
    window.closed.connect(() => {
        removeColumn(window, "window-closed");
        states.delete(window);
    });

    if (window.fullScreen) return;
    if (Number(window.maximizeMode) === FULL_MAXIMIZE_MODE) {
        setLayoutMode(state, MAXIMIZE_MODE);
        if (onManagedOutput(window)) {
            applyLayoutGeometry(window, state, MAXIMIZE_MODE, "startup-adopt-maximize");
        }
        return;
    }
    const tileMode = detectQuickTileMode(window);
    if (isTileMode(tileMode)) {
        setLayoutMode(state, tileMode);
        if (onManagedOutput(window)) {
            applyLayoutGeometry(window, state, tileMode, "startup-adopt-tile");
        }
    }
}

function reapplyManagedLayouts(reason) {
    states.forEach((state, window) => {
        if (!state.internalChange && !state.interactiveMoveResize && !window.fullScreen &&
                !state.managedByScrollLayout && onManagedOutput(window) &&
                isLayoutMode(state.layoutMode)) {
            applyLayoutGeometry(window, state, state.layoutMode, reason);
        }
    });
}

function connectManagedGeometry() {
    managedOutputs().forEach(output => {
        if (connectedManagedOutputs.has(output)) return;
        connectedManagedOutputs.add(output);
        output.geometryChanged.connect(() => {
            if (profileForOutput(output)) {
                reapplyManagedLayouts("managed-output-geometry-changed");
                relayout("managed-output-geometry-changed");
            }
        });
    });
}

function onScreensChanged() {
    connectedManagedOutputs = new Set();
    connectManagedGeometry();
    reapplyManagedLayouts("screens-changed");
    relayout("screens-changed");
}

loadConfig();
workspace.windowList().forEach(setupWindow);
workspace.windowAdded.connect(window => {
    setupWindow(window);
    beginWindowAdoption(window, "window-added");
});
workspace.windowActivated.connect(onWindowActivatedForScrollLayout);
workspace.screensChanged.connect(onScreensChanged);
workspace.virtualScreenGeometryChanged.connect(() => {
    reapplyManagedLayouts("virtual-screen-geometry-changed");
    relayout("virtual-screen-geometry-changed");
});
if (workspace.screenOrderChanged) workspace.screenOrderChanged.connect(onScreensChanged);
connectManagedGeometry();
initializeScrollLayout();
scrollLayoutInitialized = true;

registerShortcut(
    "CCScrollFocusPreviousColumn",
    "CC Scroll: Focus Previous Column",
    "Meta+H",
    () => focusRelativeColumn(-1)
);

registerShortcut(
    "CCScrollFocusNextColumn",
    "CC Scroll: Focus Next Column",
    "Meta+L",
    () => focusRelativeColumn(1)
);

registerShortcut(
    "CCScrollToggleFocusWide",
    "CC Scroll: Toggle Focus Wide",
    "Meta+Z",
    () => toggleFocusWide(workspace.activeWindow)
);

registerShortcut(
    "CCScrollMoveColumnLeft",
    "CC Scroll: Move Column Left",
    "Meta+Shift+H",
    () => moveFocusedColumn(-1)
);

registerShortcut(
    "CCScrollMoveColumnRight",
    "CC Scroll: Move Column Right",
    "Meta+Shift+L",
    () => moveFocusedColumn(1)
);

registerShortcut(
    "CCScrollToggleFloating",
    "CC Scroll: Toggle Floating",
    "Meta+Shift+Enter",
    () => toggleFloating(workspace.activeWindow)
);

registerShortcut(
    "CCScrollPublishDockState",
    "CC Scroll: Publish Dock State",
    "",
    () => publishDockState("bridge-request")
);

registerShortcut(
    "CCScrollApplyDockCommand",
    "CC Scroll: Apply Dock Command",
    "Meta+Ctrl+Alt+Shift+F11",
    applyPendingDockCommand
);

registerShortcut(
    "CCScrollEmergencyRestore",
    "CC Scroll: Emergency Restore Parked Windows",
    "Meta+Ctrl+Alt+Shift+F12",
    () => emergencyRestoreAllWindows("external-unload")
);

commitDockState("script-start");

debug(`loaded primary=${resolveTargetOutput() ? resolveTargetOutput().name : "<none>"}` +
    ` secondary=${resolveSecondaryOutput() ? resolveSecondaryOutput().name : "<none>"}` +
    ` primaryOuter=${gapTop}/${gapRight}/${gapBottom}/${gapLeft}` +
    ` secondaryOuter=${secondaryGapTop}/${secondaryGapRight}/${secondaryGapBottom}/${secondaryGapLeft}`);
