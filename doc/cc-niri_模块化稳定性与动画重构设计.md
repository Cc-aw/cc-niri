# CC Niri 模块化与稳定性重构设计文档

> 项目：`Cc-aw/cc-niri`  
> 目标：在保持当前日常可用功能和交互语义的前提下，将项目重构为**稳定、动画流畅、模块边界清晰、便于长期维护**的 KWin scrolling window layer。  
> 基线：当前主分支已经具备 Scrollable Columns、Safe Area、Focus Wide、Floating、Dock 双向同步、动画 Effect、Bridge、状态机和回归测试。  
> 重构原则：**先保稳定，再拆模块；先保证行为不变，再优化动画；不为了“像 niri”而增加不必要复杂度。**

---

# 1. 重构背景

当前项目已经从早期 POC 演进为一个完整的窗口管理扩展系统，主要包含：

- KWin Script：
  - 主屏滚动列
  - Safe Area
  - pseudo maximize
  - Quick Tile
  - Focus Wide
  - Floating
  - 窗口 adoption
  - Output / Fullscreen 生命周期
  - Dock 同步
  - Dock stepwise scroll
  - 稳定性 transaction / invariant
- KWin Effect：
  - scrolling transition
  - animation retarget
  - Focus Wide paint-only animation
- D-Bus Bridge：
  - KWin 与 Dock 的命令和状态传递
- Plasma Task Manager Fork：
  - UUID 同步
  - Column 顺序同步
  - Presentation 控制
- 测试：
  - geometry
  - adoption
  - transaction
  - parking
  - motion retarget
  - Dock sync
  - Wide transition

当前最主要的问题已经不是“功能不足”，而是：

> **控制逻辑已经集中到少数大文件中，状态机之间的耦合越来越高。**

尤其：

```text
package/contents/code/main.js
≈ 2700 行
≈ 100 KB
```

该文件同时承担配置、窗口状态、Column 模型、布局计算、geometry commit、Dock IPC、Presentation、Wide、Floating、Adoption、跨屏、Fullscreen、Quick Tile 等大量职责。

继续在这个结构上增加功能，会提高以下风险：

- 修动画影响窗口状态；
- 修 Floating 影响 Adoption；
- Dock 操作影响 Presentation；
- geometryChanged 反馈再次触发状态机；
- 新功能继续增加全局变量和 cross-state 条件；
- 源码测试越来越依赖字符串匹配，重构成本持续增加。

因此下一阶段不应继续堆功能，而应进行一次**行为保持型架构重构**。

---

# 2. 重构目标

## 2.1 第一目标：稳定性

重构后必须确保：

- 一个状态只有一个明确 Owner；
- Column geometry 仍只有一个 authoritative writer；
- 动画不能决定真实布局状态；
- KWin signal 不能直接修改多个子系统；
- Adoption / Floating / Presentation 等状态机互不越权；
- 任何异常路径都可以恢复窗口；
- 不依赖固定动画时间保证正确性；
- 不引入高频 polling。

---

## 2.2 第二目标：模块化

将现在的单文件控制器拆成职责明确的模块：

```text
Event
  ↓
Controller / State Machine
  ↓
State
  ↓
Layout Engine
  ↓
Layout Plan
  ↓
Geometry Committer
  ↓
KWin Window

                          ↓
                     Motion Effect
                  仅负责视觉动画
```

模块之间应通过明确接口协作，而不是互相直接修改内部字段。

---

## 2.3 第三目标：动画流畅

保留目前已经正确的：

- paint-only animation；
- translation / scale / opacity；
- current visual state sampling；
- animation retarget；
- Motion epoch。

在此基础上逐步实现：

- 普通滚动以 Translation 为主；
- 减弱卡片式 Scale / Fade；
- Retarget 不发生位置跳变；
- 连续输入缩短剩余动画时间；
- 最终用明确 Motion Transaction 代替 geometry heuristic。

---

## 2.4 第四目标：长期可维护

最终希望做到：

```text
新功能
  ↓
新增 Controller / State
  ↓
Layout Engine 消费 State
  ↓
不需要修改 10 个无关模块
```

