# CC Niri Maximize — Clavis Motion 动画系统移植与实现设计

**目标版本基线：** `CC Niri Maximize 3.0.0-alpha.30`  
**参考项目：** `https://github.com/StatIndet/quickshell`（Clavis Shell）  
**目标环境：** Fedora 44 / Plasma / KWin 6.7.5 / Wayland  
**文档目标：** 在不破坏当前窗口布局、Dock 同步和稳定性机制的前提下，将 Clavis Shell 的动画设计语言迁移到 CC Niri Maximize，使滚动列、Focus Wide、Dock 和后续 Spotlight/OSD 形成统一、自然、可中断的 Motion System。

---

## 1. 结论

本次优化**不是重新设计窗口管理架构**，也不是直接复制 Clavis 的视觉组件。

当前 CC Niri Maximize 已经具备：

- 主屏滚动 Column；
- Dock 与 Column 双向顺序同步；
- Dock 隐藏任务分步滚动；
- Focus Wide 50% ↔ 72%；
- Floating；
- Safe Area；
- Presentation 状态；
- epoch / invariant audit / adoption state machine；
- Bridge session / generation / command ID；
- 事件驱动而非轮询。

这些机制继续保持不变。

本次只新增一层：

```text
Authoritative Layout State
          │
          │ relayout()
          ▼
     Final Geometry
          │
          ▼
   Motion Controller
          │
   visual progress 0..1
          │
          ▼
 Translation / Scale / Opacity
          │
          ▼
        Paint
```

核心原则：

> **Layout 决定“窗口最终在哪里”，Motion 只决定“用户如何看到窗口到那里”。**

因此本次改造的目标是：

1. 统一所有动画时间和 easing；
2. Column 滚动支持自然减速；
3. 连续 `Meta+H/L` 可以中途 retarget，不 snap；
4. Dock 远距离跳转保持原事务模型，但视觉上变成连续滚动；
5. Focus Wide 使用更柔和的 expressive motion；
6. Dock / Quickshell 使用同一套 motion language；
7. 后续 Spotlight / OSD 可以直接复用该动画体系。

---

# 2. 不做什么

本轮明确**不做**以下修改：

- 不实现 Multi-Window Column；
- 不实现 Tabbed Column；
- 不改变 `Window ≈ Column ≈ Dock Task` 的简单模型；
- 不改变 Dock UUID 同步协议的核心语义；
- 不改变 KWin 为 Column 顺序最终权威的原则；
- 不改变 `relayout()` 为 geometry 唯一写入点的原则；
- 不改变 Focus Wide 固定 72%；
- 不改变 Dock 远距离跳转必须经过相邻 Column 的事务链；
- 不新增轮询；
- 不使用 Timer 去逐像素修改真实窗口 geometry；
- 不为了动画重新引入 Geometry Change effect；
- 不优先做液态 Shader；
- 不重写稳定性状态机。

本轮优先级：

```text
稳定性 > 可中断性 > 连续感 > 动画精致度 > 炫技效果
```

---

# 3. Clone 参考项目

建议把 Clavis 作为独立参考仓库，不要直接放进主工程源码树。

例如：

```bash
mkdir -p ~/Projects/reference
cd ~/Projects/reference

git clone https://github.com/StatIndet/quickshell.git clavis-shell
```

之后重点阅读：

```text
clavis-shell/
├── Common/
│   ├── Animations.qml
│   └── KeystoneMotion.qml
│
├── Modules/
│   ├── Dock/
│   │   ├── DockItem.qml
│   │   └── DockSurface.qml
│   │
│   └── Launcher/
│       ├── LauncherWindow.qml
│       ├── SpotlightStyle.qml
│       └── SpotlightModeMorphSurface.qml
│
└── docs/
    └── architecture/
        └── spotlight-search.md
```

优先级：

### 第一优先级

```text
Common/Animations.qml
Modules/Launcher/LauncherWindow.qml
Modules/Launcher/SpotlightStyle.qml
```

重点学习：

- motion token；
- enter / exit 不同时长；
- 当前 progress → 新 target 的 retarget；
- duration 根据剩余距离动态缩放。

### 第二优先级

```text
Common/KeystoneMotion.qml
Modules/Dock/DockItem.qml
```

重点学习：

- 大空间动画与微交互动画分层；
- hover / press 应该非常快；
- expressive curve 只用于重要空间变化。

### 第三优先级

```text
Modules/Launcher/SpotlightModeMorphSurface.qml
docs/architecture/spotlight-search.md
```

重点学习：

- 单一 progress 驱动多个视觉属性；
- 可逆动画；
- 动画中断；
- 多元素共享连续 motion。

---

# 4. GPL 注意事项

参考仓库根目录 `LICENSE` 为：

