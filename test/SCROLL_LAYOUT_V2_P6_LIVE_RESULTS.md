# Scroll Layout V2 P6：准备与实机验收

日期：2026-10-16；基线 `8056cfe6b4a023ac8dcbfb01e4495a5acf4c2c4e` 加现有 P0–P6 未提交工作区。

**状态：已于2026-10-16经用户“开始部署”明确授权完成部署并开启 V2，启动核验 PASS；真实交互/性能/资源验收仍 PENDING，不能标记 V2 READY。** 源码默认开关仍关闭，本机配置已开启。准备阶段的离线、备份与 dry-run 记录保留在下文；本次部署记录见最后一节。

## 已实现

- V2 安全 stop 使用瞬时恢复证明：本次 CLI commandId/live session → JS Native ownership 退休 → 所有释放窗口的真实几何/透明度/最小化确认 → Bridge restored → 卸载。旧状态、错误 session/requestId、未确认取消、客户端超时均不能放行。3500ms 事件等待只在恢复时存在，完成/关闭/超时清理连接和引用；不新增生产动画时钟。
- Bridge 的恢复状态不写入 `workspaces.json`，session 变化/进程重启清除；终态必须在匹配 pending 后报告。旧 V1 保留旧停止路径，开启 V2 却没有匹配证明的组合拒绝卸载。
- `tools/scroll-layout-v2-p6.py prepare/verify` 冻结源码、三个 Native 产物、构建缓存、完整原安装包、配置/快捷键/快照与 rollback；候选安装校验通过后复用已测产物。当前仓库、完整源码集合、产物、缓存、用户前缀任一变化都拒绝候选安装。
- rollback 默认 dry-run，执行模式先安全 stop，再恢复原 immutable Native 链接及配套完整组件/配置/布局。备份在私有目录，不提交用户配置。恢复会替换试用期间的新配置/布局。
- 复用现有 10s Scroll/3s Workspace 有界 capture；离线统计转场呈现 P50/P95/P99/max、≥25ms 和33–50ms。内存采样可附固定负载 context；缺 B0、PSS、同负载/同环境证明时标 INCONCLUSIVE，不以 RSS 替代。
- README、设计索引与 [P6 操作单](../doc/SCROLL_LAYOUT_V2_P6_RUNBOOK.md) 明确 V1/V2 差异、H/L、两次点击和 Fcitx5、开启顺序及验收范围。

## 离线与隔离验证

最终证据索引：[validation.json](scroll-layout-v2-p6-evidence/20261016/preparation/validation.json)。源码、三个二进制、构建缓存 SHA 由该记录冻结，私有备份不进入仓库。开发期记录不充当最终验收。

| 检查 | 结果 |
| --- | --- |
| 生成包一致；完整 JS 回归 | PASS，118个测试文件、229项 |
| Rust1.99.0 fmt / locked clippy / locked workspace test | PASS，109项 |
| `node tools/check.js --native` | PASS，Bridge/Clip/Ring/Plasmoid、Golden、FFI、生产符号边界、私有 DBus |
| Bridge / Clip / Ring CTest | PASS，18 / 18 / 25项 |
| 新恢复证明模型与 CLI 失败门禁 | PASS，真实 frame/visibility 延迟、关闭/超时释放、Native-before-client、未知取消、stale token/session 与拒绝卸载 |
| 候选包/安装/离线分析 | PASS，篡改、未验证、异仓库、cache/源码集合漂移拒绝；候选安装不重新构建；rollback 默认 dry-run；缺失/截断数据不标 PASS |
| 完整 main 私有 KWin 100% / 150%＋Fcitx5 | PASS，34/34、37/37；[100%](scroll-layout-v2-p6-evidence/20261016/preparation/isolated-100/report.json)、[150%＋Fcitx5](scroll-layout-v2-p6-evidence/20261016/preparation/isolated-150-fcitx5/report.json)；不替代真实 GPU 与 mixed-DPI |
| Core / FFI / Rust / CMake 与 P5 比较 | 无新增改动；P5 Debug/Release Core各13、umbrella30、OFF/编译器拒绝路径及Golden证据继续适用于未变核心，见 [P5](RUST_NATIVE_R7_SCROLL_LAYOUT_V2_P5_RESULTS.md) |
| 用户安装组件 SHA 对照、候选与回滚 dry-run | 由最终 validation 和私有 manifest 记录；不执行桌面恢复 |
| 用户桌面部署 / V1→V2启动 | PASS，既有安装入口完成；新 Native 实际加载路径与恢复协议匹配；KWin PID未变 |
| 用户桌面 V2 安全stop全矩阵 / 完整 rollback执行 | PENDING / NOT RUN；私有 V2 stop 与真实 V1停止不替代全矩阵 |
| 4K60 / 双屏 mixed-DPI / 30–60min / PSS预算 / GPU | NOT MEASURED / PENDING |

