# Focus Ring Phase 2：独立资格与归属管理

日期：2026-10-04。代码和自动验证完成；本阶段尚未部署、尚未实机验收。当前内屏继续运行已验收的 Phase 1 静态边框。

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
- 原生绘制路线、4px 浅蓝色、圆角兼容保持 Phase 1；额外在 Native 资格检查里直接拒绝 transient / utility / toolbar，避免等待 Script 消息时误画辅助窗口。

## 自动验证

- `node tools/check.js --native` 通过：84 个 JS 测试文件；Bridge 5 个 CTest、3 项隔离 DBus 集成；Viewport Clip 4 个 CTest；Focus Ring 5 个 CTest；Bridge / Clip / Ring / Plasmoid 构建通过。
- `focus-ring-controller.test.js`：事务内实际焦点和 null focus、独立 session / generation、无布局写入、策略 / 浮动 / 输出 / Qt 桌面 sequence、闭窗不读销毁属性、停用清理、重发和可选 endpoint 故障不影响 ColumnStore。
- `focus-ring-runtime.test.js` 执行真实生成包：事务内布局抑制激活时独立资格仍更新；off/on 重发获取最新浮动名单；工作区信号乱序先禁用再 mount；Dock gateway 不可用时资格仍发布；关闭与 runtime stop 清理。
- `focus-ring-controller-qobject` 在真实 QJSEngine / QV4 中运行生产 Controller / WindowPolicy / WorkspaceMembership，使用 QObject output 和桌面 QList、真实 Qt closed signal。实际 JS JSON 送入 C++ FocusRingContext，连续创建 / 关闭 / 销毁 2,000 个窗口；刻意在 Columns 中保留已删除 wrapper 后重发也安全，最终无闭窗 / watcher 残留。
- 原生资格测试覆盖新协议、stop tombstone、新旧 Script session、非法 / 超大 / 重复 UUID、全屏恢复及 native 当前焦点政策。现有真实 KWin Item 和独立颜色绘制测试仍通过。
- 完整门禁后收拢 start / stop 生命周期接入，最后 JS 全量与 KWin QV4 语法检查再次通过。

日志：`/tmp/cc-niri-focus-phase2-gate.log`、`/tmp/cc-niri-focus-phase2-native-build.log`、`/tmp/cc-niri-focus-phase2-final-js.log`。

## 部署与下一步

此阶段改变了 Script 与 Native 的资格接口，需要配套部署生成的 Script 和新的 immutable Native 库。沿用 `install.sh` 的卸载 / 启动和 hash 路径安装；不要原地覆盖正在映射的 `.so`。没有修改正在运行的插件、kwinrc 或当前窗口。

部署后先验证：

1. 在两个普通受管应用间点击及快速 H/L，边框只在真实当前窗口；事务中焦点也及时跟随。
2. Meta+Shift+Return 浮动后边框隐藏，恢复受管后出现；F11 隐藏与退出恢复、关窗无残留。
3. `cc-niri focus-ring off` 后切焦点或调整受管名单，再 `on`；不用再移动窗口即可获取最新名单。
4. J/K 往返，旧工作区不残留边框，返回后当前窗口恢复；主屏范围测试即可。

以上实机项目待验收。后续 Phase 3 验证视觉 transform 与 Spring / viewport clip，Phase 4 连续 retarget，Phase 5 Wide / Maximize 与非等比缩放粗细，Phase 6 主屏缩放；双屏实机仍按用户范围暂缓。
