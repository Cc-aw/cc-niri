# CC Niri Phase 15：Wide Column 模型重构与 Partial Viewport 设计

> 项目：`Cc-aw/cc-niri`  
> 基线：`3.0.0-alpha.38` / `883f778`  
> 当前能力：模块化状态架构、MotionTransaction、Full-Delta Scroll、Native Viewport Clip 已完成。  
> 本阶段目标：将当前 `Wide = Presentation Override` 重构为 `Wide = Column 固定宽度属性`，使 Wide 成为 scrolling strip 的一部分，而不是临时展示模式。  
> 核心交互目标：实现类似 `1(72%) | 2(50%)`，当焦点从 Wide 1 移到 2 时，1 只保留部分可见区域，2 完整显示，从而获得更接近 niri 的连续 strip 感。  
> 原则：**Wide 是布局属性，不是 Presentation 状态；Viewport 决定看到多少，而不是通过 park/unpark 模拟 Wide。**

---

# 1. 为什么要改

当前 Wide 模型：

```text
Normal:
1(50) | 2(50)

Meta+Z
   ↓

Presentation = WIDE
   ↓

1 实际 resize 到 72%
   ↓

等待 geometry ACK
   ↓

邻居 park
   ↓

Wide paint animation
```

为实现这一行为，目前需要：

```text
PresentationController
WideTransition
```

以及：

```text
scrolling
awaiting-step
settled
expanding
animating
```

等多个状态。

这导致：

- H/L 对 Wide 有特殊分支；
- Dock 点击 Wide 要等待额外 deferred transition；
- geometry ACK 和 scroll timing 互相耦合；
- neighbor parking 成为 Wide 正确性的一部分；
- 动画被拆成“先 scroll，再 expand”两阶段；
- Wide 与普通 Column 布局模型割裂。

---

# 2. 新模型的核心思想

将 Wide 从：

```text
Presentation Mode
```

迁移为：

```text
Column Width Mode
```

也就是：

```text
Column
├── half = 50%
└── wide = 72%
```

Wide Column 永久存在于逻辑 strip 中。

例如：

```text
1(72%) | 2(50%) | 3(50%) | 4(72%)
```

Viewport 只决定：

```text
当前看到 strip 的哪一段
```

而不是：

```text
Wide 时隐藏所有邻居
```

---

# 3. 数值验证

当前主屏：

```text
safeRect.width = 2512
innerGap = 8
```

普通 half：

```text
(2512 - 8) / 2
= 1252
```

Wide：

```text
2512 * 0.72
≈ 1809
```

Wide + Normal 总宽：

```text
1809 + 8 + 1252
= 3069
```

Viewport：

```text
2512
```

溢出：

```text
3069 - 2512
= 557
```

当从 Wide 1 切到 Normal 2，为了让 2 完整可见：

```text
scrollOffset:
0 → 557
```

此时 Wide 1 剩余可见宽度：

```text
1809 - 557
= 1252
```

刚好又是一个 half Column 宽度。

最终画面自然形成：

```text
1(partial 1252) | 2(full 1252)
```

这正是本阶段想要的核心效果。

---

# 4. 最终视觉模型

## 4.1 Focus Wide 1

```text
┌─────────────────────────────┐
│            1 72%            │
└─────────────────────────────┘
```

右侧 2 第一版继续保持 parked。

## 4.2 Focus Normal 2，左侧是 Wide 1

```text
┌──────────────┐ 8px ┌──────────────┐
│ 1 partial    │ gap │      2       │
│ 1252 px      │     │   1252 px    │
└──────────────┘     └──────────────┘
```

这是本阶段最重要的 steady state。

## 4.3 普通 Normal Pair

```text
1(50) | 2(50)
```

保持现状。

---

# 5. 最关键的架构变化

当前：

```text
Presentation
├── NORMAL
├── WIDE
└── MAXIMIZED
```

目标：

```text
Presentation
├── NORMAL
└── MAXIMIZED
```

而 Wide 迁移到：

```text
Column.widthMode
```

也就是：

```text
Presentation ≠ Width
```

