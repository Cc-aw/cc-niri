# 2026-10-16 16:11 KWin 崩溃分析

当前状态（2026-10-17）：修复已实现，完整Native门禁与私有KWin回归通过；未部署，实机验收PENDING。旧产物在真实保留内部窗口用例中复现SIGSEGV，修复后100% /150%均通过。实现范围、证据与回滚见[修复记录](RUST_NATIVE_R7_INPUT_LIFECYCLE_RESULTS.md)。

以下保留2026-10-16的分析与原计划：当时仅分析，没有修改生产代码、卸载插件、重载桌面或重启应用；用户确认是桌面突然自行重启。原计划中的“尚未修复”描述仅代表当时状态。

## 已确认事实

- 16:11:44，用户桌面原 KWin PID2075 收到 SIGSEGV；systemd-coredump记录崩溃。随后 KWin 子进程变为PID896650，Plasma与若干Wayland应用重建；机器未重启，仍为同一次boot。服务MainPID2061是仍存活的wrapper，NRestarts=0不能据此认定KWin子进程没有崩溃。
- 主线程调用链为鼠标位置变化 → `ViewportInputClip::apply()` → `KWin::InternalWindow::hitTest()` → `QWindow::mask()` → SIGSEGV。cc-niri原生输入裁切直接位于崩溃调用链中，不能归因为普通JS布局卡顿。
- 已安装immutable Clip的崩溃地址偏移0x363cc，经addr2line映射到 `native/viewport-clip/ViewportClipEffect.cpp:129` 附近；前一行128正是 `client->hitTest(point)`。
- 代码遍历整个 `effects->stackingOrder()`，在判定窗口是否属于Scroll Runtime / handoff之前，无条件调用平台hitTest。当前过滤不排除已删除窗口或KWin InternalWindow。本机KWin的InternalWindow::hitTest反汇编显示：从内部QWindow句柄读取mask，调用前没有空句柄保护。

## 原因判断与边界

高度怀疑原生输入裁切的窗口生命周期过滤缺陷：把不归cc-niri管理、正在关闭或已失效的内部窗口送进hitTest，导致Qt读取无效QWindow状态。确切的InternalWindow身份、句柄是否为null或已释放，尚未从完整core核实；core文件当前不可读，非交互sudo也需要密码。不能把这一步推断写成已证实的具体空指针值。

同秒Ark退出，布局移除一列并重新arm；约0.28秒后发生鼠标事件崩溃。这支持关闭窗口/内部提示层附近的触发场景，但不能单独证明具体内部窗口属于Ark。

排查窗口内没有OOM记录。NVIDIA `invalid mmap context` 第一批在16:11:48出现，晚于16:11:44崩溃，因此不作为驱动先故障的证据。未观察到崩溃前Xid或GPU reset；不因此完全排除驱动或其他内存损坏的间接影响。

这轮仓库清理未部署：已安装main.js SHA为035f146f…，与Git HEAD `9cf6503`相同；仓库清理生成包SHA为66a0dbb9…，二者不同。Native构建结束15:50:06，私有虚拟KWin测试结束15:50:51，比实际崩溃早约21分钟。不能将清理版JS运行或同时发生的隔离测试作为本次直接触发原因。

## 后续修复方向

首先把Scroll/handoff所有权和窗口存活性过滤放在额外hitTest之前，避免对无关InternalWindow及保留的已删除窗口执行该调用；同时检查信号重入与mask恢复中的生命周期。保留KWin对popup、菜单、IME、拖拽与真实焦点的原生权威，不能简单吞掉输入或取消partial安全策略。

隔离回归应增加：内部窗口/提示层关闭但EffectWindow尚保留时持续移动鼠标、窗口关闭与重排同时发生、窗口不归Scroll所有权时不得额外调用hitTest。还需完成Native门禁与真实KWin验证，当前44项虚拟KWin通过不足以覆盖这次真实桌面生命周期场景。本轮尚未实现上述修复。

## 修复执行计划（2026-10-16，待实施）