而不是：

```text
新功能
  ↓
main.js 再加几十个 if
```

---

# 3. 不在本轮重构范围内

本轮重构**不新增以下功能**：

- Tabbed Column；
- 一个 Column 内多个 Window；
- Overview；
- 跨重启 Column 状态恢复；
- 跨重启 Focus Wide / Floating 状态恢复；
- 副屏 scrolling layout；
- 副屏与 Dock 双向排序；
- 复杂 touchpad scrolling；
- Managed Window 鼠标拖拽排序；
- variable / per-column width UI；
- Rust 重写整个 KWin Script。

原则：

> **本轮只重构已有能力，不扩大产品范围。**

---

# 4. 当前必须保留的核心设计

以下机制属于当前项目已经建立起来的正确基础，重构时禁止推翻。

---

## 4.1 `relayout()` 仍为 managed Column 唯一 geometry writer

任何模块均不得直接绕过布局系统修改受管 Column 的：

```js
window.frameGeometry
```

允许直接写 geometry 的场景应严格限定为：

- GeometryCommitter；
- 非 Column safe-area Quick Tile / Maximize；
- Emergency Restore；
- 必要的 KWin ownership transfer。

---

## 4.2 Layout Transaction

必须保留：

```text
beginLayoutTransaction()
endLayoutTransaction()
layoutEpoch
layoutTransactionDepth
```

并继续保证：

- nested layout 属于一个 epoch；
- exception 不会让 transaction depth 卡死；
- transaction 结束后统一运行 invariant audit；
- signal feedback 在 active transaction 内被抑制或延迟。

---

## 4.3 Invariant Audit

至少保留检查：

```text
duplicate-window
duplicate-uuid
logical-x
invalid-width
state-ownership
wrong-output
focus-index
scroll-offset
missing-presentation
presentation-focus
```

重构后应将其升级为独立 `InvariantChecker`。

---

## 4.4 Adoption State Machine

保留以下状态：

```text
UNTRACKED
WAITING_ACTIVATION
WAITING_PRIMARY
WAITING_ELIGIBLE
WAITING_NORMAL
ADOPTING
SETTLING
MANAGED
FLOATING
IGNORED
```

禁止重新退化成：

```text
setTimeout(...)
然后猜窗口是否 ready
```

---

## 4.5 Motion Retarget

必须保留：

```text
sample current visual state
        ↓
geometry commit
        ↓
retarget translation
        ↓
continue from current painted position
```

连续：

```text
L → L → H → L
```

不能产生明显 snap。

---

# 5. 总体架构

建议将源码结构整理为：

```text
cc-niri/
├── src/
│   ├── kwin/
│   │   ├── entry.js
│   │   │
│   │   ├── core/
│   │   │   ├── AppState.js
│   │   │   ├── Constants.js
│   │   │   ├── Config.js
│   │   │   └── Logger.js
│   │   │
│   │   ├── model/
│   │   │   ├── ColumnStore.js
│   │   │   └── WindowStateStore.js
│   │   │
│   │   ├── layout/
│   │   │   ├── Geometry.js
│   │   │   ├── SafeArea.js
│   │   │   ├── ColumnLayout.js
│   │   │   ├── Projection.js
│   │   │   ├── Parking.js
│   │   │   ├── LayoutEngine.js
│   │   │   └── GeometryCommitter.js
│   │   │
│   │   ├── lifecycle/
│   │   │   ├── AdoptionController.js
│   │   │   ├── FloatingController.js
│   │   │   ├── OutputController.js
│   │   │   └── FullscreenController.js
│   │   │
│   │   ├── presentation/
│   │   │   ├── PresentationController.js
│   │   │   └── WideTransition.js
│   │   │
│   │   ├── navigation/
│   │   │   ├── FocusController.js
│   │   │   ├── ReorderController.js
│   │   │   └── DockScrollController.js
│   │   │
│   │   ├── integration/
│   │   │   ├── DockGateway.js
│   │   │   ├── KWinSignals.js
│   │   │   └── Shortcuts.js
│   │   │
│   │   └── stability/
│   │       ├── LayoutTransaction.js
│   │       ├── InvariantChecker.js
│   │       └── Recovery.js
│   │
│   └── effect/
│       ├── entry.js
│       ├── MotionController.js
│       ├── MotionTokens.js
│       ├── MotionSampler.js
│       ├── MotionClassifier.js
│       └── MotionTransaction.js
│
├── package/
│   └── contents/code/main.js
│
├── effect/
│   └── contents/code/main.js
│
├── bridge/
├── plasmoid/
├── docs/
├── experiments/
├── test/
└── tools/
    └── build.js
```

