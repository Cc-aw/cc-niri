# W8 — Dynamic Trailing Empty Workspace

2026-10-01，feature/workspace-stack。用户确认修复后的动画正常，要求继续下一阶段。
本阶段实现可选末尾空桌面；尚未部署或启用 W8，当前日用会话保持 W6/W7 修复版。

## 行为

- 独立 DynamicWorkspaceController，DynamicTrailingWorkspace 默认 false，并提供 KDE
  Script 配置复选框。修改选项后需 cc-niri restart。
- 启动完成及窗口创建/关闭、原生 desktop membership、output、policy、桌面拓扑和主屏
  变化后，合并为一次延迟 100 ms 的存活窗口检查；等待启动与工作区迁移/切换屏障解除。
- 从 KDE 实时桌面列表取末尾 UUID，从实时窗口列表判断主屏应用窗口占用；Floating、
  Fullscreen、最小化、Dialog 与非 sticky 的多桌面应用也计入。Sticky、Plasma、Dock、
  Desktop、Popup、Splash 和其它输出窗口不计入。
- 最后一个桌面被占用时调用 createDesktop(count, "")，使用 KDE 默认名称追加一个桌面。
  不切换桌面、不写焦点或窗口几何、不删除任何桌面；已有空桌面和用户手动增加的桌面保留。
- 请求前建立确认屏障，兼容同步 desktopsChanged 与延迟原生确认。1 秒后重新读拓扑；
  无变化、API 缺失或异常时只对同一拓扑警告一次，防止到达 KDE 上限后无限创建请求。
- 延迟任务不缓存 Window QObject，读取当前存活对象；Emergency Recovery / unload 停止
  controller、取消任务，晚到信号不能创建桌面。

API 使用依据：[KDE KWin scripting API](https://develop.kde.org/docs/plasma/kwin/api/)。
本机 `/usr/include/kwin/virtualdesktops.h` 确认追加位置范围为 [0,count]，空名称采用默认名，
到达原生上限时创建可不生效；因此实现以 KDE 实际拓扑变化为确认，而不依赖返回值。

## 自动验证

新增两个测试文件，分别验证独立模块及真实生产 bundle 接线：

- 默认关闭、已有末尾空桌面、连续占用新末尾、关闭后不删除；
- 主屏/Floating/Fullscreen/minimized/Dialog/multi-desktop/Qt sequence membership；
- sticky、shell、其它输出、关闭后延迟检查、启动/迁移屏障与停止；
- 同步与延迟原生拓扑信号、API 缺失/异常/no-op 后防止循环；
- windowAdded、desktopsChanged、outputChanged 触发追加，当前桌面、焦点、列布局不变；
- Emergency 后晚到窗口与 timer 不能再创建桌面。

`node tools/build.js` 与 `node tools/check.js --native` 全部通过：69 个 JS 测试文件、
Bridge 3 项 CTest（包括 QObject 生命周期与生产 Script/Effect QJSEngine 语法）、隔离
D-Bus integration、native clip 2 项 CTest 和 Bridge / clip / Plasmoid 三项 native 构建。
配置 XML/UI 解析及 git diff --check 通过。门禁日志 `/tmp/cc-niri-w8-native-check.log`。

## 后续主屏实机验收

部署并显式启用后，在最后桌面创建或迁入测试应用，确认只追加一个空桌面，J 可进入、
K 可返回；在新末尾再次打开窗口，再追加一个。关闭测试窗口后原桌面数量不减少。
同时检查 Floating/Fullscreen、末尾已有窗口的 restart，以及关闭配置后保持固定桌面。
W8 只考虑主屏占用；不需要双屏验收。此轮尚未执行这些真实桌面创建检查。
