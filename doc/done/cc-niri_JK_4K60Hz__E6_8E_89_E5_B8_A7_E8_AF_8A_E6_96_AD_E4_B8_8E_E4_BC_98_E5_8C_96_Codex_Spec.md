# CC-Niri：J/K 工作区动画掉帧诊断与优化实施规范

> **归档状态（2026-10-20）：已实施。** D0、D1a 与 D2 已按限定范围实现，D1a / D2 已部署且当前选项关闭，短功能与用户目测通过；Blur 调整未采用，长期测试按用户要求跳过。D3 完整性能 / 资源验收仍 Pending，不能宣称真实长帧已经消除。见 [D0](../../test/JK_4K60_STUTTER_D0_RESULTS.md)、[D1a](../../test/RUST_NATIVE_R7_JK_D1A_RESULTS.md)、[D2](../../test/RUST_NATIVE_R7_JK_D2_RESULTS.md)。 原设计正文保留为历史依据；移入 `done/` 不代表未执行的验收已通过。

> **交付对象**：Codex（按阶段执行、验证、记录，再由用户决定是否部署）\
> **编写日期**：2026-10-13\
> **核查基线**：`Cc-aw/cc-niri` 远程 `main`：`b77a40eb1e0a0fd66d053c5996a13bc88e75518b`\
> **实机平台**：Fedora 44 / Plasma Wayland / KWin 6.7.5；主屏 3840×2160@60Hz、150% 缩放；副屏 2560×1440@60Hz、100% 缩放\
> **原始文档性质**：**设计与诊断方案；当前实现与未验收边界见页首归档说明，不是完整性能验收报告**。\
> **关联资料**：`JK_STUTTER_DIAGNOSTIC_20261013.md`、`test/RUST_NATIVE_R7_ANIMATION_A3_RESULTS.md`、`test/RUST_NATIVE_R7_ANIMATION_A5_RESULTS.md`、全项目 16GB 低内存规范。\
> **当前归档目录**：`doc/done/`（保留原文件名）

---

## 0. 目标、验收口径与核心原则

目标是在**保持 J/K 工作区动画观感、工作区一致性及 16GB 内存限制**的前提下，找出并降低少量残留的 33–50ms 长帧；将“真实掉帧”和“曲线造成的视觉停顿”分别处理。

**最先解决的不是某条五次曲线，而是合成器为什么没有按时呈现下一帧。** 修复顺序为：

1. **D0：测量与归因**。相同窗口负载下建立可复现基线，进行 Blur A/B，并定位长帧处于工作区挂载还是连续绘制期间。
2. **D1：已证实有效的渲染负载优化**。按 D0 证据决定是否调整 Blur/Contrast；减少每窗、每帧重复的 Desktop 遍历与投影。
3. **D2：可选观感优化**。隔离地引入 J/K Frame Delta Clamping，对长帧后的大幅位置跳跃做缓解；**不能把它宣称为消除掉帧**。
4. **D3：完整回归与发布门禁**。同负载数据、异常恢复、资源开销、4K60 主观验收和回滚完备后，才考虑部署。

**优先级：真实掉帧归因 > 可验证的负载降低 > 视觉时间轴打磨。** 不允许为让统计数字好看而篡改呈现时间戳、滤掉掉帧样本、限制真实 FPS 或缩短 420ms 时长后宣称掉帧已修复。

### 0.1 必须保留的用户体验

- `Meta+J/K` 的上下工作区切换及原生 KDE 工作区归属不改变；独立主副屏工作区行为不改变。
- 当前正常单次 J/K 轨迹时长仍为 **420ms**，除非独立实机 A/B 证明更好的视觉时间策略并取得用户认可。
- 已实现的 `smooth60`、连续 retarget、反向制动、最后实际绘制锚点与 Ring 同帧效果不失效。
- 不修改 H/L Spring、Pair/Wide、Full/Half 列宽、Focus Ring 所属窗口/圆角/颜色或 Dockless Bridge authority。
- 不损坏启用中的 `always-center-single-column`；现阶段它可能只存在于用户本地工作树，**不可因为远程仓库缺失该功能而覆盖/回退本地实现**。
- KWin 崩溃、Bridge 超时、插件重载、动画中窗口关闭都必须继续具备正确清理/恢复能力。

### 0.2 性能指标（工程目标，不是已测结果）

| 指标 | 期望 | 统计前提 |
| --- | --- | --- |
| 主屏 60Hz 正常帧间隔 | 约 16.67ms | 实际 `framePresented` |
| 超过 25ms 的呈现间隔 | 尽可能为 0，至少较基线显著减少 | 同一窗口集合/同方向/同样本量 |
| 约 50ms 的长帧 | 优先定位并争取消除 | 不允许删除首帧、缓存未热帧等不利样本 |
| 帧间隔 P95/P99/max | 单独报告，不只报告平均 FPS | 有限样本必须注明样本数及置信度限制 |
| 切换中途位置连续性 | 无 snap、回跳、画面停顿后突然突进 | 几何、painted anchor 与实际呈现分开解释 |
| 功能回归 | 全部现存 Native/JS 门禁通过 | 不可只跑 Rust 单测 |
| 内存与分配 | 不新增后台线程、全屏纹理、帧路径堆分配；稳态不持续增长 | 以全项目低内存规范为准 |

---

## 1. 实测事实：已知什么、尚不知道什么

### 1.1 2026-10-13 首次异常开机的诊断

已提供的 `JK_STUTTER_DIAGNOSTIC_20261013.md` 记载：