```text
GNU GENERAL PUBLIC LICENSE
Version 3, 29 June 2007
```

因此建议把本项目的借鉴分成两类。

## 4.1 推荐：借鉴设计思想

可以自行重新实现：

- Motion token 分层；
- duration 组织方式；
- progress-based animation；
- retarget 思路；
- FLIP 思路；
- enter 比 exit 慢；
- small interaction 使用短时长；
- large spatial transition 使用 expressive easing。

这类实现应由本项目自己编写。

## 4.2 谨慎：直接复制代码

如果直接复制较大段：

- QML；
- Shader；
- C++；
- JS；

需要检查 GPL-3.0 对你的项目分发方式的影响。

本轮没有必要直接复制 Clavis 的 Shader 或完整 QML。

---

# 5. Clavis 动画语言拆解

Clavis 的动画好看，并不是因为“所有动画都弹”。

它实际上将动画分成不同层级。

---

## 5.1 Micro Interaction

典型对象：

- Dock hover；
- press；
- icon size；
- press shade。

参考范围：

```text
90 ~ 120 ms
```

特征：

- 很快；
- 几乎不产生等待感；
- 使用 `OutCubic` 或类似 deceleration；
- 不应有明显 overshoot。

---

## 5.2 Fast Effect

典型对象：

- indicator；
- opacity；
- popup fade；
- 辅助视觉状态。

建议：

```text
150 ~ 180 ms
```

---

## 5.3 Spatial Motion

典型对象：

- Column scroll；
- 窗口关闭后的补位；
- Column reorder；
- Dock 邻接滚动。

建议：

```text
200 ~ 230 ms
```

特点：

- 起步干脆；
- 末端柔和减速；
- 不应拖泥带水；
- 必须支持 retarget。

---

## 5.4 Expressive Spatial Motion

典型对象：

- Focus Wide；
- Spotlight；
- 大型面板展开；
- OSD / Island 形态变化。

建议：

```text
280 ~ 350 ms
```

可以有极轻微 overshoot。

注意：

> 不应将 Clavis Keystone 的 500 ms 直接套到窗口滚动。

Keystone 属于大型 UI morph，而窗口导航是高频操作。

---

# 6. 新增统一 Motion Token

建议新建逻辑模块：

```text
motion/
├── MotionTokens.js
├── MotionCurves.js
├── MotionController.js
└── README.md
```

实际目录可以按当前工程结构调整。

---

## 6.1 MotionTokens.js

建议初始参数：

```javascript
const MotionTokens = {
    microPressMs: 90,
    microHoverMs: 110,

    fastMs: 170,

    spatialMs: 220,
    spatialFastMs: 190,

    resizeMs: 300,

    expressiveEnterMs: 320,
    expressiveExitMs: 240,
};
```

注意：

这些值只是第一版 tuning baseline。

不要在其他模块出现：

```text
147 ms
263 ms
380 ms
```

等随意 hardcode。

以后所有动画都从 Motion Token 读取。

---

# 7. Motion Curve

建议至少保留以下语义。

```text
standard
standardDecel

emphasized
emphasizedAccel
emphasizedDecel

expressiveSpatial
expressiveEffects
```

不要按组件命名：

```text
dockCurve
wideCurve
scrollCurve
```

而应按运动性质命名。

---

## 7.1 推荐用途

| Motion | 用途 |
|---|---|
| `standardDecel` | Column scroll、Dock indicator |
| `emphasizedDecel` | 窗口补位、Popup enter |
| `emphasizedAccel` | Popup exit、Wide collapse |
| `expressiveSpatial` | Wide expand、大型布局变化 |
| `expressiveEffects` | opacity / shadow / blur |

---

# 8. 第一阶段：只建立 Motion 基础设施

这是风险最低的一步。

目标：

- 不改变任何功能；
- 不改变 geometry；
- 不改变行为；
- 只消除散落的 duration/easing。

检查：

```text
Dock
Focus Wide
Column scroll
close refill
Presentation
```

找到所有：

```text
duration
interval
easing
```

然后分类。

注意：

当前 Dock 分步滚动的 `140 ms` 是**事务步进间隔**，不是普通动画 token。

因此第一阶段：

```text
Dock step interval = 140 ms
```

继续保留，不要粗暴替换成 `spatialMs`。

---

# 9. 第二阶段：Column Scroll 改造成 FLIP Motion

这是本轮最重要的动画改造。

当前：

```text
1 | 2

Meta+L

2 | 3
```

继续让 `relayout()` 立即计算并写入最终 geometry。

不要逐帧写 geometry。

---

## 9.1 FLIP

概念：

```text
First
Last
Invert
Play
```

### First

动画发生前保存 visual geometry：

```text
oldRect[uuid]
```

### Last

调用现有：

