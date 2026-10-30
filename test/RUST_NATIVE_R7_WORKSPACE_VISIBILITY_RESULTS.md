# R7 工作区挂载隐藏窗口修复尝试

日期：2026-10-30。范围：Scroll Layout V2 的 JS bootstrap 可见性恢复；未修改 Native、Rust、FFI、CMake、Spring 或工作区切换策略。

后续已定位并修复另一条独立原因：透明准备态进入圆角离屏缓存，用户已确认原问题修复并要求提交Git，详见 [Native 缓存失效修复与安装记录](RUST_NATIVE_R7_OPACITY_CACHE_RESULTS.md)。本记录保留第一版修复和现场纠正历史，不以第一版通过替代后续验收。

## 问题与证据

用户报告 J/K 切换后窗口偶发隐藏，按 H/L 才出现。源码中 bootstrap 先隐藏非焦点列，只有焦点窗口在同步写几何后立即匹配目标时才提前显示；后续 frameGeometryChanged 只检查是否所有目标都已确认，等 Native arm ACK 后才一起显示。

隔离模型先保留目标工作区的 parking ownership，再延迟焦点窗口的几何确认，可以复现整个目标工作区透明，按 H 后已就绪邻窗立即出现。进一步延迟两个窗口的确认，单独补回焦点窗口的确认，旧实现仍不恢复焦点窗口的透明度。**这确认了源码中的恢复缺口，未证明它是用户实机异常的唯一根因。**

## 修改

- `ColumnGeometryCoordinator.hydrate()` 在已有 configure 检查中，逐个显示真实 frame 已严格匹配、且安全锚点等于最终 visualRect 的完整可见窗口；同步确认和晚到确认使用同一条路径。
- 部分可见窗口的真实锚点经过钳制，仍等所有 configure 确认、publish ACK 和 Native arm ACK 后显示，避免提前暴露错误区域。
- 显示前标记当前 target，复用 lease 的 committing guard 防同步重入；显示后重新检查 lease / epoch / workspace，旧回调不能继续发布或显示离开工作区的窗口。
- 焦点激活和完成仍等待原有绘制证明；未降低严格几何匹配或超时门槛。
- 通过 `node tools/build.js` 更新生成包，保留工作区中既有未提交修改。

## 验证

| 项目 | 结果 |
| --- | --- |
| 修复前新回归的前四项 | **FAIL（预期）**：前三项暴露邻窗等待、晚到焦点 ACK、arm 前焦点不恢复；离开工作区后 ACK 隔离项 PASS |
| `node test/workspace-bootstrap-visibility.test.js` | **PASS，5/5**：包含同步 reveal 中再次切换工作区，旧回调不能继续执行 |
| `node test/scroll-layout-v2-column-geometry.test.js` | **PASS**：既有 P4 producer / ACK / completion / 生命周期回归 |
| `node tools/check.js`（允许隔离子进程 / IPC 后） | **PASS，296 项，124 个测试文件**；生成包一致性和 patch whitespace 检查通过 |
| 私有 KWin P5，150% | **PASS，46/46**：完整生成入口、几何、焦点、工作区及恢复回归；证据 `/tmp/cc-niri-workspace-visibility-p5-150/report.json` |
| 私有 KWin P4，100% | **PASS，32/32**：几何、真实 source / paint、裁切和退休恢复回归；证据 `/tmp/cc-niri-workspace-visibility-p4-100/report.json` |
| Rust fmt / clippy / test、`node tools/check.js --native` | **NOT RUN**：本次仅修改 JS bootstrap 和测试，没有 Native / 构建 / FFI / 工具链改动 |
| 用户原始隐藏问题的实机验收 | **FAIL**：安装后用户在工作区 2 再次报告 kitty 左侧窗口缺失，一次性截图确认；本补丁未解决全部现场原因 |
| 快速反向、Wide / Fullscreen、4K60 视觉验收 | **NOT MEASURED / Pending**：未注入快捷键操作用户窗口，私有场景不能替代实际异常验收 |

首次受限沙箱的 JS 门禁为 121/124 文件通过，三个既有 CLI / fixture 隔离测试受子进程或 IPC 权限限制；私有 KWin 首次启动也被 DBus socket 的 `Operation not permitted` 阻止。允许相同命令在沙箱外运行后，上表检查全部通过，未跳过测试或放宽断言。日志位于 `/tmp/cc-niri-workspace-visibility-check-unrestricted.log` 和相应私有场景目录。

## 资源、限制与回退

