# Focus Ring Phase 4：Retarget 实施计划

日期：2026-10-05。状态：已准备，尚未开始本阶段实现、部署或专门实机验收。

依据：[Focus Ring 实现设计第 37 节](cc-niri_Focus_Ring_实现设计.md#phase-4--retarget)。本阶段验证快速连续输入和中途反向时，边框始终附着当前 compositor visual window，没有闪烁、跳动、丢失或残留。

## 当前基线

- Focus Ring Phase 1–3 已实现并通过主屏实机验收；当前仅真实 active managed window 有 3px、#7FC8FF 边框。
- [四侧描边裁剪与启动圆角修复](../../test/FOCUS_RING_CLIP_CORNER_RESULTS.md)已部署，用户确认正常。共享裁剪保留四侧描边余量；圆角跟随已加载的圆角效果及其配置。
- Spring 的 [Phase 7 连续 retarget](../../test/VIEWOFFSET_SPRING_PHASE7_RESULTS.md) 与 [Phase 8 中途反向](../../test/VIEWOFFSET_SPRING_PHASE8_RESULTS.md) 已完成；本阶段复用生产实现，不新增另一套动画时钟或曲线。
- `ScrollViewportRuntime::arm()` 从最后实际绘制的 offset 接管新 epoch，并接受几何提交前后的已知 source / target frame。旧 epoch 的取消不能清除新 motion；反向的速度规则沿用已有 Spring 行为。
- `FocusRingPaintFrame` 在一次 `paintWindow` 调用内捕获最终视觉变换、位置、透明度、mask 与 device clip。现有 144 样本回归覆盖单段滚动，本阶段补充多段 retarget 与 owner 变化组合。

## 范围与模块职责

| 模块 | 本阶段工作 |
| --- | --- |
| `native/focus-ring/tests/FocusRingRetargetTest.cpp`（拟新增） | 组合真实生产 Spring runtime、Ring Item / PaintFrame 与共享 clip，验证连续多段滚动。Spring 只链接进测试，不成为 Ring 插件依赖。 |
| `native/focus-ring/tests/FocusRingItemTest.cpp`、`FocusRingPaintTest.cpp` | 扩展实际需要的 owner 切换、关闭和卸载清理回归；先核对已有覆盖，避免重复。 |
| `native/focus-ring/CMakeLists.txt` | 注册本阶段新增的原生回归。 |
| `FocusRingEffect` / `FocusRingItem` / `FocusRingPaintFrame` | 只有真实回归暴露缺陷时才修复对应模块；保留每次绘制调用内的快照和单 owner 生命周期。 |
| `native/common/ViewportPaintClip.h` | 使用当前生产算法，检查 retarget 期间四侧描边余量与原始遮挡区域的交集。 |
| JS `FocusRingController`、Native Clip / Spring | 沿用既有资格发布和滚动能力；不复制布局、Presentation 或 Spring 状态。 |

## 自动验证设计

1. 使用生产 `ScrollViewportRuntime` 连续 arm 不同 epoch：同向 `L → L`、反向 `L → H`、交替 `L → H → L`，以及设计文档的 `L L H L H H`。分别在两次绘制之间、几何提交前后、motion 完成但旧段尚未清理时接管。
2. 对每一帧以窗口实际 paint 数据为基准，核对 Ring 的矩阵、mask、clip 和透明度；同一 owner 的接管前后保持视觉连续。只对生产几何 / 浮点运算采用合理误差，不能用放宽误差掩盖 Ring 与同帧窗口数据不一致。
3. 覆盖 incoming、continuing、outgoing 窗口参与角色切换及旧 outgoing 保留。活动窗口到达视口左右边界时，四侧描边仍随该窗口同步显示；完全屏幕外的窗口继续被裁剪。
4. 测试 retarget 时真实焦点切换到另一窗口：旧 owner 的 Ring 和裁剪余量清理，新 owner 直接使用其当前绘制数据。不同窗口之间允许焦点边框直接换归属，不为 Ring 添加跨窗口位移动画。
5. 覆盖旧 epoch 的迟到 cancel、工作区 context barrier、关闭 / 销毁当前 owner，以及关闭再开启 Ring。旧 paint 调用结束后不得复用它的快照或已销毁源 Item。
6. 原生参数测试与真实生产模块组合验证不等同于屏幕像素验收；仍需下面的主屏人工检查。

## 实施顺序

1. 增加有实际行为断言的原生组合回归，先运行现有基线，再检查本阶段遗漏的边界。
2. 如发现失败，定位最终 paint 数据或 owner 生命周期中的具体原因，在对应模块做最小修复；如现有实现已满足要求，以回归与验收收尾，不强行增加运行时逻辑。
3. 运行新增检查、Ring 全部 CTest、Clip 全部 CTest，以及受改动影响的 JS 门禁；涉及生成包时执行完整 `node tools/check.js`。
4. 若运行库有改动，使用现有 immutable 安装器，只重载受影响的插件，保留回滚版本并核实运行中诊断、KWin 稳定性。若只有测试 / 文档变化，直接验收当前部署版本。
5. 记录实际部署 hash、自动结果与用户反馈至 `test/FOCUS_RING_PHASE4_RESULTS.md`，更新设计与索引；所有验收完成后再标记 Phase 4 完成。

## 主屏实机验收

- 准备至少 3 个半宽窗口，从最左窗口快速输入 `Meta+L、L、H、L、H、H`，再持续交替 H/L。边框只在当前窗口，始终贴合移动，无闪烁、错位、丢失和旧位置残留；四侧描边到视口边缘时仍同步出现。
- 按 L 触发滚动后立即按 J，稍后 K 返回。当前窗口边框正常，旧工作区没有残留或错误裁剪。
- 滚动中切换焦点或关闭当前受管窗口：边框立即归属新的真实当前窗口，旧边框清理，内容点击正常。
- 分别运行 `cc-niri focus-ring off` / `on`，确认关闭无残留、开启恢复；静止后不持续重绘或刷日志，KWin 不崩溃。

本阶段以当前主屏为实机范围。Wide / Maximize 的尺寸动画与固定描边厚度留给 Phase 5；主屏 HiDPI 清晰度与像素对齐留给 Phase 6。双屏不是当前验收前置条件。
