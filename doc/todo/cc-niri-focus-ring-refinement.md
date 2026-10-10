# cc-niri Focus Ring 美化实现方案

## 1. 目标

当前 cc-niri 已经具备 active window 光圈效果，整体方向正确：

- 使用浅蓝 / 青蓝色高亮；
- 能够明确区分当前聚焦窗口；
- 与深色 Zed、Plasma 暗色界面较协调；
- 不需要重新设计颜色体系。

下一步优化重点不是“换颜色”，而是提升光圈的层次、动态与桌面融合感。

本次目标：

1. 保留现有蓝色主色调；
2. 将当前单层光圈改为“清晰内边框 + 弱柔光”两层结构；
3. 保证光圈圆角与窗口圆角严格一致；
4. 为焦点切换增加短时淡入淡出动画；
5. 焦点获得时增加轻微的 glow 收敛效果；
6. 与 cc-niri 的 H/L 横向滚动动画同步；
7. 避免呼吸灯、颜色循环、流光等过度视觉效果；
8. 保证 4K / 60 Hz 下仍然清晰、稳定且不过度抢眼。

---

## 2. 当前效果判断

当前蓝色本身不需要修改。

目前视觉上已经具备较好的辨识度，问题主要集中在以下几项：

- 光圈层次相对单一；
- 边框与 glow 没有明显分工；
- focus 切换如果是瞬时切换，会显得偏“硬”；
- 如果 glow 四边完全一致，会稍微有普通矩形描边的感觉；
- 若圆角与窗口圆角不完全一致，会明显破坏精致感。

因此，本阶段不应该重做 focus indicator，而应该在现有实现基础上做精修。

---

# 3. 设计原则

## 3.1 保留蓝色主色

建议继续使用当前浅蓝 / 青蓝风格。

推荐参考范围：

```text
#7BB5F9
#7CB7FF
#80C0FF
```

不要使用过度纯净、高饱和的蓝色，例如：

```text
#0080FF
#00A0FF
```

原因：

- 过高饱和度容易产生“电竞 RGB”感；
- 当前桌面整体是深灰 / 蓝灰色；
- 略带灰度的浅蓝更容易融入 Plasma / Zed；
- 与绿色桌面壁纸也有足够区分度。

颜色不应该成为当前阶段的主要调整对象。

---

# 4. 光圈结构

建议将 focus ring 拆成两层：

```text
        very soft glow
     · · · · · · · · ·
      ╭─────────────╮
      │             │
      │   Window    │
      │             │
      ╰─────────────╯
         crisp line
```

分别承担不同职责。

---

## 4.1 Inner Border

职责：

- 明确标识 active window；
- 保证边缘清晰；
- 在复杂背景下依旧具有足够辨识度。

推荐参数：

```text
width:   1.5 ~ 2.0 logical px
alpha:   0.80 ~ 0.90
color:   保持当前浅蓝色
```

建议默认值：

```text
width = 1.5 px
alpha = 0.85
```

如果当前实现只能使用整数 logical px，则优先使用：

```text
2 px
```

但不要继续加粗。

---

## 4.2 Outer Glow

职责：

- 提供轻微悬浮感；
- 避免 focus border 看起来像普通 debug rectangle；
- 让 active window 与桌面背景之间产生自然分离。

推荐参数：

```text
radius:  5 ~ 7 logical px
alpha:   0.12 ~ 0.18
spread:  尽量小
```

建议默认值：

```text
radius = 6 px
alpha  = 0.15
```

注意：

- glow 不应该比 border 更抢眼；
- glow 应该是辅助效果，而不是主要 focus indicator；
- 不要通过增大 glow 半径来提升辨识度；
- 需要更强辨识度时优先增加 inner border alpha，而不是增加 glow。

---

# 5. 四边亮度关系

如果现有渲染架构允许，可以让顶部稍强、底部稍弱。

推荐：

```text
top:     1.00
left:    0.85
right:   0.85
bottom:  0.65
```

示意：

```text
      strongest
    ╭──────────────╮
    │              │
    │              │
    ╰──────────────╯
       weakest
```

这样做的目的不是制造明显渐变，而是降低“完全均匀矩形描边”的机械感。

实现时应非常克制。

如果需要引入大量特殊 shader 或复杂代码才能实现，可以暂时不做。

优先级低于：

1. 双层结构；
2. focus transition；
3. 与窗口动画同步。

---

# 6. 圆角处理

Focus Ring 必须严格跟随窗口圆角。

不要出现：

```text
window radius = 10
focus radius  = 8
```

也不要让 glow 在圆角位置明显突出或切断。

推荐：

```text
focus_radius = window_radius + ring_offset
```

例如：

```text
window_radius = 10 px
ring_offset   = 2 px
focus_radius  = 12 px
```

这里的 ring offset 应与 focus ring 实际向外扩展的距离对应。

要求：

- 四角连续；
- 不出现方角 glow；
- 不出现 border 与窗口圆角相交；
- DPI / fractional scaling 下仍然稳定。

---

# 7. Focus Transition

这是本阶段最值得实现的视觉改进之一。