- 52 次 J/K 测试，52 次都触发 `desktopChanged` 和 Native motion arm，没有发现按键请求整体丢失。
- 有窗口工作区（2 列 ↔ 3 列）出现 **约 100ms** 的最长呈现间隔；无每轮探针的有窗口组仍能复现。
- 空工作区对照相对轻一些，但不是严格同负载 A/B，不能仅按列数归因。
- 长帧附近，KWin 主线程在采样窗口中处于执行状态的比例约 **73%–97%**，运行队列等待近零；支持“主线程执行或图形驱动同步调用时间过长”，**未定位到具体函数**。
- 诊断组主要缺页增量为零，没有证据把此类卡顿直接归因到 swap。
- 100ms 往返中的 `brake-c1`/`envelope` 会引入主观“减速—停顿—慢起步”，但无法解释实际的 68–91ms 绘制回调空档。
- 当时未完成 Blur/Contrast A/B、CPU 调用栈热点分析或同时刻 GPU 驱动采样；归因为 **INCONCLUSIVE**。

本次异常开机中若干临时探针自身可能影响时序，但在移除每轮探针后仍出现有窗口长帧，**不能把问题完全推给探针**。

### 1.2 再次重启后用户追加的实机观察

- 组件正常、单列居中保持开启，运行状态正常。
- 完成 **12 次 J/K 复测**；最长呈现间隔约 **50ms**，不再出现此前约 100ms 的长停顿，但仍有少量掉帧。
- 原工作区/焦点恢复；未修改配置。

这说明重启消除了最严重的一组会话状态异常，但**并不构成零掉帧验收**。不能因重启恢复就认定根因已经消失，更不能直接推断 Rust 曲线或最近的单列居中代码就是掉帧根因。

### 1.3 代码审查边界

本规范审阅的远程 `main` 为 `b77a40e`，其中**未包含用户尚未推送的单列居中源码**。Codex 开始前必须先读取**本地实际已安装/已运行组件对应的源码及提交/dirty diff**；如与远程 `main` 不一致，以本机源代码作为本次开发基线，差异单独记录。

**明确没有证明**：Blur 是根因、某个特定应用造成长帧、GPU 利用率过高、CPU 调度饥饿、内存泄漏、Frame Delta Clamping 会提高 FPS、`WorkspaceMountController` 一定阻塞 50ms。

---

## 2. 精确源码执行链路

### 2.1 从 J/K 按键到 KWin 桌面切换

```text
Meta+J/K
  └─ src/kwin/workspace/WorkspaceSwitchController.js
       request() / requestTo()
       ├─ begin()       : cancel pending, capture old workspace
       ├─ requestDesktop() -> KWin desktopChanged
       └─ finish()      : mountPrepared(), commitState()
              └─ src/kwin/workspace/WorkspaceMountController.js
                   pruneSnapshots() / reconcile() / hydrate()
                   recomputeLayout() / relayout()
                   runtime state/Bridge commit
```

`WorkspaceSwitchController.js:99–143` 的挂载过程在 KWin 桌面事件路径中同步执行；`WorkspaceMountController.js:83–150` 的 `reconcile()` 包含两轮窗口枚举，第二轮为同步生命周期回调补漏，**没有证据不得直接删除**。

`WorkspaceSwitchController` 的 **400ms timeout** 是事务保护超时，**不是在每次 J/K 动画中主动暂停 400ms**。

### 2.2 从 `desktopChanged` 到连续绘制

```text
KWin EffectsHandler::desktopChanged
  └─ native/viewport-clip/WorkspaceSlideAdapter.cpp
       prepare(output)
       ├─ ScreenBinding / visible refs
       ├─ WindowForceBlurRole / WindowForceBackgroundContrastRole
       ├─ configure Rust WorkspaceMotion
       └─ setActiveFullScreenEffect()

Render loop (target output, each frame)
  ├─ WorkspaceSlideAdapter::prePaintScreen()
  │     ├─ nextPresentationTimestamp()
  │     ├─ Rust cc_niri_workspace_advance()
  │     └─ PAINT_SCREEN_TRANSFORMED
  ├─ WorkspaceSlideAdapter::paintWindow()
  │     ├─ for each desktop -> membership -> Rust projection
  │     ├─ per-desktop translated/clipped paint
  │     └─ downstream KWin Scene/Blur/Contrast/driver
  └─ WorkspaceSlideAdapter::postPaintScreen()
        ├─ finish() if completed
        └─ effects->addRepaint(output->geometry()) if active
```

**实际热点候选**：

- `native/viewport-clip/WorkspaceSlideAdapter.cpp:76–115`：准备时对该输出的所有窗口持有可见性引用和强制 Blur/Contrast 角色。
- 同文件 `:156–180`：每个目标输出 paint pass 前进 Rust 位置，设置 `PAINT_SCREEN_TRANSFORMED`，结束后持续请求整输出重绘。
- 同文件 `:183–209`：逐窗口扫描 `effects->desktops()`，逐桌面执行投影与分支，然后进入绘制链。
- `native/viewport-clip/ViewportClipEffect.cpp:935–1009`：Native Clip 的绘制与 repaint 入口，仍涉及共享时钟、旧滚动事务、输出作用域。
- `src/kwin/workspace/WorkspaceMountController.js:33–150`：桌面切换时的窗口枚举、快照/列重建、几何发布。
- `native/rust/cc-niri-native-core/src/workspace_motion.rs:345–386`：常数复杂度、已测试零分配的轨迹更新和最后绘制锚点；**当前不是最可信的 50ms 计算热点**。

### 2.3 为什么 4K60 下成本较高

- 主屏为 3840×2160，60Hz 帧预算仅 **约 16.67ms**。
- KWin Effect API 说明 `PAINT_SCREEN_TRANSFORMED` 会将渲染切到整屏变换绘制路径；这种需求是工作区动画的固有代价，不能直接删除标志。
- KWin 原生 Slide 也进行整屏变换。重点在于**整屏绘制内部是否重复绘制/模糊了不必要的窗口和桌面**。
- 3840×2160 RGBA8 单帧原始像素约 31.6MiB，实际多个 Blur pass、合成/读写会增加带宽和渲染开销；不能将这 31.6MiB 当作已测 GPU 内存占用或带宽。