```text
relayout()
```

得到：

```text
newRect[uuid]
```

### Invert

计算：

```text
dx = oldVisualX - newX
dy = oldVisualY - newY
sx = oldVisualWidth  / newWidth
sy = oldVisualHeight / newHeight
```

### Play

真实 geometry 已经是最终位置。

paint 时使用：

```text
translationX = lerp(dx, 0, easedProgress)
translationY = lerp(dy, 0, easedProgress)

scaleX = lerp(sx, 1, easedProgress)
scaleY = lerp(sy, 1, easedProgress)
```

最后：

```text
transform = identity
```

---

# 10. 为什么必须保持 relayout() 为唯一 geometry writer

不要实现：

```text
for each frame:
    window.frameGeometry.x += delta
```

否则会重新引入：

- geometry race；
- adoption race；
- KWin signal feedback；
- restore geometry 污染；
- Dock/KWin 状态不一致；
- Wide 状态竞争；
- 屏幕切换中间态。

正确架构：

```text
Input
  │
  ▼
State Transaction
  │
  ▼
relayout()
  │
  ▼
Final Geometry
  │
  ▼
Visual Animation
```

Motion Layer 不拥有布局。

---

# 11. MotionController

建议加入统一控制器。

最小状态：

```javascript
MotionController = {
    epoch: 0,

    type: "",
    active: false,

    startTime: 0,
    duration: 0,

    progress: 0,

    windows: new Map(),
};
```

每个窗口记录：

```javascript
{
    uuid,

    startVisualRect,
    targetRect,

    startOpacity,
    targetOpacity,

    startScale,
    targetScale
}
```

---

# 12. 最关键能力：Retarget

不能使用：

```text
stop
→ snap
→ restart
```

必须：

```text
capture current visual state
→ calculate new target
→ restart from current visual state
```

例如：

```text
Meta+L
```

动画：

```text
0 → 1
```

运动到：

```text
progress = 0.55
```

用户再次：

```text
Meta+L
```

此时：

```text
currentVisualState
       │
       ▼
作为新的 First
       │
       ▼
执行下一次 relayout()
       │
       ▼
获得新的 Last
       │
       ▼
重新动画
```

用户不应该看到任何 snap。

---

# 13. Retarget 时 duration 按剩余视觉距离计算

Clavis Launcher 的一个重要思想：

```text
duration =
baseDuration * abs(target - currentProgress)
```

窗口系统可以采用类似思想，但建议基于 visual distance 做一个下限和上限。

例如：

```javascript
ratio = clamp(distance / oneColumnDistance, 0.35, 1.0)

duration =
MotionTokens.spatialMs * ratio
```

但第一版可以先固定：

```text
220 ms
```

确认 retarget 正确后再优化动态 duration。

---

# 14. Column Scroll 第一版参数

建议：

```text
Duration:
220 ms

Curve:
standardDecel
```

视觉目标：

```text
快速进入运动
        │
        ▼
──────────────╮
              ╰────
```

不要使用明显 `InOutQuad`。

高频导航不应该：

```text
慢启动
→ 快
→ 慢结束
```

而应该：

```text
迅速响应
→ 平滑落位
```

---

# 15. Dock 远距离跳转：保持事务，升级视觉

当前远距离点击：

```text
1|2 → 2|3 → 3|4 → 4|5
```

现有约束全部保留：

- 相邻事务；
- 每步保留共同可见窗口；
- 目标只在最终 step focus；
- FIFO；
- 新 Dock click 可以取消旧计划；
- H/L 可以取消 Dock plan；
- reorder / close / insert 可以取消旧 plan。

**这些都是稳定性机制，不能为了动画删除。**

---

## 15.1 只修改 visual motion

保持：

```text
step interval = 140 ms
```

但每一步 visual motion：

```text
duration = 210 ~ 220 ms
```

因此产生自然 overlap：

```text
Step 1 animation:
0────────────220

Step 2:
       140────────────360

Step 3:
              280────────────500
```

用户看到的是：

```text
1|2 ════════════════> 4|5
```

底层仍然是：

```text
1|2
2|3
3|4
4|5
```

这是非常重要的目标：

> **底层 deterministic，视觉 continuous。**

---

# 16. Dock 点击目标窗口的焦点规则不变

当前原则继续保留：

```text
如果目标已经可见：
    只 focus
    不滚动

如果目标隐藏：
    相邻事务滚动
    最后一步 focus
```

动画系统不能提前 focus 远距离目标。

否则可能重新出现：

- target 从 Dock 位置“冒出来”；
- effect 判断错误方向；
- focus 触发额外 geometry/state 改变。

---

# 17. 第三阶段：关闭窗口补位 Motion

只动画**存活窗口**的补位。

例如：