其中：

```text
src/
```

是开发源码。

KWin 最终仍加载：

```text
package/contents/code/main.js
effect/contents/code/main.js
```

由构建脚本生成。

---

# 6. State Ownership

这是本次重构最重要的规则。

## 6.1 状态所有权表

| 状态 | 唯一 Owner |
|---|---|
| Column 顺序 | `ColumnStore` |
| focusedColumn | `ColumnStore` |
| Column widthMode | `ColumnStore` |
| scrollOffsetX | `ColumnLayout / ViewportState` |
| Window adoptionPhase | `AdoptionController` |
| floating | `FloatingController` |
| Presentation mode | `PresentationController` |
| persistentWide | `PresentationController` |
| pending Wide transition | `WideTransition` |
| pending Dock scroll | `DockScrollController` |
| real Column geometry | `GeometryCommitter` |
| parking ownership | `ParkingManager` |
| layout epoch | `LayoutTransaction` |
| Dock session / generation | `DockGateway` |
| visual animation state | `MotionController` |

---

## 6.2 禁止跨模块直接写内部状态

例如禁止：

```js
mainScreenState.focusedColumnIndex = ...
```

散落在：

```text
DockScroll
Floating
Adoption
Presentation
Output
```

中。

统一改成：

```js
columnStore.focus(columnId)
```

同理：

```js
presentationController.enterWide(columnId)
floatingController.detach(window)
adoptionController.retry(window)
dockScrollController.start(columnId)
```

---

# 7. 核心数据结构

## 7.1 AppState

只保存组合状态，不包含业务算法。

```js
class AppState {
    columns
    windows
    viewport
    presentation
}
```

---

## 7.2 Column

建议：

```js
{
    id,
    window,
    widthMode,
    persistentWide
}
```

禁止长期缓存：

```text
logicalX
pixelWidth
projectedRect
```

这类值应尽量由 Layout Engine 派生。

---

## 7.3 WindowState

建议分清：

```js
{
    adoptionPhase,
    layoutMode,
    floating,

    internalChange,
    interactiveMoveResize,

    restoreGeometry,
    restoreOutput,

    parkingOwned,
    parkingMinimized,
    originalOpacity,

    lastVisibleGeometry
}
```

不要同时存在多个表达相同语义的 flag。

---

# 8. Layout Engine 重构

当前 `relayoutImpl()` 同时：

- 算逻辑位置；
- 算 projected rect；
- 判断 visible；
- 算 parking；
- 排 transaction 顺序；
- 写 geometry；
- 写 opacity / minimized。

重构后必须拆成：

```text
State
  ↓
LayoutEngine.compute()
  ↓
LayoutPlan
  ↓
GeometryCommitter.commit()
```

---

## 8.1 LayoutPlan

建议：

```js
{
    reason,
    epoch,
    scrollTransaction,

    windows: [
        {
            columnId,
            window,
            placement: "visible" | "parked",
            rect,
            projectedRect,
            oldProjectedRect,
            transitionRole:
                "continuing" |
                "incoming" |
                "outgoing" |
                "static"
        }
    ]
}
```

Layout Engine：

> **只计算，不写 KWin 对象。**

---

## 8.2 GeometryCommitter

唯一职责：

```text
LayoutPlan
  ↓
按稳定顺序 commit
  ↓
window.frameGeometry
visibility
minimized
parking ownership
```

建议顺序仍保持：

```text
continuing visible
        ↓
incoming
        ↓
outgoing
        ↓
parked static
```

