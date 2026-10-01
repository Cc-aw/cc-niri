# `cc-niri-maximize` V3：Scrollable Columns 实现规格

> 交给 Codex 直接实现。
>
> 目标：在当前已经可工作的 `cc-niri-maximize V2`（Safe Area + Quick Tile + innerGap + 双屏 + Fullscreen）基础上，为**主屏**增加类似 niri 的横向滚动列式工作区。
>
> 不是完整复刻 niri，也不是重写 KWin。副屏继续保持 KDE 原生行为，用于 SSH/Terminal。

---

## 1. 当前已有基础

V2 已经实现：

```text
主屏：
- Safe Area
- outer gaps
- innerGap
- pseudo maximize
- Quick Tile Left / Right / corners
- Fullscreen bypass
- outputChanged 跨屏适配

副屏：
- KDE 原生 maximize
- KDE 原生 Quick Tile
- SSH / Terminal
```

当前默认参数继续复用：

```text
gapTop    = 42
gapBottom = 64
gapLeft   = 10
gapRight  = 10
innerGap  = 8
```

V3 不允许新建另一套 Safe Area 计算。

---

## 2. V3 的核心思想

V2：

```text
safeRect = 最终窗口布局区域
```

V3：

```text
safeRect = viewport
```

主屏只显示一个比自己更宽的逻辑窗口带的一部分：

```text
Logical Strip

 Column A       Column B       Column C       Column D       Column E
┌──────────┐   ┌──────────┐   ┌────────┐    ┌──────────┐   ┌────────┐
│ Firefox  │   │ VS Code  │   │ChatGPT │    │ Dolphin  │   │Terminal│
└──────────┘   └──────────┘   └────────┘    └──────────┘   └────────┘

                 ↑──────── safeRect viewport ────────↑
```

窗口增多时：

> 已有窗口不缩小，只扩展 logical strip；通过移动 viewport/scrollOffset 查看其他列。

---

## 3. V3 第一版只做单窗口 Column

V3：

```text
1 Column = 1 Window
```

例如：

```text
Column 0
┌──────────┐
│ Firefox  │
└──────────┘

Column 1
┌──────────┐
│ VS Code  │
└──────────┘
```

暂时不做一列多窗口、不做 tabbed column。这些放 V4/V5。

---

## 4. 数据模型必须先重构

不要继续在：

```text
maximizedChanged
quickTileModeChanged
outputChanged
activeWindowChanged
windowAdded
```

里面分别直接写 `frameGeometry`。

新增统一模型：

```js
MainScreenState {
    targetOutput
    safeRect

    columns: []

    focusedColumnIndex
    scrollOffsetX

    innerGap

    enabled
}
```

Column：

```js
Column {
    id
    window

    widthMode      // "third" | "half" | "twoThirds"

    logicalX
    pixelWidth
}
```

WindowState 建议继续扩展：

```js
WindowState {
    managedByScrollLayout
    columnId

    floating

    temporarilyMaximized
    temporarilyQuickTiled

    // 继续保留 V2 已有状态
}
```

---

## 5. `logicalX` 建议只作为派生值

不要把 `logicalX` 当永久状态。

每次布局都重新计算：

```js
function recomputeLogicalLayout() {
    let x = 0;

    for (const column of state.columns) {
        column.pixelWidth = widthForMode(column.widthMode);
        column.logicalX = x;

        x += column.pixelWidth;
        x += state.innerGap;
    }
}
```

这样：

```text
插入列
删除列
移动列
改变列宽
```

都不会积累错误坐标。

---

## 6. Safe Area 继续复用 V2

例如主屏：

```text
2560 x 1440
```

配置：

```text
top    = 42
bottom = 64
left   = 10
right  = 10
```

得到：

```text
safeRect.x      = 10
safeRect.y      = 42
safeRect.width  = 2540
safeRect.height = 1334
```

所有普通 Column：

