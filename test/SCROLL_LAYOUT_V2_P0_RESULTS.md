# Scroll Layout V2 P0 阶段结果

基线：`8056cfe6b4a023ac8dcbfb01e4495a5acf4c2c4e`；分支：`scroll-layout-v2-p0`。
状态：**PASS（基本平台可行性，采用安全两次点击退路）/ V2 NOT READY**。
当前结果、命令、限制和回滚方式见 [Native 输入/裁切续报](SCROLL_LAYOUT_V2_P0_INPUT_RESULTS.md)，
初始调查历史见 [可行性报告](SCROLL_LAYOUT_V2_P0_FEASIBILITY.md)。

- PASS：只读清单、12 项模型、9 项 API/几何断言；100% / 150% 各49项 Native 检查，Fcitx5 53项；最终108个 JS 测试文件及完整 Native 门禁。
- 已复现：直接写入越界 visualRect 会改变 output；Wayland resize 的 frameGeometry 异步收敛。
- 已验证：原生输入坐标错误的反例；两次点击/pairing、popup/Modal/DnD、标题栏/缩放、touch/hover、屏幕边缘、最大化返回、窗口销毁、Ring/输出 clip、面板 WorkArea、Fcitx5 候选窗委派与文本提交。
- NOT MEASURED：真实 DRM / 混合 DPI 同时运行、物理 tablet、IBus、pointer constraints、4K60 与全项目内存；生产 V2 协议/动画/恢复仍未实现。
- 没有改变或部署生产代码。P0 基本可行性支持离线 P1；完整生产功能和实机/资源门禁仍属后续阶段，V2 不可在当前桌面启用。