---

# 6. Column 数据结构

当前：

```js
{
    id,
    window,
    widthMode,
    persistentWide,
    logicalX,
    pixelWidth
}
```

目标：

```js
{
    id,
    window,
    widthMode: "half" | "wide",
    logicalX,
    pixelWidth
}
```

删除：

```text
persistentWide
```

因为：

```text
widthMode === "wide"
```

已经完整表达 Wide 状态。

---

# 7. Width Token

建议新增统一常量：

```js
const COLUMN_WIDTH_HALF = "half";
const COLUMN_WIDTH_WIDE = "wide";
const WIDE_RATIO = 0.72;
```

第一阶段只保留：

```text
50%
72%
```

不新增 1/3、2/3、80% 等其它 preset。

---

# 8. ColumnLayout 修改

当前：

```js
computeColumnWidth(mode, safeWidth, innerGap)
```

新增：

```js
if (mode === COLUMN_WIDTH_WIDE) {
    return Math.max(1, Math.round(safeWidth * WIDE_RATIO));
}
```

Wide ratio 定义的是 Column 自身宽度。

Gap 仍由 strip layout 单独插入。

---

# 9. deriveColumnLayout 不需要 Wide 特殊状态

继续：

```text
logicalX += pixelWidth + innerGap
```

例如：

```text
1 wide:
logicalX = 0
pixelWidth = 1809

2 half:
logicalX = 1817
pixelWidth = 1252
```

这就是标准 variable-width strip。

---

# 10. PresentationController 重构

`PresentationController` 应逐步移除 Wide 责任。

最终只处理：

```text
NORMAL
MAXIMIZED
```

应删除/迁移：

```text
wideRatio
wideRect()
mode === WIDE
selectPersistent Wide
```

---

# 11. WideTransition 的未来

当前：

```text
src/kwin/presentation/WideTransition.js
```

主要用于：

```text
scroll
→ pair settle
→ 72% request
→ geometry ACK
→ park neighbors
→ finalize
```

新模型下这些逻辑不再需要。

---

# 12. 可删除的 WideTransition 状态

目标最终删除：

```text
WIDE_REVEAL_PHASE_SCROLLING
WIDE_REVEAL_PHASE_AWAITING_STEP
WIDE_REVEAL_PHASE_SETTLED
WIDE_REVEAL_PHASE_EXPANDING
WIDE_REVEAL_PHASE_ANIMATING
```

以及大部分：

```text
geometryAttempts
pairHold
transitionToken
deferredSequence
pendingTransition
```

---

# 13. WideTransition 不要一次性删除

迁移顺序必须是：

```text
先让 widthMode=wide 正常工作
↓
再让 Meta+Z 走 widthMode
↓
再让 H/L 不再依赖 WideTransition
↓
再让 Dock 不再依赖 WideTransition
↓
最后删除 WideTransition
```

不能反过来。

---

# 14. Meta+Z 新行为

当前：

```text
Meta+Z
→ setPresentationMode(WIDE)
```

目标：

```text
Meta+Z
→ toggle focused column widthMode
```

例如：

```js
column.widthMode =
    column.widthMode === COLUMN_WIDTH_WIDE
        ? COLUMN_WIDTH_HALF
        : COLUMN_WIDTH_WIDE;
```

然后：

```text
recomputeLogicalLayout
ensureFocusedVisible
relayout
```

---

# 15. Meta+Z 不再切 Presentation

Wide toggle 不应该修改：

```text
appState.presentation.mode
presentation.windowUuid
```

它只修改：

```text
Column.widthMode
```

---

# 16. H/L 新行为

当前 `focusRelativeColumn()` 有：

```text
wideTransition.beginStepIfPending(...)
```

新模型最终应回归普通逻辑：

```text
target = previous / next
focus target

recompute layout
ensure target fully visible

relayout
activate target
```

没有：

```text
wideStep
awaitingWide
deferredWide
```

特殊路径。

---

# 17. Wide 1 → Normal 2 示例

初始：