新增 daemon、线程、动画时钟、图像 / 纹理缓冲均为 0。每次 bootstrap 增加一个按当前可见目标数量有界的引用数组及 target 布尔标记，复用已有信号 / lease / 超时；无逐帧分配、轮询或日志。lease 退休按既有 dispose 顺序断开回调。PSS / Private_Dirty、GPU、帧时间与 30–60 分钟资源趋势均 **NOT MEASURED**，不据模型宣称满足全项目内存预算。

本次修复处理“已就绪窗口被其他窗口拖住”的显示缺口。尚未确认几何的窗口继续等待原有安全路径；本次也不宣称解决所有长期隐藏或 Native 绘制异常。

源码回退仅撤销本次 `ColumnGeometryCoordinator.js` 的修改、移除新增回归及本记录，再运行 `node tools/build.js`；保留其他既有未提交修改。部署后的回退须再通过既有保存状态 / 安全 stop / 安装 / start 流程应用，不直接覆盖运行中的原生库。

## 用户授权后的安装

用户随后明确要求安装。**PASS**：执行 `CMAKE_BUILD_PARALLEL_LEVEL=2 ./install.sh`，使用 Rust 1.99.0、`/usr/bin/g++` 16.2.1 和既有构建树；安装脚本完成 save-current-state、带恢复证明的 stop、immutable Native 安装、包升级和 start。未重启 KWin、未操作 J/K 或 H/L。

- 安装前脚本 / effect、CLI、两份原生插件及配置备份：`/tmp/cc-niri-workspace-visibility-install-20261030-154037/`，具体清单见其中 `manifest.json`。
- 安装日志：`/tmp/cc-niri-workspace-visibility-install.log`，退出码 0。
- 已安装 main.js 与测试生成包 SHA256 一致：`4dde4e2eed648789ad4e73b927039554b12ee0973f5dde0c5298a00e89a8334e`。
- `./cc-niri status`：脚本 loaded / 登录启用均为 true，Transition / Clip / Focus Ring 均 loaded，Bridge active，Layout health **running (session-ready)**，Rounded Corners compatibility pending 为 none。
- 本项证明安装和启动成功；用户原始偶发问题的实际消除、视觉和长期资源验收仍保持 Pending。

## 安装后现场：原问题仍出现

用户报告当前工作区 2 的 kitty 左侧窗口隐藏。只读窗口观察和单张截图确认：左侧为 Dolphin，平台 opacity=1、minimized=false、hidden=false，frame 为 x=0/y=60/1680×1364；Native source valid=true，completed=true，目标 visualRect.x=-408，宽1680，按计划应有1272逻辑像素位于屏幕内，但截图显示该区域是桌面背景。过渡特效 debug 返回 `No window is animated`。这不是此前模型中 opacity=0 / configure 未确认的现场，不能将第一版修复视为已解决用户问题。

证据保存在 `/tmp/cc-niri-hidden-live/`（`windows.json`、`status.json`、`source.json`、`completion.json`、`screen.png`），原始 Bridge 快照在 `/tmp/cc-niri-hidden-live-state.txt`。观察脚本与临时接收器均一次性退出并卸载，没有持续采样、切换工作区或修改窗口。下一步检查实际绘制与第三方圆角离屏重定向的交互，尚未确认根因。

### 经用户明确授权的圆角 A/B

用户明确允许短暂关闭后立即恢复圆角。通过现有 Effects 接口卸载 `kwin4_effect_shapecorners`，单张截图中 Dolphin 恢复；finally 重新加载并确认 loaded=true。**更正**：代理最初误读恢复后的截图，错误报告为再次缺失；用户指出恢复后没有消失，重新检查原图也确认两张图均有 Dolphin。两图中 Dolphin 内部采样区的白色像素均为4199631/4200000，支持用户观察。整个 A/B 的 workspaceId、Bridge generation=330、focusedUuid、Native epoch=27、cameraX=1060 均未变化。没有切换工作区、注入 H/L、移动或激活窗口，也没有停止 CC-Niri。

证据为 `/tmp/cc-niri-hidden-live/corners-ab/{before,off,after,summary}.json`、`corners-off.png`、`corners-restored.png`。目前确认的是圆角效果重载能暂时恢复窗口，不能声称“启用圆角必然立刻隐藏”，具体 shader / 缓存 / 重绘归因仍未确认。用户随后又报告多次 J/K 后再次消失，进一步将疑点集中到切换生命周期中的过期绘制状态。圆角效果已恢复，本次没有部署新的修复，原始实机问题仍 **FAIL / 待修复**。