当前焦点从窗口 A 切换到窗口 B 时，不建议瞬间：

```text
A OFF
B ON
```

应该改成：

```text
A:
opacity 1.0 -> 0.0

B:
opacity 0.0 -> 1.0
```

推荐持续时间：

```text
120 ~ 160 ms
```

建议默认：

```text
140 ms
```

---

## 7.1 Focus Gain

新窗口获得焦点时：

```text
opacity:
0.0 -> 1.0

glow radius:
7 px -> 5 px
```

也就是说，刚出现时 glow 稍微松一点，然后快速收敛到窗口边缘。

视觉效果应该接近：

```text
soft appearance
      ↓
focus converges
      ↓
stable active border
```

注意：

- 不要做 scale 动画；
- 不要让整个窗口放大；
- 只调整 focus ring 自身；
- 不要出现明显 pulse。

---

## 7.2 Focus Loss

旧窗口失去焦点：

```text
opacity:
1.0 -> 0.0
```

即可。

不要做：

```text
glow radius:
5 -> 20
```

也不要做复杂退场。

Focus loss 应比 focus gain 更简单。

---

# 8. 与 H/L 滚动动画同步

cc-niri 的核心视觉体验之一是 H/L 横向窗口移动。

因此 focus ring 不应该作为独立于窗口运动的 UI 层存在。

例如：

```text
┌────1────┐ ┌────2────┐
  active
```

按下 `L` 后：

```text
horizontal scroll
+
focus transition
```

应同时开始。

推荐时间关系：

```text
0 ms
│
├─ horizontal movement starts
├─ old focus fade starts
├─ new focus fade starts
│
140 ms
│
└─ focus transition settles
│
│
250 ms
│
└─ horizontal movement / spring settles
```

重点：

> Focus ring 不需要等窗口滚动结束后再切换。

否则会产生明显的“窗口先移动、光圈后跟上”的迟滞感。

---

# 9. 状态模型建议

不要仅用：

```cpp
bool focused;
```

决定是否立即绘制 focus ring。

建议为每个窗口维护独立 focus visual state，例如：

```text
focus_target
focus_progress
glow_progress
```

概念模型：

```cpp
struct FocusVisualState {
    bool targetFocused;

    float opacity;
    float targetOpacity;

    float glowRadius;
    float targetGlowRadius;
};
```

或者统一为一个动画进度：

```text
focus_progress ∈ [0, 1]
```

然后：

```text
border_alpha = 0.85 * focus_progress
glow_alpha   = 0.15 * focus_progress
```

glow radius 可进一步映射：

```text
glow_radius =
    lerp(7 px, 5 px, focus_progress)
```

---

# 10. Render State 与 Layout State 分离

Focus ring 应跟随窗口的实际 render geometry，而不是只读取最终 layout geometry。

建议结构：

```text
Layout Geometry
      │
      ▼
Animation State
      │
      ▼
Render Geometry
      │
      ├─ Window
      └─ Focus Ring
```

即：

```text
focus ring geometry = current animated window geometry
```

而不是：

```text
focus ring geometry = target window geometry
```

否则在窗口滚动或 resize 动画过程中，光圈可能提前跳到终点。

---

# 11. 与窗口移动动画绑定

如果窗口有：

```text
layout_x
render_x
```

Focus Ring 必须使用：

```text
render_x
```

同理：

```text
layout_width
render_width
```

Focus Ring 使用：

```text
render_width
```

推荐：

```cpp
Rect focusRect = window.currentRenderRect();
```

而不是：

```cpp
Rect focusRect = window.targetLayoutRect();
```

这对于后续 cc-niri 的连续滚动体验非常重要。

---

# 12. Render 顺序

推荐渲染顺序：

```text
1. Outer glow
2. Window shadow
3. Window surface
4. Inner focus border
```

如果当前 KWin compositor 的 render pipeline 不适合这种顺序，也可以使用：

```text
1. Window shadow
2. Outer focus glow
3. Window surface
4. Inner border
```

需要保证：

- glow 不覆盖应用内容；
- inner border 在视觉上足够清晰；
- focus ring 不影响窗口 client area；
- focus ring 不修改真实 window geometry。

---

# 13. 不建议实现的效果

本阶段明确不实现：

```text
呼吸灯
颜色循环
RGB 流光
持续 pulse
focus ring 自动闪烁
沿边缘移动的 gradient
窗口缩放
焦点切换时弹跳
高强度 bloom
```

原因：

- 与 cc-niri 当前极简方向不一致；
- 长时间使用容易产生视觉疲劳；
- 会抢夺窗口内容的注意力；
- 对 4K / 60 Hz 并不会提升真实流畅度；
- 会增加 compositor 渲染复杂度。

---

# 14. 性能要求

Focus ring 属于持续存在的桌面效果，必须保持轻量。

要求：

```text
idle 状态不持续触发动画
focus animation 完成后停止 repaint
不要使用持续 timer
不要持续修改 opacity
不要持续改变 glow radius
```

理想行为：

```text
focus changed
    ↓
启动 140 ms 动画
    ↓
请求 repaint
    ↓
动画结束
    ↓
进入静态状态
```

