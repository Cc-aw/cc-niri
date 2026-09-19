# `cc-niri-maximize` V3 Phase 9.5 Revised：Mouse-first Presentation + Focus Ring

> **本版替代上一版 Phase 9.5 文档。**
>
> 本次调整：
>
> ```text
> 删除 Meta+W
> 删除 Meta+F
> 不设计 True Fullscreen / F11 工作流
> ```
>
> 保留真正有价值的能力：
>
> ```text
> Normal              = 两列 50/50
> Focus Wide          = 当前窗口 72% 居中
> Safe-Area Maximize  = 当前窗口占满 Safe Area
> Focus Ring          = 明确当前键盘焦点
> ```
>
> 但 Presentation Mode 改成 **mouse-first / Dock-driven**：
>
> ```text
> Dock Task Context Menu
>     ├── Normal
>     ├── Focus Wide
>     └── Maximize in Safe Area
>
> KDE 原生 maximize button / titlebar maximize
>     └── Safe-Area Maximize
> ```
>
> 键盘只保留 scrolling layout 最核心操作：
>
> ```text
> Meta+H / L
> Meta+Shift+H / L
> ```
>
> 不再为了尺寸模式占用新的字母快捷键。

---

# 1. 最终交互原则

用户不应该记：

```text
W 是 72%
F 是 100%
F11 是 fullscreen
```

而是：

```text
H/L
→ 导航

Shift+H/L
→ 排序

鼠标 / Dock
→ 改变当前窗口的展示模式

Focus Ring
→ 告诉用户当前焦点在哪里
```

这更适合长期日用。

---

# 2. Presentation 三态

只保留：

```text
NORMAL
WIDE
MAXIMIZED
```

不再提供：

```text
preset width cycling
arbitrary width
true fullscreen mode
```

---

# 3. NORMAL

默认：

```text
Safe Area
┌───────────────────────┬─gap─┬───────────────────────┐
│                       │     │                       │
│        VS Code        │     │          Zen          │
│                       │     │                       │
└───────────────────────┴─────┴───────────────────────┘
```

宽度：

```text
normalWidth =
    floor((safeRect.width - innerGap) / 2)
```

目标：

```text
两列完整显示
没有 partial window
没有额外空洞
```

---

# 4. FOCUS WIDE

语义：

> “我现在主要阅读这个窗口，但不想让它完全铺满整个 Safe Area。”

适合：

```text
ChatGPT
网页阅读
论文/PDF
普通视频
Zen 竖向 Tab + ChatGPT Sidebar
```

视觉：

```text
Safe Area
┌─────────────────────────────────────────────────────┐
│                                                     │
│       ╔══════════════════════════════════════╗      │
│       ║                                      ║      │
│       ║                 Zen                  ║      │
│       ║                                      ║      │
│       ╚══════════════════════════════════════╝      │
│                                                     │
└─────────────────────────────────────────────────────┘
```

默认比例：

```text
wideRatio = 0.72
```

计算：

```text
wideWidth =
    round(safeRect.width * 0.72)

wideX =
    safeRect.x +
    floor((safeRect.width - wideWidth) / 2)

wideY = safeRect.y
wideHeight = safeRect.height
```

---

# 5. WIDE 模式不显示邻居

由于当前 Phase 5.5 采用：

```text
fully-visible OR parked
```

不支持 partial Column。

所以：

```text
WIDE:
focused Column = visible
all other managed Columns = parked
```

不要出现：

```text
72% Zen
+
右边 28% 的另一个窗口残片
```

---

# 6. SAFE-AREA MAXIMIZE

语义：

> “当前窗口是主任务，我希望尽可能大，但仍保留我的 Plasma 顶部岛和底部 Dock 工作流。”

几何：

```text
x = safeRect.x
y = safeRect.y
width = safeRect.width
height = safeRect.height
```

其它 managed windows：

```text
parked
```

---

# 7. 不再设计 True Fullscreen

本 Phase 不实现：

```text
F11 mode
fullscreen presentation state
fullscreen restore stack
fullscreen shortcut
```

如果某个应用自身请求 KDE / Wayland fullscreen：

```text
交给 KDE / KWin 原生处理
```

本项目不主动提供 fullscreen 工作流。

如果 native fullscreen 临时发生：

```text
Focus Ring 应隐藏
Scrolling manager 不做额外 presentation 逻辑
```

退出 native fullscreen 后继续根据当前真实状态 reconcile。