这样 Motion Effect 依旧能够得到稳定事件顺序。

---

# 9. Parking 重构

Parking 现在是稳定性关键部分，应独立。

建议：

```text
ParkingManager

park(window, rect)
restore(window)
emergencyRestore(window)
owns(window)
```

必须满足：

- parking rect 不与任何 output 相交；
- parking 不允许转移 window output；
- 只有自己设置的 minimized 才能恢复；
- 只有自己修改的 opacity 才能恢复；
- Emergency Restore 不依赖 Column model 完整；
- uninstall / script disable 前先恢复所有 owned windows。

---

# 10. Adoption Controller

将以下逻辑全部移入：

```text
lifecycle/AdoptionController.js
```

包括：

```text
adoptionWaitPhase
advanceWindowAdoption
beginWindowAdoption
settleAdoptedWindow
```

外部只通过：

```js
adoption.onWindowAdded(window)
adoption.onActivated(window)
adoption.onReady(window)
adoption.onGeometryChanged(window)
adoption.onOutputChanged(window)
adoption.onFullscreenChanged(window)
```

Adoption 不得直接负责：

- Dock publish；
- Animation；
- Wide；
- Presentation。

它只决定：

```text
这个 Window 当前是否应该成为 Column
```

---

# 11. Floating Controller

独立负责：

```text
Column → Floating
Floating → Column
```

保留现有语义：

- `Meta+Shift+Enter` toggle；
- interactive move / resize 自动 detach；
- detach 时不把窗口留在 parking geometry；
- reattach 插入当前 focus Column 右侧；
- 临时 remember last detached window；
- 不允许 secondary focus 导致 detached target 丢失。

禁止 Floating Controller 自己写最终 Column geometry。

流程：

```text
detach
  ↓
ColumnStore remove
  ↓
Parking release
  ↓
Layout request
```

---

# 12. Presentation / Focus Wide

将以下状态集中：

```text
Normal
Wide
Maximized
persistentWide
```

建议：

```text
PresentationController
        │
        └── WideTransition
```

---

## 12.1 WideTransition

保留当前重要行为：

```text
50% pair
   ↓
请求 72% real geometry
   ↓
等待 geometry ACK
   ↓
隐藏 neighbor
   ↓
paint-only animation
```

不能变成：

```text
固定 sleep 220 ms
↓
默认 geometry 已经成功
```

---

## 12.2 Timing 分类

必须将：

```text
Correctness Timing
```

和：

```text
Visual Timing
```

分开。

例如：

```js
CorrectnessTiming = {
    geometryRetryMs: 50,
    geometryMaxAttempts: 20
}
```

而动画：

```js
MotionTokens = {
    scrollMs: 220,
    dockStepMs: 140,
    wideMs: 240,
    closeRefillMs: 200,
    microMs: 100
}
```

视觉时间不参与状态正确性判断。

---

# 13. Navigation Controller

拆为：

```text
FocusController
ReorderController
DockScrollController
```

---

## 13.1 FocusController

负责：

```text
Meta+H
Meta+L
```

流程必须保持：

```text
选择目标 Column
        ↓
计算 scrollOffset
        ↓
relayout
        ↓
真实 geometry 已提交
        ↓
workspace.activeWindow = target
```

禁止先 focus parked window。

---

## 13.2 ReorderController

负责：

```text
Meta+Shift+H
Meta+Shift+L
Dock reorder
```

所有 reorder 最终都调用：

```js
columnStore.move(...)
```

然后：

```text
layout request
Dock publish
```

---

## 13.3 DockScrollController

保留现有 stepwise scroll：

```text
1|2
 ↓
2|3
 ↓
3|4
 ↓
4|5
```

但其状态不再存为全局变量：

```js
pendingDockScroll
```

而是 Controller 内部状态。

以后允许替换为更高级 Motion Transaction，而不影响其他模块。

---

# 14. Dock Gateway

将 KWin Script 中所有：

```text
sessionId
generation
PublishState
TakePendingCommand
schema validation
command dispatch
```

移动到：

```text
integration/DockGateway.js
```

外部只使用：