---

## 3. 原因假设与证伪实验（严禁把猜测写成确定事实）

| 排序 | 假设 | 源码依据 | 能解释什么 | 首要证伪方式 |
| --- | --- | --- | --- | --- |
| H1 | KWin Blur / BackgroundContrast 在移动窗口上增加 GPU/驱动成本 | Slide `bindWindow()` 强制角色；KWin Blur 的 `shouldBlur()`/离屏缓冲 | 有窗口较差、异常在绘制期间 | 同负载 Blur 开→关→开；单独测 forced roles |
| H2 | 全屏变换与逐窗多桌面绘制路径开销偏高 | `PAINT_SCREEN_TRANSFORMED`、全输出 repaint、嵌套 desktop loop | 内容多、桌面复杂时更明显 | 每帧耗时分段与有限桌面可视列表 A/B |
| H3 | 工作区 JS mount、几何和 Bridge 同步发布阻塞动画初始帧 | `WorkspaceSwitchController.finish()`、`WorkspaceMountController.hydrate()` | 切换开始处的 33–50ms 首帧 | 记录 `desktopChanged` 到第一帧前各阶段耗时 |
| H4 | KWin/NVIDIA 驱动或会话状态偶发变差 | 重启后 100ms 问题消退；主线程实测忙碌 | 不同开机表现差异 | 正常/异常会话对比驱动、效果和调用栈 |
| H5 | 轨迹制动与 420ms 重启导致主观停顿 | `workspace_curve.rs` 的 `brake-c1` | 快速反向时“动—停—慢动” | motion capture 校验策略，不等价于呈现漏帧 |
| H6 | 本地新单列居中导致重复 geometry/mount | 当前远程没有这部分新源码 | 如出现在开始阶段则可能相关 | 读本地 dirty diff、同负载功能开关 A/B |

**诊断顺序要求**：首先做 H1/H2/H3 的证据采集；只有证据支持 H5 对主观观感有贡献时，再单独优化轨迹。H6 不允许通过覆盖用户本地功能来“测试”。

---

## 4. D0 — 建立基线与定位长帧（必须最先完成）

### 4.1 只读环境核对与保护用户数据

在修改前记录：

```bash
# 只读检查，不会停用 cc-niri
pwd
git rev-parse HEAD
git status --short
cat rust-toolchain.toml
cc-niri status

# 实际 Native 工作区优化配置
kreadconfig6 --file kwinrc --group Effect-cc-niri-viewport-clip --key OptimizedWorkspaceAnimation
kreadconfig6 --file kwinrc --group Effect-cc-niri-viewport-clip --key WorkspaceDuration
kreadconfig6 --file kwinrc --group Effect-cc-niri-viewport-clip --key AnimationProfile

# 记录实际加载状态
qdbus6 org.kde.KWin /Effects org.kde.kwin.Effects.isEffectLoaded blur
qdbus6 org.kde.KWin /Effects org.kde.kwin.Effects.isEffectLoaded slide

# 读取 Native 状态，不修改运行态
gdbus call --session --dest org.kde.KWin --object-path /ccNiriViewportMotion \
  --method org.cc.NiriViewportMotion1.GetScrollMotionStatus
```

- 检查本地源码/构建/安装组件与远程基线是否相同，**不可擅自 `git reset`、`git stash`、切分支丢失未提交修改或自动重装**。
- 保存测试前工作区、实际输出、焦点、窗口数和项目配置快照；试验后仅恢复试验自己造成的改变。
- 不采集窗口标题、屏幕内容和敏感个人信息；报告汇总可以只含窗口数量、场景标签、输出名称和耗时。
- 本机已启用单列居中，须记录其配置/源码状态。远程缺失这段实现不等于“应该撤销”。

### 4.2 现有工作区捕获接口（优先复用）

```bash
# 在运行期间安全短采样；调用后立即执行固定 J/K 场景（捕获窗口约 3s）
gdbus call --session --dest org.kde.KWin --object-path /ccNiriViewportMotion \
  --method org.cc.NiriViewportMotion1.StartWorkspaceFrameCapture

# 人工执行 J 或 K；待捕获时间结束后取数据
sleep 3

gdbus call --session --dest org.kde.KWin --object-path /ccNiriViewportMotion \
  --method org.cc.NiriViewportMotion1.GetWorkspaceFrameCapture \
  > /tmp/cc-niri-jk-sample.dbus

python3 tools/analyze-workspace-capture.py /tmp/cc-niri-jk-sample.dbus
```

这套接口**已经存在**，只记录有限数量的呈现帧、Native motion 样本和策略；不需要发明另一套长期开启的 profiler。

**统计区间必须正确**：现有 `tools/analyze-workspace-capture.py` 默认对输出捕获期内全部 `presentedMs` 计算间隔，可能把动画之前/之后的正常空闲、实验之间的停顿也算进来。**D0 正式性能结论必须基于每次真实桌面切换开始至 Native finish 后一个刷新周期（或与原诊断一致的有证据事件边界）**，按每次 transition 统计再汇总；不能直接把完整 3 秒 capture 的 `longIntervals` 当作工作区掉帧数。可以保留原分析器给出初步诊断，但还须另用离线的纯 Python 边界过滤，保存未经改写的原始时间戳。转场首帧/尾帧边界不明确时，标注不确定度而不是任意丢弃不利样本。

重点记录：