---

# 8. 不再绑定 Meta+W / Meta+F

正式删除：

```text
Meta+W
Meta+F
Meta+R
```

Presentation actions：

```text
没有默认字母快捷键
```

如果未来用户自己想绑定：

```text
可在 KDE Shortcut 设置中自行绑定
```

但本项目默认不占用。

---

# 9. Presentation 的主要入口：Dock Context Menu

Phase 8.5 已经建立：

```text
Dock ↔ Bridge ↔ KWin
```

Phase 9.5 应复用这条通信链。

右键 managed task：

```text
┌─────────────────────────────┐
│ Activate                    │
│ --------------------------- │
│ ○ Normal                    │
│ ○ Focus Wide                │
│ ○ Maximize in Safe Area     │
│ --------------------------- │
│ KDE 原生任务菜单...          │
└─────────────────────────────┘
```

当前模式用：

```text
radio/check mark
```

表示。

---

# 10. Dock 菜单不是重写整个 Context Menu

必须：

> 保留 KDE Task Manager 原生 context menu，只增加一个很小的 `CC Scroll` section。

不能因为加三个选项就重新实现：

```text
Open New Window
Close
Pin
Move to Desktop
Activities
Audio actions
```

等 KDE 原生功能。

---

# 11. Dock → KWin Presentation Command

复用 Phase 8.5 Bridge。

新增 command：

```json
{
  "protocol": 1,
  "commandId": "uuid",
  "sessionId": "current-session",
  "baseGeneration": 83,
  "type": "set-presentation-mode",
  "windowUuid": "uuid-zen",
  "mode": "wide"
}
```

允许：

```text
mode:
normal
wide
maximized
```

---

# 12. KWin Validation

收到 Presentation command 后验证：

```text
protocol
sessionId
baseGeneration
windowUuid exists
window belongs to current managed columns[]
window is on target main output
mode valid
```

如果失败：

```text
reject
republish authoritative state
```

---

# 13. Presentation State

建议：

```js
state.presentation = {
    windowUuid: null,
    mode: "normal"
}
```

只允许：

```text
normal
wide
maximized
```

---

# 14. Presentation 仍然属于当前 focused session

P0 继续采用：

> Wide / Maximized 是当前 focused window 的临时展示模式。

如果用户通过：

```text
Meta+H/L
Alt+Tab
Dock click
Overview
鼠标点击别的窗口
```

把 focus 切到另一个 managed Column：

```text
旧 presentation 自动清除
新 focused window 进入 NORMAL
```

这样避免 72% Column 永久残留在 strip 中。

---

# 15. Dock 对非当前窗口的 Presentation 请求

用户右键一个非 active Dock task，然后选：

```text
Focus Wide
```

推荐语义：

```text
1. activate target window
2. Phase 9 ensure target visible
3. set presentation=WIDE
4. relayout
```

同理 Maximize。

这样 Dock 可以直接成为：

```text
导航 + Presentation 控制器
```

---

# 16. Native Maximize Button

现有 V2 如果已经把：

```text
KDE maximize request
```

映射到：

```text
Safe-Area pseudo maximize
```

则必须复用。

也就是说：

```text
点击窗口标题栏 maximize button
→ presentation = MAXIMIZED
→ rect = safeRect
```

再次 restore：

```text
→ presentation = NORMAL
```

---

# 17. Titlebar Double-click

不要自己新增一套 double-click handler。

如果当前 KDE Window Behavior 配置：

```text
double-click titlebar = maximize
```

那么它自然经过：

```text
native maximize request
```

进入现有 V2 Safe-Area Maximize。

如果用户 KDE 设置不是 maximize：

```text
尊重用户设置
```

不要硬编码。

---

# 18. Focus Wide 为什么只放 Dock 菜单

WIDE 是项目自己的额外语义，不是 KDE 原生 maximize。

因此第一版不要：

```text
修改 KDecoration
增加自定义 titlebar button
劫持双击
劫持中键
```

这些都会显著提高 KDE 更新维护成本。

Dock Context Menu 已经是项目自己的 UI，最适合承载这个动作。

---

# 19. 可选后续：Dock 手势

P0 不做。

后续如果用户觉得右键两次太慢，可以评估：

```text
double-click active task
→ toggle Wide
```

或者：

```text
middle click
→ Wide
```

但必须先检查 KDE 原有 middle-click 行为，不能破坏：

```text
new instance
close
```

等现有习惯。