```js
dock.publish(snapshot)
dock.commit(reason)
dock.reject(command, reason)
```

业务层不得直接：

```js
callDBus(...)
```

---

# 15. Bridge 策略

Bridge 当前职责已经比较单一，本轮不进行大规模拆分。

保留：

```text
PublishState
GetState
RequestCommand
RequestDeferredCommand
TakePendingCommand
RequestEmergencyRestore
```

继续保留：

- queue bound；
- recent command ID 去重；
- session reset；
- generation check；
- emergency restore 优先级。

Bridge 不增加业务判断。

原则：

> Bridge 是 transport，不是 window manager。

---

# 16. Dock / Plasma Task Manager 重构

当前 `CC Scroll Tasks` 基于 KDE Task Manager fork。

后续重点不是重写 KDE Task Manager，而是减少 fork contamination。

建议新增：

```text
plasmoid/com.cc.scrolltasks/qml/CCScroll/
├── DockBridge.qml
├── DockStateController.qml
├── DockOrderController.qml
└── PresentationController.qml
```

`main.qml` 只保留薄接入：

```text
TaskModel
   ↕
CCScroll Controller
   ↕
D-Bus
```

优先抽离：

- normalize UUID；
- Dock state parse；
- generation；
- reorder request；
- presentation request；
- focus request。

目标：

> KDE upstream 文件越接近原版越好。

---

# 17. Effect 重构

当前 MotionController 已经是正确基础。

建议拆为：

```text
effect/
├── MotionTokens.js
├── MotionSampler.js
├── MotionController.js
├── MotionClassifier.js
└── MotionTransaction.js
```

---

# 18. Motion Tokens

统一所有动画参数。

建议初始：

```js
const MotionTokens = {
    microPressMs: 90,
    microHoverMs: 110,

    scrollMs: 220,
    scrollFastMs: 180,

    dockStepMs: 140,

    reorderMs: 220,
    closeRefillMs: 200,

    wideEnterMs: 240,
    wideExitMs: 220
};
```

禁止各模块自行写：

```js
220
180
140
240
```

---

# 19. 普通滚动动画策略

普通 H/L：

```text
Translation 为主
Scale = 1
Opacity = 1
```

只有 parking → visible 缺乏真实空间起点时才允许轻微辅助：

```text
Scale:
0.985 → 1.0

Opacity:
0.85 → 1.0
```

不建议继续使用：

```text
Scale 0.94
Opacity 0.20
```

作为普通滚动默认效果。

原因：

- 太像 launcher / card；
- 弱化空间连续性；
- 多窗口同时动画时视觉较躁；
- 不符合 scrolling WM 的视觉语言。

---

# 20. Wide 动画策略

Wide 可以保留：

```text
Scale
+
Translation
```

因为这是：

```text
50% → 72%
```

真实尺寸变化。

动画必须继续是：

```text
paint-only
```

不能使用会与真实 geometry ownership 冲突的 Position / Size effect。

---

# 21. Motion Transaction

这是动画重构的第二阶段目标。

当前：

```text
pendingDeltaX
```

建议最终升级为：

```js
{
    id,
    layoutEpoch,
    type,
    deltaX,

    continuing: [],
    incoming: [],
    outgoing: []
}
```

示例：

```text
MotionTransaction #52

type:
SCROLL

deltaX:
1260

continuing:
[B]

incoming:
[C]

outgoing:
[A]
```

Effect 不再主要依赖：

```text
oldSlot / newSlot / parked
```

去猜 transaction。

Geometry heuristic 只作为 fallback。

---

# 22. Retarget 优化

目前 Retarget 已经保证：

```text
position continuity
```

下一阶段优化：

```text
remaining distance
       ↓
new duration
```

例如：

```text
剩余 100%
→ 220 ms

剩余 50%
→ 160 ms

剩余 20%
→ 110 ms
```

这样连续：

```text
L → L
```

不会产生“第二次重新开始 220 ms”的拖沓感。

暂时不要求 spring。

等 transaction 与测试稳定后，再考虑：

```text
critically damped spring
```

---

# 23. 测试重构

当前测试中存在大量：

