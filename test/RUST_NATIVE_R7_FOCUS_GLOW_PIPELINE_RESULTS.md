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

## 2026-10-10：加粗细线并降低柔光

此前 `80f1bb3` 临时放大光晕供辨识，`3f7c824` 根据反馈将峰值减半；本轮开始时查询实际加载的 Ring，确认 width=1.5、Gaussian sigma=12、glowAlpha=0.5。用户随后反馈“柔光还是有点太强了，而且边框太细了”，要求增加边框、降低柔光。

本轮将 width 改为 **2 logical px**（增加约 33%）、glowAlpha 改为 **0.35**（峰值降低 30%），保留 #7FC8FF、borderAlpha=0.85、sigma=12 和窗口圆角。柔光从加粗细线外缘开始衰减，因此总支持范围为 2+3×12=38 logical px；重绘外扩取 39，为 fractional scale 的外缘取整保留余量。沿用小纹理、高斯有限尾端、缓存和独立柔光裁剪，无新增动画 / timer。

工作区已有未提交的 owner-output 绘制限制及混合 DPI 缓存回归，本轮保留这些改动并一同验证；未修改 JS schema、Rust Core、FFI、CMake、Spring / Workspace / Pair / Wide 参数。

加粗后的首轮完整门禁在 `focus-ring-visual-transform` 发现 125% 下完全屏外 Outgoing 边框露出一列像素：8 logical px 列间距对应 10 device px，原 6px reservation 向外取整为 8 device px，加粗描边占 3 device px，两者相加越过间距。将共享 viewport reservation 收紧至 **5 logical px**，保留更宽的 decoration-only halo clip。原“完全屏外边框不可见”断言保持不变，未通过放宽断言绕过问题；窗口内容的允许绘制范围没有扩大。

最终 `node tools/check.js --native` 全部通过：Rust **1.99.0** `cargo fmt --manifest-path native/rust/Cargo.toml --all --check`、`cargo clippy --manifest-path native/rust/Cargo.toml --locked --workspace --all-targets -- -D warnings`、`cargo test --manifest-path native/rust/Cargo.toml --locked --workspace`（52 tests）；100 JS；Bridge 17 / Clip 16 / Ring 23 CTest；隔离 D-Bus、冻结 Golden differential、生产符号边界及 plasmoid 构建。配置复用既有 Ring 构建树并显式传入 `/usr/bin/g++`（GNU 16.2.1），并发 2。裁剪修正后先定向验证 viewport / visual-transform 两项通过，再完成全部门禁；五档缩放纹理、HiDPI、裁剪、动画接管、缓存与生命周期均通过。首轮沙箱禁止隔离 D-Bus 创建 socket 的记录为 `build/focus-f1-balance/native-gate.log`；获准在沙箱外运行后的裁剪失败记录为 `native-gate-final.log`；最终通过记录为 `native-gate-corrected.log`。未改 Core / FFI / CMake / Qt 数值转换，本轮未重复独立 Core Debug / Release、umbrella、编译器拒绝或 BUILD_TESTING=OFF 矩阵。

2026-10-10 10:43（Asia/Shanghai）通过既有 save-state → stop → immutable Ring install → start 部署，仅安装 Ring。备份 `/home/cc/.local/state/cc-niri/backups/focus-f1-balance-20261010-104303`（0700），新 Ring canonical/hash 为 `1c2d3231a1b0a4bbe29d0fa12c10ba9ebcab1c0b96c58de878529411ca609c02`。安装后查询确认 width=2、glowAlpha=0.35、sigma=12、glowExtent=38、paintOutset=39、viewportOutset=5、owner-output-region、Rust backend，诊断模式与 focusAnimation 均为 false。KWin PID 2050，Clip / CLI / Bridge / JS 安装字节、输出、配置与 effect 加载状态保持一致。原窗口 geometry / desktop membership / minimized / fullscreen、实际和 Bridge 焦点、columns / viewport anchor、原桌面 ID / 每输出桌面均核验恢复，见备份 `deployment-success.json`、前后快照及 `live/deploy-restored.json`。OS 仍禁止读取 KWin maps，已核对安装 hash 和实际新参数，未独立确认进程映射文件 hash。

仅进行安装停启及恢复检查，没有创建测试窗口、切换显示缩放或重跑 H/L / J/K / Wide / fullscreen / off-on 实机场景矩阵，没有抓截图。一秒观察时 owner 保持相同且 active，glowRasterizations=8 不增加，Scroll continuous full / output / fallback full repaint 请求增量均为 0。期间 Ring drawCount 从 114 增至 144，因此仅确认纹理缓存稳定及 Scroll 请求无增量，不将其描述为 compositor 完全停止绘制；GPU 时间、resize 成本与长期稳定性未量化。日志保留启动期 JS declaration-order 警告与 Ring 尚未加载时三条 No such object path，之后 READY / ARM 正常，无 panic、invariant、fail-safe、completion timeout 或 JS ReferenceError / TypeError；日志为 `build/focus-f1-balance/kwin-deployment.log`。新版的强度与边框粗细仍待用户视觉反馈，不进入 F2。