---

# 20. Logical Order 不受 Presentation 影响

例如：

```text
A → B → Zen → D
```

Zen Wide：

```text
A → B → [Zen WIDE] → D
```

顺序仍：

```text
A B Zen D
```

Dock 仍：

```text
[A][B][Zen][D]
```

---

# 21. Presentation 不写入 Dock Manual Order

Phase 8.5：

```text
columns[] order
```

仍然是唯一 Dock 顺序依据。

Presentation：

```text
只影响显示状态
```

不能触发：

```text
TasksModel.move()
```

---

# 22. Bridge State 增加 Presentation 信息

KWin snapshot：

```json
{
  "protocol": 1,
  "sessionId": "...",
  "generation": 84,
  "focusedUuid": "uuid-zen",
  "presentation": {
    "windowUuid": "uuid-zen",
    "mode": "wide"
  },
  "columns": [
    {"uuid":"uuid-a"},
    {"uuid":"uuid-zen"},
    {"uuid":"uuid-b"}
  ]
}
```

Dock 依据它：

```text
勾选正确 radio item
```

---

# 23. Presentation Command 不应该重排 Column

命令：

```text
set-presentation-mode
```

只允许改变：

```text
presentation state
placement
geometry
```

禁止改变：

```text
columns[]
focused ordering
Dock ordering
```

---

# 24. Focus Ring

Focus Ring 保持为 Phase 9.5 的核心功能。

目的：

```text
明确当前真正 keyboard-focused window
```

特别是在：

```text
Scrolling
Parking
Dock click
Alt+Tab
多个浅色窗口
```

场景。

---

# 25. Focus Ring 样式

推荐：

```text
width = 2 logical px
color = #5D8A66
opacity = 0.90
```

不做：

```text
glow
pulse
gradient
heavy 4px border
```

---

# 26. Inactive Window 不画 Ring

只画：

```text
active managed main-screen window
```

其它全部：

```text
no ring
```

---

# 27. 副屏不画 Ring

P0：

```text
target main output only
```

因为副屏主要是：

```text
SSH / KDE native window
```

---

# 28. Native Fullscreen 临时发生时

虽然项目不实现 fullscreen 功能，但应用仍可能自己进入 fullscreen。

若：

```text
window.fullScreen == true
```

Focus Ring：

```text
hidden
```

这只是视觉保护，不代表项目维护 fullscreen presentation state。

---

# 29. Focus Ring 不参与 Geometry

绝对禁止：

```text
safeRect -= ringWidth
frameGeometry += ringWidth
normalWidth -= ringWidth
innerGap += ringWidth
```

Ring 是纯视觉效果。

---

# 30. Ring 必须跟视觉位置

Phase 5.5 后：

```text
raw frameGeometry
!=
visual projected geometry
```

因此 Ring 必须跟：

```text
Effect visual translation
```

共用坐标。

---

# 31. Visual Rect

建议 Effect 内统一：

```text
visualRect =
    frameGeometry
    + current visual translation
```

Focus Ring：

```text
ringRect = visualRect expanded by 1~2px
```

---

# 32. Effect 不重新实现 Layout

KWin Script：

```text
columns[]
logical layout
presentation projection
placement
```

KWin Effect：

```text
scroll animation
focus ring
```

不要复制：

```text
Column ordering
scrollOffset
parking policy
```

---

# 33. Focus Ring 先做 POC

先只验证：

```text
一个普通 active main-screen window
→ 2px green outline
```

必须满足：

```text
不改 geometry
不挡 input
不重建整个 scene
不卡顿
native fullscreen 时隐藏
```

通过后再接 scroll translation。

---

# 34. Focus Ring 技术优先级

优先级：

```text
A. 复用现有 KWin Effect

B. 独立轻量 focus-ring KWin Effect

C. 最小 native C++ KWin Effect
```

不要为了 Ring：

```text
创建普通 Wayland overlay window
```

也不要：

```text
用 full-screen SceneEffect 重建全部 desktop scene
```

---

# 35. NORMAL → WIDE

用户：

```text
Dock right click Zen
→ Focus Wide
```

流程：

```text
activate Zen if needed
set presentation.windowUuid = Zen
set presentation.mode = wide
compute presentation placement
park all other managed windows
relayout
publish state
```

---

# 36. WIDE → NORMAL

Dock：

```text
CC Scroll
→ Normal
```

流程：