- `outputs[].presentedMs` → P50/P95/P99、max、`>25ms` 长间隔数。
- `motionCapture.records[]` 中每个 `kind=0/1/2` 的 arm/paint/finish 记录，`startMs`、`atMs`、`strategies`、`brakeYMs`、`initialVelocity`。
- 第一个 `desktopChanged` 距离首个 paint 的时间，以及是否只在开始处掉帧。
- **注意**：仓库现有工具写明 `output-only-no-paint-to-present-join`；**不可把对应输出的某个 `framePresented` 当成确切匹配的那一帧窗口内容**。

建议场景以 **相同窗口集、相同工作区、同一轮输入序列、避免中途启动编译** 为条件，每组 12 次左右，先复用已有正常/异常基线；如统计不足再小幅增加。不要无必要做数百次重复切换。

### 4.3 Blur 开/关/开 A/B（不修改源码）

仅当 `isEffectLoaded blur` 为 `true` 时执行。先留存运行状态和基线，再临时卸载 Blur：

```bash
gdbus call --session --dest org.kde.KWin --object-path /Effects \
  --method org.kde.kwin.Effects.unloadEffect blur

# 同一窗口、同一工作区进行短采样，确认效果确实卸载

# 试验完毕，恢复原始加载状态（只有原来为 true 才加载）
gdbus call --session --dest org.kde.KWin --object-path /Effects \
  --method org.kde.kwin.Effects.loadEffect blur
```

**必须验证**：卸载/加载的返回、重新加载后的 `isEffectLoaded`、工作区和焦点状态；如果 D-Bus 接口失败，不要继续认为该轮是有效 A/B。

A/B 记录表：

| 轮次 | 场景 | Blur | 12 次总 `>25ms` 长间隔 | 单次最大间隔 | P95/P99 | 窗口集合与输出一致? |
| --- | --- | --- | ---: | ---: | --- | --- |
| A1 | 2 列↔3 列 | ON | 待填 | 待填 | 待填 | 待核 |
| B  | 同上 | OFF | 待填 | 待填 | 待填 | 待核 |
| A2 | 同上 | ON | 待填 | 待填 | 待填 | 待核 |

**判定**：仅当 OFF 多次实测显著改善且 ON 恢复后异常复现，才优先修改 Blur 强制角色策略；否则不要把 Blur 视为根因。其他候选特效也使用这一套严格、可恢复的 A/B 方法。

### 4.4 有界阶段耗时记录（当 A/B 仍不能归因时）

若仍有 33–50ms 长帧且无法确认热点，Codex 应先**只增加可选、低扰动的阶段测时**，默认 OFF：

| 阶段 | 建议埋点 | 目的 |
| --- | --- | --- |
| W0 | `WorkspaceSlideAdapter::desktopChanged()/prepare()` | 绑定全部窗口、初始化 Rust 的用时 |
| J0 | `WorkspaceSwitchController::finish()` | JS 桌面状态同步总用时 |
| J1 | `WorkspaceMountController::reconcile()/hydrate()` | 枚举窗口/几何提交是否阻塞第一帧 |
| F0 | `WorkspaceSlideAdapter::prePaintScreen()` | 运动采样/标志设置耗时 |
| F1 | `WorkspaceSlideAdapter::paintWindow()` 周边 | 整个下游绘制链的 wall time；**含其它效果/驱动，不能仅归咎于 cc-niri** |
| F2 | `WorkspaceSlideAdapter::postPaintScreen()` | 收尾/持续 repaint 申请成本 |
| P0 | `framePresented` 时间 | 真实呈现间隔，需与 F0/F1 分开解释 |

实现约束：

- C++ 用 `std::chrono::steady_clock` 测量；在测试启用时写入固定容量 POD ring buffer（如 256/512 条），在结束后通过一次显式查询序列化。
- 每帧**禁止** `qDebug`、`qCInfo`、文件 I/O、D-Bus、JSON 序列化、动态扩容、`glFinish`、同步 `glReadPixels` 或主动 GPU fence wait。
- JS 事件路径允许粗粒度计时（如 `Date.now()`），但不能宣称有亚毫秒精度；控制事件耗时与 GPU 呈现严格区分。
- 容量耗尽设置 `truncated`，停止记录；不得无界保存历史窗口、对象指针或捕获数据。
- 每个测试报告记录有无仪器开销、编译/后台负载、刷新率、缩放、平均/尾部时延。
- 如果本机拥有低扰动的 `perf` 调用栈采集能力，可选用**短时间只读采样**确定主线程/图形驱动热点；没有则标明缺失，不强装复杂图形调试工具、不在运行中的 KWin 上随意使用会暂停合成器的调试命令。

#### 归因决策树

1. 长帧仅集中在 `desktopChanged` 后的第一到第二次呈现：先核查 J0/J1/W0 的事件耗时。
2. 长帧发生在运动中段，F1 及下游绘制耗时升高：优先 H1/H2；区分 Blur 效果与 Driver/Scene。
3. 关闭 Blur 后长帧显著减少：先做可回滚的 Blur 策略试验，再考虑提交。
4. CPU 阶段都很短，但 `framePresented` 间隔依然长：不能宣布已归因，检查 GPU/驱动/呈现调度，避免用 CPU 时间替代 GPU 时间。
5. 没有长帧却主观“停—慢起步”：单独查看 `brake-c1` 和 retarget；属于视觉策略问题，不属于本阶段真实掉帧的性能改善。

**D0 交付物**：`test/JK_4K60_STUTTER_D0_RESULTS.md`（环境、版本、每组 raw capture 路径、指标表、可能热点、未证实事项、下一阶段是否有依据）。**没有 D0 结论，不允许同时改 Rust 曲线、Blur、JS mount 与整屏标志**。

---

## 5. D1 — 低风险渲染路径优化（先证实，再改）

### 5.1 桌面投影从“每窗口×每桌面”改成“每输出×每帧”

**当前源码**（简写）：