私有场景在同一完整生成 main 上覆盖 R/F、H/L、Z、Fullscreen、最大化、Dialog、J/K、工作区迁移、V2→V1→V2、Ring 和副屏 framebuffer。最终 CLI stop 前人为构造一个真实离屏且最小化的受管窗口，要求恢复数量≥1；确认本次恢复证明匹配、脚本与两个 Native 插件卸载、私有 KWin 继续运行、持久快照无 ACK。私有快捷键唤醒由 fixture 驱动，真实桌面 KGlobalAccel 投递仍待验证。

## 真实验收矩阵

以下状态仅指用户桌面；此前模型和私有场景的通过范围另见 P0–P5 与本报告，不能代填。

| 设计项 | 真实桌面结果 |
| --- | --- |
| V2-01…09 单列、宽度、gap、partial、R/F | PENDING |
| V2-10 快速 H/L 与反向 | PENDING |
| V2-11…13 两次点击、左右输入、Fcitx5/菜单/Dialog | PENDING |
| V2-14 Ring / glow 输出裁切 | PENDING |
| V2-15…17 途中关闭、ACK、重排列 | PENDING |
| V2-18…19 J/K、数字直达/移动、工作区恢复 | PENDING |
| V2-20…21 mixed-DPI 双屏与比例规则 | PENDING |
| V2-22 Fullscreen / 浮动 / 最大化 | PENDING |
| V2-23 安全启停、Bridge离线、卸载 | PENDING |
| V2-24 V1/V2与protocol1/2往返 | PENDING |
| V2-25 逐转场 V1/V2 4K60 | NOT MEASURED |
| V2-26 全项目资源与30–60min | NOT MEASURED |
| V2-27 5000次模型取消 | 既有离线证据 PASS；不作为桌面/内存结论 |
| V2-28 V1 Pair / Focus Wide | PENDING |

Scroll 统计工具以相机数值完成帧为窗口终点，不证明客户端最后一帧已呈现；presentation 未与确切窗口 paint 关联。MEASURED 不等于流畅度 PASS。内存工具仅计算受控 idle 中位差，动画峰值、长期正斜率、Qt/Scene/纹理和 GPU 归因仍须补证；整体 M0–M3 未转为 PASS。

## 交付与下一步

候选部署及完整恢复命令见操作单。实际私有候选路径与只读环境观察摘要由 [preparation-summary.json](scroll-layout-v2-p6-evidence/20261016/preparation/preparation-summary.json) 记录。候选已安装；后续若源码/产物/配置变化，重部署前刷新验证记录、候选与备份。

下一步为功能实机验收，通过后再安排固定负载 V1/V2 帧对照、B0基线及长测。安全/input/副屏/快照污染 FAIL 阻止继续放量。保留已安装稳定版与配套快照，不强杀 KWin、不关闭用户应用。

## 2026-10-16 经授权部署

用户明确指令“开始部署”后，先保存旧版实时布局，刷新十项完整组件/配置/快照备份到 `/tmp/cc-niri-p6-20261016-deploy`，再次验证原535文件候选、三个产物、缓存和 rollback dry-run。

`./install.sh --prepared-manifest /tmp/cc-niri-p6-20261016-deploy/manifest.json` 退出0；沿用既有 stop / immutable install / start，先在 V1 启动。确认新 Bridge 发布 live session，Clip/Ring `binaryPath` 均为新 immutable canonical 路径，再执行 `./cc-niri stop` → 写 `ScrollLayoutV2Enabled=true` → `./cc-niri start`，全部退出0。