```text
clear presentation
restore normal scrollOffset
ensureFocusedVisible()
relayout
publish state
```

---

# 37. NORMAL / WIDE → MAXIMIZED

入口可以来自：

```text
Dock menu
KDE native maximize button
```

统一最终状态：

```text
presentation.mode = maximized
```

不要维护两套 Safe-Area Maximize。

---

# 38. MAXIMIZED → NORMAL

入口：

```text
Dock menu Normal
或
KDE native Restore
```

统一：

```text
presentation.mode = normal
```

---

# 39. WIDE → MAXIMIZED

Dock 菜单直接选择：

```text
Maximize in Safe Area
```

状态：

```text
wide → maximized
```

---

# 40. MAXIMIZED → WIDE

Dock 菜单：

```text
Focus Wide
```

直接：

```text
maximized → wide
```

无需复杂 previous-mode stack。

---

# 41. Focus Change

如果当前：

```text
Zen WIDE
```

用户：

```text
Meta+L
```

切到 Dolphin：

```text
Zen presentation cleared
Dolphin NORMAL
```

---

# 42. Reorder While Wide/Maximized

例如：

```text
A B [Zen WIDE] D
```

`Meta+Shift+H`：

```text
A [Zen WIDE] B D
```

Zen 保持当前 Presentation。

只修改 logical order。

---

# 43. windowAdded

后台 windowAdded：

```text
加入 columns[]
不退出当前 presentation
```

如果新 window 真正抢到 active focus：

```text
activeWindowChanged
→ clear old presentation
→ new window NORMAL
```

---

# 44. Presentation 不永久修改 scrollOffsetX

进入 Wide/Max：

```text
保留 normal scrollOffsetX
```

不要为了居中：

```text
永久改 logical scrollOffsetX
```

Presentation 是 viewport override。

退出：

```text
恢复 normal scrollOffsetX
```

必要时：

```text
ensureFocusedVisible()
```

---

# 45. 推荐 Pipeline

```text
state mutation
    ↓
recomputeLogicalLayout()
    ↓
computePresentationProjection()
    ↓
if NORMAL:
    ensureFocusedVisible()
    ↓
relayout()
    ↓
emit transition
    ↓
publish state
```

---

# 46. Presentation Projection 独立层

```text
Logical Column Model
        ↓
Normal Logical Layout
        ↓
Presentation Override
        ↓
Viewport Placement
        ↓
Visible / Parked
        ↓
frameGeometry
```

不要把 Wide / Max 特例散落在多个 signal handler。

---

# 47. 推荐函数

```js
function setPresentationMode(windowUuid, mode)
function clearPresentationMode(reason)

function computeNormalWidth()
function computeWideRect()
function computeMaximizedRect()

function computePresentationPlacements()
```

`relayout()` 继续是 managed geometry 唯一 writer。

---

# 48. Dock Context Menu 实现边界

建议只新增：

```text
CC Scroll
  ○ Normal
  ○ Focus Wide
  ○ Maximize in Safe Area
```

不要顺便增加：

```text
move left
move right
float
send to monitor
width presets
```

这些以后根据实际需求再加。

---

# 49. Presentation Generation

Presentation mode change 属于 committed UI state。

所以：

```text
generation++
```

这样：

```text
Dock
Bridge
KWin
```

状态一致。

---

# 50. Test T01：Normal 50/50

```text
A B
```

验证：

```text
A/B 完整显示
gap 正确
无 partial
```

---

# 51. Test T02：Dock → Wide

右键 B：

```text
Focus Wide
```

验证：

```text
B = 72%
B centered
A parked
output remains main display
Dock order unchanged
```

---

# 52. Test T03：Wide → Normal

Dock 选：

```text
Normal
```

恢复两列。

---

# 53. Test T04：Native Maximize

点击 window maximize button。

验证：

```text
focused rect == safeRect
presentation.mode == maximized
```

---

# 54. Test T05：Native Restore

再次 restore。

验证：

```text
presentation.mode == normal
normal layout restored
```

---

# 55. Test T06：Dock → Maximize

Dock 选：

```text
Maximize in Safe Area
```

必须和 native maximize 使用相同 geometry path。

---

# 56. Test T07：Wide → Max

Dock：

```text
Wide
→ Maximize
```

正确切换。

---

# 57. Test T08：Max → Wide

Dock：

```text
Maximize
→ Wide
```

正确切换。

---

# 58. Test T09：Focus Change Clears Presentation