```cpp
for (auto *desktop : effects->desktops()) {
    if (!window->isOnDesktop(desktop)) continue;
    const auto projection = cc_niri_workspace_projection(binding->motion, desktopPoint(desktop),
        screenRect.width(), screenRect.height(), m_horizontalGap, m_verticalGap);
    if (!projection.visible) continue;
    // translate and paint
}
```

这个设计对 N 个受处理窗口和 D 个桌面进行 O(N×D) 轮成员检查/投影，不一定占 GPU 主成本，却是明确可优化的 CPU 工作。

**建议算法**：

1. 在 `prePaintScreen` 完成 Rust `advance()` 后，针对当前输出及当前帧一次性计算屏幕内可能可见的 Desktop 及 `translation`、viewport clip。
2. 正常纵向相邻切换预计仅需**一到两个** Desktop，但不得硬编码“最多两个”；用小固定容量结构（如 `std::array<VisibleDesktop, 4>`）保存常规情形。
3. `paintWindow` 只遍历已筛选的可见桌面，检查 `window->isOnDesktop(desktop)`，复用投影并执行正确的变换/裁剪。
4. `wrap`、跨多格直达、grid 变化、Sticky 窗口、桌面拓扑变更、输出切换和嵌套 paint 时，如果无法证明缓存完整与有效，则回退到原始全列表遍历/投影。**不能静默漏画桌面**。
5. 缓存生命周期只覆盖**当前真实输出 frame pass**；不能把指向 KWin Desktop 的裸指针跨删除/重配事件长期保留，也不能以全局单实例缓存代替 per-output/per-pass 数据。
6. 不能改变 `mark_painted` 时机：只有某个窗口的非空 clip 真正走入实际绘制路径后才算实际绘制锚点。

#### D1 几何验收

- 正常 J/K，包含切换的一半位置；画面顶部/底部过渡无黑缝、闪烁、叠画。
- `Meta+1…9` 非相邻直达、连续 J/J、J/K 反向与列宽 Full 仍正确。
- Pair→Wide 中途切换/返回，不破坏 frozen departure pose 和旧 Scroll 的释放。
- Sticky / Dialog / Fullscreen / moving window、独立副屏与混合 DPI 保持原策略。
- active/finished/stop/reconfigure/输出热插拔等状态变化正确使缓存失效。
- Native Rust 不新增每帧动态分配；必要时记录 CPU 每帧投影调用次数的前后对比。

预期收益首先是 **CPU 路径缩短**，不是保证 4K GPU 时间降低。只有实测对真实长帧有改善，才能称为有效的掉帧优化。

### 5.2 Blur/Background Contrast 策略（仅当 D0 A/B 证实相关）

KWin 6.7 `BlurEffect::shouldBlur` 会识别 `WindowForceBlurRole`；`BlurEffect::blur` 在需要时执行 Blur pass 并管理按背景尺寸分配的纹理/FBO。你的 `bindWindow` 当前总是将强制角色设为 true，随后在 `unbindWindow()` 里恢复。

**安全实施规范**：

- 优先引入**独立试验开关**，默认与当前已验收行为一致；只改变 Workspace Slide 期间的 forced roles，而不是全局关闭用户的 Blur 设置。
- `WindowBinding` 必须继续保存原始 `QVariant`；结束、取消、异常、桌面/输出删除、组件卸载时恢复原值。
- 不能覆盖其他 KWin 效果当前持有的角色；尤其要审查 `unbindWindow()` 的 “if current is true then restore” 在并发效果 owner 变化时的边界，避免清除其他效果后来写入的意图。
- 渲染行为变更必须获得明确的用户视觉验收：透明终端、面板、圆角、主题、焦点光圈和窗口边缘不能异常。
- 只在 D0 证明效果有效时，考虑提高开关默认策略；否则保持原实现，记录试验失败。

### 5.3 `PAINT_SCREEN_TRANSFORMED` / 全输出重绘

不能仅为了优化 FPS 直接删除 `PAINT_SCREEN_TRANSFORMED`。KWin 的 transformed screen 改变通用场景/遮挡判定；错误裁剪可能导致移动中的旧画面残留。

只有在理解并覆盖 KWin `WorkspaceScene` 的 Generic Paint 路径后，才可以考虑：

- 在普通非 wrap、无背景平移、纯移动窗口等受限条件下证明局部 damage 等价；
- 对其他场景回退原生 full repaint；
- 不改变 Focus Ring/Blur 的参与顺序与物理 DPI 裁剪边界。

这一项风险高、性能收益未知，**不是本轮第一批代码修改**。此前 A5 的 target-output 重绘优化主要用于 H/L Scroll continuation，不能将其测试结论直接套到 J/K。

**D1 交付物**：每一项独立提交、独立 A/B 统计、Native/JS 门禁、无需新 GPU 大纹理及已验证回滚路径。

---

## 6. D2 — J/K Frame Delta Clamping（独立、可选的观感优化）

### 6.1 与真实掉帧的区别

当前 `WorkspaceMotion::advance(now)` 使用绝对 `now-started_at` 推进曲线：

```rust
let elapsed = now.saturating_sub(self.started_at);
```

如果真实间隔依次是 16.7ms → **50ms** → 16.7ms，下一张成功呈现的画面将直接处于 50ms 之后的位置。这个设计保证物理时间不拖延，但视觉上跨过了漏掉的两个中间画面。

KWin 6.7 原生 `AnimationClock::tick()` 在给定刷新率时，会限制两次 tick 的 `delta`；当前 `WorkspaceSlideAdapter::prePaintScreen()` 直接把 `nextPresentationTimestamp()` 传给 Rust。

**因此：Clamping 可以减轻突进感，但不能修复真正的 GPU/CPU 长帧。** 不允许通过限制逻辑时间让 `framePresented` 的统计看起来变好。