本轮窄回滚入口为备份的 `rollback-component.sh`：stop 成功恢复 parked windows → 仅将 Ring discovery 恢复至旧 immutable hash `181bb4a3ea22de4a0218e95369d61de8756fac41928bd70c947c6c981bd439bc` → start，不整体覆盖配置 / 工作区。源码调整尚未提交，回退本轮 Width / GlowAlpha / PaintOutset / ViewportOutset 与配套测试修改即可恢复原样式；保留工作区原有 owner-output 修复，避免整体回退用户已有改动。

## 2026-10-10：再次降低柔光至 0.25

用户在上一版部署后要求继续降低柔光。本轮仅将 glowAlpha **0.35 → 0.25**（峰值再降低约 29%），调整真实纹理测试的 alpha 上限与可见衰减采样阈值；边框继续为 2 logical px / alpha=0.85，Gaussian sigma=12、总支持范围 38、damage 39、viewport reservation 5、圆角与 owner-output 绘制限制保持原值。未修改 Core / FFI / CMake / JS 或动画。

`node tools/check.js --native` 全部通过：Rust 1.99.0 fmt --check、clippy --locked --workspace --all-targets -D warnings、cargo test --locked --workspace（52 tests），100 JS、Bridge 17 / Clip 16 / Ring 23 CTest、隔离 D-Bus、冻结差分、生产边界及 plasmoid 构建。复用既有 Ring 构建树，configure 显式 `/usr/bin/g++`，并发 2；日志为 `build/focus-f1-softer/configure.log` / `native-gate.log`。本轮无相关 Core / FFI / 工具链改动，未重复独立 Debug / Release、umbrella 或编译器拒绝矩阵。

10:47（Asia/Shanghai）通过 save-state → stop → immutable Ring install → start 部署。备份 `/home/cc/.local/state/cc-niri/backups/focus-f1-softer-20261010-104750`（0700）；新 canonical/hash `6a2cf6cee3f5a5f9c29d35ed8e9e28317648ddd097a91acc2436b96b52c19eef`，查询已确认 glowAlpha=0.25、width=2、Rust backend。原窗口 geometry / membership / minimized / fullscreen、实际与 Bridge 焦点、columns / viewport anchor、桌面 / 输出、配置及其余组件核验恢复，KWin PID 保持 2050。安装 hash 与运行接口已核对；受 OS maps 读取限制，仍未独立确认进程映射文件 hash。部署记录为 `build/focus-f1-softer/deployment.log` 与备份 `deployment-success.json`。

一秒观察中相同 owner 持续 active，glowRasterizations=8 保持不变，Scroll continuous full / output / fallback full repaint 增量均为零；Ring drawCount 从 121 增至 151，未将其视作 compositor 完全无绘制。GPU / resize 性能未量化，没有抓截图、切实机缩放或重跑 H/L / J/K / Wide / fullscreen / off-on 场景矩阵；本轮停启和恢复检查通过，主观强度仍待用户反馈。

回滚使用本备份 `rollback-component.sh`，仅恢复上一版 Ring `1c2d3231a1b0a4bbe29d0fa12c10ba9ebcab1c0b96c58de878529411ca609c02` discovery，沿用 stop → 切换旧 immutable 链接 → start；不整体覆盖配置或工作区。源码回滚本轮 GlowAlpha 与对应纹理测试阈值，保留此前边框、裁剪和用户已有改动。

## 2026-10-10：收窄光晕，避免触及相邻窗口

用户反馈左侧窗口的柔光已经到达右侧窗口。前两次只降低 alpha，保留 sigma=12 / 边框外 36 logical px 的支持范围，因此仍远超当前 8 logical px 列间距。本轮将 Gaussian sigma **12 → 1.5**，边框外三倍 sigma 的衰减范围 **36 → 4.5 logical px**，总外扩 **38 → 6.5 logical px**，保守 damage 外扩 **39 → 7**。边框维持 2 logical px / alpha=0.85，柔光峰值维持 0.25，颜色、圆角、viewport reservation=5、独立柔光 clip、owner-output 限制均保留。材质在有限外缘平滑降至零，沿用实际设备取整；不引入邻窗 / 布局 authority，也不修改 Core、FFI、CMake、JS、窗口间距或生产动画。