```text
1 | 2 | 3
```

关闭 `2`：

```text
1 | 3
```

第一版不要自己接管 closed window 的 fade。

原因：

- KWin 自己已经有关闭窗口生命周期；
- closed surface snapshot 处理可能与 compositor effect 冲突；
- 不是当前最重要的问题。

只做：

```text
Window 3:
old visual rect
    ↓
new final rect
    ↓
FLIP 200~220 ms
```

这样已经能显著提升质感。

---

# 18. 第四阶段：Focus Wide Motion

当前 Wide：

```text
50%
 ↓
72%
```

已经是 paint-only Scale + Translation。

这非常适合升级，而不需要改变布局模型。

---

## 18.1 Wide Enter

建议：

```text
duration = 300 ~ 320 ms
curve = expressiveSpatial
```

效果：

```text
50%
 │
 │ grow + center
 ▼
72%
```

允许非常轻微 overshoot，但最大不要有明显 bounce。

视觉上：

```text
1.00
 ↓
1.01~1.02
 ↓
1.00
```

---

## 18.2 Wide Exit

建议：

```text
duration = 220 ~ 240 ms
curve = emphasizedAccel / standard
```

退出比进入快。

原因：

- 进入 Wide 是“展示空间变化”；
- 退出 Wide 是“返回工作状态”。

---

# 19. Wide 邻居不要直接 Fade

例如：

```text
┌────────┐┌────────┐
│ Code   ││ Zen    │
└────────┘└────────┘
```

Code 进入 Wide。

不要：

```text
Zen opacity 1 → 0
```

推荐：

```text
Code:
50% → 72%

Zen:
向右 slide 到 safe area 外
```

即：

```text
┌─────┐┌─────┐
│Code ││ Zen │
└─────┘└─────┘

          ↓

┌───────────┐       ──→ Zen
│   Code    │
└───────────┘
```

这样用户仍能保持空间认知：

```text
Zen 仍然在 Code 右边
```

---

# 20. Wide 的最终 geometry 仍由现有状态机控制

不要改变：

```text
presentation = wide
width = safeRect.width * 0.72
centered = true
```

其他窗口最终还是按现有规则停放。

Motion 只负责：

```text
old visible visual state
       ↓
target visual state
```

不修改 Presentation 逻辑。

---

# 21. Wide 离散导航继续保留

当前：

```text
1|2 → 2|3 → 3@72%
```

这是一个很好的稳定性设计。

不能因为动画变漂亮而改成：

```text
1|2 → 3@72%
```

继续保留：

```text
第一次：
到 2|3

第二次：
3 → Wide
```

只改每个 transition 的 visual motion。

---

# 22. 第五阶段：Column Reorder

快捷键：

```text
Meta+Shift+H
Meta+Shift+L
```

逻辑顺序仍由 KWin commit。

建议使用：

```text
FLIP
duration = 220 ms
curve = standardDecel
```

两个 Column 交换位置时：

```text
A | B

↓

B | A
```

视觉上应该互相 slide，而不是：

```text
A 消失
B 出现
```

---

# 23. Quickshell Dock 动画统一

窗口动画稳定后，再改 Dock。

不要反过来。

建议新增：

```text
Common/Motion.qml
```

用于 Quickshell UI。

---

## 23.1 Dock 参数

建议：

```text
icon hover:
100~120 ms
OutCubic

press:
80~100 ms

indicator move:
160~180 ms
standardDecel

tooltip fade:
120~150 ms
```

Dock 是高频控件，必须快。

---

# 24. Active Indicator 改成共享滑动对象

当前 active task 可以继续保持绿色 indicator。

但推荐避免：

```text
旧 indicator fade out
新 indicator fade in
```

改成：

```text
一个 activeIndicator
```

状态：

```text
x
width
visible
```

切换：

```text
[Zen] [Code] [Kitty]
       ━━━

↓

[Zen] [Code] [Kitty]
             ━━━
```

动画：

```text
x:
old → new

width:
old → new

duration:
170 ms
```

这样会明显精致。

---

# 25. Dock icon 不要做过度弹簧

不要：

```text
1.0
→ 1.30
→ 0.90
→ 1.10
→ 1.0
```

建议：

```text
1.0 → 1.06
```

或仅调整 iconSize。

Dock hover 应该：

```text
立即有响应
+
柔和 settle
```

而不是“果冻”。

---

# 26. 第六阶段：统一 Popup / Surface Motion

如果 cc-shell 继续增加：

- Spotlight；
- Quick Panel；
- Dock popup；
- OSD；

统一使用：

```text
enter:
210 ms

exit:
170~180 ms
```

视觉：

```text
scale:
0.96 → 1.0

translateY:
-8 → 0

opacity:
0 → 1
```

不要：