```text
y      = safeRect.y
height = safeRect.height
```

---

## 7. Column 宽度

V3 只支持：

```text
1/3
1/2
2/3
```

推荐：

```js
function widthForMode(mode) {
    const w = state.safeRect.width;

    switch (mode) {
    case "third":
        return Math.floor(w / 3);
    case "half":
        return Math.floor(w / 2);
    case "twoThirds":
        return Math.floor((w * 2) / 3);
    }
}
```

默认：

```text
defaultWidthMode = "half"
```

V3 P0 不做复杂 per-app width。

---

## 8. `innerGap` 在滚动列中的使用

例如：

```text
Column A width = 1270
innerGap       = 8
```

则：

```text
A.logicalX = 0
B.logicalX = 1278
```

统一：

```text
next.logicalX =
    current.logicalX
    + current.pixelWidth
    + innerGap
```

---

## 9. 新核心状态：`scrollOffsetX`

新增：

```text
state.scrollOffsetX
```

它表示 viewport 在 logical strip 上的起点。

物理 X 坐标：

```text
physicalX =
    safeRect.x
    + column.logicalX
    - scrollOffsetX
```

例如：

```text
safeRect.x    = 10
column.x      = 1500
scrollOffsetX = 1000
```

得到：

```text
physicalX = 510
```

---

## 10. `relayout()` 必须成为 scrolling layout 唯一 geometry writer

V3 最重要的架构要求：

```text
事件
 ↓
修改 Model
 ↓
recomputeLogicalLayout()
 ↓
ensureFocusedVisible()
 ↓
relayout()
```

不要：

```text
onSomethingChanged()
→ 直接随手写 frameGeometry
```

建议：

```js
function relayout() {
    recomputeLogicalLayout();

    for (const column of state.columns) {
        const rect = {
            x: state.safeRect.x
                + column.logicalX
                - state.scrollOffsetX,
            y: state.safeRect.y,
            width: column.pixelWidth,
            height: state.safeRect.height
        };

        applyColumnGeometry(column.window, rect);
    }
}
```

只在布局状态变化时执行，不使用定时轮询。

---

## 11. 正式开发前必须先做 off-screen POC

V3 最大风险：

> KWin 是否允许 managed window 的 `frameGeometry` 完全移动到物理 output 外。

Codex 第一件事必须真实测试：

```text
activeWindow.x = mainScreen.x - 1000
activeWindow.x = mainScreen.x - 2500

activeWindow.x = mainScreen.right + 1000
activeWindow.x = mainScreen.right + 2500
```

观察：

```text
是否允许
是否自动 clamp
不同 Wayland 应用是否一致
```

至少测试：

```text
Konsole
Dolphin
Firefox/Zen
VS Code
```

如果允许，直接使用真实 off-screen strip。

如果 KWin 强制 clamp，停止主实现并报告结果，再设计 parking/virtualization fallback；不要用 polling 强行对抗 KWin。

---

## 12. `ensureColumnVisible()` 使用 minimal reveal

不要每次 focus 都把列强行居中。

定义：

```text
viewportLeft  = scrollOffsetX
viewportRight = scrollOffsetX + safeRect.width

columnLeft    = column.logicalX
columnRight   = column.logicalX + column.pixelWidth
```

### 已完全可见

```text
columnLeft >= viewportLeft
AND
columnRight <= viewportRight
```

则：

```text
不滚动
```

### 左边超出

```text
columnLeft < viewportLeft
```

则：

```text
scrollOffsetX = columnLeft
```

### 右边超出

```text
columnRight > viewportRight
```

则：

```text
scrollOffsetX =
    columnRight - safeRect.width
```

这就是 V3 的 minimal scrolling。

---

## 13. Clamp Scroll Offset

计算整个 strip：

```text
stripWidth =
    最后一列 right
```

然后：

```text
minScroll = 0
maxScroll = max(0, stripWidth - safeRect.width)
```