```js
read main.js
mainSource.includes(...)
mainSource.slice(...)
```

以及测试文件复制生产算法的问题。

这些测试适合早期验证，但不适合长期模块化开发。

---

## 23.1 新测试结构

建议：

```text
test/
├── unit/
│   ├── geometry.test.js
│   ├── safe-area.test.js
│   ├── column-layout.test.js
│   ├── projection.test.js
│   ├── parking.test.js
│   ├── adoption.test.js
│   ├── presentation.test.js
│   ├── motion-sampler.test.js
│   └── motion-retarget.test.js
│
├── state/
│   ├── lifecycle-sequences.test.js
│   ├── output-transitions.test.js
│   ├── floating-sequences.test.js
│   └── presentation-sequences.test.js
│
├── integration/
│   ├── dock-protocol.test.js
│   ├── bridge-schema.test.js
│   └── generated-package.test.js
│
└── manual/
    └── ACCEPTANCE.md
```

---

## 23.2 测试生产函数

应该：

```js
const {
    computeLayout
} = require("../../src/kwin/layout/LayoutEngine")
```

而不是测试里复制：

```js
function computeLayout(...) { ... }
```

---

# 24. State Machine Sequence Test

必须加入完整事件序列测试。

例如：

```text
Add A
Activate A

Add B
Activate B

Add C
Activate C

Focus Left
Focus Right

Enter Wide
Exit Wide

Detach Floating
Reattach

Close B

Move A Secondary
Return A Primary

Fullscreen C
Exit Fullscreen
```

每一步执行：

```text
assertInvariants()
```

---

# 25. 随机状态机测试

后续建议增加简单 fuzz。

随机生成：

```text
focus-left
focus-right
wide
floating
close
add
output-change
fullscreen
restore
reorder
dock-focus
```

执行：

```text
1,000 ~ 10,000 events
```

每个 event 后检查：

```text
Column 不重复
UUID 不重复
focus 合法
scrollOffset 合法
Presentation target 合法
Parking ownership 合法
Output ownership 合法
```

这类测试对窗口管理器稳定性价值非常高。

---

# 26. CI

新增：

```text
.github/workflows/ci.yml
```

每次 push / PR 执行：

```text
JS syntax
    ↓
Unit tests
    ↓
State machine tests
    ↓
Motion tests
    ↓
Bridge build
    ↓
Bundle
    ↓
Generated package consistency
```

建议：

```bash
node --check
node --test

cmake -S bridge -B build/bridge
cmake --build build/bridge

npm run build
git diff --exit-code
```

---

# 27. 文档结构整理

当前：

```text
docx/
poc/
```

建议改成：

```text
docs/
experiments/
```

---

## 27.1 docs

建议长期只维护：

```text
docs/
├── ARCHITECTURE.md
├── STATE_MACHINES.md
├── MOTION.md
├── DOCK_PROTOCOL.md
├── TESTING.md
└── COMPATIBILITY.md
```

---

## 27.2 experiments

历史 POC：

```text
experiments/
```

并新增：

```text
experiments/README.md
```

说明：

```text
ACTIVE
REFERENCE
OBSOLETE
```

避免历史 POC 被误认为 production code。

---

# 28. 重构实施阶段

整个过程禁止一次性大 rewrite。

推荐按照以下阶段。

---

# Phase 0：冻结 baseline

目标：

> 建立一个可随时回退的稳定点。

任务：

1. 当前可用版本打 tag；
2. 当前所有测试全部 PASS；
3. Bridge build PASS；
4. 保存人工验收矩阵；
5. 记录当前操作视频或关键现象；
6. 不新增功能。

验收：

```text
Meta+H/L
Dock click
Dock reorder
Wide
Maximize
Floating
Fullscreen
Quick Tile
Cross-output
Close refill
Emergency Restore
```

全部保持当前行为。

---

# Phase 1：抽纯函数模块

优先抽：

```text
Geometry
SafeArea
Column width
Projection
Parking geometry
```

这些模块：

- 不访问 workspace；
- 不访问 callDBus；
- 不修改 KWin window；
- 输入 → 输出纯函数。