```text
scale 0.8 → 1.0
```

太像网页弹窗。

---

# 27. 第七阶段：CC OSD

OSD 可以直接使用同一套 expressive effect。

例如：

```text
┌─────────────────┐
│   Focus Wide    │
│       72%       │
└─────────────────┘
```

或：

```text
Floating
Managed
Safe Maximize
```

建议：

```text
enter:
180~210 ms

hold:
500~800 ms

exit:
150~180 ms
```

OSD 不参与 Window Layout。

---

# 28. 第八阶段：Spotlight

等基础 Motion 稳定以后再做。

第一版：

```text
windowProgress: 0..1
```

同时控制：

```text
opacity
scale
translateY
shadow
```

例如：

```text
progress = 0

scale = 0.96
y = -8
opacity = 0
```

到：

```text
progress = 1

scale = 1
y = 0
opacity = 1
```

---

# 29. Spotlight 必须可反向

例如打开到：

```text
progress = 0.43
```

用户再次按 `Meta+Space`：

不要等打开完成。

直接：

```text
0.43 → 0
```

duration：

```text
baseCloseDuration * 0.43
```

这正是 Clavis 最值得借鉴的设计之一。

---

# 30. Liquid Morph 最后再做

不要第一版就移植：

```text
spotlight_mode_field.frag
```

先做到：

```text
railProgress
  │
  ├─ main pill width
  ├─ button positions
  ├─ button sizes
  └─ icon opacity
```

确认纯几何 motion 已经舒服。

然后再考虑：

```text
SDF blending
neck
shader blur region
```

如果没有好的 motion：

> Shader 只会让不自然的运动变得更花。

---

# 31. 动画状态与布局状态必须完全分离

建议明确两个层。

---

## 31.1 Logical State

例如：

```text
managedColumns
scrollOffset
focusedColumn
presentation
floating
dockPlan
generation
```

由现有 KWin script / Bridge 管理。

---

## 31.2 Visual State

例如：

```text
visualRect
visualOpacity
visualScale
motionEpoch
progress
```

由 MotionController 管理。

禁止 MotionController 修改：

```text
column order
presentation
floating membership
dock generation
adoption state
```

---

# 32. Epoch 处理

建议 Motion 也有独立：

```text
motionEpoch
```

每个新 transition：

```text
motionEpoch++
```

回调执行前：

```text
if callbackEpoch != motionEpoch:
    ignore
```

防止：

```text
旧 animation completion
```

修改：

```text
新 transition
```

的状态。

---

# 33. 取消操作

以下事件发生时：

```text
Dock plan cancel
H/L override
reorder
close
new window insert
screen topology change
script shutdown
emergency restore
```

不能简单：

```text
visual transform = 0
```

如果下一次布局 transition 紧跟着发生，应：

```text
captureCurrentVisualState()
→ retarget()
```

只有以下情况可以直接 snap：

```text
script unload
emergency recovery
output removed
critical invariant failure
```

稳定性优先。

---

# 34. Screen / Output 变化

当：

```text
screen list changed
virtual geometry changed
output order changed
scale changed
```

第一版建议：

```text
cancel motion
snap to final authoritative geometry
recalculate safe area
```

不要尝试给屏幕拓扑变化做动画。

这类事件非常低频，没必要增加状态复杂度。

---

# 35. Adoption 与新窗口

第一版继续使用现有 adoption settle。

不建议立刻给新窗口插入加复杂动画。

原因：

- Electron / Code 需要 geometry settle；
- 首次 paint 时机复杂；
- 新窗口 animation 很容易与 adoption race。

第一版：

```text
adoption 正确 > 动画
```

等 H/L / Wide / reorder 稳定后再考虑：

```text
new column enter:
opacity + small translate
```

---

# 36. Floating

第一版：

```text
Managed → Floating
Floating → Managed
```

不需要 expressive 动画。

尤其进入 Floating 后：

- 窗口归还 KWin 正常交互；
- geometry ownership 变化。

保持当前稳定逻辑。

只允许重新加入 Managed 后的最终 Column 使用普通 FLIP settle。

---

# 37. 性能要求

Motion 系统必须避免：

- 每帧 D-Bus；
- 每帧 Bridge command；
- 每帧重新构建完整 Column model；
- 每帧写 geometry；
- 每帧 JSON serialization；
- 高频 console log；
- 每帧重新查询 app metadata。

每帧只应该：

```text
读取 monotonic progress
计算 transform
paint
```

---

# 38. Debug 模式

建议加入：

```text
motionDebug = false
```

打开后显示：

```text
Motion:
type=SCROLL
epoch=143
progress=0.63
duration=220
windows=3
```

并可打印：

```text
[MOTION] scroll start
[MOTION] retarget
[MOTION] complete
```

