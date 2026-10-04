# Focus Ring Phase 1：Static Native POC

日期：2026-10-04。实现与自动检查完成，尚未部署，尚未做屏幕视觉验收。当前会话继续运行已通过验收的 Spring Phase 1–8。

## 模块与完成范围

- 独立 native/focus-ring：FocusRingEffect 集成 KWin 焦点和窗口事件；FocusRingContext 为不持有 Window 的资格 / 快照检查；FocusRingItem 管理一个 KWin OutlinedBorderItem。
- 2 logical px、#7FC8FF、alpha=1、radius=0，外侧矩形边框。作为 WindowItem 的场景子项，与 windowContainer 共用窗口渲染路径，排在内容之前；不创建 Wayland / QML overlay，不拦截输入。
- 外扩边界由 Item boundingRect 表达；增删和尺寸变化复用局部 damage，不增加 timer、polling、每帧 DBus / JS geometry 或 addRepaintFull。
- 暂时只读 Bridge protocol 2 当前 columns 判断 cc-niri membership；native 以真实 activeWindow 为焦点依据。正式 JS FocusRingController 与独立资格通道未实现。
- 全屏进入隐藏，退出仍可依据当前实际焦点恢复；非当前桌面 / 活动、非主输出、非成员、dialog / popup / special、最小化、opacity=0、屏幕外停放或关闭均拒绝。
- 输出、活动、显示桌面、锁屏、fullscreen effect、窗口策略与几何变化通过事件刷新；关闭、删除、父项销毁和卸载删除边框。Bridge owner 变化清空上下文，异步初始 GetState 不覆盖较新 StateChanged。
- 没有读写 role 1001–1006，避免 Spring role 冲突；后续可能的 Focus Ring role 1007 仅在设计里预留。
- 原布局、Spring、Script Effect、Bridge 与停放源代码未改动。
- 只提供只读诊断接口 `/ccNiriFocusRing` / `org.cc.NiriFocusRingPoc1.GetFocusRingStatus`，返回当前 owner、输出、工作区和样式。

## 自动验证

本机 kwin / kwin-devel：6.7.5-1.fc44，直接针对已安装 SDK 构建；插件默认关闭。

- 新插件构建通过。
- 新模块 3 项 CTest 通过：AppStream、资格 / 上下文、真实 KWin scene item。
- 真实 Item 测试验证 932×960 窗口的 scene boundingRect 扩为 (-2,-2,936,964)，窗口 position / size 不变、边框位于内容之前、确有可绘制 quad、同 owner 不重复分配。
- 40 次 attach / clear 无孤立子项；父 Item 销毁时边框清理；清理后父 bounds 恢复；处理静态事件队列不持续改变 bounds。
- 资格测试覆盖实际焦点、主输出、当前桌面 / 活动、fullscreen 隐藏及退出恢复、最小化 / 删除 / 透明 / 非成员；旧快照、同 generation 冲突、UUID 标准化重复、无效 JSON / 元数据和超大消息拒绝。
- `node tools/check.js --native`：82 个 JS 测试文件、Bridge 5 项 CTest / 3 项隔离 DBus、Viewport Clip 4 项 CTest、新 Focus Ring 3 项 CTest，以及所有原生构建通过。随后补齐输出 / 活动 / 策略清理事件，重新构建与运行新模块测试。
- CI 已加入新插件配置、构建和 CTest；远程 CI 未运行。

日志：`/tmp/cc-niri-focus-ring-phase1-check.log`、`/tmp/cc-niri-focus-ring-phase1-final-native.log`。

配置与检查：

```sh
cmake -S native/focus-ring -B build/native-focus-ring \
  -DCMAKE_BUILD_TYPE=RelWithDebInfo -DCMAKE_INSTALL_PREFIX="$HOME/.local" \
  -DKDE_INSTALL_PLUGINDIR=lib64/qt6/plugins -DBUILD_TESTING=ON
node tools/check.js --native
```

## 未完成与部署边界

尚未加载到 KWin；以上 linked KWin Item 自动测试不能代替实际 compositor 绘制、重绘、direct scanout 和崩溃风险验证。

部署前需增加 immutable canonical 安装并补齐启停 / 卸载流程，沿用 viewport-clip 的经验，避免覆盖正在映射的 .so。当前 install.sh / cc-niri 未接入新 POC，默认不安装、不启用。

接下来验证静态边框外侧、遮挡、点击输入、native fullscreen、关闭及卸载无残留，再进入 Phase 2 独立 JS 资格归属。
Spring / retarget / J/K 的视觉同步、Wide 非等比缩放后的固定粗细、Maximize 的边缘裁剪、主屏 fractional scale 尚待后续实机验收；场景子项共享链路不代表这些矩阵已经通过。