执行：

```text
scrollOffsetX =
    clamp(scrollOffsetX, minScroll, maxScroll)
```

V3 暂时不做 overscroll。

---

# 14. Vim 风格快捷键

## Focus

```text
Meta + H
→ Focus Previous Column

Meta + L
→ Focus Next Column
```

## Move Column

```text
Meta + Shift + H
→ Move Current Column Left

Meta + Shift + L
→ Move Current Column Right
```

## Resize Column

```text
Meta + R
→ Cycle Column Width
```

循环：

```text
1/3 → 1/2 → 2/3 → 1/3
```

默认新窗口为：

```text
1/2
```

## Managed / Floating

```text
Meta + Shift + Enter
→ Toggle Scroll Layout / Floating
```

## Pseudo Maximize

建议：

```text
Meta + Ctrl + Enter
→ Toggle Pseudo Maximize
```

如果当前已有其它键位，可配置，但不要覆盖用户的 Terminal 快捷键。

---

## 15. 保留 KDE 原生 Safe-Area Quick Tile

必须继续保留：

```text
Meta + Left
Meta + Right
```

对应 V2：

```text
Safe Area Left Tile
Safe Area Right Tile
```

不要把它们改成 scrolling focus。

最终：

```text
Meta+H/L
→ Scroll Columns

Meta+Left/Right
→ Safe-Area Quick Tile
```

两套共存。

---

## 16. Shortcut 名称

KWin shortcut 注册名称建议：

```text
CC Scroll: Focus Previous Column
CC Scroll: Focus Next Column

CC Scroll: Move Column Left
CC Scroll: Move Column Right

CC Scroll: Cycle Column Width

CC Scroll: Toggle Floating

CC Scroll: Toggle Pseudo Maximize
```

方便在 KDE 快捷键页面搜索。

---

## 17. Focus Next / Previous

假设：

```text
A B C D
    ↑
```

`Meta+L`：

```text
A B C D
      ↑
```

流程：

```text
focusedColumnIndex++
workspace.activateWindow(target.window)
ensureFocusedVisible()
relayout()
```

边界默认：

```text
不 wrap
```

最后一列继续 `Meta+L` 不动。

---

## 18. Move Column

例如：

```text
A B [C] D
```

按：

```text
Meta+Shift+H
```

结果：

```text
A [C] B D
```

本质：

```text
swap columns[]
focusedColumnIndex--
recompute
ensureVisible
relayout
```

不是直接改窗口 X。

---

## 19. Cycle Width

当前：

```text
half
```

按：

```text
Meta+R
```

：

```text
half → twoThirds
```

再按：

```text
twoThirds → third
```

再按：

```text
third → half
```

每次：

```text
recomputeLogicalLayout()
ensureFocusedVisible()
relayout()
```

---

## 20. 新窗口插入策略

新的 managed normal window：

> 插入 focused column 的右侧。

例如：

```text
A [B] C
```

打开 D：

```text
A B [D] C
```

D 成为 focused column。

然后：

```text
ensure D visible
relayout
```

---

## 21. 第一个窗口

如果：

```text
columns.length == 0
```

则：

```text
columns = [newColumn]
focusedColumnIndex = 0
scrollOffsetX = 0
```

---

## 22. 哪些窗口默认 Managed

只接管：

```text
normalWindow
managed
moveable
resizeable
非 specialWindow
非 fullscreen
```

默认忽略：

```text
dialog
utility
popup
tooltip
notification
dock
desktop
OSD
file chooser
特殊窗口
```

典型：

```text
VS Code 主窗口
→ Column

Save As dialog
→ Floating
```

---

## 23. Managed 与 Floating

V3 必须明确区分：

```text
Managed
→ 属于 columns[]

Floating
→ 完全交给 KDE
```

不能只靠窗口当前 geometry 判断。

---

## 24. 手动拖动/resize Managed Window