### 6.2 设计方案与时间域一致性

推荐在 C++ Workspace Adapter 中增加**可选、每输出的动画逻辑时钟**，而不是直接截断 Rust `elapsed`：

1. 在第一个有效帧确定逻辑时间起点，后续对同一输出使用单调 `logical_now`。
2. 以有效的 compositor predicted presentation timestamp 为输入，限制一次真实 paint pass 对逻辑时间的推进量，优先根据有效输出刷新周期推导，60Hz 约 16.67ms。无效/变化中的输出事实保持安全回退。
3. **Rust start/retarget、advance、`mark_painted` 的 timestamp 必须始终来自同一逻辑时间域**。不能让 start 用真实 `steady_clock`，advance 用减速后的虚拟时间，却直接用两者相减。
4. 对没有真实输出 paint 的虚假/嵌套 pass，不得消耗逻辑时间；每个输出同一 frame identity/revision 不得推进两次。
5. 动画正进行时 retarget 必须从最后**真正被绘制**的 logical pose/velocity/acceleration 接管；连续目标、反向、C1/C2/制动的数学约束保持。
6. reset/finish/reconfigure/切换 workspace、输出销毁或刷新率变更时，安全释放时钟状态，确保不会继承旧会话的逻辑滞后。
7. 若出现暂停很久没有帧、预估时间倒退、速率变化或时钟失效，要明确定义跳变/回退处理，避免整条动画永久落后或卡住。
8. 不新增 timer/async worker、不在每帧保存历史或动态创建容器；只允许少量 POD 字段放到现有 `ScreenBinding`。

**重要取舍**：Delta Clamping 会使发生缺帧时的实际动画完结时间可能**超过标称 420ms**。必须单独报告实际 deadline 延迟。不能既承诺每次始终 420ms 墙钟精确完成，又在丢帧时无条件跳过真实时间——除非为这种冲突规定并验证明确的收尾策略。

### 6.3 对照实验与实现门禁

- `off`：当前绝对时间策略、保留现有 Rust 代码行为。
- `on`：逻辑时间按真实输出帧节奏受限推进，不改变帧实际呈现时间。
- 同一窗口集合、同一 60Hz 输出、相同 J/K 输入，分别比较：实际 max/P99、最大可见单帧位置跳跃、总动画时长、最后 pose/velocity、反向接管误差。
- `on` 只可能改善视觉跳跃；如果实际长帧仍为 50ms，报告必须明确写**掉帧未消除**。

**禁止**：

```rust
// 错误示例：这样将整条动画的累计 elapsed 永久限制在一帧，
// 也破坏 now/start/painted anchor 的时间域一致性。
let elapsed = (now - self.started_at).min(frame_interval);
```

### 6.4 反向制动单独处理，不与时钟修改混合

`workspace_curve.rs` 中的 `BrakeC1` 会先在 <=50ms / <=0.02 cell 的受限区域内减速，再从 0 速度开始剩余五次曲线。连续反向时可能有“急动—停—慢动”的体感，但**不是已经测到的 33–50ms 真实漏帧的充分解释**。

如果在有效 A/B 后仍明显不满意，可以另立设计阶段评估 C1 拼接、随剩余距离变化的 duration 和更自然的轨迹速度约束。不能在本轮 D0/D1 或 Delta Clamping 同一个提交中修改。

**D2 交付物**：选项默认 OFF、时钟/retarget 独立契约测试、同负载 A/B、明确 visual 与 actual-frame 两套结论、回退方案。

---

## 7. 16GB 内存与性能预算（整个 cc-niri 项目级约束）

本轮必须遵守项目独立的 `cc-niri_16GB_Whole_Project_Memory_Budget_Codex_Spec.md`。下面的阈值是先验工程目标，不是目前实测事实：

| 项目 | 原则或初始目标 |
| --- | --- |
| 全项目 Dockless 稳态 PSS 增量 | 初始目标 <=32MiB，长期争取 <=16MiB（相对可比 KDE 基线） |
| 动画期间全项目额外 PSS 峰值 | 初始目标 <=64MiB（以实际 A/B 数据校准） |
| J/K 优化新增常驻线程/服务 | 0 |
| 额外 4K fullscreen texture/FBO | 0（不新建） |
| hot path 新增动态堆分配 | 0（理想目标/需检查） |
| 有界诊断 | 默认 OFF；固定容量；结束立即释放/停止 |
| 重复 J/K、窗口关闭、工作区切换 | 不允许稳态内存持续增长 |

为了避免概念混淆：

- **PSS 增量**以同配置、同窗口负载、可比的原生 KWin 基线为参考，而非要求整个 `kwin_wayland` 只有 32MiB。
- 图形驱动的显存占用与进程 PSS 不是同一个指标；必要时分别记录。
- Blur A/B 自身可能改变 KWin 的纹理缓存与显存，必须与 cc-niri 自身新增缓存分开分析。
- 每帧新增 `std::vector`、`QJsonObject`、同步日志、动态大缓冲不可接受；可见桌面缓存优先 `std::array`/现有 `ScreenBinding`。
- 新功能不能以大幅牺牲视觉质量、窗口恢复安全或强行关闭系统效果的方式达到内存数字。

---

## 8. 必须保留的并发/生命周期边界

