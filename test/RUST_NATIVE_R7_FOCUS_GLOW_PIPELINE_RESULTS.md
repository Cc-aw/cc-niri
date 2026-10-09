# R7 后续：Focus Glow 渲染路径修正

## 问题与范围

用户连续反馈只能看到细蓝边框，前三次静态调参未通过视觉验收。前次截图中有边框外 RGB 差异，仅能说明存在颜色贡献，不能代表用户能识别柔光。

旧实现把 glow radius 当作有限色带的整个宽度，且与窗口内容共用 Native viewport clip；全宽 / 部分窗口及滚动中，外侧被原 6 logical px reservation 限定。此次保留 #7FC8FF、1.5 logical px / alpha=0.85 的细线，改为高斯距离衰减：sigma=6 logical px、三倍 sigma 的外侧支持范围，总外扩 19.5 logical px、峰值 alpha=0.45，末端归零，damage 保守外扩 20 logical px。强度提高是对反复“看不到”反馈的响应，尚不能当作用户视觉接受。

Clip Adapter 仅在同步 paint 调用期间，为 Ring owner 发布原始 compositor device region 与该帧 device viewport 的轻量栈上下文；Ring paint frame 当场复制 Qt 值，栈指针不保存到 Frame / Core / FFI。RAII 清理与嵌套恢复以 QPointer 保护 owner 生命周期。窗口与细线仍使用原 6px clip，柔光单独绘制到扩大的 viewport 与原始 compositor region 的交集，保留输出边界、damage 和更高窗口的遮挡。两层使用同一 frozen window transform / opacity / Rust 几何。

用 renderer subtree filter 分两次提交，不通过每帧隐藏 / 显示 Item 触发额外 repaint；当两个 region 相同仍合并为一次提交。过滤语义核对 [KWin 6.7.5 renderer](https://raw.githubusercontent.com/KDE/kwin/v6.7.5/src/scene/itemrenderer_opengl.cpp)。沿用 8 个小纹理、32 个圆角轮廓 band，直边为单像素宽条；没有窗口大小的 blur framebuffer，没有持续 timer。实际 resize / GPU 成本仍须实机量化。

新增 transient `SetGlowOnlyDiagnostic(bool)`：只在内存中选择绘制层，触发一次现有 damage，不修改配置、focus / layout authority 或 clock；可直接确认隐藏细线后是否存在光晕。`GetFocusRingStatus` 提供 gaussian 类型、独立 clip 类型、诊断状态及实际跨插件 viewport paint 计数。JS schema / 发布 authority、Rust Core / FFI、Spring / Workspace / Pair / Wide 参数不变。

## 已执行验证

- 新回归覆盖宽于旧 6px clip 的 halo 区域确实提交、细线保持原 clip、原 occlusion 不扩展、小 damage 不扩成整屏、嵌套上下文恢复、栈上下文结束后 frame 仍安全、owner 销毁、glow-only 无细线提交及不修改 Item 可见性。
- 五档 scale 的真实纹理检查保留 alpha 上限、单调衰减、有限尾端、client area 透明和缓存，并检查边框外 6 logical px 的 diffuse band。
- `node tools/check.js --native` 通过：Rust 1.99.0 fmt --check、clippy --locked --workspace --all-targets -D warnings、cargo test --locked --workspace（52 tests）、100 JS、Bridge 17 / Clip 16 / Ring 23 CTest、冻结 Golden differential、生产边界和 plasmoid 构建。
- Core Debug / Release 各 12 CTest、umbrella Debug 27 CTest 全通过。复用既有构建树，configure 显式 `/usr/bin/g++`，并发 2，日志 `build/focus-f1-gaussian/results.json`。无 CMake / FFI / Core 边界修改，未重复 compiler rejection / BUILD_TESTING=OFF 矩阵。

## 部署与实机状态

当前屏幕锁定，**尚未部署此实现，尚未执行只画柔光诊断或新路径实机验收**。已准备 save-state → stop → immutable Clip / Ring install → start 的双组件部署，以及仅恢复两条 discovery 绑定的窄回滚。不得用自动测试或旧截图替代新路径实机检查。

解锁后先核对新 Clip / Ring 跨插件上下文实际计数、一次简短 H/L / J/K / Wide / fullscreen / off-on 和停止重启的必要平台 hook 复验，再检查当前窗口的 glow-only / normal 截图与空闲缓存。恢复原窗口、焦点、工作区、视口、配置和输出。用户实际看到的窗口 / 输出也须与 Ring owner 对应；现有 Ring eligibility 仍由主输出的 JS 控制面发布，不擅自建立副屏焦点 authority。

源码回退仅回退本次提交；组件部署前保留旧 immutable Clip / Ring 路径、配置、工作区和用户文档快照。只画柔光诊断必须恢复为 false，不作为默认模式或持久配置。