```text
offset = 0

1:
logicalX = 0
width = 1809

2:
logicalX = 1817
width = 1252
```

Focus 2 后：

```text
columnRight = 3069
viewportWidth = 2512
```

需要：

```text
offset = 3069 - 2512
       = 557
```

所以：

```text
old offset = 0
new offset = 557
delta = 557
```

Motion：

```text
Translation:
+557 → 0
```

最终：

```text
1 partial | 2 full
```

不需要 WideTransition。

---

# 18. Normal 2 → Wide 1 示例

当前：

```text
offset = 557
```

focus 1：

```text
1.logicalX = 0
```

为了完整显示 1：

```text
offset = 0
```

Motion：

```text
-557 → 0
```

最终：

```text
1 wide full
```

---

# 19. Partial Window 是这次真正的新能力

当前 LayoutEngine：

```js
isRectFullyVisible(...)
    ? "visible"
    : "parked"
```

也就是：

```text
partial = parked
```

新模型必须修改。

---

# 20. Placement Model 升级

推荐：

```text
VISIBLE_FULL
VISIBLE_PARTIAL_LEFT
VISIBLE_PARTIAL_RIGHT
PARKED
```

第一版实际只开放：

```text
VISIBLE_FULL
VISIBLE_PARTIAL_LEFT
PARKED
```

`VISIBLE_PARTIAL_RIGHT` 先保留枚举但不作为 steady-state 策略。

---

# 21. 为什么要区分 Partial Left / Right

当前显示器排列：

```text
DP-1 | HDMI-A-1
```

左侧 partial：

```text
超出的是虚拟桌面左边
```

通常不会进入副屏。

右侧 partial：

```text
可能真实进入 HDMI-A-1
```

存在：

- output ownership；
- invisible input；
- focus；
- pointer hit testing；

风险。

---

# 22. Phase 15 第一版只支持 Partial Left

明确限制：

```text
允许：
Wide predecessor partial-left

暂不允许：
right-side steady partial window
```

也就是：

```text
1 wide partial | 2 full
```

允许。

但：

```text
1 wide full | 2 partial-right
```

第一版不要作为 steady state。

---

# 23. Native Viewport Clip 只解决画面，不自动解决 input

现有 Native Clip 能保证：

```text
超出 viewport 的 pixel 不显示到副屏
```

但它不会自动改变：

```text
Window input region
Window output ownership
Pointer hit testing
```

因此不能简单认为：

```text
“画面裁掉了” = “窗口完全安全”
```

---

# 24. 第一版 Partial Policy

建议新增：

```js
function classifyPlacement(rect, safeRect)
```

规则：

```text
完全可见
→ VISIBLE_FULL

左边越界，但与 viewport 有交集
→ VISIBLE_PARTIAL_LEFT

右边越界
→ PARKED

完全无交集
→ PARKED
```

---

# 25. Partial Left 的 geometry 路线

先验证真实 geometry 是否允许：

```text
x < virtualScreenLeft
```

例如：

```text
x = -533
width = 1809
```

若 KWin 不发生异常 clamp、不发生错误 outputChanged、无 input 异常，则可以保留真实 partial geometry。

如果 KWin 会 clamp 或产生副作用，则立即改成：

```text
safe real geometry
+
paint-only partial representation
```

不要继续堆 geometry workaround。

---

# 26. Stop Condition：不要再次堆 geometry workaround

如果 Partial Left 需要：

```text
magic offset
special clamp
fake resize
复杂 parking inheritance
```

立即停止真实 partial geometry 方案。

改成 paint-only partial representation。

---

# 27. Wide Toggle 动画不能直接复用 ScrollTransaction

Width Change 时：

```text
scrollOffset 可能不变
```

但是：

```text
Column width
logicalX
```

变化。

例如：

```text
1 half → wide
```

会导致：

```text
1:
width 1252 → 1809

2:
x 1284 → 1841
```

这不是普通 Scroll。

---

# 28. 新增 LayoutSnapshot

当前 scroll transaction 主要依赖：

```text
oldScrollOffset
newScrollOffset
```

Width Change 需要：