正常版本必须关闭高频日志。

---

# 39. Motion Transition 类型

建议第一版固定枚举：

```text
NONE

SCROLL
DOCK_SCROLL
CLOSE_REFILL
REORDER

WIDE_ENTER
WIDE_EXIT
```

暂时不要：

```text
INSERT
FLOAT
OUTPUT_MOVE
FULLSCREEN
QUICK_TILE
```

---

# 40. 冲突优先级

建议：

```text
Emergency / topology
    >
Presentation
    >
Direct keyboard navigation
    >
Dock navigation
    >
Passive refill
```

例如：

```text
Dock 正在远距离滚动
```

用户按：

```text
Meta+L
```

现有行为继续：

```text
cancel Dock plan
```

Motion：

```text
current visual state
    ↓
retarget to keyboard target
```

不要 snap。

---

# 41. 推荐开发 Phase

---

## Phase M0 — Baseline

目标：

```text
当前 alpha.30 行为冻结
```

任务：

- commit 当前 alpha.29 / alpha.30；
- 完整 Node regression；
- Bridge compile；
- 记录 H/L、Dock jump、Wide 的视频；
- 记录现在的 timing。

验收：

```text
没有未提交关键修改
```

---

## Phase M1 — Motion Tokens

实现：

```text
MotionTokens
MotionCurves
```

不改视觉。

验收：

- 所有动画 duration 有统一来源；
- 140 ms Dock transaction interval 单独保留；
- 无行为变化。

风险：

```text
低
```

---

## Phase M2 — Scroll FLIP

实现：

```text
Meta+H
Meta+L
```

只处理相邻 Column。

支持：

```text
retarget
```

验收：

```text
连续按 LLLLL 不闪烁
不 snap
不改变 Column order
不改变 focus rule
```

风险：

```text
中
```

---

## Phase M3 — Dock Scroll Integration

把现有相邻 Dock transaction 接到 MotionController。

保持：

```text
140 ms step interval
```

视觉：

```text
~220 ms per transition
```

验收：

```text
2 → 7
```

连续平滑。

同时：

- 最终 focus 正确；
- 中途 target 不激活；
- 点击新 Dock task 正确取消旧计划；
- H/L 正确接管；
- generation 不改变。

---

## Phase M4 — Close Refill

只动画 surviving window。

验收：

- 关闭左侧；
- 关闭右侧；
- 关闭焦点；
- 关闭最后一列；
- viewport 不漂移；
- focus rule 不变。

---

## Phase M5 — Reorder

实现：

```text
Meta+Shift+H/L
```

FLIP swap。

验收：

- Dock order 与 KWin order 一致；
- active window 不丢；
- 快速重复 reorder 不 snap。

---

## Phase M6 — Focus Wide

实现：

```text
Wide enter = ~320 ms
Wide exit = ~240 ms
```

目标窗口：

```text
scale / translation
```

邻居：

```text
slide away / slide back
```

验收：

```text
50 → 72 → 50
```

无 geometry 抖动。

Wide discrete navigation 继续有效。

---

## Phase M7 — Dock UI Motion

Quickshell：

```text
Motion.qml
```

实现：

- icon hover；
- press；
- active indicator slide；
- popup enter/exit。

验收：

- 无多 active line；
- 快速 hover 不残影；
- popup 打开/关闭状态一致。

---

## Phase M8 — OSD

加入：

```text
Focus Wide
Floating
Managed
Safe Maximize
```

状态反馈。

---

## Phase M9 — Spotlight

最后实现。

先 progress-based surface。

最后才考虑 liquid morph shader。

---

# 42. 回归测试矩阵

每个 Motion Phase 都必须跑以下场景。

---

## 42.1 基础 Scroll

```text
2 windows
3 windows
7 windows
```

测试：

```text
H
L
HHHH
LLLL
HLHLHL
```

---

## 42.2 连续 Retarget

在动画未结束前：

```text
L → L
L → H
H → H
H → L
```

要求：

```text
无 snap
无 ghost
无错误 focus
```

---

## 42.3 Dock

```text
visible target
hidden adjacent target
hidden far target
```

测试：

```text
2 → 7
7 → 1
2 → 7 → 4
```

中途重新点击。

---

## 42.4 Close

```text
close left visible
close right visible
close focused
close offscreen
close final column
```

---

## 42.5 Wide

```text
normal → wide
wide → normal

1|2 → 2|3 → 3@wide

wide → H
wide → L

wide window close
```

---

## 42.6 Floating

测试 Motion 不干扰：

```text
managed → floating
floating move
floating resize
floating → managed
```

---

## 42.7 Fullscreen

必须保持：

```text
F11 native fullscreen
```

Motion 不应该对 fullscreen surface 施加旧 transform。

---

