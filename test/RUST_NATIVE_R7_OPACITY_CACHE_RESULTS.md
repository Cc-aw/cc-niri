# R7：透明准备态的离屏缓存失效修复

日期：2026-10-30。范围为 Native Clip 的 Qt/KWin 透明度观察与 effect 内容缓存失效通知；未修改 Rust Core、FFI、CMake、JS 布局/工作区/焦点 authority、Spring 或动画参数。

## 问题与修复

用户在工作区2多次J/K后，kitty左侧Dolphin缺失。平台opacity=1、minimized=false、hidden=false，Native source仍valid且有painted记录，但截图确实缺少窗口。圆角重载后恢复，继续J/K仍会复发。诊断中曾误读圆角恢复后的截图，已更正，完整历史保留在 [工作区可见性记录](RUST_NATIVE_R7_WORKSPACE_VISIBILITY_RESULTS.md)。

私有KWin像素对照确认：透明度为0时产生的内容可以留在圆角OffscreenEffect缓存中；仅恢复opacity=1不足以使缓存失效，真实客户端再次damage才恢复。圆角关闭时，相同opacity序列正常。恢复前后的Native epoch、camera、frame未改变。

`CcNiriViewportClipEffect::watchPartialNativeInteraction()` 增加一个随EffectWindow生命周期管理的opacity信号连接。在V2启用、普通存活窗口的透明度跨越0边界时，发出一次effect级`windowDamaged`通知，要求依赖窗口内容的离屏效果重新生成缓存。进入透明态与恢复可见态均处理，避免准备阶段仍显示旧的可见缓存。重复赋值以及两个非零透明度之间的变化不触发本修复。

该通知不移动、缩放、激活或取消最小化窗口，不伪造客户端surface commit / configure ACK / paint completion，也不改动epoch、Native ownership或JS发布顺序。既有几何ACK、arm ACK和真实绘制证明继续执行。恢复通知在WindowItem已处理对应opacity更新后同步发出，没有额外timer或延时。

## 验证

工具链为Rust / Cargo 1.99.0、`/usr/bin/g++` GNU 16.2.1；沿用已通过共享toolchain检查的既有构建树，标准非Debug配置调用Rust release，依赖锁定不变。

| 检查 | 结果 / 证据 |
| --- | --- |
| 修复前透明缓存回归 | **FAIL，15/16（保留缺陷证据）**，唯一失败为恢复opacity后像素仍透明；客户端damage恢复与无圆角负对照均通过。`/tmp/cc-niri-workspace-visibility-final-diagnosis/report.json` |
| 最终100%像素回归 | **PASS，28/28**，含无客户端damage的立即隐藏、透明缓存后恢复、12轮慢切换/快速反向返回、idle无Native continuation repaint、安全stop；`/tmp/cc-niri-opacity-cache-final-100/report.json` |
| 最终150%像素回归 | **PASS，28/28**，同上，尺度与用户桌面一致；`/tmp/cc-niri-opacity-cache-final-150/report.json` |
| scope / frame检查 | **PASS**，两种缩放下opacity前后session/workspace/output/scopeRevision/epoch/camera和实际frame均一致；Native source均valid |
| 私有完整入口150% + Fcitx5 | **PASS，49/49**，H/L、J/K、宽度、重排、全屏、最大化、迁移、会话恢复、输入法与安全恢复；`/tmp/cc-niri-opacity-cache-p5-150-ime/report.json` |
| `cargo fmt --manifest-path native/rust/Cargo.toml --all --check` | **PASS**，单独执行及完整Native门禁均通过 |
| `cargo clippy --manifest-path native/rust/Cargo.toml --locked --workspace --all-targets -- -D warnings` | **PASS**，完整Native门禁执行 |
| `cargo test --manifest-path native/rust/Cargo.toml --locked --workspace` | **PASS，109项**，完整Native门禁执行 |
| `CMAKE_BUILD_PARALLEL_LEVEL=2 node tools/check.js --native` | **PASS**，296项JS /124文件，Bridge18/18、Clip18/18、Ring25/25，7个私有Bridge集成入口、Golden differential、生产边界检查、4个Native构建通过；`/tmp/cc-niri-opacity-cache-native-gate.log` |
| Python语法、bundle一致性、whitespace | **PASS**，`py_compile`、`node tools/build.js --check`、`git diff --check` |
| Debug/Release Core额外矩阵、编译器拒绝矩阵 | **NOT RUN**，本轮未修改Core、Qt DTO转换、FFI、CMake或工具链；完整门禁中的既有Rust/FFI/差分/运行时测试通过 |
| 用户原始隐藏问题的实机验收 | **PASS**，用户在安装后明确反馈“已经修复”，并要求提交Git；验收范围限于本次J/K隐藏问题 |
| 快速反向、全屏和4K60视觉流畅度完整矩阵 | **Pending**，未将用户对原问题的确认外推为完整性能/功能验收 |