这是风险最低的一阶段。

---

# Phase 2：ColumnStore + StateStore

抽：

```text
ColumnStore
WindowStateStore
```

要求：

- Column 顺序统一由 ColumnStore 修改；
- focus 统一由 ColumnStore 修改；
- 所有查找 API 统一；
- 禁止业务代码直接 splice `columns[]`。

---

# Phase 3：LayoutPlan

重构：

```text
relayoutImpl
```

变成：

```text
LayoutEngine.compute()
GeometryCommitter.commit()
```

要求：

- LayoutEngine 纯计算；
- commit 顺序保持不变；
- animation observable geometry sequence 不变。

这是第一阶段最关键 checkpoint。

---

# Phase 4：Stability 模块

抽：

```text
LayoutTransaction
InvariantChecker
Recovery
ParkingManager
```

要求：

- 所有 transaction path 都有 finally；
- Emergency Restore 独立工作；
- invariant 覆盖不下降。

---

# Phase 5：Lifecycle

依次拆：

```text
AdoptionController
FloatingController
OutputController
FullscreenController
```

一次只拆一个。

每拆一个：

```text
测试
→ commit
→ runtime 验证
```

禁止一次拆四个。

---

# Phase 6：Presentation

拆：

```text
PresentationController
WideTransition
```

必须保持：

```text
Wide discrete navigation
72%
geometry acknowledgement
neighbor parking timing
```

完全一致。

---

# Phase 7：Dock Integration

拆：

```text
DockGateway
DockScrollController
ReorderController
```

Bridge 暂不重构。

---

# Phase 8：Effect 模块化

拆：

```text
MotionTokens
MotionSampler
MotionController
MotionClassifier
```

这一阶段仍不改变视觉效果。

只要求：

> **行为完全一致。**

---

# Phase 9：动画优化

模块稳定之后才修改视觉。

依次进行：

1. 普通 Scroll 去除强 Scale；
2. Fade 从 0.2 提升到 0.85 左右；
3. Reduce unnecessary animation；
4. distance-aware duration；
5. Motion Transaction；
6. 最后再评估 spring。

每项单独 commit。

---

# Phase 10：Dock Fork 清理

将 CC 逻辑从 KDE upstream QML 中抽离。

优先：

```text
State
Bridge
Order
Presentation
```

最后再处理 appearance。

---

# 29. 推荐 Commit 顺序

建议使用：

```text
chore: freeze refactor baseline

refactor: extract geometry helpers
refactor: extract safe area calculation
refactor: introduce column store
refactor: introduce window state store

refactor: split layout planning from geometry commit
test: cover production layout engine

refactor: extract layout transactions
refactor: extract invariant checker
refactor: extract parking ownership

refactor: isolate window adoption controller
refactor: isolate floating lifecycle
refactor: isolate output lifecycle

refactor: isolate presentation state
refactor: isolate wide transition controller

refactor: isolate dock gateway
refactor: isolate dock scroll controller
refactor: isolate reorder controller

refactor: modularize motion controller

ci: add automated regression workflow

style: simplify scroll motion
perf: add distance-aware motion duration
refactor: add explicit motion transactions
```

不要用：

```text
refactor: rewrite cc-niri
```

这种巨型 commit。

---

# 30. Codex 执行规则

Codex 在整个重构过程中必须遵守：

## Rule 1

禁止修改当前用户可见功能语义，除非当前 Phase 明确要求。

---

## Rule 2

禁止一次性重写 `main.js`。

必须渐进抽离。

---

## Rule 3

每个 Phase 必须：

```text
修改
↓
运行测试
↓
检查 diff
↓
再进入下一 Phase
```

---

## Rule 4

禁止同时重构：

```text
Adoption
+
Wide
+
Floating
```

这三个状态机耦合风险很高。

---

## Rule 5

禁止增加：

```text
sleep
busy wait
poll loop
```

作为正确性方案。

---

## Rule 6

禁止把 Animation 状态当 Layout truth。

真实状态永远来源于：

```text
App State
+
KWin real geometry
```

---

## Rule 7