当用户：

```text
interactiveMoveResizeStarted
```

且窗口属于 Column：

建议立即：

```text
从 columns[] 移除
managedByScrollLayout = false
floating = true
```

剩余窗口：

```text
recompute
relayout
```

当前窗口之后交给 KDE 自由移动/resize。

---

## 25. Toggle Floating

快捷键：

```text
Meta + Shift + Enter
```

如果当前 Managed：

```text
从 Column 移出
→ Floating
```

如果当前 Floating：

```text
插入 focused Column 右侧
→ Managed
```

这是 V3 很重要的逃生/回归机制。

---

## 26. 窗口关闭

例如：

```text
A B [C] D
```

关闭 C：

优先 focus 右侧：

```text
A B [D]
```

如果关闭最后一列：

```text
A B [C]
```

则：

```text
A [B]
```

然后：

```text
recompute
ensureVisible
relayout
```

---

## 27. `workspace.activeWindowChanged` 必须接入

用户不会只用 Meta+H/L 切窗口。

还会：

```text
Alt+Tab
底部 Dock
Overview
鼠标点击
```

如果：

```text
activeWindow
```

属于某个 managed Column：

```text
focusedColumnIndex = indexOf(activeWindow)
ensureFocusedVisible()
relayout()
```

这样 Alt+Tab 到 off-screen 窗口时，viewport 会自动滚过去。

---

## 28. Alt+Tab 场景必须测试

例如：

```text
A B C D E
```

当前 viewport 显示：

```text
B C
```

Alt+Tab 到 E：

必须：

```text
focus E
→ scroll E into view
```

不能只激活窗口却仍看不到它。

---

## 29. Pseudo Maximize 与 Column 共存

V3 不删除 V2。

Managed Column 点击 maximize / 使用快捷键：

```text
Column
→ Pseudo Maximize
→ Restore
→ 回原 Column
```

重要：

> 进入 pseudo maximize 时不要永久从 columns[] 删除窗口。

需要记录：

```text
它原来的 columnId / widthMode / index
```

临时 layout override 即可。

---

## 30. Quick Tile 与 Column 共存

同理：

```text
Column
→ Meta+Left
→ V2 Safe Area Left Tile
→ 退出 Quick Tile
→ 回原 Column
```

Quick Tile 应视为：

```text
temporary layout override
```

不要把它当成永久脱离 Column。

---

## 31. Fullscreen

Fullscreen 仍然最高优先级：

```text
Column
→ F11
→ 整个 output
→ F11 exit
→ 回 Column
```

如果进入 fullscreen 前：

```text
Pseudo Maximize
Quick Tile
```

仍按 V2 原有恢复语义处理。

---

## 32. 主屏 → 副屏

Scrolling layout 只作用于主屏。

Managed Column window 通过：

```text
Meta+Alt+Right
```

或拖动进入副屏：

```text
从 columns[] 移除
managedByScrollLayout = false
```

副屏之后完全交给 KDE。

禁止把：

```text
safeRect
scrollOffset
column width
```

带到副屏。

---

## 33. 副屏普通窗口回主屏

副屏 normal window 进入主屏：

建议：

```text
自动加入 scrolling layout
```

插入：

```text
focused column 右侧
```

但如果该窗口进入主屏时仍处于：

```text
native maximize
native Quick Tile
fullscreen
```

优先执行 V2 已有的：

```text
outputChanged adopt
```

不要立刻强制 Column 化。

---

## 34. Screen Geometry 改变

监听：

```text
workspace.screensChanged
workspace.virtualScreenGeometryChanged
```

主屏分辨率/scale/位置改变：

```text
重新计算 safeRect
重新计算所有 column pixelWidth
重新计算 logical positions
clamp scrollOffset
relayout
```

---

## 35. Animation：V3 明确不做

V3 所有移动先：

```text
instant geometry update
```

不做：