1. **单一 Authority**：JS 仍负责 Workspace/Column 状态与窗口归属；Rust Core 仅决定运动数值；C++ 管理 KWin 对象、效果和绘制。
2. **没有第二个动画时钟 owner**：可选逻辑时钟是 Workspace Slide 的唯一采样时间适配层，不能跟另一套 Scheduler 平行驱动同一个 Rust Core。
3. **KWin 桌面与效果的真实生命周期**：桌面删除、重新排序、屏幕热插拔、窗口关闭、切换 Activity、KWin 其他 fullscreen effect 抢占时要释放 binding 与临时窗口数据。
4. **最后绘制锚点**：不能仅仅以 `advance()` 返回值假定一帧已经显示。保留 `mark_painted` 必须在有效非空窗口绘制后确认。
5. **焦点/场景顺序**：不得先激活仍被 park 的窗口。Pair→Wide、Wide→Pair 的 departure freeze/clip 和 Focus Ring owner 必须继续正常。
6. **用户配置与已安装状态**：停用效果、切 profile、`cc-niri stop/restart` 前后只恢复自己修改的配置；备份原状态；恢复失败时中止继续改动。
7. **原生 Slide 互斥**：启用自定义 Workspace Slide 时不允许与原 KDE Slide 同时持有相同转场的动画 authority。
8. **报错 Fail Safe**：任何新增缓存无效或计时异常，应退回现有经验证绘制/数值路径，不应产生黑屏、闪退或藏窗。

---

## 9. 分阶段开发、测试与提交规则

### D0 — 因果证据与只读诊断

**允许**：确认实际安装/本地差异；短时现有 capture；同负载 Blur A/B；如必要增加**默认关闭且有上限**的性能测量。\
**禁止**：直接改 Rust 运动曲线、移除全屏 paint、重写 JS workspace authority。\
**结果**：`test/JK_4K60_STUTTER_D0_RESULTS.md`，必须明确结论 `BLUR_RELATED` / `MOUNT_RELATED` / `RENDER_RELATED` / `DRIVER_OR_UNKNOWN` / `INCONCLUSIVE` 及证据强度。

### D1a — 可视 Desktop / 投影预计算（低风险、需回归）

在固定帧作用域中缓存可见 desktop 与 projected translation，原 `paintWindow` 语义不变，异常自动回退。单独提交，先运行自动门禁再实机短测。

### D1b — Blur/Contrast 条件策略（仅 H1 证实才实施）

以 opt-in 开关进行，保存并严格恢复 KWin 原角色，不能与 D1a 一起提交。确认效果与差异，正式方案以用户视觉反馈为准。

### D2 — Frame Delta Clamping（选做；观感优化）

必须独立提交、默认 OFF、逻辑时钟域一致。任何 FPS 变化严格由真实呈现采样证实，不能用逻辑动画步进代替 FPS。

### D3 — 性能、稳定性与 16GB 内存发布门禁

按相同条件完成 A/B、快速 J J K K、非相邻直达、长时间 idle、窗口/桌面生命周期、恢复/卸载及 16GB 增量测量。记录用户主观验收与尚未覆盖项目。

### 每次源码改动至少执行

```bash
node tools/build.js                 # 修改 src/ 后更新生成包；禁止手改生成脚本
cargo fmt --manifest-path native/rust/Cargo.toml --all --check
cargo clippy --manifest-path native/rust/Cargo.toml --locked --workspace --all-targets -- -D warnings
cargo test --manifest-path native/rust/Cargo.toml --locked --workspace
node tools/check.js --native
```

- Rust 精确遵守 `rust-toolchain.toml`（当前远程 `1.99.0`），Cargo 使用 `--locked`，C++ CMake 固定 `/usr/bin/g++` GCC 16.x。
- Native 代码修改还必须按 `native/AGENTS.md` 执行 Debug/Release、CTest、`BUILD_TESTING=OFF` 的 production boundary 审计（按修改范围）。
- 推荐串行执行耗资源测试，构建并行最多 2，以适配 16GB 内存，不在帧率测量期间进行编译。
- 远程 `b77a40e` 的 GitHub CI 曾因 `test/workspace-runtime-guards.test.js` 的测试 VM 环境缺少 `layoutEligibility` 而出现 99/100 回归失败。**本地开始前重新核对是否仍存在；若存在先独立修复基线测试，且不得将修复基线计为 J/K 性能收益。**
- JS-only 或 C++-only 改动也不能省略相关的实机 KWin 运动与视觉验收。

---

## 10. 实机回归矩阵与完成定义

| 编号 | 场景 | 关键验收 |
| --- | --- | --- |
| S01 | 单次 J、单次 K（已有窗口） | 帧间隔、原始位置/焦点、无 visual snap |
| S02 | J J、K K，80ms 与 100ms 间隔 | 连续 retarget，旧 epoch 不误完成 |
| S03 | J K、K J 快速反向 | 制动有界，画面无反向突跳，区分真实掉帧 |
| S04 | 两个有窗口工作区，配置与窗口集合固定 | A/B 的 P95/P99/max/长帧数具有可比性 |
| S05 | 有窗口 ↔ 空工作区 | 背景、全屏过渡、无遗留画面 |
| S06 | Pair→Wide 转场中 J，随后 K 返回 | departure pose、Clip、焦点、Ring 正常 |
| S07 | Full 列、单列居中、普通 half 列 | 不回退本地新功能，渲染与几何正确 |
| S08 | 副屏显示不同桌面，主屏 J/K | 不修改副屏桌面/窗口 Safe Area |
| S09 | 150% + 100% 混合 DPI | 无错位、半像素抖动、clip 缝隙 |
| S10 | Sticky / Dialog / Fullscreen / moving window | Native 生命周期/窗口角色语义正常 |
| S11 | 动画中关闭窗口、工作区回收/新增 | 未悬挂 KWin 指针、缓存失效、停放窗口可恢复 |
| S12 | 模拟错误输入/输出失效、停启效果 | fallback 后无黑屏、窗口消失、KWin 崩溃 |
| S13 | `cc-niri restart/stop/start` | 原工作区、实际焦点、列顺序/偏好/状态正确 |
| S14 | 30–60min 普通桌面/短压力试验 | 无重复资源累积、无稳态内存持续增长 |