## 42.8 Quick Tile / Maximize

验证：

```text
safe maximize
restore
quick tile
restore
```

不得残留 translation / scale。

---

## 42.9 双屏

测试：

```text
main → secondary
secondary → main
output disconnect
output reconnect
```

拓扑改变允许直接 snap，不要求动画。

---

# 43. Invariant

Motion 系统新增以下 invariant：

```text
1. logical geometry 永远来自 relayout
2. Motion 不写 Column order
3. Motion 不写 Presentation state
4. Motion 不写 adoption ownership
5. complete 后所有 visual transform = identity
6. inactive transition 不得留下 scale / translation
7. motion epoch 不允许旧 completion 修改新 motion
8. emergency restore 必须能直接清空 Motion
```

---

# 44. 紧急恢复

现有：

```text
Meta+Ctrl+Alt+Shift+F12
```

执行时新增：

```text
MotionController.cancelAll(true)
```

其中：

```text
true = snap
```

然后再执行原恢复流程。

恢复优先级：

```text
安全恢复 > 动画完整播放
```

---

# 45. 推荐 Motion API

建议最终形成类似接口。

伪代码：

```javascript
MotionController.begin({
    type: MotionType.SCROLL,
    duration: MotionTokens.spatialMs,
    curve: MotionCurves.standardDecel,
    windows: affectedWindows
});
```

如果已有 transition：

```javascript
MotionController.retarget({
    type: MotionType.SCROLL,
    targetRects: newRects
});
```

结束：

```javascript
MotionController.finish(epoch);
```

紧急：

```javascript
MotionController.cancelAll({ snap: true });
```

---

# 46. 推荐事件流程：Meta+L

```text
Meta+L
  │
  ▼
cancel Dock navigation plan
  │
  ▼
capture current VISUAL state
  │
  ▼
logical focus/viewport update
  │
  ▼
relayout()
  │
  ▼
capture final geometry
  │
  ▼
MotionController.retarget()
  │
  ▼
paint FLIP
  │
  ▼
progress = 1
  │
  ▼
clear visual transform
```

---

# 47. 推荐事件流程：Dock 远距离任务

```text
Click target 7
  │
  ▼
build plan
[2|3] [3|4] [4|5] [5|6] [6|7]
  │
  ▼
step 1
  │
  ├─ relayout
  └─ Motion retarget
       │
       │ 140ms
       ▼
step 2
  │
  ├─ relayout
  └─ Motion retarget
       │
       ▼
...
       │
       ▼
final step
       │
       ▼
focus target 7
```

底层仍然可靠。

视觉变得连续。

---

# 48. 推荐事件流程：Wide

```text
Meta+Z
 │
 ▼
capture current visual state
 │
 ▼
presentation = WIDE
 │
 ▼
relayout final 72%
 │
 ▼
target window:
FLIP scale + translation

neighbors:
slide toward respective edge
 │
 ▼
320 ms expressive spatial
 │
 ▼
clear transforms
```

退出使用同样架构反向。

---

# 49. 第一轮参数表

建议先用这套，不要无限调参。

| 动画 | Duration |
|---|---:|
| Dock Press | 90 ms |
| Dock Hover | 110 ms |
| Active Indicator | 170 ms |
| Popup Enter | 210 ms |
| Popup Exit | 175 ms |
| Column Scroll | 220 ms |
| Close Refill | 210 ms |
| Reorder | 220 ms |
| Wide Enter | 320 ms |
| Wide Exit | 240 ms |
| OSD Enter | 190 ms |
| OSD Exit | 160 ms |

Dock far-scroll：

```text
step interval = 140 ms
visual duration = 220 ms
```

---

# 50. 调参规则

只允许按以下顺序调。

### 先调 duration

判断：

```text
太慢 / 太快
```

### 再调 deceleration

判断：

```text
落位是否自然
```

### 最后调 overshoot

判断：

```text
是否需要生命感
```

不要一开始同时改：

```text
duration
curve
scale
opacity
overshoot
```

否则无法判断问题来源。

---

# 51. 什么叫“正确的动画”

不是“明显”。

而是：

```text
用户知道窗口从哪里来到哪里
+
操作立即响应
+
落位柔和
+
连续操作不打断思路
```

优秀状态：

> 用户注意到系统很顺，但不会每次都注意到动画本身。

---

# 52. 什么叫“失败的动画”

以下任何一个出现都应该回退：

```text
按键后感觉慢半拍
连续 L 时窗口停顿
动画中再次操作出现 snap
focus 已经变了但视觉窗口没跟上
Wide 邻居突然消失
Dock 与窗口运动节奏不一致
窗口到了最终位置后再抖一下
动画结束后 geometry 再跳一次
双屏间出现 ghost
```

---

