# R7 跨屏鼠标拖动提前接管修复

日期：2026-10-19。范围：副屏已有普通窗口拖入主屏时的 JS 生命周期协调。Rust Core、C++ Adapter、FFI、Spring / retarget / 动画参数均未修改，Native 校验与取消证明保持有效。

## 故障与实现

现场记录为单列 bootstrap 成功后，两列 bootstrap 连续两次 Native arm 拒绝，随后全局恢复并停用。用户确认入口为鼠标从副屏直接拖到主屏。私有 KWin 已在真实 Wayland system move 中，给前两次接管调用各增加有界 12ms 延迟，重复捕获相同停用链；调用前迁入窗口实际 x=1800 / 1600，计划要求 x=1288，Native move=true 而脚本 moving=false。历史现场缺少 frame 与拒绝分支记录，不能声称每项底层事实完全相同。

修复在交互开始的同步信号中设置移动标记，覆盖副屏 normal 窗口，并在异步取消前生效。未被布局拥有的副屏拖动不再退休无关主屏布局；实际 window.move / resize 和脚本标记共同阻止输出变化与 adoption 提前接管。松手后通过原有 exclusive / cancel 证明流程，按实际输出重新协调 adoption。取消确认晚于松手或下一次拖动时，不得重新挂起旧交互或让旧 finished 接管新交互。已有主屏 Column 鼠标拖动仍由 FloatingController detach；松手后不自动 reattach Floating 窗口。

修改文件为 RuntimeEntry.js、AdoptionController.js、OutputController.js 及通过 node tools/build.js 生成的包。没有新增常驻服务、线程、动画时钟、图形缓冲、缓存或 idle 轮询；仅复用窗口已有的有界状态与 Native 取消入口。资源预算未实测，不能据此记为达标。

## 验证

| 项目 | 结果 | 证据 / 范围 |
| --- | --- | --- |
| 新增生成入口回归 | PASS，7 项 | cross-output-drag.test.js：迁入期间几何 / 接管禁写、快速往返、Native 事实先于 started、Floating 保留、迟到取消、关窗 / 暂停、新交互覆盖旧 finished |
| OutputController / workspace adoption / Floating 既有定向回归 | PASS | 原有语义及 Native move / resize fallback |
| 100% / 150% 私有受控拖动 | PASS，各 17/17 | private-controlled-100-final / private-controlled-150-final：包含此前 12ms 竞争窗口、无拖动窗口被计划接管、无恢复、最终稳定并安全 stop |
| 100% 私有 P6 完整回归 | PASS，49/49 | private-p6-final：宽度、工作区、Ring、三轮合成锁定 / 解锁、真实恢复证明与重复 stop |
| node tools/check.js | PASS，261 项 / 119 文件 | js-gate-verified.log；沙箱内首轮既有 P0 Native fixture 失败，允许隔离本地 IPC 后通过 |
| Native 构建与门禁 | 本轮未重跑 | 三个 Native 二进制 SHA256 与已验证锁屏部署完全一致；本轮生产改动仅三个 JS 文件和生成包，复用上一轮 Native 验证，不能记为本轮新执行 |
| 真实用户桌面部署 | PASS，2026-10-20 | 用户明确授权后经 prepared manifest 和恢复证明完成；health=running、Native source valid、安装哈希及两屏 / 五工作区布局核验通过 |
| 真实跨屏拖动 / 4K60 / mixed DPI 视觉验收 | Pending | 私有 Virtual/Mesa 不能替代真实桌面交互与 GPU 验收 |
| A/B PSS / Private_Dirty / 长期资源与 GPU 成本 | NOT MEASURED | 没有宣称满足全项目预算 |

证据目录：[cross-output-fix](lock-resume-evidence/20261019/cross-output-fix/)。之前的故障复现位于同级 recurrence/。私有故障探针中的 12ms 延迟只用于放大竞争，生产修复不依赖固定延时。

## 部署与回滚

通过原有 prepared manifest 固定 JS、已验证 Native 二进制及构建缓存，备份旧安装组件、配置与每个工作区快照。安装复用既有 save-state → 有证明的 stop → immutable 安装 → start 流程；不强制卸载或强杀 KWin。部署前后验证布局 health、Native source、安装哈希、各输出当前工作区和保存列宽 / 顺序。

2026-10-20 用户明确回复“现在部署并安全重载”后完成部署。授权前自动审批曾拒绝真实桌面安装；未绕过该拒绝，等待本次新候选的明确授权后才执行。部署前重新核对源码 / 二进制与已验证候选一致，刷新当天配置 / 快照备份，并通过候选校验和 rollback dry-run。

本次实际部署 manifest 为 `/tmp/cc-niri-output-drag-20261020-deploy/manifest.json`；回滚入口为同目录 `rollback.sh`，默认 dry-run，实际恢复需 `--execute` 并先证明当前窗口恢复。未执行完整回滚，不能记为回滚验收 PASS；`/tmp` 被清理后不可继续依赖该入口。

核验证据为 `cross-output-fix/deployment-verification-20261020.json`、`deployment-20261020.log` 与 `status-after-20261020.txt`。部署前后 DP-1 与 HDMI-A-1 各自原生当前工作区 ID 不变；五个工作区按 ID 比较 columns、focusedUuid、presentation、viewportAnchorV2 全部一致。Script / Clip / Ring / transition 均加载，脚本与本次候选哈希一致，JS 新会话 health=running，Native source valid。只读观察脚本使用后立即卸载。

未自动操作真实桌面的鼠标拖动，真实跨屏交互、4K60 与资源验收仍 Pending / NOT MEASURED。部署后仅补记文档与证据，未再次生成或修改已安装产物；本轮保留之前已存在的锁屏与工作区 H 改动。