不要做：

```text
每帧永久 repaint
```

---

# 15. 4K / Fractional Scaling

当前使用环境可能包含 4K 屏幕和 fractional scaling，因此需要避免直接硬编码 device pixel。

推荐统一使用：

```text
logical pixel
```

然后由 compositor / render backend 转换到物理像素。

需要测试：

```text
100%
125%
150%
175%
200%
```

重点检查：

- 1.5 px border 是否发虚；
- 圆角是否一致；
- glow 是否产生锯齿；
- 左右边宽度是否一致；
- 上下边是否出现不同物理像素厚度。

如果 1.5 logical px 在某些 scale 下效果不稳定，可以按 scale 做 pixel alignment。

---

# 16. 建议默认参数

第一版可以直接采用：

```text
focus_color       = current blue

border_width      = 1.5 logical px
border_alpha      = 0.85

glow_radius       = 5.5 logical px
glow_alpha        = 0.15

focus_in_duration = 140 ms
focus_out_duration= 140 ms

gain_glow_start   = 7.0 px
gain_glow_end     = 5.5 px
```

如果只能使用整数：

```text
border_width = 2 px
glow_radius  = 6 px
```

---

# 17. 推荐实现阶段

## Phase F1 — Focus Ring 分层

实现：

```text
inner border
+
outer glow
```

要求：

- 保留当前蓝色；
- 不改变 focus 判断机制；
- 不添加动画；
- 先验证静态视觉效果。

完成标准：

- active window 清晰；
- glow 足够弱；
- 四角无异常；
- 4K 下边缘清楚。

---

## Phase F2 — Focus Fade

增加：

```text
old window:
1 -> 0

new window:
0 -> 1
```

时间：

```text
140 ms
```

完成标准：

- 快速切焦点不会闪；
- 连续 H/L 不出现 focus ring stuck；
- 动画结束后不会持续 repaint。

---

## Phase F3 — Focus Gain 收敛

新窗口获得焦点：

```text
opacity:
0 -> 1

glow radius:
7 -> 5.5
```

要求：

- 效果必须非常轻；
- 不允许出现明显 pulse。

---

## Phase F4 — H/L Animation Integration

将 focus transition 和横向 movement 使用同一个 animation clock / timeline。

目标：

```text
window movement
+
focus change
```

成为一次统一视觉事件。

完成标准：

- 光圈不提前跳到 target geometry；
- 光圈始终跟随 render geometry；
- 快速连续 H/L 时没有断层。

---

## Phase F5 — Edge Weighting

可选阶段。

尝试：

```text
top    1.00
left   0.85
right  0.85
bottom 0.65
```

如果需要显著增加代码复杂度，则放弃此阶段。

---

# 18. 测试场景

必须至少覆盖以下情况。

## 单窗口

```text
1
```

测试：

- focus ring 静态显示；
- 圆角；
- maximize；
- restore。

---

## 两窗口

```text
1 | 2
```

测试：

```text
H
L
H
L
```

观察：

- focus fade；
- movement 同步；
- 无残留光圈。

---

## 快速切换

连续输入：

```text
L L H H L H L
```

检查：

- animation interrupt；
- focus state；
- opacity；
- stale animation。

---

## Resize

例如：

```text
1/3
→
1/2
→
2/3
→
1
```

Focus ring 必须实时跟随当前 animated geometry。

不要提前跳到 target width。

---

## 多窗口滚动

```text
1 | 2 | 3 | 4
```

执行：

```text
L
L
L
H
H
```

检查 off-screen 窗口的 focus ring 是否正确消失和重新出现。

---

## Workspace 切换

如果当前已经存在多工作区支持，则检查：

```text
workspace 1
→
workspace 2
→
workspace 1
```

不得出现：

- 两个窗口同时高亮；
- 上一个 workspace 的 glow 残留；
- focus ring 停在旧位置。

---

# 19. 验收标准

完成后应达到：

```text
[ ] 当前蓝色主色保留
[ ] inner border 清晰但不厚重
[ ] outer glow 柔和
[ ] glow 不抢内容
[ ] 圆角严格匹配窗口
[ ] focus 切换无瞬闪
[ ] focus acquire 有轻微收敛
[ ] H/L 时 focus 与窗口一起运动
[ ] 使用 render geometry 而非 target geometry
[ ] resize 时 focus ring 不跳变
[ ] 快速输入不会残留旧动画
[ ] 动画结束后停止持续 repaint
[ ] 4K 下边缘仍然清晰
[ ] fractional scaling 正常
```

---

# 20. 最终目标视觉

最终不应追求“炫”。

目标是：

```text
        faint blue glow
     · · · · · · · · ·
      ╭─────────────╮
      │             │
      │   Window    │
      │             │
      ╰─────────────╯
        crisp blue
```

视觉关键词：

```text
clean
subtle
smooth
integrated
```

Focus Ring 应该让用户立即知道：

> 当前焦点在哪。

但几秒钟以后，用户不应该持续注意到：

> 这里有一个特效。

这应该成为 cc-niri focus indicator 的最终设计原则。