不要删除当前 stability guard，除非有等价或更强机制替代并有测试证明。

---

## Rule 8

每个模块必须有明确 public API。

不允许：

```text
模块 A 直接访问模块 B 内部 object
```

---

# 31. 性能原则

该项目不是高吞吐后端程序，性能重点不是算法微优化，而是：

- 减少重复 signal work；
- 减少重复 geometry write；
- 减少不必要 relayout；
- 减少重复 Dock publish；
- 不 polling；
- 避免无意义 animation；
- 避免反复 hide/show 同一个窗口。

任何：

```js
if (sameRect(...)) return
```

这类 guard 应保留。

---

# 32. Logging

统一日志类别：

```text
[layout]
[lifecycle]
[adoption]
[floating]
[presentation]
[dock]
[motion]
[stability]
[recovery]
```

Debug disabled 时：

- 不构造大量复杂字符串；
- 不打印逐 frame 信息；
- 不打印正常重复 signal。

异常必须保留：

```text
INVARIANT
RECOVERY
TIMEOUT
SCHEMA REJECT
QUEUE FULL
```

---

# 33. 最终入口目标

最终：

```js
const app = new CCNiri({
    workspace,
    config: loadConfig()
});

app.start();
```

`entry.js` 只负责：

```text
construct
wire
start
stop
```

不再包含业务算法。

---

# 34. 最终依赖方向

必须保持单向：

```text
KWinSignals
     │
     ▼
Controllers
     │
     ▼
State Store
     │
     ▼
Layout Engine
     │
     ▼
Layout Plan
     │
     ▼
Geometry Committer
     │
     ▼
KWin
```

并行：

```text
State
  │
  ├── Dock Snapshot
  │
  └── Motion Intent
```

禁止出现：

```text
Effect → 修改 AppState
Dock QML → 修改 Layout
GeometryChanged → 随意调用多个 Controller
```

---

# 35. 最终验收标准

## 稳定性

连续使用：

```text
8 小时
```

不出现：

- 窗口丢失；
- 窗口永久停在屏幕外；
- 窗口透明无法恢复；
- Column 重复；
- Dock 顺序长期失步；
- Wide 卡在错误 geometry；
- Floating 无法 reattach；
- KWin scripting exception；
- signal storm。

---

## 动画

快速执行：

```text
L L L H H L
```

要求：

- 无瞬移；
- 无明显 snap；
- 无窗口跨副屏闪现；
- 无突然从 Dock 图标位置冒出；
- 连续 motion 能平滑 retarget。

---

## 模块化

目标：

```text
entry.js < 300 行
```

单个 Controller 尽量：

```text
< 500 行
```

不是硬限制，但超过后应重新审视职责。

---

## 测试

至少覆盖：

```text
Geometry
Layout
Parking
Adoption
Floating
Presentation
Wide
Dock
Motion
Output
Fullscreen
Recovery
```

并且主要测试：

> **production modules，而不是测试中复制的算法。**

---

# 36. 本轮重构完成后再考虑的功能

当以上架构稳定后，再评估：

```text
Overview
Tabbed Column
session persistence
更高级 spring
更短路径 Dock scrolling
更多窗口动画
```

在这之前：

> 不建议继续扩张功能范围。

---

# 37. 最终原则

CC Niri 的目标不应该是：

> 完整复制 niri。

而应该是：

> **在 KDE / KWin 上构建一个稳定、轻量、动画精致、每天敢用的 scrolling-window layer。**

当前项目已经有：

```text
single geometry writer
layout transaction
invariant audit
adoption FSM
parking ownership
Dock generation protocol
retargetable Motion
```

这些都是很好的地基。

本次重构的真正目标不是“重写”，而是：

```text
把已经正确的机制
        ↓
变成明确的模块
        ↓
限制状态写权限
        ↓
建立稳定的数据流
        ↓
让未来增加功能不再破坏已有功能
```

优先级始终保持：

```text
稳定
 >
状态边界
 >
模块化
 >
测试
 >
动画质量
 >
新功能
```

这将作为后续所有 CC Niri 开发的长期架构基线。
