# Focus Ring Phase 6 HiDPI 实施计划

日期：2026-10-05。状态：实现、自动验证与独立部署完成，用户确认功能正常，内屏实机验收通过，Phase 6 内屏范围完成，见 [阶段记录](../../test/FOCUS_RING_PHASE6_RESULTS.md)。Phase 5 已由用户确认完成；本阶段仅核对内屏 HiDPI、分数缩放与最终设备像素对齐。

依据：[Focus Ring 实现设计](cc-niri_Focus_Ring_实现设计.md#phase-6--hidpi--multi-output)。用户明确当前只有一个屏幕，本阶段只针对内屏开发、自动验证与实机验收。双屏、跨输出迁移和 mixed DPI 均不纳入本阶段，也不是完成条件；以后有需要时单独开发。

## 当前基线

- 当前描边为 3 logical px、#7FC8FF。静态使用 OutlinedBorderItem，正向轴缩放动画使用 FocusRingStrokeItem；旋转、剪切及反射保留原生回退。
- Phase 5 已覆盖 1 / 1.25 / 1.5 / 2 outputScale，验证固定厚度、同帧窗口矩阵、圆角图块和缓存，但未验证所有子项逐层取整后的最终设备坐标。不能据此宣称无模糊或半像素抖动。
- 本次准备检查：现有构建树的 Ring 10 项 CTest、Viewport Clip 4 项 CTest 全部通过。这是当前测试基线，不代替修改后的重新构建。
- 已通过实时 Wayland 查询确认仅内屏 eDP-1 连接并开启，1920×1080 @ 144Hz、scale=1。实机验收使用当前 100% 配置；其他 scale 仅为单输出自动参数覆盖。

## 设备像素规则

逻辑宽度保持 3px，直边设备厚度采用 round(3 × outputScale)：100% 为 3px，125% 为 4px，150% 为 5px，200% 为 6px。分数缩放会产生量化误差，验收以该明确规则为准，不要求不同 scale 下量化后的逻辑宽度完全相等。

核对本机 KWin 6.7.5 的实际绘制顺序：[Item renderer](https://raw.githubusercontent.com/KDE/kwin/v6.7.5/src/scene/itemrenderer_opengl.cpp)。renderer 分别取整每层 Item 的设备位置，并对 quad、静态 outline 厚度与轮廓做设备像素取整。当前测试只检查部分矩阵与局部 quad；实施时应沿完整子项路径验证，不能把对子项局部顶点取整当作最终屏幕像素结论。

动画窗口可以处于分数设备位置。Ring 必须忠实贴合本次窗口 paint，不能为了把 Ring 单独吸附到整数网格而产生窗口与 Ring 的错位。动画中的纹理采样结果与静态清晰度分别验收；圆角允许正常抗锯齿。

## 实现与验证范围

| 模块 | 工作 |
| --- | --- |
| 新增 tests/FocusRingHiDpiTest.cpp | 按 renderer 顺序组合 root、Stroke Item、patch 的取整位置、transform 与实际 quad，验证最终直边坐标、厚度和片段连接。 |
| tests/CaptureRenderer.h | 必要时补充逐层原生矩阵辅助函数；明确属于 CPU 捕获，不伪称真实 GPU 像素。 |
| FocusRingStrokeItem / FocusRingItem | 仅在回归证明存在问题后修改几何、子项原点、缓存或局部 damage；保留窗口同帧 root 矩阵和既有回退。 |
| CMakeLists.txt | 注册 HiDPI 原生回归。 |
| FocusRingEffect | 需要时增加只读 outputScale / 对齐诊断；不增加每帧日志或输出布局策略。 |
| ViewportPaintClip | 验证四侧描边余量、输出边界、遮挡与原始 damage 交集；发现缺陷后再做对应修复。 |

源码位置均相对 native/focus-ring，ViewportPaintClip 位于 native/common。JS eligibility、Presentation、Spring 和布局保持现有职责；没有第二套时钟、每帧 DBus 或几何发布。

## 自动用例

1. 以当前内屏实际 scale 为首要用例，并保留 1 / 1.25 / 1.5 / 2 scale 的单输出参数覆盖；验证整数和分数窗口位置、奇偶尺寸与 renderOffset，以 RenderViewport 实际映射处理内屏坐标。不增加双屏拓扑或跨输出迁移用例。
2. 检查静态四边厚度与窗口内沿关系，尤其是 150% 下 3 logical px 量化成 5 device px 的左右 / 上下差异。
3. 对滚动的分数 translation、Wide 非等比缩放、双轴缩放和 retarget，组合各级实际取整与矩阵，验证直边厚度、四个角与直边的连接、贴合误差，保留真实窗口同帧变换。
4. 用连续帧与靠近单位 scale 的样本检查 Stroke Item → 静态 OutlinedBorderItem 的切换；比较两条实际路径的内外沿位置，定位端点跳变，不放宽误差掩盖问题。
5. 模拟同一内屏的 viewport.scale 变化，验证厚度、圆角缓存和 damage 随 scale 更新；相同帧重复绘制复用缓存。覆盖关闭 / 开关后旧 attachment 拒绝重用。
6. 使用原始 deviceRegion 与生产 viewport clip 交集检查四侧余量；输出外和遮挡区域不因装饰 padding 被重新显示。

若用例失败，先保留失败证据，再做最小修复。真实 GL 采样、圆角接缝和最终模糊程度仍需实机验证。

## 实施顺序

1. 读取当前内屏模式、scale 与运行中 Ring 诊断，记录测试环境；不自动改变桌面缩放。
2. 新增有最终坐标断言的 HiDPI 回归，运行 Phase 5 基线定位遗漏。
3. 按失败原因修复对应原生模块；已有行为通过时不额外增加运行时逻辑。
4. 重新构建并运行 Ring 全部 CTest、Clip 全部 CTest、node tools/check.js 和 git diff --check。检查原 Phase 3–5 组合回归。
5. 运行库有变化时沿用 immutable 安装与回滚，仅部署 Ring，并核对 hash、实际加载诊断、独立 off/on 与 KWin 日志；仅测试 / 文档变化时验收当前已部署版本。
6. 将结果写入 test/FOCUS_RING_PHASE6_RESULTS.md，区分自动验证、部署与人工验收。内屏验收完成后记录 Phase 6 内屏范围完成，双屏开发不作为前置条件。

## 内屏人工验收

- 静态 Normal / Wide / Max：四边粗细一致、直边清晰、圆角连续，描边位于内容之外。
- 慢速 H/L、快速 retarget、Wide 尺寸动画及中途反向：贴合同帧窗口，动画端点无明显跳变，四个角与直边无裂缝、闪动或残留。
- 视口四侧和输出边缘：外沿在合法范围内保留，被遮挡和输出外区域不显示。
- F11 进入 / 退出全屏、J/K、关闭窗口、独立 off/on：归属和清理正确，静止无持续全屏重绘或日志错误。
- 实机验收使用当前内屏实际 scale，不要求连接外屏或切换桌面缩放。其他 scale 的单输出参数仅记自动覆盖，不能填写实机通过。

## 完成条件

新增 HiDPI 回归和既有门禁通过；所有发现的像素几何缺陷有对应回归；当前内屏实机确认清晰度、动画贴合与端点切换；没有改变布局、输入、ownership 或动画时钟。记录清楚内屏实际模式与 scale；双屏、跨输出迁移和 mixed DPI 不属于本阶段完成条件。
