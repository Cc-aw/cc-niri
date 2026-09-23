"use strict";

class GeometryCommitter {
    constructor(dependencies) {
        this.stateFor = dependencies.stateFor;
        this.sameRect = dependencies.sameRect;
        this.sameRectNear = dependencies.sameRectNear || dependencies.sameRect;
        this.rectCopy = dependencies.rectCopy;
        this.rectText = dependencies.rectText;
        this.isTileMode = dependencies.isTileMode;
        this.isRectInsideAnyOutput = dependencies.isRectInsideAnyOutput;
        this.debug = dependencies.debug;
        this.warn = dependencies.warn;
        this.setWindowVisibility = dependencies.setWindowVisibility;
        this.isWindowHidden = dependencies.isWindowHidden;
        this.rememberVisibleGeometry = dependencies.rememberVisibleGeometry;
    }

    commitGeometry(column, target, reason) {
        const window = column.window;
        const windowState = this.stateFor(window);
        if (windowState.floating || window.fullScreen ||
                this.isTileMode(windowState.layoutMode)) {
            return;
        }
        if (this.sameRect(window.frameGeometry, target)) return;
        windowState.internalChange = true;
        try {
            window.frameGeometry = target;
        } finally {
            windowState.internalChange = false;
        }
        this.debug(`[cc-scroll] LAYOUT reason=${reason} column=${column.id}` +
            ` physicalX=${target.x} width=${target.width}` +
            ` actual=${this.rectText(window.frameGeometry)}`);
    }

    commit(plan) {
        const transaction = plan.scrollTransaction;
        const wideExitTarget = plan.wideExitColumn
            ? plan.windows.find(item => item.column === plan.wideExitColumn)
            : null;
        const heldIncoming = [];
        if (plan.viewportMotion) {
            const motion = plan.viewportMotion;
            this.debug(`[MOTION_TX] BEGIN epoch=${plan.epoch}` +
                ` type=${motion.type} target=${motion.targetColumnId}` +
                ` neighbor=${motion.neighborColumnId} side=${motion.side}` +
                ` neighborVisualStart=${this.rectText(motion.neighbor.oldVisualRect)}` +
                ` neighborVisualEnd=${this.rectText(motion.neighbor.newVisualRect)}`);
        }
        if (transaction) {
            this.debug(`[MOTION_TX] BEGIN id=${transaction.id}` +
                ` epoch=${transaction.epoch} type=${transaction.type}` +
                ` direction=${transaction.direction} delta=${transaction.deltaX}` +
                ` viewport=${this.rectText(transaction.viewport)}`);
        }
        plan.commitOrder.forEach(item => {
            const column = item.column;
            if (wideExitTarget && item.placement === "visible" &&
                    column !== plan.wideExitColumn &&
                    !this.sameRectNear(
                        plan.wideExitColumn.window.frameGeometry,
                        wideExitTarget.rect)) {
                heldIncoming.push(column);
                this.debug(`[MOTION_TX] HOLD_WIDE_EXIT_NEIGHBOR` +
                    ` column=${column.id} target=${plan.wideExitColumn.id}`);
                return;
            }
            if (transaction && item.transitionRole !== "static") {
                this.debug(`[MOTION_TX] ROLE id=${transaction.id}` +
                    ` column=${column.id} role=${item.transitionRole}`);
            }
            if (item.placement === "parked" &&
                    this.isRectInsideAnyOutput(item.rect)) {
                this.warn(`[cc-scroll] invalid parking rect column=${column.id}` +
                    ` rect=${this.rectText(item.rect)}`);
            }
            if (item.placement === "parked" &&
                    !this.isWindowHidden(column.window) &&
                    this.isRectInsideAnyOutput(column.window.frameGeometry)) {
                this.rememberVisibleGeometry(
                    column.window,
                    this.rectCopy(column.window.frameGeometry)
                );
            }
            if (item.placement === "visible" &&
                    this.isWindowHidden(column.window)) {
                this.commitGeometry(column, item.rect, plan.reason);
                this.setWindowVisibility(column.window, true);
            } else {
                if (item.placement === "visible") {
                    this.setWindowVisibility(column.window, true);
                }
                this.commitGeometry(column, item.rect, plan.reason);
            }
            if (item.placement === "parked") {
                this.setWindowVisibility(column.window, false);
            }
            else {
                this.rememberVisibleGeometry(column.window, this.rectCopy(item.rect));
            }

            const outputName = column.window.output
                ? column.window.output.name
                : "<none>";
            if (item.placement === "visible") {
                this.debug(`[cc-scroll] PROJECT column=${column.id}` +
                    ` logicalX=${column.logicalX}` +
                    ` oldProjectedX=${item.oldProjectedRect
                        ? item.oldProjectedRect.x : "<none>"}` +
                    ` projectedX=${item.newProjectedRect.x}` +
                    ` kind=visible output=${outputName}`);
            } else {
                this.debug(`[cc-scroll] PARK column=${column.id}` +
                    ` logicalX=${column.logicalX}` +
                    ` oldProjectedX=${item.oldProjectedRect
                        ? item.oldProjectedRect.x : "<none>"}` +
                    ` projectedX=${item.newProjectedRect.x}` +
                    ` parkingX=${item.rect.x} output=${outputName}`);
            }
        });
        if (transaction) {
            this.debug(`[MOTION_TX] COMPLETE id=${transaction.id}`);
        }
        return { heldIncoming };
    }
}

/* cjs:start */
module.exports = { GeometryCommitter };
/* cjs:end */
