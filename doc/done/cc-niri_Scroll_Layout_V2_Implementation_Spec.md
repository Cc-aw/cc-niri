# CC-Niri Scroll Layout V2：niri 风格连续列布局实现规范

> **归档状态（2026-10-20）：已实施。** P0–P5 与 P6 准备工具已实现，已获授权部署并启用；完整真实交互、4K60、mixed DPI 和全项目资源验收仍 Pending。结果见 [P6 记录](../../test/SCROLL_LAYOUT_V2_P6_LIVE_RESULTS.md)，恢复重试的后续修复见 [热重载记录](../../test/SCROLL_LAYOUT_V2_RELOAD_RESULTS.md)。 原设计正文保留为历史依据；移入 `done/` 不代表未执行的验收已通过。

> **文档用途**：直接交给 Codex 按阶段实施的设计与验收规范，不是已实施结果。<br>
> **基线日期**：2026-10-14<br>
> **基线仓库**：[`Cc-aw/cc-niri`](https://github.com/Cc-aw/cc-niri) / `main`<br>
> **锁定提交**：[`8056cfe6b4a023ac8dcbfb01e4495a5acf4c2c4e`](https://github.com/Cc-aw/cc-niri/commit/8056cfe6b4a023ac8dcbfb01e4495a5acf4c2c4e)<br>
> **目标环境**：Fedora 44、KWin/Plasma Wayland、主屏 3840×2160@60Hz/150%、副屏 2560×1440@60Hz/100%、内存 16 GiB<br>
> **核心约束**：保留 Rust Core/JS Control Plane/C++ KWin Adapter 分权、既有单列居中、4K60 动画、Focus Ring、工作区 J/K、安全停用与低内存契约。<br>
> **设计编写时状态（2026-10-14）**：**DESIGN / NOT IMPLEMENTED / 实机验收 PENDING**。当前实施状态见页首归档说明。文中的数值为设计测试样例，不是新功能的实机结果。

---

## 0. Codex 执行总要求

本任务是将当前主屏固定 Safe Area + Pair/Wide 布局，升级为 **niri 风格的独立列宽 + 连续横向列空间 + 单一视口摄像机模型**。不是给已有 `PAIR_TO_WIDE` 再补一种布局，也不是仅把 `half` 改成 `twoThirds`。

1. 首先检查 `git status --short`、`git rev-parse HEAD`、已有组件状态和提交差异。本文锁定 `8056cfe...` 为审查基线；若本地有更新、未提交修改或文档外额外功能，必须先读懂并保留，不得整体 reset、stash、rebase、覆盖工作树或修改冻结 Golden。
2. **只在独立开发分支和离线测试环境实现。** 未经用户明确授权，不得操作用户正在使用的 KWin 会话、变更 `kwinrc`、安装、stop/start、卸载 Effect、重启 KWin/Plasma、移动/关闭现有窗口或切换输出模式。每个阶段可以独立提交；禁止声明尚未做的实机测试已通过。
3. 保留根 `AGENTS.md` 与 `native/AGENTS.md`：Rust 1.99.0、`/usr/bin/g++` GCC 16.x、`--locked`、`node tools/build.js` 生成脚本、完整 Native Gate 和 16 GiB 预算。不要编辑 `package/contents/code/main.js` 中的**生成模块段**；只编辑 `src/`，确需调整 main 手写编排时遵循已有 markers。
4. **必须先完成 V2-P0 平台可行性验证**，再实施多窗口部分可见的实机功能。不能为了截图正确而把真实窗口推入副屏、制造错误鼠标点击、黑屏或内存泄漏。
5. 新功能独立开关，默认 `false`；V2 未通过全量门禁和用户实机验收之前，V1 行为必须保持字节级或语义等价：`half↔full`、原 Wide、`AlwaysCenterSingleColumn`、当前副屏边距、J/K、H/L、Dockless、Ring、SCROLL v2 和 COLUMN_REINDEX 的现有协议契约均不能悄悄退化。
6. 将每阶段实现、失败、尚未解决的 KWin API 限制、测量结果和回滚方式写在 `test/SCROLL_LAYOUT_V2_*_RESULTS.md`。不要把算法单测、模拟截图或短时间 UI 检查当作长期稳定性/真实性能验收。

---

## 1. 用户需求与验收定义

| ID | 用户需求 | V2 验收含义 |
|---|---|---|
| UX-01 | 不再受现有 Safe Area 的左右边界约束 | 视口的最终**绘制/输入裁切边界**是当前主显示器的物理输出逻辑范围（`OutputRect`）；窗口横向排布由每列宽度和统一间距计算，不能把旧 `safeRect` 当作部分可见截止线 |
| UX-02 | 每个窗口独立循环 `1/2 → 2/3 → 1 → 1/2` | 该宽度属于**列的持久属性**，不是临时 Wide、快速平铺、独占展示或 KDE Fullscreen。宽度改变不会隐式修改其他列的宽度 |
| UX-03 | 焦点位于 2/3 列时居中 | 活动 2/3 列居中；邻居保持原始宽度/逻辑顺序，可在输出左右边缘只露出部分。被裁掉的部分不能跑到副屏，也不能突然 Park 或闪退 |
| UX-04 | 四周距离一致 | 所有正常平铺窗口的上下、左右**统一逻辑 gap `g`**，列间隙也为 `g`。与 KDE 面板占用冲突时，先尊重官方 WorkArea，然后相对于 WorkArea 使用对称 gap；不要为顶部面板单独硬编码 `GapTop=50` |
| UX-05 | 与 niri 相似的滚动行为 | 焦点改变优先平移共享视口，列宽不会因焦点被改变；半宽普通列维持最小必要滚动，单列时自动居中，2/3 焦点优先居中 |
| UX-06 | 动画丝滑 | H/L 在快速反向、连续宽度变化和部分裁切情况下从最后**实际绘制**的视口状态接管，禁止视觉回退、闪现、瞬移、错误 park 或连续动画被旧 ACK 覆盖 |
| UX-07 | 兼容现有项目 | J/K、工作区快照/恢复、Fullscreen、Dialog/Transient、Floating、次屏独立工作区、Focus Ring、D-Bus Bridge 和 `cc-niri stop` 安全恢复可用 |
| UX-08 | 低内存、高刷新率 | 不新增 daemon、线程、独立动画时钟、大面积中间纹理或逐帧 JSON；不恶化 4K60 长帧，按受控 A/B 验证整体 PSS、Frame Presented 与对象生命周期 |

**不在本期范围**：多窗口垂直堆叠 Column、Overview、将副屏改造成新的滚动布局、第三方 Dock UI 重写、完全替换 KWin/Wayland 的输入/窗口管理权限。V2 不能宣称已经具有 niri 独立合成器所有能力。

---

## 2. 已推送版本的真实基线（源码核查）

### 2.1 已有功能：必须保留、不得重新发明

| 功能 | 当前实现位置 | 本次处理 |
|---|---|---|
| `AlwaysCenterSingleColumn`、正数逻辑前导留白 | `src/kwin/layout/ColumnLayout.js`、`RuntimeConfig.js`、KConfig | **复用思想**，扩展为 V2 通用视口边界；不保留“只支持 half”的隐含限制 |
| 1↔2 半列重排连续动画 | `src/kwin/layout/SingleColumnTransition.js` | **保留 V1；V2 借鉴其 basis/ACK 技术**。当前只接受 half、同宽、唯一 survivor；不能冒充通用宽度重排 |
| Typed `COLUMN_REINDEX` | `src/kwin/layout/ScrollMotionPlan.js`、Rust `native_protocol.rs`/`scroll_runtime.rs` | 原类型和校验语义不能破坏。新列宽改变需要独立、经过验证的通用几何协议或受控专用流程 |
| 共享 Rust Spring Scroll / `smooth60` | `native/rust/cc-niri-native-core/src/scroll_runtime.rs`、`ViewportClipEffect.cpp` | 保留唯一运动 owner 和最后 painted retarget；修正部分可见时的策略边界 |
| 滚动协议发布顺序 | `ScrollPlanCommitGate.js`、`RuntimeBridge.js`、`bridge/src/CCNiriBridge.cpp` | 保留 membership publish ACK → motion publish ACK → Native arm ACK → geometry/activation；失败须有界 cancel/fallback |
| J/K 420ms Rust workspace motion | `workspace_motion.rs`、`WorkspaceSlideAdapter.cpp` | 不修改工作区曲线/焦点 authority。D1a 投影缓存、D2 时钟限制仍为独立可选项，默认禁用 |
| Native Focus Ring | `native/focus-ring/`、`src/kwin/visual/FocusRingController.js` | 保留真实 KWin focus owner，跟随相同 visual transform 和输出裁切 |
| 16 GiB 资源预算及生命周期门禁 | `AGENTS.md`、`test/CC_NIRI_GLOBAL_MEMORY_*` | 新功能须计入整个项目资源账本，不能宣称既有预算已测达标 |

### 2.2 导致 V2 无法直接增加一个比例的旧假设

**L-01 两档列宽。** `ColumnStore.normalizeColumnWidthMode()` 仅接受 `full`，否则全部折算 `half`。`ColumnWidthController.cycle()` 仅是 half/full，`deriveColumnLayout()` 依赖相同 `safeWidth`。历史 `third/twoThirds` 在快照迁移时原本也会被折算为 half。

**L-02 只有 Full 才触发部分可见。** `LayoutEngine.computeLayoutPlan()` 的 `partialLayout` 以 `columns.some(widthMode === "full")` 为条件，并以 `isRectFullyVisible()` 作为普通列的可见判断。这会让一个仅有 2/3 + 1/2 的邻居列因为未全宽进入旧 Safe Area 而直接 Park。

**L-03 ViewOffset 上界缺少通用尾部留白。** `computeStripWidth()` 返回末列右边缘，`boundScrollOffset()` 将 camera 限制在 `[0, max(stripWidth - viewportWidth, 0)]`。现在的前导留白按 half 计算，适合单 half，但不足以一般性保证最后一个 2/3 列可居中，Pair 边界还可能受到末尾 clamp 干扰。

**L-04 部分裁切耦合动画降级。** Rust `scroll_runtime.rs` 使用 `use_smooth = smooth && !clip_partial`，`carry` 也拒绝部分裁切。这是现存设计事实。V2 必须**分别**表示“需要 Native paint/input clip”和“允许安全的速度继承”；严禁把 `clipPartial` 简单删掉。

**L-05 输入坐标和物理 output 归属问题。** KWin 当前真实窗口 `frameGeometry` 与 Native `WindowPaintData` 平移属于不同空间。`ViewportInputClip` 主要利用临时隐藏与原生命中流程阻止窗口超出视口的错误命中，尚不具备 niri 原生合成器式任意平移后的 Wayland surface 局部输入坐标重映射。渲染正确不等于点击正确。

**L-06 旧 Wide 负责“聚焦变宽”。** `ContextualViewport.js` 使用 `pair/wide-focus`，`PresentationController` 使用单独 72% 宽度，`PAIR_TO_WIDE/WIDE_TO_PAIR` 隐藏邻居。V2 不应继续以这条特殊展示链实现 2/3；它必须是正常持久列宽。

**L-07 旧快照不能保存 V2 中心锚点。** `WorkspaceSnapshotStore`、`StartupLayout` 仅接受非负 `viewportAnchor.delta`。真实中心锚点可能 `camera - column.logicalX < 0`；目前无可用旧锚点时会丢掉中心视口相对位置。Bridge state protocol 2 当前同时验证根列/活动工作区列顺序和宽度，需要保证新宽度跨两处一致。

**L-08 旧不对称 gap。** 当前主屏默认 `top/bottom/left/right/inner = 50/8/24/24/8`，副屏默认四周 24；其中主屏顶部留白并不等于窗口之间的空隙。V2 不应该仅给它们赋相同数值并继续名为 Safe Area。

> 注意：上述是从 `8056cfe...` 仓库源码确认的事实；下面的“新增类型、设置和策略”均为设计提案，不代表已经存在。

---

## 3. V2 总体架构：三个几何空间，一套布局权威

```text
KWin Output / panel struts
       │
       ▼
OutputTopology / LayoutGeometry（JS；无渲染）
  ├─ OutputRect       : 输出的完整逻辑矩形，物理裁切边界
  ├─ WorkingArea      : KWin clientArea 排除真正面板占用后的布局范围
  ├─ Gap              : 所有正常列统一的逻辑间距 g
  └─ PhysicalScale    : 物理像素对齐参数，仅在输出映射边界使用
       │
       ▼
ColumnStore（JS）：独立列宽 half / twoThirds / full；稳定窗口 ID、顺序
       │
       ▼
ContinuousColumnLayout（纯 JS）：prefix-sum → logicalX、宽度、前后虚拟留白
       │
       ▼
ViewportPolicy（纯 JS）：fit / center → targetScrollOffsetX（非负）
       │
       ▼
LayoutEngine：old/new projected rectangles + partiallyVisible + transition roles
       │
       ▼
Existing ScrollPlanCommitGate + RuntimeBridge + Native Protocol
       │                                │
       └─ ACK → GeometryCommitter       ▼
                          Rust ScrollViewportRuntime（唯一 Spring/Frame Authority）
                                        │
                          KWin Clip Adapter：投影、绘制、输入保护、Ring 对齐
```

**权威边界**：列顺序、宽度、焦点意图、工作区归属和 `targetScrollOffsetX` 只由 JS 决定；Rust 负责可验证的运动/边界/协议数值；C++ 负责 KWin 对象、真实窗口几何、Scene/paint/input、FFI 和时钟事实。不要创建另一套持久窗口模型、焦点 owner 或 Spring。

### 3.1 三类区域及优先级

- `OutputRect`：`output.geometry`，用来禁止像素、纹理和窗口输入穿越到相邻物理输出；2/3 邻居允许延伸到**输出边缘**，不是旧 safeRect 边缘。
- `WorkingArea`：优先向 KWin 查询当前输出、工作区对应的 `workspace.clientArea(KWin.MaximizeArea, output, desktop)`（该接口由 KWin 6.7 脚本暴露）。面板真正独占的区域不是普通外边距。API 可用性和语义需要在 V2-P0 的真实 KWin fixture 验证；取不到时必须使用有界、可解释的保守回退，不能静默覆盖到顶栏。
- `Gap`：建议新增统一配置 `ScrollLayoutGap=16` logical px，**仅在 V2 开启时使用**；V1 原有 `Gap*` 保持不变。任一列之间 gap 为 g，顶部与底部为 g，工作区内正常首/末列的对齐边距为 g。

不可兼得的情况须明确告知：假设顶栏占用物理屏幕顶部 50px，又要求窗口不遮挡顶栏，就无法让窗口距离**物理屏幕**上下边缘相同。V2 以 `WorkingArea` 为上下对称基准，不让顶栏和客户端重叠；输出边界仍是横向 partial clip 的最终边界。

### 3.2 统一列尺寸

对普通列，令 `W = WorkingArea.width`、`H = WorkingArea.height`、`g = EffectiveGap`。V2 采用 niri 类似的比例宽度定义：

```text
width(proportion p) = max(1, floor((W - g) * p - g))
                       p ∈ { 1/2, 2/3, 1 }
height             = max(1, H - 2*g)
windowY            = WorkingArea.y + g
columnGap          = g
```

这里的 1/2、2/3、1 是**输出可用布局宽度的预设比例**，不是硬编码的 1280/1707/2560，也不是对当前相邻窗口剩余空间平分。列宽持久保存为模式，输出/缩放变化时重新从 `WorkingArea` 推导。

窄屏/异常数值：`g` 必须有限、非负且不导致负宽或负高；超界值进行保守限制并记录诊断。允许 `WorkingArea` 为非常规尺寸，最终 clamp 必须稳定、没有 NaN/Infinity。宽度、位移和间隔只在输出物理像素边界作同一规则取整，不把 DPI scale 再乘到逻辑宽度上。

**具体几何样例（离线 fixture，并非本机实测）**：`W=2560, g=16`。

| 宽度模式 | 公式 | 结果 logical px |
|---|---|---:|
| half | `(2560-16)/2 - 16` | 1256 |
| twoThirds | `(2560-16)*2/3 - 16` | 1680 |
| full | `(2560-16) - 16` | 2528 |

两个 half：左 16，1256 宽；中间 16；右 1256；右边 16。完全铺满 WorkingArea 宽度，所有空隙一致。

### 3.3 独立列空间：逻辑位置永不因焦点改变

```text
logicalX(0) = leadingInset
logicalX(i) = logicalX(i-1) + width(i-1) + g
renderX(i)  = WorkingArea.x + logicalX(i) - cameraX
```

只有列新增、删除、调整宽度、重排或工作区域变化，才会改变列的逻辑位置；**改变焦点只修改 cameraX，不改其他列宽**。

**强制保留已有非负 wire offset**。V2 复用单列居中已有 virtual leading inset 思路，增补对称 trailing inset：

```text
halfW         = width(1/2)
leadingInset  = max(0, floor((W - halfW)/2))
trailingInset = leadingInset
stripEnd      = last.logicalX + last.pixelWidth + trailingInset
maxCamera     = max(0, stripEnd - W)
cameraX       = clamp(targetCamera, 0, maxCamera)
```

此布局只支持 half/twoThirds/full 三档，half 为最窄，因此这对留白足以使第一列和末列的任何档位拥有必要的居中空间。未来增加小于 half 的比例时，必须重新证明或更新 inset 公式，不能默认这个证明继续成立。

与 `8056cfe` 的**关键差别**是通用的 `trailingInset`。V1 `computeStripWidth()` 不变，V2 另建 `computeStripEndWithPadding()` 或参数化纯函数，禁止修改旧接口导致 V1 单测大面积失败。

例如 `W=2560,g=16,halfW=1256`：`leadingInset=trailingInset=652`。单 half：`logicalX=652,camera=0`，其屏幕 x=652，恰好居中。双 half：`logicalX=[652,1924]`，在普通 Pair 对齐下 `camera=636`，屏幕 x=[16,1288]，右端=2544，距右边 16。

### 3.4 视口策略：2/3 居中，half 以完整可见为先，Full 保持边距

定义 `centerColumn(column) = column.logicalX - (W-column.pixelWidth)/2`；目标 camera 最后统一 clamp 为非负。焦点切换策略：

1. 单列且宽度小于 W：居中（当前 V1 `AlwaysCenterSingleColumn` 行为在 V2 下自然推广到 2/3）。空→首列直接定位目标，不从无意义的历史 camera 滑入。
2. 活动列宽为 `twoThirds`：**总是居中**；相邻列不得自动缩窄、推走或隐藏。
3. 活动列宽为 `half` 且有多列：若目标已经在 `WorkingArea` 视口内**完整可见且满足边缘 g**，保持当前 camera；否则用最小位移使它完整可见且保留边界 g。不能每次 H/L 都强迫 half 居中。
4. 活动列宽为 `full`：使完整列显示在 `WorkingArea` 内，左/右外 gap 各为 g（普通 Full，不是 KDE Fullscreen）；相邻内容可以完全不显示，但**不能因 Full 触发旧 `wide-focus` 隔离**。
5. 超大窗口或工作区缩小时：需要验证最小可见宽度，若无法满足 g，采用定义明确的 fallback，不能产生非有限 camera、突然 reset 或输出跨屏。

参考纯函数：

```javascript
function centeredCamera(column, workWidth, maxCamera) {
    const target = column.logicalX + column.pixelWidth / 2 - workWidth / 2;
    return clamp(target, 0, maxCamera);
}

function fittedCamera(current, column, workWidth, gap, maxCamera) {
    const left = column.logicalX - gap;
    const right = column.logicalX + column.pixelWidth + gap;
    let target = current;
    if (left < current) target = left;
    else if (right > current + workWidth) target = right - workWidth;
    return clamp(target, 0, maxCamera);
}

function focusCamera(state, column) {
    const { columns, workWidth, gap, maxCamera } = state;
    if (columns.length === 1 || column.widthMode === "twoThirds") {
        return centeredCamera(column, workWidth, maxCamera);
    }
    return fittedCamera(state.cameraX, column, workWidth, gap, maxCamera);
}
```

上面是**策略伪代码**，不是生产代码：实现时须区分已提交 camera 与仍在运动的 visual camera，维护 epoch、到位阈值和实际 painted source；不能直接用旧 target 抹除在途速度。

### 3.5 2/3 活动列的强制视觉样例

`W=2560,g=16,leadingInset=652`。A 是 2/3（1680 宽），B 是 half（1256 宽）：

```text
A.logicalX = 652
B.logicalX = 652 + 1680 + 16 = 2348
centerCamera(A) = 652 - (2560-1680)/2 = 212
A.renderX = 440      A.renderRight = 2120
B.renderX = 2136     B.renderRight = 3392
Visible(B) = [2136, 2560]，宽 424 logical px
```

```text
屏幕 x=0                                                     x=2560
│                                                               │
│        [                  A = 2/3                  ] g [B仅露424]
│<440>   [                   1680                  ]16 [424]  │
│                                                               │
                           B 的余下 832px 在当前输出以外：必须裁切，
                           不能出现在紧邻的副屏，也不能改变 B 的持久列宽。
```

示例还应覆盖左侧的部分可见邻居，以及左、右同时部分可见的中间 2/3 列。两侧可见窗口都应保持由相同逻辑 prefix-sum 得出的列间距 `g`。

---

## 4. 状态、兼容性与快捷键

### 4.1 V2 配置开关

在 `package/contents/config/main.xml`、`config.ui`、`RuntimeConfig.js` 增加独立配置：

```text
ScrollLayoutV2Enabled = false   # 默认关闭，整套新布局独立开关
ScrollLayoutGap = 16           # V2 统一逻辑 gap 的建议默认值
```

启用时，滚动列范围仅为**主屏**。`AlwaysCenterSingleColumn` 在 V2 中由自然居中策略覆盖而不再是主算法分支；字段仍保留以便 V1 关闭 V2 后恢复原语义。V2 开关必须在启动/加载配置时决定，不能未经同步取消旧动画而在帧中切换基准。

副屏的现有最大化/Quick Tile Safe Area 逻辑仍由现有配置控制，不被 V2 强制统一。原生 Fullscreen 不改变。

### 4.2 列宽与键位

建议使用稳定字符串 `half`、`twoThirds`、`full`，不要同时混用 `2/3`、`wide`、`66` 等内部同义值。

| 操作 | V2 行为 | V1 关闭 V2 后 |
|---|---|---|
| `Meta+R` | **half → twoThirds → full → half**，持续改变当前列的 WidthMode | 原 half ↔ full |
| `Meta+F` | full 开/关，返回进入 full 前的 `half` 或 `twoThirds`，不能永远返回 half | 保留原快捷键/恢复记忆 |
| `Meta+H/L` | 左右切焦点，当前 half fit、twoThirds center、full fit，Spring 滚动 | 保留原逻辑 |
| `Meta+Z` | V2 建议映射为“只居中当前列的视口”，**不修改列宽**；或先以兼容命令单独提供，待实机确认后切键 | 原 72% Contextual Wide |
| 窗口新增/关闭/重排 | 保持单列居中、按列宽重新计算逻辑顺序和 camera，连续过渡 | 保留已验证的 V1 `COLUMN_REINDEX` |
| Dialog/Transient/Floating/Fullscreen | 保留当前分类和 Native/KWin 权威，不进入比例宽度循环 | 完全保持 |

**不允许**：`Meta+R` 在 twoThirds 时无故进入 `PAIR_TO_WIDE`；焦点落在 twoThirds 时悄悄修改 `pixelWidth`；`Meta+Z` 对 V2 列打上历史 `persistentWide` 并使邻居隐藏。

### 4.3 旧 Wide 与最大化兼容

V2 的 `2/3` 是普通列宽，不是 `PresentationController::wideRect()` 的 72%。分离**用户请求的普通列宽**与**传统展示模式**：

- `ContextualViewport` 的旧 `PAIR/WIDE_FOCUS` 在 **V1 路径**保持不变；V2 不主动触发 `wide-focus`、`PAIR_TO_WIDE` 或 `WIDE_TO_PAIR` 来模拟 2/3。
- 已存储的 `persistentWide` 字段只保留兼容元数据，不在 V2 焦点切换时扩展窗口。切回 V1 必须能重新按原语义解释（不要 destructive migrate）。
- KDE 原生 Fullscreen、旧安全区域最大化与脚本 Full 不等价。V2 普通 `full` 不调用 `window.setMaximize(true,true)`，也不丢弃用户原生 Fullscreen restore 状态。
- 若需要替换 Dock 菜单中的 `Focus Wide`，应另行做好 UI/Bridge 命令兼容检查，不能删除旧枚举让连接到 Bridge 的已有 Dock 崩溃。

### 4.4 状态建模（建议接口）

```text
V2 Column {
    window / stableUuid / stableColumnId,
    widthMode: half | twoThirds | full,
    previousNonFullWidthMode: half | twoThirds,
    logicalX: f64, pixelWidth: f64,
    ... existing eligibility and lifecycle fields
}

V2 WorkspaceViewport {
    cameraTargetX: finite f64 >= 0,
    focusedUuid: stableUuid | null,
    focusPolicy: fit | center,
    geometryGeneration: monotonic,
    outputIdentity + workspaceIdentity,
}
```

仍复用现有 `ColumnStore`，不构建“独立的第二份窗口列表”。临时动画的 old frame、source pose、snapshot 只能存在于 bounded transaction 或 Rust Runtime 内，不能放入持久 `WorkspaceSnapshotStore`。

---

## 5. KWin 部分可见窗口：必须先验证的系统边界

这一节是 **V2 最大工程风险**，不可因布局数学通过就跳过。

### 5.1 四个坐标与绘制/输入不是同一回事

- **逻辑列空间**：`logicalX,width`，绝对不会因为焦点改变。
- **目标视觉几何**：`Output/WorkArea origin + logicalX - cameraX`，可能部分超出 `OutputRect`。
- **真实 KWin 几何**：`window.frameGeometry`；涉及 KWin 输出归属、Wayland configure/ACK 和原生输入命中，不能随意跨输出。
- **Native 绘制变换与裁切**：`WindowPaintData` translation + `ViewportPaintClip`；用于将安全锚点上的真实 surface 显示到视觉位置。

部分可见 B 的**目标视觉**区间可能 `[2136,3392]`，但主输出实际只覆盖 `[0,2560]`。不能直接写真实 `frameGeometry.x=2136,width=1256` 然后期望 KWin 必然认为它仍属于主屏；这样窗口中心和大部分面积进入右侧输出，可能触发跨屏归属、焦点、输入与纹理生命周期变化。

### 5.2 建议的安全锚点 + Native 视觉投影原型

在原型中尝试如下规则，**所有结果以真实 KWin 验证为准**：

```text
visualRect = projection(column, cameraX)
realRect.width = visualRect.width            # 不为露出的 424px 缩小客户端
realRect.x = clamp(visualRect.x,
                   OutputRect.left,
                   OutputRect.right - realRect.width)
visualDeltaX = visualRect.x - realRect.x
renderClip = OutputRect ∩ KWin 当前输出 Region
```

只对可视区域与本输出有交集的列创建 Native 投影；真实窗口保持受管输出的归属；部分范围通过 Native 执行 paint clip，窗口超过输出的内容不得穿透到相邻显示器。动画中 old/source/target 可能不同，必须处理真实 Wayland configure 尚未 ACK 的过渡姿态。

**特别警告：**仅有这个算法还不等于完成输入。示例中 B 的实际 KWin frame 会被夹到屏幕内，它与 A 的 real frame 可能重叠；更重要的是，KWin 所见本地点击坐标仍相对于 `realRect`，不自动跟着 `visualDeltaX` 移动。只靠简单 clipping，鼠标可能错误触发被视觉覆盖的后台应用。

### 5.3 逐条验收的输入策略

必须首先用当前 KWin API 验证“partial 窗口的点击、hover、拖动、输入坐标是否可安全重定向”。**不得假设 `ViewportInputClip` 已经实现任意位移的输入重映射。**

优先研究两条路径：

- **严格原生映射路径**：若所用 KWin 6.7 插件 API 能在不绕开 Wayland 权威的前提下实现真实视觉窗口坐标映射，则使用同一份 Rust projected rectangles 计算绘制与 input hit-test。严禁手工注入不完整的合成指针事件、绕开 KWin grab/Wayland serial。
- **安全两次点击退路**：若无法可靠重映射，partial 区域首次单击只触发“聚焦该列、滚动到活动位置”，**阻止该次按下/释放交给错误的客户端内容**；在窗口成为完整可见、真实 KWin frame 与内容局部坐标一致后，用户第二次点击才向应用分发。必须完整配对 press/release，防止 stuck button、Drag & Drop 或焦点竞态。该退路是**与 niri 真正单次可交互存在差异的已知限制**，不能对外宣称完全等价。

两条路径无论选择哪条，都必须测试：右邻 partial、左邻 partial、两侧 partial、指针移动跨列、点击/滚轮、标题栏拖动、触摸、缩放窗口、popup/menu、输入法候选框、屏幕边缘、跨屏鼠标、最大化返回。**不允许**在视觉 A 所在区域让真实 B 吃掉点击；不得禁用输入保护来换取看起来流畅。

如果 P0 验证表明既有 KWin Effect API 无法实现安全输入/渲染组合，就先停在 **PROTOTYPE / BLOCKED**，保留 V1。不得把窗口发送到副屏、复制窗口尺寸图像作为掩饰或静默降低行为承诺。

### 5.4 Partial 生命周期和安全恢复

- `Visible` 的判定首先是**与 `OutputRect` 有非空交集**，不再要求完整落在 Safe Area。与工作区无交集的离屏列才允许成为 `Parked` 候选。
- 半列和 2/3 都可能是 `partial`。`partial` 描述的是**输出裁切必要性**，不改变它们的真实宽度或焦点归属。
- 运动中 Outgoing 继续绘制的既有 Native ownership 规则仍有效；需要等完成并收到合法 park/disarm 信号才隐藏。取消 ACK、未知窗口、工作区离开和异常帧应安全回退，而不是让旧 epoch 把窗口弹到邻屏。
- `GeometryCommitter` 当前“`partial` 且 Native 没有接管就直接 Park”是现有失效安全逻辑。V2 只有在获得新、明确的 Native 能力和 arm ACK 后才能展示 partial；失败时不得以越界真实几何冒险显示。
- 原生 Fullscreen、活动窗口在副屏、Dialog、临时 popup、用户交互式拖动期间按现有 authority 退出或暂停相应接管，不挟持原生 KWin 行为。

---

## 6. Rust Scroll 动画与协议：复用，不复制

### 6.1 `clipPartial` 与速度继承必须解耦

当前 Rust 有：

```rust
let carry = continuing && self.smooth_motion && smooth
    && !self.clip_partial && !clip_partial;
let use_smooth = smooth && !clip_partial;
```

不能直接全局删除上述保护。引入经过协议验证的 V2 typed capability / policy（命名由现有 ABI 审查确定，例如 `partialClipMotionPolicy`），区分：

```text
needsPaintClip          # 部分列纹理被输出裁切；Native input 也必须受保护
allowsVelocityCarry     # 只有 source/target 及宽度/几何可验证且连续时才允许
sameCoordinateBasis     # 旧 Native Camera 与新逻辑列空间是否属于同一基准
validOutputBinding      # workspace/output/epoch 未过期
```

只有**实际绘制**的上一 sample 才能用于起点与速度继承；丢帧后的预测 sample 不能冒充 painted。重复同目标保留曲线；反向保留 bounded Spring 的范围证明及 fail-safe fallback。保留 stable/smooth60、0.25 物理像素阈值、已有 D1a/D2 选择与 per-output paint clock。

Rust 内存和 CPU：每个活跃事务的 target/source/role maps 可以按活跃窗口数量 O(N) 使用，禁止随历史 arm 数量增长；`advance/projection/input` 的每帧数据访问必须零新增堆分配。新对象必须具备正确 FFI 生命周期和 ABI size 测试。

### 6.2 什么时候使用现有 `SCROLL`、`COLUMN_REINDEX`

| 事件 | V2 优先动画路线 | 必须保证 |
|---|---|---|
| 仅焦点/摄像机改变，列基准和宽度均不变 | 现有 `SCROLL` + V2 partial capability | 保留最后 painted velocity，部分邻居不 Park |
| V1 单 half ↔ 双 half（V2 关闭） | **现有** `COLUMN_REINDEX` / SCROLL 判定 | 原 typed validator、150ms cancel 超时、focusNew=false、旧 ACK 全不退化 |
| 列新增/删除，但有稳定幸存者和相同几何基准 | 视实际连续性选择 SCROLL | 先 membership ACK，后 arm；不错误重新启动 Spring |
| V2 2/3/Full 宽度改变、混合列插入/移除，logicalX 及 frame 同时变化 | **新的独立 typed 几何过渡**（若同基准 SCROLL 不能满足） | 原帧/目标帧、source 逻辑基准、窗口宽度变化都要严格验证，不得硬套仅同宽 half 的 COLUMN_REINDEX |
| Output/WorkArea/scale 实际变化或不安全源窗口 | 安全静态重排 / 有界 disarm | 禁止以未知旧基准做视觉连续性伪造 |

### 6.3 通用列几何过渡：建议最小 typed 扩展

如果 P0 无法在现有 `SCROLL/COLUMN_REINDEX` 语义下严格表达混合宽度过渡，建议添加**独立类型**，例如 `COLUMN_GEOMETRY`，沿用**已有** session/workspace/output/epoch/Bridge endpoint、ACK Gate 和单一 Rust Spring/paint context：

```text
COLUMN_GEOMETRY (设计提案，非现有 API)
- protocol: 2 + 新明确 kind，或另行定义版本但保持老消息兼容
- sessionId / workspaceId / targetOutput / epoch / issuedAt
- viewport/output binding
- oldScrollOffsetX, newScrollOffsetX（wire 必须有限且非负）
- entries <= 256, UUID + stableColumnId 唯一
  - oldLogicalX / newLogicalX
  - oldPixelWidth / newPixelWidth
  - oldFrameRect / committedTargetRect
  - oldPlacement / newPlacement
  - sourceSnapshot 或 old-painted/basis 能力标记
- 明确的中间态/完成/取消 ACK 与 retarget policy
```

这只是提案形状。正式 DTO 必须先设计严格 validator，处理无效 client ACK、旧窗口已经销毁、duplicate UUID、跨工作区、超过最大帧/宽度、source/output 不符、错 epoch、恶意/非有限数字、重放、旧 payload、未接管帧等情况，并通过 Bridge→Adapter→Rust 的端到端差分和拒绝测试。不可把 `COLUMN_REINDEX` 的“两个 half / 唯一幸存者 / 同宽”的校验直接放宽为任意重排。

对宽度变化，优先使用**受同一 presentation clock 驱动**的视口移动与列间相对 offset；保留原 client resize/configure ACK 生命周期，避免把 client surface 强行拉伸导致文字/交互坐标畸变。是否需要新增小的 Rust `ColumnGeometryTransition` 数值状态，在 P0/P2 中据真实测试决定；绝不新增独立帧时钟或全屏纹理缓存。

### 6.4 顺序、取消和失效安全契约

```text
JS mutate model + compute target
 → PublishState (new membership/width/owner, ACK)
 → PublishMotionPlan (typed, ACK)
 → Native Arm (validate identity/basis + install ownership, ACK)
 → GeometryCommitter (real target only after arm ownership)
 → Activation/Focusing (target可安全显示后)
 → painted frame / Native completion
 → Deferred Parking / cancel / release
```

必须继承 `ScrollPlanCommitGate` 既有 bounded cancel ACK、`commitWhenDisarmed`、stale epoch 检查与 Bridge membership 验证。对于宽度变更不能依赖旧几何 `near` 判断来伪装相同窗口尺寸，否则 Native 无法再投影、视图闪烁。相反也不能随意跳过几何一致性校验；需要清楚的 old/new 源帧验证契约。

出错时安全回退：先解除 Native ownership，等待 ACK 或现有有限期限，再静态提交合法、属于当前输出的 KWin 几何；不能在旧 effect 仍绘制原基准时立刻写新窗口 rect；迟到 ACK 不得重放几何或修改实际焦点。Bridge/Native 组件升级必须配套安装，旧二进制遇未知 typed type 应 fail closed。

---

## 7. 快照、工作区和版本切换

### 7.1 必须支持的恢复场景

- 主屏从一个 2/3 单列切到其他工作区，再按 J/K 返回：宽度、中心视口、焦点和 gap 不变。
- 存在 2/3 + half + full 的混合工作区，Meta+Shift+J/K 和数字 move-and-follow：移动的列只改变 workspace，不改变 widthMode；源、目标工作区各自按焦点策略调整 camera。
- 删除左邻列、关闭焦点窗口、Dialog 关闭、输出 scale 从 150% 变化或当前工作区没有任何列：持久快照不得持有已销毁窗口对象或旧 `ColumnId`。
- V2=false 时旧 V1 快照可恢复，旧 Wide/full 半列保留原行为。再次 V2=true 时已经保存的 2/3 宽度不应无故被丢弃。
- 启停 `cc-niri` 不重新启动或删除用户应用；所有 parked windows 必须安全恢复。

### 7.2 兼容旧 protocol 1/2 与负相对锚点

现存 `WorkspaceSnapshotStore` 和 `StartupLayout` 强制 `viewportAnchor.delta >= 0`。V2 应增加**独立版本化的** `viewportAnchorV2`（或等价有界模式），以便保存**带符号的**中心相对位移：

```json
{
  "scrollLayoutVersion": 2,
  "viewportAnchorV2": {
    "uuid": "<stable-window-uuid>",
    "cameraMinusLogicalX": -440,
    "focusPolicy": "center"
  }
}
```

其中 `-440` **只是示例**：当 `column.logicalX=652`、`camera=212` 时，delta 为 `-440`。不是让 SCROLL wire offset 或 Native unsigned token 变成负数。恢复时重新推导所有新列的逻辑位置，然后按 `camera = clamp(anchor.logicalX + signedDelta, 0, maxCamera)` 还原；新工作区域或列宽变化时优先按目标活动列重新计算 center/fit，旧锚点不可机械照搬。

新的持久字段不能直接覆盖旧 `viewportAnchor` 的非负约束。对旧 protocol 1/2 保留迁移入口；对新的 snapshot shape 添加版本标识、严格类型与范围校验，并保证旧 Bridge active/root 列顺序和宽度一致。Bridge 的协议号是否保持 2，必须通过端到端 schema 测试确定；不要为了一个新字段无条件破坏旧服务读取。

**重要兼容性陷阱**：旧 `normalizeColumnWidthMode()` 把 `twoThirds` 视为 half。V2 必须区分“带 V2 版本字段的合法 twoThirds”与“旧快照中历史上被弃用的 twoThirds”。不要直接修改旧快照语义，导致 V1 的历史迁移测试反转。为 V2 宽度偏好保留可安全回退的版本化字段，或明确定义一次性原子迁移；V2 关闭再打开后宽度仍应可恢复。

快照中不存储 frame buffer、KWin 指针、transition handle、历史 ACK、动画时刻或每帧位置。持久状态大小继续低于 Bridge 的 1 MiB 上限，旧 Bridge 容错/回滚需单独验证。

---

## 8. 具体代码改动清单（锁定基线 `8056cfe`）

| 文件 / 目录 | 工作内容 | 保留的现有契约 |
|---|---|---|
| `src/kwin/layout/ColumnLayout.js` | 新增纯 V2 列宽、prefix-sum、leading/trailing inset、strip bounds、非负 camera clamp | 原 V1 `computeColumnWidth()`、`virtualLeadingInset()` 默认结果 |
| `src/kwin/layout/Projection.js` | 分离 `visualRect`、`OutputRect` 交集、partial 标志和真实锚点类型 | 原物理坐标方向和 viewport clip |
| **新** `src/kwin/layout/ContinuousColumnLayout.js`（或相同职责文件） | 统一 `deriveV2Layout()`、`centeredCamera()`、`fittedCamera()` 等纯函数；不得复制 ColumnStore | JS 模块打包规则、QJSEngine 语法 |
| `src/kwin/layout/SafeArea.js` / `src/kwin/runtime/OutputTopology.js` | 增加 `OutputRect`、`WorkingArea`、V2 Gap；V1 不变，副屏不变 | KWin panel、主副屏各自桌面归属 |
| `src/kwin/model/ColumnStore.js` | V2 合法 half/twoThirds/full、记忆前一个非 full 宽度 | V1 half/full、焦点窗口 identity、无 stale references |
| `src/kwin/layout/ColumnWidthController.js` | Meta+R 三档循环；Meta+F 回到正确非 full 宽度；统一 Width transaction | 旧 `Meta+R/Meta+F` 关闭 V2 时不变 |
| `src/kwin/presentation/ContextualViewport.js`、`PresentationController.js` | V2 仅位置居中、取消自动 72% 隔离；V1 保留原 Wide | 原最大化/fullscreen 和旧 Wide 兼容 |
| `src/kwin/layout/LayoutEngine.js` | 所有列使用物理交集判可见；partial→Native Clip；出视口才 Park | Native ACK 后 geometry、稳定 commit order |
| `src/kwin/layout/GeometryCommitter.js`、`Parking.js`、`DeferredScrollParking.js` | 实际输出安全锚点、source/target real frames、输入保护和退出时延迟停放 | 出错时恢复、窗口不跑副屏、无重复显隐 |
| `src/kwin/layout/SingleColumnTransition.js` | V1 half-only 保留；V2 用通用逻辑基准/事务而非特殊 Pair 逻辑覆盖 | `COLUMN_REINDEX` 的旧所有测试 |
| `src/kwin/layout/ScrollMotionPlan.js`、`ScrollPlanCommitGate.js` | V2 按需设计 typed 几何过渡、已提交/在途 camera、scope & ACK | SCROLL v2 与单列 reindex 次序、取消 150ms 上限 |
| `src/kwin/runtime/RuntimeConfig.js`、`package/contents/config/main.xml`、`package/contents/ui/config.ui` | 新 V2 配置、统一 gap、兼容旧开关 | 默认 V1 / 旧持久化值 |
| `src/kwin/workspace/WorkspaceSnapshotStore.js`、`WorkspacePersistence.js`、`WorkspaceMountController.js`、`StartupLayout.js` | V2 宽度、signed anchor/焦点和迁移 | protocol1/2、移动/恢复/回收、安全 stop |
| `src/kwin/stability/InvariantChecker.js` | V2 构建独立不变量：不同宽度 prefix、camera bounds、输出 clip、有效 owner、无输入泄漏 | V1 原 invariants 原样保留 |
| `native/rust/cc-niri-native-core/src/scroll_runtime.rs`、`native_protocol.rs`、`ffi_scroll.rs` | 验证过的部分裁切平滑 retarget；如需新增 typed 几何过渡才扩 ABI | Rust sole policy，Golden、FFI release、null、安全期望 |
| `native/viewport-clip/ViewportClipEffect.cpp`、`RustScrollViewportRuntime.cpp`、`native/common/ViewportPaintClip.h` | 可见视觉投影、输出裁切、受保护输入命中、单一 paint clock | Ring/outgoing/shared clip、J/K WorkspaceSlideAdapter |
| `bridge/src/CCNiriBridge.cpp`、对应 sequence / DTO | 仅在新 typed protocol 需要时扩展，先 State ACK 才允许新 motion | session/epoch/membership、防重放、队列上限 |
| `native/focus-ring/` | 验证 Ring 跟随部分可见的视觉 rect 和裁切，尽量不改 Focus Ring 核心样式 | 现有 `#7FC8FF` 样式、真实 focus owner、共享时间 |
| `tools/build.js`、`test/*` | 注册新 JS 模块，新增测试与 Native contract、禁手工生成段 | node/check.js --native 与 CMake 生产边界 |

新增文件名仅为建议，先复用已有职责清晰的模块；不要为了多模块而过度拆分。

---

## 9. 分阶段实施、提交与门禁

### V2-P0：固定基线与 KWin 输入/几何可行性（**任何实机变更之前**）

**目标**：锁定 `8056cfe`、确认本地正在运行的组件与提交差异（只读），隔离模拟测试 KWin partial 表现，列出实际受限 API。建立模型测试：visual x 超出主屏但 real frame 锚定主屏、Render Clip、Ring、input press/release、跨屏归属、Wayland configure ACK。

**交付**：`test/SCROLL_LAYOUT_V2_P0_FEASIBILITY.md`，包含“完全支持”或“必须两次点击”的输入能力结论、视频/截图/日志、是否阻塞。先在可控测试输出/会话中验证；不访问用户运行中桌面做冒险修改。若证据不足，记 `BLOCKED/INCONCLUSIVE`，禁止推生产。

### V2-P1：纯几何与三档列宽

- V2 独立配置默认关；ColumnStore 增加 twoThirds，WidthController 形成严格循环。
- `ContinuousColumnLayout` 实现 niri-like `w(p)`、prefix sum、统一 gap、双侧 inset、target viewport、无负 camera。
- `WorkingArea`/`OutputRect`/缩放分离；Old SafeArea 保留在 V1 和副屏路径。
- 用 1/2+1/2、2/3+half、half+2/3、full+half、五列混合、偶/奇逻辑宽度、gap 0/16、大 gap/窄窗口验证；100/125/150/175/200% physical rounding 误差不超过一个物理像素。

**交付**：`test/scroll-layout-v2-geometry.test.js`、`...width-cycle.test.js` 和 P1 报告；默认关时既有 V1 单测完全通过。

### V2-P2：连续视口与工作区事件

- 在主屏用统一 camera 计算焦点、插入/关闭、移列、工作区 mount/restoration；单列居中自然支持 half/twoThirds。
- Meta+H/L、程序激活、Alt-Tab、Dock（仅已启用）、焦点历史都走统一 ViewportPolicy，不能从两个地方决定 camera。
- 一次操作最多一次布局 generation，避免新的模型事务与 Adoption 的同步回调互相重入；同步/重复事件幂等。
- 关闭左边、关闭右边、最后剩一个 mixed-width 列的重排必须保留最近已画出的视觉位置，不能复用不合法的同宽 `COLUMN_REINDEX`。

**交付**：runtime 模拟矩阵，自动校验焦点 ID、camera、顺序与 issued epochs。P2 阶段仍可关闭 V2 并回到 V1。

### V2-P3：Native Partial Paint/Input 与 smooth60（**功能核心**）

- 实现 OutputRect 严格 clip，与 WorkArea 拆分；可见窗口只看与 OutputRect 的交集。Partial 中保留实际 KWin frame 的输出归属与原 client width。
- 保证 Native 已 arm 才展现/激活 partial；Bridge 错误、无 native support、cancel 迟到、invalid output 不能越界 commit。
- 按 P0 的输入可行性选原生正确坐标路径或安全两次点击路径，并保留桌面角落/焦点/键鼠 grab 的原生授权语义。
- Rust 的裁切与速度继承分别验证；反向 retarget 在部分显示状态下不得重置视觉速度。保留已存在的 smooth60/A4/A5 tuning、临界像素取整、D1a/D2 选项。

**交付**：Native Clip / Rust contract、端到端 Bridge 独立 bus、Window Geometry ACK fixture、Input Clip contract；实机全屏不泄漏/无 ghost-window。P0 若未通过，P3 标 BLOCKED，不可以跳过。

### V2-P4：混合列宽变化与连续动画

- 宽度 `half→twoThirds→full→half` 和已有窗口插入/删除不能只靠旧 `PAIR_TO_WIDE/WIDE_TO_PAIR`；若几何源/目标发生变化，使用明确的新 typed column-geometry 事务或严格证明的等价协议。
- 布局只决定 target，Rust 对共享 camera 及必要的 per-column 视觉过渡负责；旧旧 client frame / 新 configure ACK 时无跳变、不拉伸文字、不出现错误 input。
- 连按 Meta+R / Meta+H/L、宽度操作中关闭窗口、Ring 淡出、J/K 离开并返回、Workspace fallback 都以最新 epoch 为唯一事实。失败必须停留在合法几何，不能进入永久 parking。

**交付**：混合宽度 retarget 数学测试、旧协议 Golden 全绿、生产 FFI 符号审计通过。

### V2-P5：持久化迁移、全功能兼容

- 为新宽度和中心相对锚点添加版本化字段，严格区分历史 `twoThirds`（原来会降级 half）和 V2 真正 twoThirds。
- 旧 protocol1/2、Bridge 同步发布/恢复、V2 开关切换、Dormant Wide 偏好、Fullscreen restore、workspace 转移及回收全部回归。
- Focus Ring、Dialog/Transient、窗口离屏唤醒、Secondary safe area、Mixed DPI 互不干扰。

**交付**：`test/scroll-layout-v2-persistence.test.js`、`test/scroll-layout-v2-workspace.test.js`、Bridge/DBus 集成测试及 P5 报告。

### V2-P6：4K60 + 16 GiB 实机验收、README 与安全部署

- 首先完成全部离线门禁，生成包、构建 Native Release/Debug、OFF production boundary；固定测试窗口负载后做 V1/V2 对照。
- 在 4K60/150% + 2K60/100% 环境验证 partial + input + Ring + J/K；观察 `framePresented` 真正丢帧，不能只看 Rust 数学轨迹或 420ms elapsed。
- 记录整个项目相对原生 KDE 的 PSS/Private_Dirty/GPU 资源、动画峰值、长循环后 steady state；按根 AGENTS 预算判定。不能以 `sizeof`、0 allocations Core 单测或最终包大小推断整套项目内存通过。
- 更新 README 和旧设计索引，将 V1 `ContextualWide` 在 V2 中的行为差异明确说明；功能经过用户**明确授权后**才能 `save-state → stop → immutable install → start`，保留配套完整组件快照与 rollback。

**交付**：`test/SCROLL_LAYOUT_V2_P6_LIVE_RESULTS.md`、固定输入负载原始帧/内存数据与回滚脚本。无权限或用户禁止长测时标 `SKIPPED/PENDING`，不得记为 PASS。

---

## 10. 回归测试矩阵与验收标准

| ID | 测试操作 | 必须满足 |
|---|---|---|
| V2-01 | 空工作区新开 half | width=half；居中；没有从旧 camera 飞入的首帧 |
| V2-02 | 单列 half→twoThirds→full→half | 模式顺序准确；单列各档正确居中/留 gap；没有 Wide 隔离 |
| V2-03 | 两列 half | 左/中/右 gap 相同；完整 Pair，无奇怪的额外右白边 |
| V2-04 | A=2/3，B=half，焦点 A | A 居中、B 仅露必要部分；B 的右侧在**物理主屏边界**裁掉 |
| V2-05 | half → 2/3 作为右邻居 | 右邻切到 2/3 后按焦点居中，前列在左边部分出现，不闪退 |
| V2-06 | 2/3 中间列，两边都有邻居 | 左右邻居都可部分可见；列逻辑宽度与 gap 保持不变 |
| V2-07 | Full→half、Full→twoThirds、再返回 Full | Full 是普通列，不等于 KWin Fullscreen，不隐藏邻窗状态 |
| V2-08 | Meta+R 连续 12 次 | 无跳档/重复、宽度模式不被重入回调污染 |
| V2-09 | 处于 2/3 按 Meta+F 两次 | 先 Full、再回 2/3；原非 full 记忆保留 |
| V2-10 | 5 个不同宽度窗口快速 H/L、反向 | 连续 ViewOffset + painted retarget；无突然跳帧、ghost surface 或抢错焦点 |
| V2-11 | 2/3 焦点右侧部分邻居点按 | 命中正确窗口；若使用两次点击退路，首次只聚焦，不把误差坐标下发给客户端 |
| V2-12 | 部分窗口左侧点按/标题栏/滚轮 | 不触发后台重叠窗口；press/release 配对，拖动不粘住 |
| V2-13 | 2/3 旁边弹出输入法、右键菜单、Dialog | 不错误裁掉关联 popup；Dialog/Transient 不被强行入列 |
| V2-14 | 光圈随水平滚动到主屏边缘 | Focus Ring、glow 与 window surface 同步且按输出裁切；无其他显示器发光 |
| V2-15 | 关闭左列/右列，只剩一个 2/3 | 幸存列居中；适用时动画从真实 painted pose 接管；旧 ACK 无效 |
| V2-16 | 两列宽度改变时关闭前景窗口 | 既有 Geometry ACK 未到时不误判 source；无永久 parking |
| V2-17 | 列移动 H/L / 调整顺序 | 列 ID、宽度、焦点 ID 与视觉位置一致；增删/重排无突然消失 |
| V2-18 | J/K 在空、单半列、单 2/3、混合列工作区间切换 | 420ms 动画 authority 不变；宽度与锚点分别恢复；无旧画面透出 |
| V2-19 | Meta+Shift+J/K、数字 move-and-follow | 源与目标 workspace 独立恢复各自的列宽/焦点/camera |
| V2-20 | 主屏 4K/150%、副屏 2K/100% | 所有剪裁仅发生于主屏，部分窗口**绝不投影到副屏**；副屏安全区不变 |
| V2-21 | 100/125/150/175/200% 比例转换 | 同一逻辑几何规则、gap 对齐误差 ≤1 physical pixel，无裁切裂缝 |
| V2-22 | Fullscreen ↔ V2、浮动 ↔ V2、窗口最大化 | KWin Fullscreen / Dialog / Float 的原生操作仍正常，退出可恢复正确列宽 |
| V2-23 | `cc-niri stop`、restart、Bridge 暂离线、效果卸载 | parked 全部安全恢复，不留下透明/不可见/外屏窗口，无 KWin crash |
| V2-24 | V2=false、V2=true 往返，旧 protocol 1/2 快照 | V1 回退不变，V2 宽度/签名按版本迁移，不错误清除用户数据 |
| V2-25 | 4K60 固定窗口负载 A/B | 逐转场 P50/P95/P99/max/≥25ms 帧数；不比 V1 引入显著更多 33–50ms 长帧 |
| V2-26 | 16 GiB 内存账本、30–60min 稳态交互 | 总项目增量和 per-feature 增量按 AGENTS 目标测量、记录、归因；零历史增长 |
| V2-27 | 5000 次取消/ACK 失联模型 | Timer、callback、FFI handle、retained source、snapshot owner 与 tombstone 收敛 |
| V2-28 | V1 原有 1↔2 half `COLUMN_REINDEX`、Focus Wide | 当 V2 关闭时完整契约不变，包括左插入、关闭左窗与 SDK clip |

**判定规则**：任何 P0 input/safety、P3 副屏泄漏、P4 旧 ACK 重放/窗口闪退、P5 快照污染、P6 安全 stop/restore 的 FAIL，都会阻止“V2 完成”。性能指标尚未测量时只能记 `PENDING/INCONCLUSIVE`，不能将工具正常退出等同于 4K60 达标。

### 10.1 纯数学的固定断言

```javascript
const W = 2560, g = 16;
const wHalf = 1256, wTwoThirds = 1680, wFull = 2528;
const inset = 652;

// one half
// screenX = 652, centered, camera=0

// two half
// logical = [652, 1924], camera=636
// screenX = [16, 1288], screen right=2544; gaps left/mid/right 16

// A=2/3, B=half, focus A
// logical = [652, 2348], camera=212
// A screen=[440,2120], B screen=[2136,3392]
// B physical visible clip=[2136,2560], width=424

// full
// focus camera=636, full screen rect=[16,2544]

// camera always finite >=0 and <= computed maxCamera
// V1 disabled: existing W=2512,g=8, half=1252 and L=630 fixtures unchanged
```

上述断言用来避免因整数取整、右尾留白、旧 Safe Area 或 `isRectFullyVisible` 逻辑导致端点 off-by-one。

### 10.2 执行门禁与报告格式

每一阶段最低门禁：

```bash
node tools/build.js
node tools/build.js --check
node tools/check.js
```

修改 Native/Bridge/FFI 后执行根 AGENTS 强制门禁：

```bash
cargo fmt --manifest-path native/rust/Cargo.toml --all --check
cargo clippy --manifest-path native/rust/Cargo.toml --locked --workspace --all-targets -- -D warnings
cargo test --manifest-path native/rust/Cargo.toml --locked --workspace
node tools/check.js --native
```

涉及 CMake/FFI/生产边界时，再根据 `native/AGENTS.md` 进行 Rust Core Debug/Release、Native umbrella、`BUILD_TESTING=OFF`、GCC16 编译器拒绝策略、Golden 差分与符号审计。建议在 16 GiB 设备上使用 `--parallel 2`，逐阶段顺序执行，不并行高内存编译。

记录测试结论至少要包含：`PASS/FAIL/INCONCLUSIVE/BLOCKED/PENDING/NOT MEASURED`、目标 commit、执行命令、退出码、测试数、输出/缩放/窗口条件、耗时、证据路径、当前运行配置、组件 SHA、回滚方法。截图或用户视觉评价只能标记其覆盖范围，不得扩称 30–60 分钟稳定性。

---

## 11. 性能、内存与卡顿的已知限制

1. 最新基线中已有 J/K D1a 可选投影缓存和 D2 可选 Frame Delta Clamping；其独立开关在本次审核版本中默认关。V2 **不要复制**一套 J/K 缓存、WorkspaceClock 或帧采样器。
2. 已有 J/K 测量包含真实 **33–50ms** 呈现间隔，即使短 J/K 功能/观感验收 PASS，也不能声称其已被修复。Scroll Layout V2 要额外比较 H/L 与 J/K 的帧呈现，避免新 partial 合成放大长帧。
3. `clipPartial` 增加时，对 KWin Blur/BackgroundContrast、Input Clip、Ring Glow 可能提高绘制频率；性能优化应优先减少重复状态转换与错帧重绘，不能靠新增屏幕尺寸 RenderTexture 掩盖问题。
4. 全项目低内存**设计目标**：相对原生 KDE，Dockless 空闲 PSS ≤32 MiB（争取 ≤16 MiB），动画峰值 PSS ≤64 MiB；轻量布局功能增量 idle ≤2 MiB、active peak ≤8 MiB；30–60min 相同负载闲置 PSS 增量 >4 MiB 须调查。**这些都是待实测预算，并非 `8056cfe` 已达到的结果。**
5. 禁止每帧分配全新 Array/Object 来包装窗口几何的 Native hot path；小规模 V2 JS 状态只在布局事件路径计算，Rust/Qt effect 绘制热路径使用容量有界或复用的数据结构。动画结束、取消/超时、窗口关闭、输出移除和脚本 stop 后，持有对象回到稳态。
6. 用已有 `tools/sample-memory.py` 对 KWin/Bridge/PSS 持有证据做 B0/B1（权限缺失则 `INCONCLUSIVE`）；J/K 用 `tools/analyze-workspace-capture.py`，H/L 用 `tools/analyze-animation-capture.py`。帧到达时间不能替代真实 GPU 函数热点；内存 RSS/sizeof 不能替代归因后的 PSS/GPU 数字。

---

## 12. 安全回滚与发布计划

- **V2 配置默认关闭**。代码未通过 P0/P3 安全性验证前不要在用户常用桌面加载 V2。
- 对单个阶段可按功能开关关闭，确保 V1 原来 `AlwaysCenterSingleColumn=true`、原 1↔2 typed reindex、half/full、Wide 和旧 safe area 全部可回到基线；不得因为新增 v2 字段而让旧脚本无法读取快照。
- Native typed 协议升级需 Bridge、Viewport Clip、Script 作为一套配对安装。旧消费者接收未知类型应 fail closed；不要将回滚建立在混用版本必然安全的假设上。
- 实机部署**获得用户授权后**按仓库现有 `save-current-state → stop（恢复失败即中止）→ immutable install → start` 流程进行；保留原 `kwinrc`、快照、Bridge、Clip、Ring、package、CLI、真实工作区/焦点和组件 SHA；建立可执行 rollback-component 脚本并先在隔离环境验证。
- 遇到黑屏、窗口 park 不恢复、真实窗口跨输出或错误输入：调用项目已有 emergency restore / stop 安全流程，不强杀 KWin、不强行注销、不删用户工作区数据。不允许把 `.local/state/cc-niri/workspaces.json` 直接覆盖成测试数据。
- 只有 P0–P6 自动/实机/内存必要项目通过并得到用户视觉确认，才可标记 **V2 READY**；否则保留实验状态与可关闭开关。

---

## 13. Codex 最终交付内容

按阶段提供：

1. 完整的 `Scroll Layout V2` 源码与新增模块（纯 JS layout、明确的 Native Clip/input、如需的 typed Rust/FFI 协议）；生成包一致。
2. 经过验证的 half/twoThirds/full 逐列宽度、焦点 camera、统一边距、2/3 partial 邻居、快照与快捷键。
3. 每个阶段的新测试、Golden 差分及完整 Native Gate 报告，明确真实运行/尚未测试项目。
4. P0 KWin API 可行性证据，特别是部分窗口的输入与副屏边界，不含未经证实的“全功能 niri 等价”声明。
5. 4K60（包含原 J/K 长帧）和 16 GiB 全项目 PSS/GPU 增量对照，不新增永久帧缓冲或守护进程。
6. 完整 V1→V2/回退路径与 README/设计索引更新；生产部署只在获得用户明确授权后执行。

**优先级原则**：**正确的列模型与窗口输入 > 输出裁切和原生安全恢复 > 视觉动画连续 > 平均 FPS 微优化 > 特效花哨程度**。不得为了画面流畅牺牲真实窗口的可点击性、输出归属、工作区恢复或 16 GiB 设备长期稳定性。

---

## 14. 源码与设计参照

**cc-niri（固定 `8056cfe6`）：**

- [ColumnLayout.js](https://github.com/Cc-aw/cc-niri/blob/8056cfe6b4a023ac8dcbfb01e4495a5acf4c2c4e/src/kwin/layout/ColumnLayout.js) — 已有 half/full 与 virtual leading inset。
- [SingleColumnTransition.js](https://github.com/Cc-aw/cc-niri/blob/8056cfe6b4a023ac8dcbfb01e4495a5acf4c2c4e/src/kwin/layout/SingleColumnTransition.js) — 当前 half-only 1↔2 reindex。
- [LayoutEngine.js](https://github.com/Cc-aw/cc-niri/blob/8056cfe6b4a023ac8dcbfb01e4495a5acf4c2c4e/src/kwin/layout/LayoutEngine.js) — partial 仅依赖 Full 的历史行为。
- [ContextualViewport.js](https://github.com/Cc-aw/cc-niri/blob/8056cfe6b4a023ac8dcbfb01e4495a5acf4c2c4e/src/kwin/presentation/ContextualViewport.js) — 旧 Pair / Wide 隔离。
- [scroll_runtime.rs](https://github.com/Cc-aw/cc-niri/blob/8056cfe6b4a023ac8dcbfb01e4495a5acf4c2c4e/native/rust/cc-niri-native-core/src/scroll_runtime.rs) — 共享 Rust viewport motion、clipPartial、reindex。
- [native_protocol.rs](https://github.com/Cc-aw/cc-niri/blob/8056cfe6b4a023ac8dcbfb01e4495a5acf4c2c4e/native/rust/cc-niri-native-core/src/native_protocol.rs) — 现有 SCROLL/COLUMN_REINDEX 的严格校验。
- [ViewportClipEffect.cpp](https://github.com/Cc-aw/cc-niri/blob/8056cfe6b4a023ac8dcbfb01e4495a5acf4c2c4e/native/viewport-clip/ViewportClipEffect.cpp) — 输出绘制/输入遮罩和 Native FFI。
- [WorkspaceSnapshotStore.js](https://github.com/Cc-aw/cc-niri/blob/8056cfe6b4a023ac8dcbfb01e4495a5acf4c2c4e/src/kwin/workspace/WorkspaceSnapshotStore.js) — 原有非负 viewport anchor、宽度迁移。
- [AGENTS.md](https://github.com/Cc-aw/cc-niri/blob/8056cfe6b4a023ac8dcbfb01e4495a5acf4c2c4e/AGENTS.md) — 编译器、权限、项目级低内存约束。

**niri 官方参考（原理参考，不可无差别照搬 KWin 无权限实现）：**

- [niri Configuration: Layout](https://github.com/niri-wm/niri/blob/main/docs/wiki/Configuration:-Layout.md) — `gaps`、`preset-column-widths`、`center-focused-column`、`always-center-single-column`。
- [niri scrolling.rs](https://github.com/niri-wm/niri/blob/main/src/layout/scrolling.rs) — `resolve_column_width()`、`column_x()`、`compute_new_view_offset_*()`、`view_pos()`、连续列空间与可见/居中计算。
- [KWin scripting workspace clientArea](https://github.com/KDE/kwin/blob/Plasma/6.7/src/scripting/workspace_wrapper.h) — 输出/桌面可用区域与面板 strut 的来源。
