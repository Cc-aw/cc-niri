# Focus Ring Phase 2：独立资格与归属管理

日期：2026-10-04。代码和自动验证完成；本阶段已在主屏配套部署并启用，自动加载 / 独立开关检查及三轮人工实机验收全部通过。用户随后要求边框从 4px 调整为 3px，已完成构建、原生检查并单独部署。

## 实现

- 新增 `src/kwin/visual/FocusRingController.js`，由运行时启动 / 停止管理，单独订阅真实窗口激活、窗口策略、输出、工作区及关闭事件。
- Script 只发布主屏当前工作区的受管 UUID 集合，不指定边框 owner、不写焦点、frameGeometry、opacity、ColumnStore 布局或 Spring 状态。Native 始终使用实际 `effects->activeWindow()`，只有一个符合资格的 owner。
- 独立通道直接使用 `org.kde.KWin /ccNiriFocusRing org.cc.NiriFocusRing1.PublishEligibility`；不再读取 Dock snapshot、Bridge service、Dock generation 或逻辑 focusedUuid。旧 `org.cc.NiriFocusRingPoc1` 诊断接口升级为 `org.cc.NiriFocusRing1`。
- 协议 1：`type=focus-ring-eligibility`、独立 sessionId / generation、enabled、targetOutput、workspaceId、windows。无坐标、样式、动画时钟或 KWin data role。Native 限制消息 256 KiB、窗口 256 个、安全整数 revision、规范化 UUID 去重；拒绝 Dock 协议。
- ColumnStore 仅增加可选成员变化通知；清空、加入、移除会触发资格发布。布局提交另做一次去重后的刷新，避免插入与状态初始化顺序导致遗漏。焦点事件强制重发，位于独立订阅里，不受 `layoutTransaction.isActive()` 或 Dock transfer gate 阻挡。
- 工作区以 KDE 当前桌面为准：旧 Columns 与当前桌面不一致时发送禁用 / 空名单，完成 mount 后重新发布。浮动、dialog / modal / transient / utility / toolbar / popup / special、Sticky、多工作区、非主输出不加入资格集合。
- 原生全屏、最小化、活动、透明停放、输出外几何等瞬态由 Native 继续判断；全屏期间保留 JS membership，因此退出 F11 可恢复，无需把窗口重新加入列。
- 开启 / 重新加载 effect 时，Native 调用已有 KGlobalAccel 机制中的专用空快捷键 `CCScrollPublishFocusRingState` 请求当前资格；Script 即使上一条发送发生在 effect 关闭期间，也会强制重发。没有 timer、polling 或每帧 DBus。
- stop / emergency restore 发布新 revision 的禁用空名单并断开自己的信号连接。关闭窗口先排除，再在 ColumnStore 移除后释放闭窗 wrapper；未挂载工作区的闭窗不保留 wrapper。Native 卸载清空 Item / endpoint。
- 同 session 的旧 revision / 同 revision 冲突不覆盖当前资格；旧 Script session 进入有界 tombstone 集合，不能覆盖新 session。非法输入关闭资格但保留 revision，不能用旧消息重新启用。
- 资格阶段实现时原生绘制路线、4px 浅蓝色、圆角兼容保持 Phase 1（验收后 3px 调整见末节）；额外在 Native 资格检查里直接拒绝 transient / utility / toolbar，避免等待 Script 消息时误画辅助窗口。

## 自动验证

- `node tools/check.js --native` 通过：84 个 JS 测试文件；Bridge 5 个 CTest、3 项隔离 DBus 集成；Viewport Clip 4 个 CTest；Focus Ring 5 个 CTest；Bridge / Clip / Ring / Plasmoid 构建通过。
- `focus-ring-controller.test.js`：事务内实际焦点和 null focus、独立 session / generation、无布局写入、策略 / 浮动 / 输出 / Qt 桌面 sequence、闭窗不读销毁属性、停用清理、重发和可选 endpoint 故障不影响 ColumnStore。
- `focus-ring-runtime.test.js` 执行真实生成包：事务内布局抑制激活时独立资格仍更新；off/on 重发获取最新浮动名单；工作区信号乱序先禁用再 mount；Dock gateway 不可用时资格仍发布；关闭与 runtime stop 清理。
- `focus-ring-controller-qobject` 在真实 QJSEngine / QV4 中运行生产 Controller / WindowPolicy / WorkspaceMembership，使用 QObject output 和桌面 QList、真实 Qt closed signal。实际 JS JSON 送入 C++ FocusRingContext，连续创建 / 关闭 / 销毁 2,000 个窗口；刻意在 Columns 中保留已删除 wrapper 后重发也安全，最终无闭窗 / watcher 残留。
- 原生资格测试覆盖新协议、stop tombstone、新旧 Script session、非法 / 超大 / 重复 UUID、全屏恢复及 native 当前焦点政策。现有真实 KWin Item 和独立颜色绘制测试仍通过。
- 完整门禁后收拢 start / stop 生命周期接入，最后 JS 全量与 KWin QV4 语法检查再次通过。

日志：`/tmp/cc-niri-focus-phase2-gate.log`、`/tmp/cc-niri-focus-phase2-native-build.log`、`/tmp/cc-niri-focus-phase2-final-js.log`。

## 部署与下一步

此阶段改变 Script 与 Native 的资格接口，本轮已配套部署生成的布局 Script 和新的 immutable Native 库。采用与 `install.sh` 相同的 `cc-niri stop/start` 恢复流程及 `tools/install-native-clip.py` 安装器；未原地覆盖已映射的 `.so`。

