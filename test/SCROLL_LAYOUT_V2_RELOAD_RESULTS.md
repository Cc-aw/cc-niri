# V2 热重载恢复与超时重试修复

2026-10-16。用户确认上一轮部署成功，要求解决反复热重载失败。范围为纯 JS 恢复路径；保留先前已验证的混合宽度换位修复。

## 原因与修复

`ParkingManager.release()` 原先使用 `scrollLastVisibleGeometry` 的历史尺寸恢复窗口，并套用 V1 SafeArea。V2 的真实客户端通常已经停放在输出内，额外重配尺寸没有必要；历史尺寸可能不再满足客户端当前尺寸约束或分数缩放网格。回归能复现：150% 下请求历史高度1357，客户端返回1357⅓，严格几何 ACK 永远不相等。Full 的2528宽也会被V1 SafeArea缩到2512。

V2 现在使用实际客户端 frame 为恢复基准，保留已接受尺寸，必要时平移或缩小到当前 V2 WorkingArea；该区域已包含面板预留及共同像素网格。即使实际位置已经合适，仍提交目标以覆盖尚未完成的旧 configure。V1 沿用原有恢复区域与历史尺寸策略。Fullscreen 和用户自己最小化的窗口仍保留原规则。

`Recovery` 原先在首次超时后丢失恢复请求，而 parking 标志已经清空，遂用永久 blocked 防止错误地以空列表确认恢复。现在保留 UUID、目标矩形、透明度和最小化目标的值类型账本，不保留 QObject。客户端超时后，重试从存活窗口重新解析原目标并再次等待真实 ACK；目标未达到仍 blocked，迟到 ACK 或窗口关闭后才可通过。Native 未确认退休的情况仍禁止恢复写入，不能用客户端重试绕过 Native 退休。

成功后清空账本，窗口关闭时删除对应记录；等待仍只有原来的有界 deadline 和事件连接，完成/失败均释放。失败时增加一次最多8条窗口几何/可见性摘要，不记录窗口标题，不在绘制或每帧路径采样；诊断异常不能阻断清理。非有限透明度也不能满足证明。

## 验证

- PASS：`node tools/build.js`、`node tools/check.js`，118文件 /241项；覆盖历史奇数高度、Full宽度、真实延迟帧、连续失败重试、关闭清理、非有限透明度和诊断失败清理。修复前用例复现尺寸不等和永久 blocked，修复后通过。见 [JS 门禁](scroll-layout-v2-reload-evidence/20261016/js-gate.log)。
- PASS：私有 Release KWin / Native / Bridge，100% 为41/41，150%+Fcitx5为44/44。每种缩放均有三轮真实 CLI stop、全新会话和精确恢复证明，并验证历史奇数高度不再导致额外 resize。见 [100%](scroll-layout-v2-reload-evidence/20261016/isolated-100.json)、[150%](scroll-layout-v2-reload-evidence/20261016/isolated-150.json)。
- 测试工具修正：初次100%检查读取未绑定的 source 遥测，Outgoing停放后其 valid 可失效；等待该遥测也不能证明新的有效来源。改用生产相同的 `GetColumnGeometrySourceFor`，绑定当前 membership 并等待同 epoch。最终两种缩放通过，没有放宽 Native 规则。见 [尝试记录](scroll-layout-v2-reload-evidence/20261016/harness-correction.json)。
- Native / Bridge / CMake 的140份源码及三个二进制 SHA 与上轮 Native 验证一致。此次没有重跑 Rust fmt/clippy/test、Native CTest 和 Debug/Release 构建；纯 JS 修改使用上述门禁与真实 Native 集成验证。见 [摘要](scroll-layout-v2-reload-evidence/20261016/validation.json)。

## 实机部署与重复重载

PASS：先保存布局、备份脚本/配置/快照；旧运行时本次正常 stop 成功，随后升级已验证 Script 并启动。没有人工恢复例外，没有绕过或伪造 ACK。备份在 `/tmp/cc-niri-reload-fix-20261016-151327`，见 [部署记录](scroll-layout-v2-reload-evidence/20261016/deployment.json)。

部署后先执行两次正常 `cc-niri restart`，均返回0、得到新 session 和 valid/completed Native source。这两轮没有脚本停放窗口，故另补有停放窗口的实际验收：创建两个短时自有 Wayland 测试窗口，等待真实动画完成；每轮确认4列中有2个实际 opacity=0 / minimized=true 的停放窗口，然后执行正常 restart。两轮均返回0，日志均为 `EMERGENCY_RESTORE count=2`，新会话 Native source有效且完成；没有 RESTORE_ACK_FAILED、RESTORE_BLOCKED、停用或 JS 异常。见 [停放窗口补测](scroll-layout-v2-reload-evidence/20261016/parked-smoke.json)、[最终状态](scroll-layout-v2-reload-evidence/20261016/final-state.json)。

临时窗口全部关闭，原焦点已恢复，最终原有两列的 Native source valid/completed；KWin PID2075全程不变。实际 restart 按既有 CLI 正常卸载/加载 Script、Native 和 Bridge；应用未被关闭。本次未使用先前任何一次人工确认作为恢复证明。

限制：这覆盖当前桌面及两种缩放的恢复/重试路径，不能保证拒绝 configure、挂起或异常最小尺寸的任意客户端均可恢复；真实目标不满足时继续 blocked，并给出有界诊断。4K60、PSS/Private_Dirty、GPU和长期增长仍 NOT MEASURED。本次只新增 O(N) 的 UUID/值类型恢复账本，没有新常驻服务、线程、动画时钟或图形缓冲；不据此宣称全项目内存达标。

回滚：保留上述备份；先通过正常 stop 的真实恢复确认，再用备份 Script 包恢复并 start。回退旧恢复实现会重新引入本记录中的尺寸与永久 blocked 问题，不能默认跳过门禁。
