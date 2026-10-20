# R7 / Scroll Layout V2 P6 准备门禁

2026-10-16，基线 `8056cfe6b4a023ac8dcbfb01e4495a5acf4c2c4e` 加 P0–P6 工作区。**准备实现完成；2026-10-16经授权部署并开启 V2，启动核验PASS；交互/性能/资源实机验收 Pending。**

本阶段 Native 范围是 Bridge 的瞬时恢复证明 D-Bus；恢复 authority 仍在 JS，C++ 仅验证/传输 live session 与 requestId。Core、Rust/FFI DTO、动画参数和渲染 hooks 相对已验证 P5 没有新改动，参考基线没有改变。

`cargo fmt --manifest-path native/rust/Cargo.toml --all --check`、locked workspace all-targets clippy `-D warnings`、locked workspace test（109项）均由完整 Native 门禁执行通过。`node tools/check.js --native` 通过：118个 JS 文件 /229项，Bridge/Clip/Ring CTest18/18/25，Plasmoid构建、Golden differential、FFI、生产边界及私有 D-Bus。构建使用 Rust1.99.0、`/usr/bin/g++` GNU16.2.1，共享 CMake 工具链与现有树，parallel2。

Core Debug/Release、umbrella、OFF与编译器拒绝路径使用 [P5 已通过记录](RUST_NATIVE_R7_SCROLL_LAYOUT_V2_P5_RESULTS.md)，本阶段核对对应源码 SHA 未变；更新后的 Bridge 另复验 OFF production 边界。P6 当前源码/产物 SHA、命令和结果见 [validation](scroll-layout-v2-p6-evidence/20261016/preparation/validation.json)。

新增私有 Bridge 测试验证 pending→terminal、过期session/token拒绝、session切换/重启清空、磁盘快照完全不含恢复 ACK。私有完整入口验证真实客户端恢复后 CLI 才卸载脚本与两插件，KWin 保持运行；100%和150%+Fcitx5结果见 [P6 总报告](SCROLL_LAYOUT_V2_P6_LIVE_RESULTS.md)。

没有新增服务、线程、图像/纹理、FFI handle 或动画时钟。恢复等待仅事件连接与一个有界 deadline，完成/关闭/超时释放；Bridge 仅一个有界当前状态，命令继续使用既有有界队列。零生产资源新增与局部清理不等于项目总预算通过，PSS/Private_Dirty、Qt/Scene/纹理、GPU、4K60与长期增长仍 NOT MEASURED。

回滚按 [操作单](../doc/done/SCROLL_LAYOUT_V2_P6_RUNBOOK.md) 使用配套 immutable 旧组件、配置与持久快照；原准备阶段只做备份验证和 dry-run；现已完成用户授权部署和启动核验，见 [部署记录](scroll-layout-v2-p6-evidence/20261016/deployment/deployment.json)。实际加载的两个新 Native immutable 路径已确认，安装后的Bridge/Clip/Ring生产边界通过；用户桌面V2安全启停完整矩阵、回滚执行与视觉尚未验收。

P6实机后续纯JS修复：可见Plasma边缘面板避让与150%客户端尺寸共同网格已修复部署，见[专项结果](SCROLL_LAYOUT_V2_PANEL_FIX_RESULTS.md)。最终233项JS、37项私有KWin和真实几何核对通过；Native/Rust/FFI/Bridge/构建缓存与原验证的SHA未变，沿用原Native门禁，无Native参数或协议改动。

独立顶部间距后续：纯JS235项、私有KWin37项通过，Native/FFI未变。新包已安装但热重载恢复确认blocked，当前旧布局暂停，待用户正常重新登录；详见[顶部结果](SCROLL_LAYOUT_V2_TOP_GAP_RESULTS.md)，不记新配置实机PASS。

顶部调整最新状态：用户明确批准逐窗恢复确认后，已仅替换Script完成热恢复；顶部8生效，真实/painted几何核验PASS。Native插件、Bridge与KWin进程未重启，原自动ACK失败不改记通过，详见[最终顶部记录](SCROLL_LAYOUT_V2_TOP_GAP_RESULTS.md)。

混合宽度换位后续：纯 JS 目标策略修复 half 左移到首列时意外居中；237 项 JS 与私有 150%+Fcitx5 KWin 41/41 通过，Native 实现未变。经用户本次明确人工恢复确认后仅替换 Script，部署和启动核验 PASS，实机换位目测 Pending；自动恢复 ACK 仍 blocked，不改记通过。见[换位结果](SCROLL_LAYOUT_V2_REORDER_RESULTS.md)。

热重载后续修复：V2 恢复保留当前真实客户端尺寸并使用 V2 WorkingArea；超时后以 UUID/值类型账本重试原目标，仍要求真实 ACK 与已确认 Native 退休。241 项 JS、私有100% 41/41、150%+Fcitx5 44/44通过。正常部署后，实机四轮正常 restart 成功，其中补测两轮各有2个真实停放窗口；无人工恢复例外，原失败记录不改写。临时窗口已清理，最终 source有效完成、KWin未重启，资源预算仍NOT MEASURED。见[热重载结果](SCROLL_LAYOUT_V2_RELOAD_RESULTS.md)。