新增相邻窗口回归复用 HiDPI 集成测试：使用 KWin SDK 实际生成的设备 quads、child rounding、冻结变换及 glow patches，验证 100% / 125% / 150% / 175% / 200%、不同输出原点 / 子像素位置 / 宽度 / 非均匀缩放下，整个光晕绘制几何都严格位于左右 8 logical px 邻窗边界以内。测试不是仅检查 alpha；即使透明度降低，过宽的纹理也不能通过。保留峰值上限、边框外 1px 有效 alpha、3px 弱尾端、单调衰减 / 末端透明、client area 透明和静态缓存断言，移除旧宽光晕必须在边框外 6px 仍有高 alpha 的断言。更新 damage bounds、独立 viewport clip 的尾端采样；混合 DPI 测试将 owner 放到更靠近输出边界的位置，继续覆盖小光晕跨输出时的纹理缓存保护。

完整 `node tools/check.js --native` 通过：Rust **1.99.0** fmt --check、clippy --locked --workspace --all-targets -D warnings、cargo test --locked --workspace（52 tests），100 JS、Bridge 17 / Clip 16 / Ring 23 CTest、隔离 D-Bus、冻结 Golden differential、生产符号边界和 plasmoid 构建。复用既有 Ring 构建树，configure 显式 `/usr/bin/g++`（GNU 16.2.1），并发 2；日志 `build/focus-f1-compact/configure.log` / `native-gate.log`。没有相关 Core / FFI / Qt 数值转换 / CMake 改动，未重复独立 Core Debug / Release、umbrella、编译器拒绝或 BUILD_TESTING=OFF 矩阵。

10:58（Asia/Shanghai）完成 save-state → stop → immutable Ring install → start。备份 `/home/cc/.local/state/cc-niri/backups/focus-f1-compact-20261010-105850`（0700），新 canonical/hash `afa7c40537b61c57b6b36c6f6082eece602a7984346b9abc4782cd1a4fafc7df`。查询确认 glowRadius=1.5、glowExtent=6.5、paintOutset=7、width=2、glowAlpha=0.25、Rust backend；KWin PID 2050。原窗口 geometry / membership / minimized / fullscreen、实际及 Bridge 焦点、columns / viewport anchor、桌面 / 输出、配置与其余组件在部署后核验恢复。OS 仍禁止读取 KWin maps，确认了安装 hash 和实际新参数，未独立核验进程映射文件 hash。记录在 `build/focus-f1-compact/deployment.log` 与备份 `deployment-success.json`。

一秒观察时同一 owner 持续 active，glowRasterizations=8 不增加；Scroll continuous full / output / fallback full repaint 增量均为零，Ring drawCount 从 113 增至 143。较小支持范围减少纹理和 damage 覆盖面积，但未量化 GPU / resize 性能；CTest 耗时不作为性能基准。

部署后在当时右侧 owner 与左侧 8px 邻窗场景抓取 Ring on / off 两张 Spectacle 合成截图，位于备份 `adjacent-static-check/`，截图为 10240×2880 的统一 2× 导出栅格。期间焦点发生变化，最终 owner 与初始不一致，按脚本保留用户选择，跳过像素差比较，不将截图当作匹配场景的防串光实机验收。正常两层 Ring、配置、组件、输出已核验恢复，见 `adjacent-static-check/result.json`。没有创建测试客户端、强制切焦点、切换实机缩放或重跑动画场景矩阵；当前 8px 间距的自动防串光检查通过，主观效果仍待用户反馈，更小间距和其他实机设置未验收。

本轮回滚入口为备份 `rollback-component.sh`，沿用 stop → 仅恢复旧 Ring `6a2cf6cee3f5a5f9c29d35ed8e9e28317648ddd097a91acc2436b96b52c19eef` immutable discovery → start，不整体覆盖配置 / 工作区。源码回退本轮 GlowRadius / PaintOutset 与对应测试改动即可恢复上一版，保留此前边框、alpha、裁剪及用户已有改动。

### F1 用户验收通过

收窄版本部署后，用户明确反馈“可以了”，接受当前边框 / 柔光及相邻窗口效果。**F1 静态分层视觉验收通过**；当前接受参数为 width=2、borderAlpha=0.85、glowAlpha=0.25、Gaussian sigma=1.5、总支持范围=6.5 logical px。该反馈不补做此前未执行的 GPU 性能、其他实机缩放 / 间距或动画矩阵，也不将已跳过的截图像素差比较改写为通过。

按美化方案，后续仍有 F2 约 140ms 焦点淡入淡出、F3 轻微获得焦点收敛、F4 将新焦点过渡接入既有 H/L 呈现时间线，F5 四边权重为可选项。已有同帧 render geometry / transform / opacity / clip 跟随可继续复用；新增过渡消费既有呈现时间，不建立独立 Ring 时钟或第二套焦点 authority。F3 的动态半径需按本轮已接受的紧凑光晕重新设计，保留当前 8px 间距下的防串光约束，不机械恢复原文较大的光晕默认参数。本轮仅记录验收与剩余范围，未实施 F2–F5。