```text
spring
easing
touchpad physics
continuous scrolling
velocity
```

动画以后再做。

优先保证：

```text
模型正确
focus 正确
geometry 正确
状态恢复正确
```

---

## 36. Session Persistence：V3 不要求

V3 不要求 Plasma/KWin 重启后保存：

```text
column order
column width
scrollOffset
```

运行时稳定优先。

Persistence 放后续版本。

---

## 37. 推荐配置项

V3 可以增加：

```text
scrollLayoutEnabled = true

defaultColumnWidth:
    third
    half
    twoThirds

focusWrap = false
```

P0 默认：

```text
scrollLayoutEnabled = true
defaultColumnWidth = half
focusWrap = false
```

---

## 38. Debug 日志

Debug 开启后建议打印：

```text
[cc-scroll]

ADD_WINDOW
caption=...
column=3
width=half

FOCUS
from=2
to=3

SCROLL
old=812
new=1278

MOVE_COLUMN
from=3
to=2

RESIZE_COLUMN
column=2
half -> twoThirds

LAYOUT
column=2
logicalX=1280
physicalX=10
width=1693
```

不要默认刷日志。

---

# 39. Codex 实现前的 3 个强制 POC

## POC 1：Off-screen Geometry

测试多个应用：

```text
Konsole
Dolphin
Zen/Firefox
VS Code
```

把窗口移到：

```text
主屏左边 -1000 / -2000
主屏右边 +1000 / +2000
```

记录 KWin 是否 clamp。

---

## POC 2：多窗口一次 relayout

打开 3~4 个窗口，一次函数里连续设置 geometry。

验证：

```text
没有抖动
没有 KWin 反向覆盖
没有 signal storm
```

---

## POC 3：Off-screen Active Window

把某 managed window 移出 viewport。

通过：

```text
Alt+Tab
```

激活它。

确认：

```text
workspace.activeWindowChanged
```

能可靠捕获。

三个 POC 通过后再正式做 V3。

---

# 40. 实现顺序

严格建议：

```text
Phase 0
三个 POC

Phase 1
MainScreenState + Column model

Phase 2
recomputeLogicalLayout()

Phase 3
relayout()

Phase 4
Meta+H/L focus

Phase 5
ensureColumnVisible()

Phase 6
Meta+Shift+H/L move column

Phase 7
Meta+R cycle width

Phase 8
windowAdded / windowClosed

Phase 9
activeWindowChanged / Alt+Tab

Phase 10
Managed <-> Floating

Phase 11
和 V2 pseudo maximize / Quick Tile / fullscreen 融合

Phase 12
outputChanged / 双屏

Phase 13
config / README / 全量测试
```

---

# 41. 测试矩阵

### T01 单窗口
打开 Firefox：

```text
1 Column
width=1/2
```

### T02 多窗口
依次打开：

```text
Firefox
VS Code
Dolphin
ChatGPT
```

期望：

```text
4 Columns
```

旧窗口尺寸不因新增窗口缩小。

### T03 Focus Next
`Meta+L`：

```text
可见 → 不滚
不可见 → minimal scroll
```

### T04 Focus Previous
`Meta+H` 同理。

### T05 Move Column
```text
A B [C] D
Meta+Shift+H
```

得到：

```text
A [C] B D
```

### T06 Cycle Width
```text
half
→ Meta+R
→ twoThirds
```

### T07 新窗口插入
```text
A [B] C
```

打开 D：

```text
A B [D] C
```

### T08 Close Focused
```text
A B [C] D
```

关闭 C：

```text
A B [D]
```

### T09 Alt+Tab 到 off-screen
必须自动 scroll 到目标列。

### T10 手动拖动
Managed window 拖动后：

```text
→ Floating
```

### T11 Toggle Floating
`Meta+Shift+Enter`：

```text
Managed <-> Floating
```

### T12 Pseudo Maximize
Column → Pseudo Maximize → Restore：