诊断脚本首次仅在读取 loaded 布尔值时解析失败，在任何卸载前退出；修正 GVariant 布尔解析后上述完整 A/B 成功。未遗留诊断服务或持续截图。

## 后续定位：透明内容进入圆角离屏缓存

新增 `workspace-visibility` 私有场景，使用完整生成入口、150% 输出、左侧带服务端装饰的静态测试窗口（2/3）、右侧无边框窗口（half），复制现场圆角参数并逐次检查窗口内部最终 framebuffer 像素。只改测试工具，不改或部署生产代码。

### 实验与结论

1. **工作区往返复现**：`/tmp/cc-niri-workspace-visibility-rounded-repro-v2/report.json` 中第6次返回，左窗两个内部采样点从预期 `#994499` 变为背景 `#000000`，右窗仍为预期 `#32a060`，Native source 仍 valid=true。此轮报告为 INCONCLUSIVE（旧探针对断言异常的默认分类），具体像素断言确实失败；不能把11项前置检查通过算成整轮PASS。另一次12轮正常返回，24/24 PASS，说明工作区时序复现仍具有偶发性。
2. **拆分 opacity 与客户端内容重绘**：在私有窗口上设置 opacity=0，明确让客户端重绘一次，再恢复 opacity=1，不改工作区 / 几何 / 焦点。窗口仍透明；再次让客户端重绘一次后，内容立即出现。最终证据 `/tmp/cc-niri-workspace-visibility-final-diagnosis/report.json`。
3. **圆角关闭负对照**：仅在同一私有 KWin 关闭圆角，执行相同 opacity 0→1 序列，恢复为1后窗口内容正常，无需第二次客户端重绘；finally 恢复私有圆角效果。
4. **诊断预期失败**：最终报告 **FAIL，15/16**，唯一失败断言为 `opacity_restore_refreshes_cached_pixels=false`；`client_damage_restores_cached_pixels=true`、`without_corners_opacity_restore_refreshes_pixels=true`、安全 stop confirmed。保留失败作为待修复回归，不能改成PASS。opacity恢复前后 Native epoch=7、cameraX=1060、frame均相同，source均valid=true。

这确认了一条与现场一致的缓存失效缺口：脚本的透明准备态可以进入圆角的离屏纹理，恢复平台 opacity 本身不足以刷新该纹理；静态客户端不再提交内容时，透明结果可以持续保留。重载圆角会重建离屏状态，所以恢复后并不必然立刻复发；之后J/K再次触发透明准备态，仍可能重现。H/L能够恢复与重新配置 / 客户端 damage 更新缓存相容，不能假定每次H/L都一定产生相同底层事件。

对应平台代码支持这条机制：[KWin 6.7.5 OffscreenEffect](https://github.com/KDE/kwin/blob/v6.7.5/src/effect/offscreeneffect.cpp) 的 `OffscreenData::maybeRender()` 将窗口绘入纹理并清 dirty，`handleWindowDamaged()` 负责重新置dirty；[WindowItem](https://github.com/KDE/kwin/blob/v6.7.5/src/scene/windowitem.cpp) 的 `updateOpacity()` 只更新Item透明度；[ItemRendererOpenGL](https://github.com/KDE/kwin/blob/v6.7.5/src/scene/itemrenderer_opengl.cpp) 的 `createRenderNode()` 将Item透明度乘入绘制节点。私有像素对照证明的是可观察机制，未向真实KWin注入逐帧诊断以声称精确捕捉了现场某一帧的纹理内容。

### 工具验证及边界

- **PASS**：Python语法检查、`git diff --check`；新增截图名称最初含数字，被既有fixture的字母白名单拒绝，已修正调用，不放松fixture限制。
- **PASS**：`node test/stability-probe-isolation.test.js`，5/5；受限沙箱首次阻止spawnSync，允许隔离子进程后同一测试通过。
- **PASS**：`node tools/check.js`，296项、124文件，约94.8秒。最后只增加了两次只读Native source证据记录，之后重跑最终私有场景、Python语法与whitespace检查。
- 试验过20轮版本，超过私有客户端40秒寿命，未形成有效报告；缩至12轮后正常完成。该超时不计为生产故障，也不计为PASS。
- 本轮没有修改或安装新的生产修复，没有再次切换真实桌面的圆角效果。Rust / Native / FFI / CMake未改，完整Native门禁 **NOT RUN**。下一步修复应处理恢复可见性时的离屏内容失效或隔离透明准备态，不能用持续重绘或逐帧强制damage代替。