```text
old layout
new layout
```

建议新增：

```js
LayoutSnapshot
```

---

# 29. LayoutSnapshot 数据结构

建议：

```js
{
    scrollOffsetX,

    columns: [
        {
            id,
            logicalX,
            pixelWidth
        }
    ]
}
```

---

# 30. Width Toggle Snapshot 示例

Before：

```text
1 half:
x=0
w=1252

2 half:
x=1260
w=1252
```

After：

```text
1 wide:
x=0
w=1809

2 half:
x=1817
w=1252
```

Motion layer 就能得到：

```text
oldRect → newRect
```

---

# 31. 新 MotionType

建议新增：

```js
MotionType.COLUMN_RESIZE
```

比 `WIDTH_CHANGE` 更明确表达这是一次布局重排动画。

---

# 32. Wide Toggle 动画设计

## 32.1 1: half → wide

Window 1：

```text
real width:
1252 → 1809
```

视觉：

```text
ScaleX:
1252 / 1809
→ 1
```

Anchor：

```text
LEFT
```

Window 2：

```text
old x=1284
new x=1841
```

视觉：

```text
Translation:
1284 - 1841
= -557
→ 0
```

结果：

```text
1 从左固定向右扩展
2 同步被向右推开
```

---

# 33. Wide → Half 动画

完全对称。

Window 1 以 left anchor 收缩。

Window 2：

```text
Translation:
+557 → 0
```

效果：

```text
1 收缩
2 顺滑回到右侧 slot
```

---

# 34. 为什么这种动画更自然

当前：

```text
1 centered grow
2 park/disappear
```

新模型：

```text
1 resize
2 spatially shift
```

视觉上更像：

```text
整条 strip 重新排布
```

而不是：

```text
一个窗口进入 Presentation Mode
```

---

# 35. MotionTransaction 的演进

当前 MotionTransaction 主要是：

```text
continuing
incoming
outgoing
```

Width change 需要表达：

```text
resized
shifted
```

长期推荐演进为统一 `entries`：

```js
{
    id,
    type,
    viewport,

    entries: [
        {
            windowId,
            role,
            oldRect,
            newRect
        }
    ]
}
```

Role：

```text
continuing
incoming
outgoing
resized
shifted
```

---

# 36. 本阶段不要同时重写整个 MotionTransaction

为了控制风险：

```text
保留 scroll transaction 现状
+
新增 column resize transaction
```

先把 Wide-as-Width 做正确。

后续再统一 transaction schema。

---

# 37. Dock 行为

当前 Dock 中 Wide 是 Presentation command。

新模型需要迁移。

---

# 38. Dock Presentation 菜单

当前：

```text
Normal
Focus Wide
Maximize in Safe Area
```

内部目标语义：

```text
Normal
→ widthMode=half

Wide
→ widthMode=wide

Maximize
→ presentation=maximized
```

UI 文案可以暂时不变，但协议语义必须拆开。

---

# 39. Dock protocol

长期停止使用：

```text
set-presentation-mode
mode=wide
```

建议新增：

```text
set-column-width-mode
```

payload：

```js
{
    type: "set-column-width-mode",
    windowUuid,
    widthMode: "half" | "wide"
}
```

---

# 40. 协议迁移策略

不要一次删除旧：

```text
set-presentation-mode wide
```

先让新 Dock UI 发送：

```text
set-column-width-mode
```

KWin 暂时兼容旧 Wide command，将其内部转换成 width toggle。

稳定一版后再删除旧兼容。

---

# 41. Maximize 行为

Safe Maximize 仍然保留 Presentation。

如果当前 Column：

```text
widthMode = wide
```

进入 maximize：

```text
Presentation = MAXIMIZED
```

恢复后：

```text
仍然回到 widthMode = wide
```

这会比当前 Presentation Wide / Maximize 嵌套关系更自然。

---

# 42. Fullscreen

Fullscreen 不改变：

```text
widthMode
```

退出 F11：

```text
恢复原 strip width
```

---

# 43. Floating

Wide Column detach 为 Floating 时，推荐保留用户宽度偏好。