```text
B Wide
Meta+L
```

结果：

```text
B presentation cleared
new focus NORMAL
```

---

# 59. Test T10：Reorder Keeps Presentation

```text
A [B Wide] C
Meta+Shift+H
```

结果：

```text
[B Wide] A C
```

---

# 60. Test T11：Ring follows H/L

```text
A focused
Meta+L
```

Ring：

```text
A → B
```

---

# 61. Test T12：Ring follows scroll animation

Parked target 被激活时：

```text
window + ring
```

必须同方向、同视觉 transform 进入。

---

# 62. Test T13：Dock Click

点击 parked task：

```text
activate
auto-scroll
ring follows
```

---

# 63. Test T14：Native App Fullscreen

如果应用自己 fullscreen：

```text
Ring hidden
```

退出后：

```text
reconcile
```

但不维护自定义 fullscreen state。

---

# 64. Test T15：副屏

副屏 active：

```text
main Ring OFF
```

主屏重新 active：

```text
Ring 恢复
```

---

# 65. Test T16：Parking Ownership

Wide / Max 时：

```text
所有 parked managed windows
output 仍为 main output
```

---

# 66. Regression Matrix

重测：

```text
Safe Area
Parking
Meta+H/L
minimal scroll
Meta+Shift+H/L
Dock bidirectional order
windowAdded/windowClosed
Alt+Tab
Dock click
native maximize/restore
Quick Tile
cross-screen
secondary native workflow
scroll transition direction
```

---

# 67. 本阶段明确不做

```text
Meta+R
Meta+W
Meta+F
custom fullscreen
F11 workflow
arbitrary width
per-app width
expand-to-available-width
center-column shortcut
custom titlebar button
titlebar mouse gesture
multi-window Column
tabbed Column
urgent ring
touchpad continuous scroll
```

---

# 68. Codex 实现顺序

严格按：

```text
1. 删除 Meta+R / Meta+W / Meta+F 默认绑定

2. 固定 NORMAL 为 exact 50/50

3. 实现 Presentation state + projection

4. 实现 WIDE 72% centered

5. 统一现有 V2 Safe-Area Maximize 为 MAXIMIZED state

6. 扩展 Phase 8.5 Bridge command：
   set-presentation-mode

7. 在 Dock 原生 context menu 中增加 CC Scroll section

8. Dock → Wide/Normal/Max 双向状态同步

9. native maximize/restore 与 presentation state 同步

10. 完整 sizing / bridge regression

11. 单独 Focus Ring POC

12. Ring 接 visual translation

13. full regression
```

---

# 69. Definition of Done

- [ ] 没有 `Meta+R`。
- [ ] 没有 `Meta+W`。
- [ ] 没有 `Meta+F`。
- [ ] 项目不设计自定义 fullscreen 工作流。
- [ ] NORMAL 精确 two-column。
- [ ] Dock 可选择 Normal / Wide / Maximize。
- [ ] WIDE = 72% centered。
- [ ] WIDE 时其他 managed windows parked。
- [ ] MAXIMIZED = Safe Area 100%。
- [ ] native maximize 与 Dock Maximize 走同一状态路径。
- [ ] logical order 不因 presentation 改变。
- [ ] Dock order 不因 presentation 改变。
- [ ] focus change 自动清除 presentation。
- [ ] reorder 时保持当前 presentation。
- [ ] presentation 不永久污染 `scrollOffsetX`。
- [ ] Focus Ring 只显示 active main-screen managed window。
- [ ] Ring 不改变 geometry。
- [ ] Ring 使用 visual rect。
- [ ] Ring 与 scroll transition 同步。
- [ ] native fullscreen 临时发生时 Ring 隐藏。
- [ ] Parking ownership 不回归。
- [ ] 副屏行为不回归。
- [ ] 无 polling。
- [ ] journal 无持续错误。

---

# 70. 最终 Daily Workflow

键盘：

```text
Meta+H / L
→ 浏览窗口

Meta+Shift+H / L
→ 调整窗口顺序
```

鼠标：

```text
Dock right click
→ Normal / Focus Wide / Maximize

窗口 maximize button
→ Safe-Area Maximize / Restore
```

视觉：

```text
Focus Ring
→ 永远明确当前输入焦点
```

最终系统不要求用户记一组不断增长的窗口管理快捷键，而是保持：

> **键盘负责 scrolling；鼠标/Dock 负责 presentation；Focus Ring 负责反馈。**