- 部署前重新运行 `node tools/check.js --native`：85 个 JS 测试文件、Bridge / Clip / Ring 原生测试及构建全部通过，包含刚验收的 Wide 邻窗回归。日志 `/tmp/cc-niri-focus-phase2-deploy-gate.log`。
- 主屏 eDP-1；部署前后 KWin PID 均为 2088，未重启 KWin 或 Plasma。
- 新 canonical：`~/.local/lib/cc-niri/focus-ring/2e2772e5e1c6d4130e7b8f3fd55bfbc91b59dd2a588d9fcb6ba1a4fe7ae02335/cc-niri-focus-ring.so`。旧版本库保留用于回退。
- 新布局 SHA256：`c5bd51fe916bc98806eeede352079d66cd561b243edec93a019f786e8e502f77`，与仓库生成包一致。
- 动画 Effect 未替换，仍为已通过实机验收的 Wide 邻窗修复版本；Clip / Bridge / Dock 二进制未替换。
- 新诊断接口返回 `phase=independent-eligibility`、`eligibilitySource=layout-script`、enabled=true、eligibleCount=2；资格输出与工作区和当前布局一致。保持 width=4、color=#7FC8FF。
- 自动 off 检查：effect 卸载，诊断 endpoint 删除；布局 / Spring / Clip / Bridge 仍运行。on 后无需移动窗口，获得同一独立 session 的新名单，generation 从 4 增至 5。
- 部署前后持久工作区快照一致：列、焦点、Wide 偏好、viewport 及 anchor 保留。
- 初始诊断 owner 为空，尚不能用该快照证明实际焦点边框绘制正确；该项由以下人工步骤验证。
- 日志无新增脚本运行异常或 KWin 崩溃。加载 Native 前可见可选资格端点暂不存在的 DBus 报错，Native 加载后重发成功；已有 `deferredScrollParking` 前向引用警告仍可见。

备份与命令审计：`/tmp/cc-niri-focus-phase2-backup-20261004-icg1x3ww`，含旧布局 / Effect、kwinrc、旧库 canonical、工作区快照、commands.json、result.json 与 KWin 日志。部署辅助脚本 `/tmp/cc-niri-focus-phase2-deploy.py` 在检查失败时恢复旧布局与旧库发现链接。

人工验收步骤：

1. 在两个普通受管应用间点击及快速 H/L，边框只在真实当前窗口；事务中焦点也及时跟随。
2. Meta+Shift+Return 浮动后边框隐藏，恢复受管后出现；F11 隐藏与退出恢复、关窗无残留。
3. `cc-niri focus-ring off` 后切焦点或调整受管名单，再 `on`；不用再移动窗口即可获取最新名单。
4. J/K 往返，旧工作区不残留边框，返回后当前窗口恢复；主屏范围测试即可。

人工验收进度（2026-10-04）：

- 第一轮通过：用户在点击切换两个受管窗口及快速 Meta+H / L 后反馈“这次正常”，确认边框只跟随当前焦点、旧窗口无残留，颜色和圆角正常。
- 第一轮后只读诊断：仍为 `independent-eligibility`，独立资格 generation=37、eligibleCount=2；drawCount 已增至 2252，KWin PID 仍为 2088。读取时 owner 为空，不将快照视作某个窗口的焦点匹配证明。
- 第二轮通过：用户反馈“全部正常”，确认 Meta+Shift+Return 浮动 / 恢复受管、F11 全屏 / 退出以及 J/K 工作区往返时，边框正确隐藏与恢复，旧工作区无残留。第二轮后 KWin PID 仍为 2088，独立资格 generation=45、eligibleCount=2。
- 最后一轮通过：用户反馈“全部正常”，确认边框 off 期间改变焦点 / 浮动资格后，on 使用最新资格；浮动窗口无边框、恢复受管后出现；临时受管窗口关闭后边框无残留并转到新的当前受管窗口。

Phase 2 三轮人工实机验收全部完成，独立资格与归属管理通过。后续 Phase 3 验证视觉 transform 与 Spring / viewport clip，Phase 4 连续 retarget，Phase 5 Wide / Maximize 与非等比缩放粗细，Phase 6 主屏缩放；双屏实机仍按用户范围暂缓。

## 验收后的 3px 样式调整

用户在确认最后一轮“全部正常”后要求边框变小为 3px。仅将 FocusRingItem::Width 从 4.0 改为 3.0，并更新已有场景几何检查：932×960 窗口外扩到 (-3,-3,938,966)，1348 宽边框 bounds 为 1354。浅蓝颜色、圆角兼容、资格协议及绘制路线沿用本轮已验收实现。构建和单独部署已完成：

- `cmake --build build/native-focus-ring` 与该目录 5 项 CTest 全部通过。日志 `/tmp/cc-niri-focus-ring-3px-gate.log`。
- 仅通过 `cc-niri focus-ring off/on` 更新原生 Ring；新 immutable canonical 为 `~/.local/lib/cc-niri/focus-ring/f4247a8124c3004669e8970726e494260c9238e8e2fa5c9abbe26f3bca860bd2/cc-niri-focus-ring.so`。
- 部署后诊断 width=3、color=#7FC8FF、phase=independent-eligibility，收到当前独立资格（generation=127、eligibleCount=2）。
- KWin PID 仍为 2088；布局 Script、动画 Effect、Viewport Clip 文件 hash 未变，布局 / 动画 / Clip / Bridge 继续运行。卸载和加载日志没有新增异常。
- 备份与审计：`/tmp/cc-niri-focus-ring-3px-backup-20261004-w2k9e18a`，包含旧库路径、kwinrc、命令记录、部署结果和 KWin 日志；失败恢复逻辑见 `/tmp/cc-niri-focus-ring-3px-deploy.py`。

Phase 2 人工验收结果对应调整前的 4px 版本；本次 3px 已由场景测试与部署诊断确认，用户尚未单独反馈新线宽外观。