Detach：

```text
state.preferredColumnWidthMode = column.widthMode
```

Attach：

```text
insertWindow(
    window,
    index,
    state.preferredColumnWidthMode || "half"
)
```

这样：

```text
wide
→ floating
→ reattach
```

仍然恢复 wide。

---

# 44. Column Close

关闭 Wide Column：

```text
strip 重新计算
```

右侧 Column 自然左移。

这应该成为普通：

```text
CLOSE_REFILL
```

不再有 Wide 特殊处理。

---

# 45. Reorder

Wide Column reorder 后 `logicalX` 会因为宽度差异发生更大变化。

`ReorderController` 不需要理解 Wide。

它只：

```text
ColumnStore reorder
↓
derive layout
↓
relayout
```

Motion 后续按 old/new rect 处理。

---

# 46. ensureColumnVisible 基本可保留

当前逻辑：

```text
columnLeft < offset
→ align left

columnRight > viewportRight
→ shift enough to expose right edge
```

这恰好适合新 Wide 模型。

因此：

```text
scrollOffsetToRevealColumn()
```

大部分可以保留。

---

# 47. 但“target fully visible”和“neighbor partial”必须分开

Focus target：

```text
必须 fully visible
```

邻居：

```text
可以 partial-left
```

不能继续让 `placement visible` 和 `focus reveal requirement` 共享一个布尔判定。

---

# 48. Projection API 建议

新增：

```js
function viewportIntersection(rect, viewport)
```

返回：

```js
{
    intersects,
    clippedRect,
    overflowLeft,
    overflowRight,
    overflowTop,
    overflowBottom
}
```

这样 Partial 逻辑更清晰。

---

# 49. LayoutEngine 新 Placement 规则

第一版：

```text
if fully visible
    VISIBLE_FULL

else if intersects && overflowLeft > 0 && overflowRight === 0
    VISIBLE_PARTIAL_LEFT

else
    PARKED
```

明确只支持 left partial。

---

# 50. GeometryCommitter 行为

当前：

```text
visible → set visibility true
parked → set visibility false
```

未来：

```text
VISIBLE_FULL
VISIBLE_PARTIAL_LEFT
→ visible=true

PARKED
→ visible=false
```

Partial Window 不能被 minimized。

---

# 51. Native Viewport Clip 与 steady partial

现有 native clip 主要绑定 motion transaction。

如果 steady-state Partial Left 使用真实越界 geometry，需要先验证是否还需要 persistent clip marker。

若需要，可以复用 role `1001`，增加 owner：

```js
{
    enabled: true,
    owner: "layout",
    viewport...
}
```

Motion 使用：

```text
owner = motion
```

Layout partial 使用：

```text
owner = layout
```

但不要在未验证前增加长期 clip 状态。

---

# 52. Input 是真正的 Stop Condition

只要 Partial Window 出现：

```text
副屏 invisible click region
错误 pointer hit
错误 outputChanged
```

就不要扩展 steady partial-right。

Phase 15 第一版只做：

```text
partial-left
```

---

# 53. Phase 15 实施顺序

## Phase 15.0：冻结 alpha.38

基线：

```text
883f778
```

打 tag：

```bash
git tag cc-niri-alpha38-full-delta-baseline
```

运行：

```bash
node tools/check.js
node tools/check.js --native
```

人工验证当前 full-delta baseline。

---

## Phase 15.1：增加 COLUMN_WIDTH_WIDE

只改：

```text
ColumnLayout
ColumnStore compatibility
tests
```

不改 Meta+Z。

目标：

```text
Layout Engine 已经能正确排 72% Column
```

---

## Phase 15.2：LayoutSnapshot

为 width change 增加：

```text
old/new layout snapshot
```

先不做精细动画。

确保：

```text
half ↔ wide
```

layout correctness。

---

## Phase 15.3：Meta+Z 改走 widthMode

将：

```text
toggleFocusWide()
```

改成：

```text
toggleFocusedColumnWidth()
```

暂时可以无精细动画。

先确认功能正确。

---