```text
回原 Column
```

### T13 Quick Tile
Column → `Meta+Left` → Exit：

```text
回原 Column
```

### T14 Fullscreen
Column → F11 → Exit：

```text
回原 Column
```

### T15 主屏到副屏
Managed → 副屏：

```text
退出 scroll layout
KDE 原生管理
```

### T16 副屏普通窗口回主屏
normal window：

```text
加入 focused 右侧
```

### T17 Dock Hide/Show
不能改变 Safe Area / Column geometry。

---

# 42. V3 明确禁止 Scope Creep

V3 不做：

```text
一列多窗口
tabbed columns
滚动动画
连续触摸板 scrolling
Overview 重写
动态 workspace
session persistence
完整 niri clone
```

---

# 43. Definition of Done

- [ ] 主屏存在稳定的 Column model。
- [ ] 1 Column = 1 normal window。
- [ ] 支持 1/3、1/2、2/3 三种宽度。
- [ ] 新窗口插入 focused column 右侧。
- [ ] `Meta+H/L` 正常 focus previous/next。
- [ ] 已可见列不发生无意义 scroll。
- [ ] 不可见列使用 minimal reveal。
- [ ] `Meta+Shift+H/L` 正常重排列。
- [ ] `Meta+R` 正常循环列宽。
- [ ] `Meta+Shift+Enter` 正常 Managed/Floating。
- [ ] Alt+Tab 到 off-screen window 会自动滚过去。
- [ ] Window close 后 column state 正确。
- [ ] 手动 move/resize 可以退出 scroll layout。
- [ ] Pseudo Maximize 能恢复原 Column。
- [ ] V2 Quick Tile 能恢复原 Column。
- [ ] Fullscreen 能恢复原 Column。
- [ ] 主屏移到副屏后停止 scroll management。
- [ ] 副屏保持 KDE 原生行为。
- [ ] V2 Safe Area / outer gap / innerGap 全部复用。
- [ ] 不使用 polling。
- [ ] 不持续使用 frameGeometryChanged 强制对抗 KWin。
- [ ] 无持续 KWin scripting errors。

---

# 44. 最终体验

主屏逻辑空间：

```text
  VS Code        ChatGPT       Dolphin       Firefox        Terminal
┌───────────┐   ┌─────────┐   ┌───────┐   ┌─────────┐   ┌─────────┐
│           │   │         │   │       │   │         │   │         │
│           │   │         │   │       │   │         │   │         │
└───────────┘   └─────────┘   └───────┘   └─────────┘   └─────────┘

                 ←──── physical Safe Area viewport ────→
```

操作：

```text
Meta+H/L
→ 切换列

Meta+Shift+H/L
→ 移动列

Meta+R
→ 改变列宽

Meta+Shift+Enter
→ Floating / Managed
```

窗口越开越多：

> 不压缩旧窗口，只向逻辑 strip 横向扩展。

---

# 45. 给 Codex 的最终执行要求

基于当前已经可工作的 `cc-niri-maximize V2` 开发 V3。

不要删除或重写已有：

```text
Safe Area
outer gaps
innerGap
Quick Tile
Pseudo Maximize
Fullscreen
outputChanged
双屏逻辑
```

在其上新增：

```text
Scrollable Columns Layer
```

先完成：

```text
Off-screen Geometry POC
→ Column Model
→ relayout()
→ Focus + minimal scrolling
```

再加入窗口状态融合。

如果 KWin 对完全 off-screen geometry 有强制 clamp：

> 停止直接实现 logical strip，先记录真实行为，再设计 parking/virtualization fallback。

禁止通过高频 polling 或持续 `frameGeometryChanged` 重写来对抗 KWin。

最终目标：

> **让 KDE 主屏拥有类似 niri 的横向滚动列式工作流，同时保持 Plasma Panel、Dock、Overview、副屏 SSH 工作流不变。**