前置清理已独立提交为 `34970aa`（`refactor: remove unused JS code and bundling entries`）。此次修复从该提交继续，清理提交不包含崩溃修复。当前阶段仅制定计划，没有修改或部署生产代码。

1. **建立针对性失败用例。** 扩展既有私有 KWin 输入 fixture / probe，在独立 D-Bus、输出和配置下创建并关闭内部窗口、提示层及普通客户端；覆盖保留 EffectWindow 而内部 QWindow 已销毁的阶段，并在关闭、重排、handoff 期间发送有界鼠标移动。应能验证当前插件对无关或已关闭窗口执行额外 hitTest 的错误；若不能稳定复现原始 SIGSEGV，分别记录“禁止调用的路径已覆盖”和“原始崩溃未复现”，不得把替代用例当作完整复现。诊断只放在隔离 fixture，不增加生产每帧日志或常驻采样。
2. **先修平台生命周期入口。** 在 `ViewportInputClip::apply()` 调用 `client->hitTest()` 前，检查窗口仍存活、未删除、非内部窗口，并通过现有 Rust runtime / handoff 查询确认其为当前裁切对象。使用既有所有权接口，不在 C++ 另建布局或输入策略。关闭窗口即使仍保留绘制引用，也不得参与输入命中；无关 popup、菜单、Fcitx5 候选窗和浮动窗口继续由 KWin 处理。保留活动 runtime 与冻结 handoff 两条路径，避免只修其中一条。
3. **审计同一输入链的引用和重入。** 检查 `partialEvent()` 的 candidate / authorityCandidate、`nativeOwnsInput()`、`restoreMasks()`、windowClosed / windowDeleted 信号及零延迟恢复 timer。区分 QObject 尚存活与窗口可接收输入，不能仅以 QPointer 非空为有效依据。核对临时 mask、可见性引用在关闭、Show Desktop、屏幕锁定、disarm、effect 析构时的释放顺序；保留现有重入保护、真实 ACK 和恢复流程，不引入每帧分配或新的时钟。
4. **完成隔离行为回归和 Native 门禁。** 在活动 runtime / handoff 下验证：未受管与已关闭内部窗口不会进入额外 hitTest；正常受管窗口仍正确裁切；部分可见区点击与安全两次点击、popup / 菜单 / Fcitx5、拖拽、全屏和锁屏让权不回归。重复关闭 / 重排 / 快速反向操作，检查无崩溃、残留 mask、可见性引用或 timer。执行根约束的固定 Rust fmt / clippy / test 及 `node tools/check.js --native`，顺序构建、并行度2；若涉及 Core / FFI / Qt 转换或 CMake 边界，按 `native/AGENTS.md` 补齐对应 Debug / Release、umbrella 和生产边界检查。此前44项通过不替代新增生命周期测试。
5. **形成候选版本后再部署验收。** 将修改、回归证据、未覆盖项和回滚步骤写入新的 Native 结果记录。通过自动门禁后，经用户明确允许，按既有 save-state → stop / restore ACK → immutable install → start 流程更新桌面；不强杀或重启 KWin，不绕过 blocked / ACK。实机复验 H/L、快速反向、换位、J/K、Pair/Wide、Ring、Ark关闭 / 提示层、Fcitx5和安全重载；未执行的项保持 Pending。发生异常时使用备份和既有恢复流程回滚。

完成标准：上述禁止调用路径有可检验回归，原生输入与恢复行为检查通过，用户实机验收完成。完整 core 未读取、原始 SIGSEGV 未稳定复现等限制须继续保留；隔离无崩溃或短时实机通过不能证明所有生命周期问题已消除。

证据：[主线程调用栈](kwin-crash-evidence/20261016-161144/main-thread-stack.txt)、[分析摘要](kwin-crash-evidence/20261016-161144/analysis.json)。完整日志和core元数据仅保存在私有目录 `/tmp/cc-niri-crash-20261016-161144`，未将完整core或含窗口信息的原始journal提交到仓库。