此前仅恢复可见边界的首轮版本在150%通过26/26；随后补齐进入透明边界的失效处理与独立隐藏断言，以上28/28均来自最终版本。保留两个版本的范围差异，不混算检查数量。

提交前将本修复与工作树中原有的会话恢复、CLI和审计改动分开暂存。上述完整门禁及安装哈希对应当时的完整工作树；另外将暂存版本独立导出，**PASS**：生成包一致性、三组P4/工作区/延迟ACK回归测试文件和三个Python探针的语法检查。生成包仅提交与本次Coordinator源文件对应的生成段，未夹带其他运行时改动。

## 资源与生命周期

新增daemon、线程、动画时钟、timer、窗口/全屏图像或纹理缓冲均为0；回调不建立JSON、不记录每帧日志，也不在绘制路径轮询。使用现有圆角纹理，在真实透明边界事件上使其失效并重绘；不新增第二套renderer或缓存。

每个具有平台client的存活EffectWindow增加一个Qt信号连接，O(N)按真实对象数增长，不按历史操作增长；闭包仅捕获effect自身，不另持有Window引用。sender或receiver销毁时Qt自动断开，retained deleted窗口的事件被拒绝。idle回归检查两个采样点的Native continuation repaint计数不增长；这不等同于全项目长测或GPU计数。

额外信号连接的实际PSS / Private_Dirty、GPU时间、4K60帧时间以及30–60分钟趋势均 **NOT MEASURED**。缓存正确失效会增加必要的边界事件内容重绘，没有以此宣称达到32/64MiB全项目预算；全项目M0/M1/M3仍沿用现有Pending状态。

## 安装与回退

沿用前面用户明确要求安装的授权，验证通过后执行`CMAKE_BUILD_PARALLEL_LEVEL=2 ./install.sh`，退出码0。既有入口完成save-current-state、确认窗口恢复后stop、immutable Native安装和start；不强杀或重启KWin，不再次卸载圆角特效。

- 安装前备份：`/tmp/cc-niri-opacity-cache-install-20261030-171835/`，包括脚本/effect、CLI、Bridge、两个Native插件与配置参考；具体路径、原canonical路径及hash见`manifest.json`。不应整体回写kwinrc覆盖后续用户设置。
- 安装日志：`/tmp/cc-niri-opacity-cache-install.log`，包含`cc-niri stopped; parked windows restored.`与启动成功。
- 实际加载Clip：`/home/cc/.local/lib/cc-niri/viewport-clip/b95ab3bce7250d247a19101b7f21ae42149390c8e8d6d51c2a8c81172ab848cd/cc-niri-viewport-clip.so`。DBus上报路径与discovery链接解析结果一致，canonical目录名等于文件SHA256。
- main.js与测试生成包完全一致，SHA256为`4dde4e2eed648789ad4e73b927039554b12ee0973f5dde0c5298a00e89a8334e`。
- 安装后脚本、Transition、Clip、Ring和圆角均loaded，Bridge active；Layout health **running (session-ready)**，圆角compatibility pending=none。核验值保存在备份目录`verification.json`。

源码回退只移除本次opacity观察连接，保留其他既有修改，再通过同一门禁与安全安装流程应用。部署回退可在保存状态和确认安全stop后，用旧canonical路径恢复Clip的discovery链接，随后start；不覆盖已映射库，不绕过恢复证明，不直接整体恢复配置文件。旧canonical路径保存在备份manifest中。恢复旧版本会重新暴露本回归，不能当作问题解决。