## Phase 15.4：Partial Left Placement

升级：

```text
visible / parked
```

为：

```text
full / partial-left / parked
```

只实现：

```text
Wide predecessor partial-left
```

---

## Phase 15.5：H/L 删除 Wide 特殊导航

删除：

```text
beginStepIfPending
wideStepDirection
```

让 Wide Column 完全参与普通：

```text
ensureColumnVisible
```

---

## Phase 15.6：Dock 迁移

新增：

```text
set-column-width-mode
```

Dock Wide 不再发送 Presentation Wide。

---

## Phase 15.7：Column Resize Motion

新增：

```text
MotionType.COLUMN_RESIZE
```

实现：

```text
Wide target scale-from-left
neighbor translation
```

---

## Phase 15.8：删除 WideTransition

只有前面全部稳定后，删除：

```text
WideTransition.js
Wide deferred commands
Wide timer
Wide geometry retry
Wide phases
```

---

## Phase 15.9：Presentation 简化

Presentation 最终：

```text
NORMAL
MAXIMIZED
```

清理：

```text
PRESENTATION_WIDE
```

---

# 54. 测试计划

新增：

```text
test/column-wide-layout.test.js
test/partial-placement.test.js
test/column-resize-motion.test.js
test/wide-width-navigation.test.js
test/wide-width-dock.test.js
```

---

# 55. Wide Layout Test

输入：

```text
safe=2512
gap=8

1 wide
2 half
```

要求：

```text
1 width=1809
2 logicalX=1817
stripWidth=3069
```

---

# 56. Focus 2 Test

初始：

```text
offset=0
```

Focus 2：

```text
offset=557
```

最终：

```text
1 visible width=1252
2 fully visible
```

---

# 57. Focus 1 Test

初始：

```text
offset=557
```

Focus 1：

```text
offset=0
```

要求：

```text
1 fully visible
```

---

# 58. Partial Left Test

Wide 1 projected：

```text
x=-533
w=1809
```

要求：

```text
placement=VISIBLE_PARTIAL_LEFT
```

而不是：

```text
PARKED
```

---

# 59. Partial Right Test

例如：

```text
x=1841
w=1252
right > safeRect.right
```

第一版要求：

```text
PARKED
```

避免 steady right overflow。

---

# 60. Meta+Z Test

```text
half → wide
```

要求：

```text
presentation.mode 不变化
column.widthMode 变化
```

---

# 61. Maximize Restore Test

Wide Column：

```text
wide
→ safe maximize
→ restore
```

要求：

```text
仍是 wide
```

---

# 62. Floating Reattach Test

```text
wide
→ floating
→ attach
```

要求：

```text
wide 恢复
```

---

# 63. Dock Test

Dock 设置 Wide：

```text
widthMode=wide
```

不能：

```text
presentation.mode=wide
```

---

# 64. Motion Test

Half → Wide：

```text
1 resized
2 shifted
```

要求：

```text
1 visual left edge continuity
2 visual x continuity
```

---

# 65. 快速切换测试

执行：

```text
Z
80 ms
Z
100 ms
Z
```

要求：

```text
无 snap
```

如果第一版无法安全 retarget resize，可短期在 width toggle 动画期间抑制重复 Z，但只能作为临时 safety guard。

---

# 66. H/L + Z 交错

测试：

```text
Z
L
H
Z
```

要求：

```text
无 Wide FSM
无 stale token
无 deferred command
```

---

# 67. Dock Long Jump

存在：

```text
1 wide
2 half
3 half
4 wide
```

Dock 点击不同 Column：

```text
viewport 正常滚动
```

不能触发旧 Wide deferred path。

---

# 68. Logging

新增：

```text
[cc-width]
[cc-partial]
[cc-resize-motion]
```

示例：

```text
[cc-width] column=1 half->wide
[cc-partial] column=1 placement=partial-left visible=1252
[cc-resize-motion] column=1 old=1252 new=1809
```

---

# 69. 删除计划

最终 Phase 15 完成后可以删除：

