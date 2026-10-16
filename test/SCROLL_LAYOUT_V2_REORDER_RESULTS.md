# V2 混合宽度换位的视口修复

2026-10-16，基线 `ff3bc8c`。用户确认：2/3 窗口居中后，焦点切到右侧 1/2 窗口，按 Win+Shift+H 与 2/3 换位，1/2 意外居中。

原因：结构变化统一以焦点窗口的旧绘制位置为锚点。向左换位后，维持旧位置需要负 camera，被 clamp 到 0，使第一列 half 落在 leadingInset=652。修复将移动和重排的目标计算改为从已观测 camera 对新位置执行原有 fit/center 策略；新增、关闭、尺寸变化的焦点位置锚定保留。Native 接管来源仍是实际绘制帧，未将旧目标冒充来源。

在 W=2560、gap=16 时，half 左移后 x=16、宽1256，2/3 邻居 visual.x=1288、宽1680；邻居真实安全 frame.x=880，由 Native 投影裁切。反向换位后 half.x=1288；活动 2/3 仍居中 x=440。列身份、宽度、焦点和每次单一 epoch 保持。

验证 PASS：修复前纯模型和完整生成入口均复现 652≠16；修复后左右移动、重排和 2/3 居中回归通过。`node tools/build.js` 与 `node tools/check.js` 通过（118 文件 /237 项）；补充的 2/3 换位断言另执行模型测试通过。最初受限沙箱门禁的原生 fixture 失败，允许本地隔离测试进程后完整门禁通过。私有 Release KWin、150%+Fcitx5 的 P6 场景通过 41/41，新增实际客户端换位、有效 Native source 和副屏无泄漏检查。见 [JS 门禁](scroll-layout-v2-reorder-evidence/20261016/js-gate.log)、[隔离结果](scroll-layout-v2-reorder-evidence/20261016/isolated.json)、[验证摘要](scroll-layout-v2-reorder-evidence/20261016/validation.json)。

范围为纯 JS 目标策略及测试，Rust/C++/FFI/构建配置、Spring 与绘制实现未改。没有新增常驻状态、timer、连接、纹理或动画时钟；全项目 PSS、Private_Dirty、GPU、4K60和长期资源验收 NOT MEASURED。

当前状态：用户授权部署并重新加载后，save-state 成功，但安全 stop 的精确恢复 ACK 再次 blocked，在卸载和安装前中止。只读复核 11 个存活受管窗口均可见、未最小化且位于输出内；Native Scroll/Workspace/handoff 均停用。用户另行明确批准“允许本次人工确认后重载脚本”，重新审计后仅卸载旧 Script、升级包并加载新 Script。保留原 failed ACK，不伪造或改写证明，不把本次批准变为默认绕过。

部署与启动核验 PASS：安装脚本 SHA 与候选相同；新 session recovery=running，Native source valid/completed；KWin PID2075 和 Bridge PID 均未变，未卸载 Native 插件或关闭应用。详见[部署摘要](scroll-layout-v2-reorder-evidence/20261016/deployment.json)。备份脚本、配置和布局位于 `/tmp/cc-niri-half-reorder-deploy-20261016-145838`。实机换位目测 Pending；自动恢复 ACK 问题仍未修复。回滚可从该目录恢复旧脚本包，经单独安全恢复后加载；或恢复 `ff3bc8c` 的两个源码模块，再生成和验证包。