# 53. 版本建议

建议从当前 `alpha.30` 往后：

```text
alpha.31
Motion Tokens + Curves

alpha.32
Retargetable Scroll FLIP

alpha.33
Dock Continuous Visual Scroll

alpha.34
Close Refill + Reorder Motion

alpha.35
Expressive Focus Wide

alpha.36
Quickshell Dock Motion

alpha.37
OSD

beta.1
Motion stability freeze
```

Spotlight 可以独立于窗口核心版本继续开发。

---

# 54. 第一阶段不要做的优化

在 Motion 稳定前，不做：

```text
spring physics engine
velocity-based inertia
gesture physics
window blur transition
window corner morph
liquid window edge
shader-based window distortion
3D tilt
background parallax
```

这些都不是当前日用价值最高的部分。

---

# 55. 最终目标

最终 CC Niri Maximize 的动画应该表现为：

### Column Navigation

```text
空间连续
快速响应
柔和落位
可随时反向
```

### Dock Navigation

```text
逻辑仍逐列
视觉近似连续
```

### Focus Wide

```text
明显但不夸张
邻居保持空间方向
```

### Dock / Bar

```text
短促
克制
统一
```

### Spotlight / OSD

```text
稍微 expressive
但仍遵循同一 motion language
```

---

# 56. 最终架构图

```text
                 ┌──────────────────────┐
                 │     User Input       │
                 │ H/L / Dock / Z / ... │
                 └──────────┬───────────┘
                            │
                            ▼
                 ┌──────────────────────┐
                 │ Logical Transaction  │
                 │ focus/order/state    │
                 └──────────┬───────────┘
                            │
                            ▼
                 ┌──────────────────────┐
                 │      relayout()      │
                 │ authoritative geom   │
                 └──────────┬───────────┘
                            │
              ┌─────────────┴──────────────┐
              │                            │
              ▼                            ▼
     ┌──────────────────┐          ┌─────────────────┐
     │ MotionController │          │ Bridge / Dock   │
     │ visual snapshots │          │ logical sync    │
     │ progress/retarget│          └─────────────────┘
     └─────────┬────────┘
               │
               ▼
     ┌──────────────────┐
     │   KWin Effect    │
     │ FLIP/scale/alpha │
     └─────────┬────────┘
               │
               ▼
            Display
```

---

# 57. 最重要的三条实现原则

## 原则 1

```text
永远不要为了动画破坏 relayout() 的唯一 geometry authority。
```

## 原则 2

```text
连续操作必须 retarget 当前 visual state，而不是 stop → snap → restart。
```

## 原则 3

```text
底层事务可以离散，但视觉运动应该连续。
```

对于当前项目，第三条尤其重要。

你的 Dock 远距离滚动已经有一个可靠的离散相邻事务模型。

因此最理想的优化不是替换它，而是：

```text
Reliable discrete state machine
            +
Continuous visual motion
```

这也是本次借鉴 Clavis Motion System 的核心目标。

---

# 58. 开发开始前 Checklist

开始 `alpha.31` 前：

- [ ] 提交当前 alpha.29 / alpha.30 未提交修改
- [ ] 保存完整 regression baseline
- [ ] 录制当前 H/L 动画
- [ ] 录制当前 2 → 7 Dock jump
- [ ] 录制当前 Focus Wide
- [ ] clone Clavis reference repo
- [ ] 阅读 `Common/Animations.qml`
- [ ] 阅读 `Common/KeystoneMotion.qml`
- [ ] 阅读 `LauncherWindow.qml` 的 progress / retarget
- [ ] 阅读 `SpotlightStyle.qml`
- [ ] 阅读 `DockItem.qml`
- [ ] 不直接复制 Shader
- [ ] 建立 Motion token
- [ ] 从相邻 `Meta+H/L` 开始实现

---

# 59. 第一项实际开发任务

第一项任务只做：

```text
Meta+H / Meta+L
```

完成标准：

```text
1. 最终 geometry 与 alpha.30 完全一致
2. Column 顺序完全一致
3. focus 行为完全一致
4. Dock 同步完全一致
5. 单次 H/L 更自然
6. 快速 LLLLL 无 snap
7. 快速 HLHL 无 snap
8. 动画结束所有 transform 归零
9. emergency restore 正常
10. regression tests 全部通过
```

只有这一项完全稳定后，再把 MotionController 接入 Dock far-scroll。

---

# 60. 项目方向

这套实现完成以后，CC Niri Maximize 的核心竞争点不再是：

```text
“复制了多少 niri 功能”
```

而应该是：

```text
KDE / KWin 的稳定能力
        +
niri-like scrolling workflow
        +
Clavis-like motion language
```

这三者结合以后，比继续增加复杂窗口模型更符合日常使用目标。