只读启动核验 PASS：脚本已加载且开机启用、Bridge active、Clip/Ring已加载；partial enabled/two-click、COLUMN_GEOMETRY protocol4/painted-client-frames、生效的真实 geometry source，以及与 Bridge live session 一致的 recovery running。KWin PID前后均2075，未重启 KWin或关闭应用；本次 KWin日志未发现 JS TypeError/ReferenceError/SyntaxError及恢复阻塞条目。安装后的三个 Native 二进制通过生产边界检查；Script/Effect/CLI与候选 SHA一致，Native安装后的RPATH调整与immutable路径/hash另记，未将安装SHA与构建树SHA混同。

完整机器记录和组件SHA见 [deployment.json](scroll-layout-v2-p6-evidence/20261016/deployment/deployment.json)。配置、窗口数据、运行状态和原始日志保存在私有备份目录；回滚入口为该目录的 `rollback.sh`，默认dry-run，`--execute`恢复部署前完整配置/布局。尚未执行完整回滚。

本次没有注入 H/L、R/F或J/K来操作用户窗口，没有启动持续capture或内存长测。V2-01…28中的交互、V2安全启停完整矩阵、视觉、4K60、PSS/Private_Dirty/GPU与30–60分钟仍按上表 Pending/NOT MEASURED。启动成功不等于P6完成。部署后文档状态已更新，因此原冻结候选只对应部署时版本，后续安装需刷新校验记录。

## 实机后续：顶栏覆盖与150%客户端ACK修复

部署后用户报告顶部被面板遮挡，诊断确认51px可见Plasma顶栏没有预留WorkArea。补充真实可见边缘dock避让后，实机又暴露VS Code将1357高回报为1357⅓导致bootstrap超时；最终对纵向可用区域按整数逻辑/设备网格向内对齐，不放松严格ACK。修复版已安全部署，真实frame和painted frame均y=68/high=1356，Native completed且恢复running，KWin PID未变；最终233项JS、37/37私有150%+Fcitx5、8/8真实几何/启动核对通过，最终启动日志无脚本异常或再次超时。详见[专项修复记录](SCROLL_LAYOUT_V2_PANEL_FIX_RESULTS.md)。

用户主观视觉确认与其余功能/性能/资源矩阵仍Pending。真实V2 safe stop在修复安装过程中成功执行，完整Bridge离线/卸载/恢复矩阵和整套回滚仍未验收。原稳定V1与各次配套备份保留。

## 历史状态：仅顶部间距调整曾被恢复确认阻止

用户要求只缩小顶部，新独立配置ScrollLayoutTopGap=8已实现，统一ScrollLayoutGap仍16；235项JS与37项私有KWin回归通过。但实际重载的恢复确认失败，当前旧运行时blocked且布局暂停，未卸载组件或绕过ACK。仅将新脚本包安装到磁盘，待用户保存工作并正常注销登录后生效/核验。见[顶部专项记录](SCROLL_LAYOUT_V2_TOP_GAP_RESULTS.md)。旧启动PASS和顶部修复PASS仅代表前次运行阶段，不能作为当前新配置已生效的证据。

## 最新状态：仅顶部间距已热重载生效

用户明确批准逐窗核对替代本次失败的自动恢复ACK后，完成新鲜窗口/Native审计并仅替换Script，新session恢复running。真实frame与painted y均60、高度1364、底边1424，列宽模式及其余gap16保持；顶部8已生效，不需要注销。KWin/Bridge PID不变，Native插件未重载，原自动恢复失败保留为FAIL历史，重试锁死问题未修复。见[顶部最终结果](SCROLL_LAYOUT_V2_TOP_GAP_RESULTS.md)。主观视觉与全P6性能/资源矩阵继续Pending。

## 用户确认与存档

2026-10-16，用户在仅顶部间距8生效及热重载后确认“没有问题 git存档”。当前顶部留白与重载后目测验收PASS，见[顶部记录](SCROLL_LAYOUT_V2_TOP_GAP_RESULTS.md)。P6完整交互/性能/资源矩阵仍保持原Pending/NOT MEASURED，自动恢复永久锁住重试缺陷仍开放，本次Git存档不宣称V2全部完成。
