# R7 / Scroll Layout V2 P5 集成结果

日期：2026-10-16。P5 完整结果及可复核证据见 [P5 报告](SCROLL_LAYOUT_V2_P5_RESULTS.md) 与 [verification](scroll-layout-v2-p5-evidence/20261016/full-p5/native/verification.json)。

P5 将 P2/P4 接入完整生成入口，添加版本化列宽、签名锚点、V1 dormant 偏好以及 Bridge 持久化验证。Rust Core、FFI header、冻结 reference 和 Cargo.lock 相对已验证 P4 不变；没有新增 Native ABI、渲染路径、动画时钟或布局/焦点 authority。Bridge C++ 仅校验/保存既有快照 envelope 的新增持久字段，Native typed geometry 的算法与 validator 继续使用原 Rust 实现。

| 门禁 | 结果 |
| --- | --- |
| Rust 精确1.99.0 fmt / locked clippy all-targets / workspace dev及release | PASS，109项各通过 |
| 完整 Native 门禁；最终完整 JS | PASS；Bridge/Clip/Ring CTest 18/18/25，JS 116个文件/220项 |
| Core Debug / Release、umbrella Debug | PASS，13/13/30项 |
| OFF production 与 reference/FFI边界；工具链拒绝 | PASS |
| Bridge 新/旧读取方私有 DBus + disk restart | PASS，15 / 7项 |
| 完整 main 私有 KWin 100%、150%、150%+Fcitx5 | PASS，30/30、30/30、33/33 |
| P4 150%+Fcitx5 回归 | PASS，35/35 |
| 实机视觉、4K60、PSS/Private_Dirty/GPU和长测 | NOT RUN / NOT MEASURED，P6 Pending |

阶段边界：P5 实现及自动化/隔离验证完成；V2 默认关闭、未部署，不能宣称 READY。四个已安装组件 SHA 未变。私有总线/显示和 build-tree 产物未触碰当前桌面。整体资源预算保持 Pending；源码切换回 V1 的办法和未来配套组件/快照回滚要求见 P5 报告。
