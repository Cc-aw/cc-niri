# Scroll Layout V2 顶栏遮挡修复

2026-10-16。用户报告部署后窗口上方被顶栏覆盖。本次为 P6 实机发现的 JS 几何修复，Native/Rust/FFI/Bridge/CLI/构建配置未变。

## 原因与改动

只读 KWin 诊断确认：主屏2560×1440逻辑/150%，Plasma顶栏为 `[0,0,2560,51]`，可见且 `dock=true`；`clientArea(MaximizeArea)` 却返回全输出 `[0,0,2560,1440]`。V2只信任官方WorkArea，原窗口从y=16开始，顶端与顶栏重叠。

V2在官方WorkArea之外，补充避让当前输出/工作区可见且横跨整个输出边缘的dock面板。按真实frame取最大占用，不硬编码GapTop=50；不重复扣除官方strut，不把隐藏Dock、短Dock、普通popup、别的输出/工作区窗口当成边缘面板。OutputRect仍用于最终partial裁切，副屏和V1不变。

面板添加、关闭、geometry/output/desktop/hidden/minimized变化沿现有RuntimeLifecycle事件连接触发布局；关闭/stop继续由原生命周期释放连接。无新daemon、轮询、动画时钟或Native资源。

第一版修复已避开顶栏，但实机 VS Code 在150%把请求高度1357回报为1357⅓，触发严格bootstrap ACK超时，布局安全恢复并停用。没有把窗口已移开误报为功能完成。最终几何将纵向可用区域向内对齐到共同的整数逻辑/设备像素网格；本机51px面板的有效预留为52px，目标窗口y=68、height=1356，避免放松ACK或容忍未知客户端几何。横向列宽、camera和Spring参数未变。标准100/125/150/175/200%网格分别为1/4/2/4/1逻辑像素；因此避让可能增加不足一个网格单位的保守空白。

## 验证与范围

- 新几何回归覆盖非预留51px顶栏、已有strut不重复、隐藏/短Dock、普通popup、其他输出/工作区、侧栏。
- 完整入口模型覆盖panel添加、resize、隐藏、重新出现和关闭；另模拟真实client buffer/scale回报，验证150%奇数面板高度不会卡住bootstrap。
- 最终完整JS为118个文件 / **233项PASS**，私有150%+Fcitx5为 **37/37 PASS**。记录见 [final](scroll-layout-v2-p6-evidence/20261016/panel-fix/final/) 与该目录的validation.json；前两次开发期layer-shell测试不作为通过证据。
- 通用layer-shell面板在私有KWin中没有进入workspace.windowList，故“无strut的任意layer-shell面板”仍INCONCLUSIVE。本次修复覆盖用户实际可枚举的Plasma dock面板；官方strut继续优先。没有据模型宣称所有第三方面板兼容。
- 最终真实桌面核对 **8/8 PASS**：实际frame和painted source均为y=68、height=1356，Native completed=true，恢复状态running且session匹配，two-click开启，安装main SHA匹配，KWin PID仍为2075。结果见 [live-verification](scroll-layout-v2-p6-evidence/20261016/panel-fix/final/live-verification.json)。主观视觉和全P6矩阵另待用户验收；4K60、全项目PSS/Private_Dirty/GPU和长测均NOT MEASURED。

## 部署和退路

沿用save-state → 匹配本次恢复证明的safe stop → immutable install → start。每次应用前保留完整组件/配置/布局备份，原稳定V1备份 `/tmp/cc-niri-p6-20261016-deploy` 保留；修复过程的备份路径由实机验证记录给出。回滚默认dry-run，完整恢复使用对应目录的rollback.sh；恢复会替换为备份时的配置和布局，未执行强杀或重启KWin。

最终修复版已部署，备份位于 `/tmp/cc-niri-p6-20261016-panel-grid-fix`；最终启动区间日志未发现脚本异常或bootstrap超时。完整恢复未执行。第一版面板修复及通用layer-shell开发记录保留为失败/INCONCLUSIVE历史，不计入最终PASS。
