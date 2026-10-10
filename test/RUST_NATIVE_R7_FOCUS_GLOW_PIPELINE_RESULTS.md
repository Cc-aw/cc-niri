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

2026-10-10 解锁后已部署源码 `5d89f1e`。备份为 `/home/cc/.local/state/cc-niri/backups/focus-f1-gaussian-20261010-093357`（0700），含部署前配置 / 工作区 / 窗口与实际焦点 / 组件路径 / 用户设计文档 / 执行脚本和窄回滚。save-state → stop 成功恢复 parked windows → immutable Clip / Ring install → start；KWin PID 保持 2050。

- 新 Clip canonical/hash：`8cefef2a59fd9c18f76c8d680b131067bb74f7b3cadf3218e567b0a7757d2e66`；新 Ring：`819c7cbd647d629996c96de6bf191c8afbd1102c78be4156583ccd67632b2f19`。查询核对高斯参数、独立 clip、Rust backend；Bridge / CLI / JS / 配置 / 输出保持原值。OS 禁止读取 KWin maps，因此仅确认 immutable 安装 hash、显式 reload 和新接口，未独立核验进程映射文件 hash。
- 仅一次 H/L 80ms 反向接管、J/K 80ms 返回、Wide 往返、fullscreen 恢复、Ring off-on；停止 / 重启已由部署路径覆盖。H/L 的 `separateGlowClipDrawCount=52`，证明两个新插件实际传递了 paint context。所有原窗口 geometry / membership / minimized / fullscreen、实际及 Bridge 焦点、columns / viewport anchor、桌面 ID / 输出桌面和配置恢复，无相关 KWin 错误。
- 原短检查脚本错误地在 Ring reload 后要求新实例的 context 计数大于零；静态完整窗口不需要 Clip，reload 也会清零该计数。这是检查断言错误。保留原失败记录，复用 reload 前 H/L 的 52 次实际计数，仅补完一次 1 秒空闲检查，未重跑键盘场景。最终结果为 `short-platform-check/result-with-idle.json`。
- 空闲检查纹理 rasterizations 不增加，Scroll paintedFrames / full repaint / output repaint 均为零。未量化实际 GPU / resize 开销，未执行五档 scale 的实机矩阵；该矩阵仅有前述自动纹理测试。

## 只画柔光诊断与视觉状态

对 DP-1（3840×2160@60、150%）当前窗口 `0d479654-b982-4a21-9693-e3c9f3f8813f`，frame 为 x=1284 / y=50 / 1252×1382，完成同场景 normal / Ring off / glow-only 三张截图，并临时隐藏细线约一分钟供用户观察。截图位于备份 `glow-only-diagnostic/`。只画柔光图能单独看到外侧的蓝色渐变，normal 图同时保留清晰细线；右侧自然衰减可见，圆角连接连续。

Spectacle 统一 2× 导出栅格，不能将它当成输出实际物理像素厚度。右边距窗口外缘 2.25 / 6.25 / 10.25 / 14.25 / 16.25 logical px 的 normal 相对 off 蓝通道中位差约 56 / 37.5 / 16 / 4 / 2，glow-only 相同位置近似一致，20.25px 归零。顶部远端另有背景差异，不作为整个支持范围的计量。像素差仅用来验证独立绘制和衰减；**用户尚未确认新版本的柔光强度，F1 视觉验收仍待反馈，不进入 F2**。

诊断结束已核对 `glowOnlyDiagnostic=false`，恢复默认两层显示，配置 / 组件 / 输出保持一致。未创建测试客户端；诊断期间若用户另选窗口，不覆盖用户的新焦点。实际看到的窗口 / 输出须与 Ring owner 对应；现有 eligibility 仍由主输出的 JS 控制面发布，没有建立副屏焦点 authority。

## 回滚

运行本备份 `rollback-component.sh`：stop → 仅恢复旧 Clip `a873c8719ccee73cb3258b91ff93b4d05c7c04b5b9788b7276d1381008c86cba` 与旧 Ring `c6bbaf8e63e65ac065d82c5604f8d26ed6ad77c70b33cb05260060aa1fc0f86e` 的 immutable discovery → start。不整体覆盖配置或工作区，不删除用户新窗口。源码仅回退 `5d89f1e`。只画柔光诊断为临时内存状态，未写入持久配置。