```text
persistentWide
PRESENTATION_WIDE
WideTransition.js
Wide deferred Bridge commands
WIDE_* phase constants
WIDE_PAIR_HOLD_MS
WIDE_GEOMETRY_RETRY_MS
WIDE_GEOMETRY_MAX_ATTEMPTS
wideStepDirection
beginStepIfPending
```

---

# 70. 不要过早删除的内容

保留直到 migration 完成：

```text
旧 Dock mode=wide compatibility
旧 test fixtures
WideTransition fallback
```

最后单独清理 commit。

---

# 71. 推荐 Commit 顺序

```text
chore: freeze alpha38 full-delta baseline

feat: add wide column width mode
test: cover variable column widths

refactor: add layout snapshots for width changes
test: cover half-wide layout transitions

feat: make Meta+Z toggle column width
test: decouple wide width from presentation state

feat: support partial-left viewport placement
test: keep wide predecessor partially visible

refactor: route H/L through normal variable-width scrolling
test: remove wide-specific navigation behavior

feat: add column width dock command
test: move dock wide action to width mode

feat: animate column width changes
test: preserve resize and neighbor motion continuity

refactor: remove deferred wide transition state machine
test: remove stale wide command paths

refactor: simplify presentation to normal and maximize
docs: document variable-width strip model
```

---

# 72. 禁止巨型 Commit

禁止一个 commit 同时：

```text
删除 WideTransition
改 LayoutEngine
改 Dock
改 Motion
```

必须逐层迁移。

---

# 73. 最终目标架构

Phase 15 完成后：

```text
Column Width
├── HALF 50%
└── WIDE 72%

Logical Strip
│
├── 1(72)
├── 2(50)
├── 3(50)
└── 4(72)

        ↓

Viewport
        ↓

Partial / Full Placement
        ↓

Native Clip
```

Presentation：

```text
NORMAL
MAXIMIZED
```

---

# 74. 最终 H/L 模型

H/L 永远只做：

```text
focus neighbor
↓
ensure target fully visible
↓
calculate viewport offset
↓
relayout
↓
full-delta motion
```

不再关心：

```text
这个 Column 是不是 Wide
```

因为：

```text
Wide 只是 width
```

---

# 75. 最终 Meta+Z 模型

Meta+Z：

```text
toggle width
↓
derive strip
↓
reveal focused Column
↓
animate layout reflow
```

没有：

```text
Presentation Wide
geometry ACK FSM
neighbor park phase
```

---

# 76. 设计原则总结

本阶段最重要的原则：

> **不要再把 Wide 当“模式”，把它当“尺寸”。**

最终：

```text
Wide
不是：
Presentation Override

而是：
Column Geometry Property
```

这会带来：

```text
更简单的状态机
更自然的导航
更连续的动画
更稳定的 Dock 行为
更接近 niri 的 scrolling strip
```

---

# 77. Phase 15 完成标准

必须同时满足：

```text
1. Wide = widthMode，不再是 Presentation

2. 1(72) → 2(50) 可以形成：
   1(partial) | 2(full)

3. H/L 无 Wide 特殊 FSM

4. Dock Wide 改成 Column Width command

5. Maximize Restore 保留原 widthMode

6. Floating Reattach 保留 widthMode

7. WideTransition 删除

8. PRESENTATION_WIDE 删除

9. Partial-left 不造成 outputChanged

10. Partial-left 不产生错误 input

11. Full-delta motion 无回归

12. Native viewport clip 无回归

13. tools/check.js PASS

14. tools/check.js --native PASS

15. GitHub Regression PASS
```

---

# 78. 最终用户体验

用户看到的不是：

```text
“这个窗口进入 Wide 模式”
```

而是：

```text
“这个 Column 本来就比较宽”
```

导航时：

```text
Wide 1
   ⇄
Wide 1 partial | Normal 2
```

所有变化都来自：

```text
strip geometry
+
viewport movement
```

而不是：

```text
特殊 Presentation 状态机
```

这将是 CC Niri 从“模拟 niri 行为”进一步迈向“真正 variable-width scrolling layout”的关键一步。