**通过门槛**：

- 真实帧长指标由 `framePresented` 佐证，不能只观察 `workspaceMotion` 逻辑时间。
- 对每一项被称为“优化有效”的改动，提供同负载前后原始统计与样本量、重现步骤，以及视觉功能不退化的证据。
- 原来 100ms 的严重会话偶发问题不代表已经根治；如果无法复现/归因，应明确记录而不是推断原因。
- 所有新诊断配置默认关闭，不新增后台线程/大纹理；不违反整项目内存预算。
- 当前本机启用的单列居中与工作区恢复、Ring/Blur 正常行为不应被无意修改。
- 没有实机用户验收的项标记 `PENDING`，不能用仅通过自动测试代替。

---

## 11. 可直接交给 Codex 的执行指令

> 请阅读本文件和 `JK_STUTTER_DIAGNOSTIC_20261013.md`，以本机实际工作树与已安装组件为基线，对 cc-niri 的 J/K 4K60 动画剩余 33–50ms 长帧进行因果诊断。**先仅完成 D0，不先修改 Rust 工作区曲线、动画 duration、全屏绘制标志或重写 WorkspaceSwitchController**。区分真实 `framePresented` 长帧和 `brake-c1` 的主观停顿。首先利用既有 `StartWorkspaceFrameCapture` 与 `analyze-workspace-capture.py`，使用固定有窗口场景做 Blur ON/OFF/ON 短测；如仍无法确定热点，加入默认关闭、固定容量、帧路径零分配的阶段耗时计数，再生成 `test/JK_4K60_STUTTER_D0_RESULTS.md`。保护全部未提交代码，尤其是本地的 `always-center-single-column`，不自动重装或重启用户 KWin。不采集用户窗口内容。完成 D0 并给出可核查的结论后，按照证据逐项提出 D1a/D1b/D2 的独立最小补丁，任何改动都要保留回退和 16GB 内存约束。所有未执行的测试必须如实注明，不得声称性能已经提高。

---

## 12. 源码与证据索引

### CC-Niri（远程审核基线 `b77a40e`）

- [Workspace Slide Adapter](https://github.com/Cc-aw/cc-niri/blob/b77a40eb1e0a0fd66d053c5996a13bc88e75518b/native/viewport-clip/WorkspaceSlideAdapter.cpp)：`prepare`、Blur/Contrast、`prePaintScreen`、`paintWindow`、`postPaintScreen`。
- [Viewport Clip Effect](https://github.com/Cc-aw/cc-niri/blob/b77a40eb1e0a0fd66d053c5996a13bc88e75518b/native/viewport-clip/ViewportClipEffect.cpp)：合成器 paint 入口、Workspace capture / motion status。
- [Rust Workspace Motion](https://github.com/Cc-aw/cc-niri/blob/b77a40eb1e0a0fd66d053c5996a13bc88e75518b/native/rust/cc-niri-native-core/src/workspace_motion.rs)：轨迹时间、绝对 elapsed、painted anchor。
- [Rust Workspace Curve](https://github.com/Cc-aw/cc-niri/blob/b77a40eb1e0a0fd66d053c5996a13bc88e75518b/native/rust/cc-niri-native-core/src/workspace_curve.rs)：Carry C2/C1、Brake C1、Reset 的约束。
- [Workspace Switch Controller](https://github.com/Cc-aw/cc-niri/blob/b77a40eb1e0a0fd66d053c5996a13bc88e75518b/src/kwin/workspace/WorkspaceSwitchController.js)。
- [Workspace Mount Controller](https://github.com/Cc-aw/cc-niri/blob/b77a40eb1e0a0fd66d053c5996a13bc88e75518b/src/kwin/workspace/WorkspaceMountController.js)。
- [Existing workspace frame analyzer](https://github.com/Cc-aw/cc-niri/blob/b77a40eb1e0a0fd66d053c5996a13bc88e75518b/tools/analyze-workspace-capture.py)。
- [A3 动画验收](https://github.com/Cc-aw/cc-niri/blob/b77a40eb1e0a0fd66d053c5996a13bc88e75518b/test/RUST_NATIVE_R7_ANIMATION_A3_RESULTS.md)；[A5 动画验收](https://github.com/Cc-aw/cc-niri/blob/b77a40eb1e0a0fd66d053c5996a13bc88e75518b/test/RUST_NATIVE_R7_ANIMATION_A5_RESULTS.md)。

### KDE KWin 6.7 参照实现

- [AnimationClock（帧增量限制）](https://github.com/KDE/kwin/blob/Plasma/6.7/src/effect/timeline.cpp#L22-L49)：真实时间增量限制。
- [原生 Slide](https://github.com/KDE/kwin/blob/Plasma/6.7/src/plugins/slide/slide.cpp)：可见桌面筛选、workspace motion、Blur roles。
- [Blur Effect](https://github.com/KDE/kwin/blob/Plasma/6.7/src/plugins/blur/blur.cpp#L488-L625)：`shouldBlur()`、离屏纹理与背景处理。
- [KWin Effect API](https://github.com/KDE/kwin/blob/Plasma/6.7/src/effect/effect.h)：`PAINT_SCREEN_TRANSFORMED` 语义。

### 证据来源边界

- `JK_STUTTER_DIAGNOSTIC_20261013.md` 是**实际用户提供的 52 次本机诊断结果**，不是对当前远程 GitHub 版本完成的新测试。
- “再次重启后 12 次 J/K 最大约 50ms”来自用户本轮补充，没有相同粒度的阶段耗时原始记录；Codex 应另建基线记录，不能补造帧数据。
- 文档中的阶段、阈值、目标与候选优化是**计划**；所有结论应由接下来的实机 A/B 与门禁结果确认。
