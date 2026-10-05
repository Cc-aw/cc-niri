# Focus Ring Phase 4：Retarget

日期：2026-10-05。实现与自动验证完成；本阶段新库已独立部署并启用，自动加载 / off-on 与运行健康检查通过，三轮主屏人工实机验收全部通过。Phase 4 完成。

依据：[实施计划](../doc/todo/cc-niri_Focus_Ring_Phase4_Retarget_实施计划.md)与 [Focus Ring 设计第 37 节](../doc/todo/cc-niri_Focus_Ring_实现设计.md#phase-4--retarget)。

## 实现与发现

本阶段复用生产 Spring 的连续 retarget、反向与最后实际绘制位置接管，不新增 Ring 动画、时钟或布局状态。

新增回归发现一个绘制树生命周期缺口：一个 paint 回调捕获旧 owner 的快照后，若后续工作使焦点离开再返回同一窗口，或关闭再开启边框，旧 owner 指针仍等于当前 owner；原检查因此允许旧快照画到新建的边框树上。这是自动回归暴露的边界，未据此声称用户实机上已经观察到该异常。

修复前 `focus-ring-isolated-paint` 失败：

```text
FAIL returning to the same owner cannot revive a frame from its previous attachment
```

日志：`/tmp/cc-niri-phase4-before.log`。

修复职责：

- `FocusRingPaintFrame` 新增当前 isolated paint root 的 `QPointer` 作为 attachment 标识，与源 Item 一起在本次 paint 调用内捕获。清理绘制树时标识自动失效；即使新树复用同一内存地址，也不会恢复已失效的弱引用。
- `FocusRingItem::paint()` 同时核对源 owner 与 attachment。旧 owner 的树被清理、焦点离开又回来、off/on 或 owner 销毁后，旧快照不能绘制，也不调用 renderer。
- `FocusRingEffect` 在已有捕获入口传入当前 paint root。没有新增协议、DBus、timer、日志、Spring 状态或动画速度规则。
- 同一 owner 的正常 attach / 几何提交仍复用 paint root，因此同一次绘制调用的有效快照不会因 retarget 或原生位置更新而失效；矩阵、clip 和 opacity 仍采用该调用捕获的窗口视觉数据。
- 现有 3px、#7FC8FF、圆角适配与四侧描边余量保留；布局、frameGeometry、输入区域、JS controller、Native Clip 和 Bridge 源码没有改动。

## 自动验证

新增 `focus-ring-retarget`，只在测试目标中组合生产 `ScrollViewportRuntime` / `ViewportMotion` / `Spring`、真实 KWin Item、Ring Item / PaintFrame 与共享 viewport clip。Ring 插件本身没有链接 Spring。

- 主序列为 `L L H L H H`，另测其镜像 `H H L H L L`；每种方向在 1 / 1.25 / 1.5 / 2 设备 scale 下执行，主序列共 48 个 SCROLL plan。新增组合共检查 1468 个边框绘制样本。
- 每段在 0 / 7 / 20 / 40ms 取样；新输入发生在上次实际绘制之后、下次绘制之前。检查新 epoch 接管前后的 source 和 target 几何、真实位置连续性及旧 epoch 的迟到取消。
- 覆盖 incoming / continuing / outgoing 的角色变化、未结束 outgoing 保留、最终完成与取消、旧完成尚未清理时的反向接管。
- 覆盖尚未收到上段几何提交的新输入，以及 `retargetOnly` 的等逻辑 offset 返回；不把已提交目标坐标当成上次视觉位置。
- 在模拟同一 paint 回调的后续工作中 arm 新 plan、提交位置并更新原生 opacity，确认有效 attachment 的旧局部快照仍严格对应已经绘制的窗口帧；下一次调用则捕获新的视觉数据。
- 每个样本严格比较 Ring 与源窗口交给捕获 renderer 的原生矩阵、mask、device clip 和叠加 opacity；边框保持独立浅蓝材质，窗口实际几何不被绘制代码修改。
- 四侧描边在视口边界处保留所需余量；完全停放的边框仍被裁剪。检查模拟焦点切换后的旧 damage marker 与余量清理。
- 滚动仍 active 时切换 workspace context，并显式执行 Ring 清理，再返回并启动新段；关闭当前 scene owner 后，窗口与 attachment 弱引用同时失效，剩余窗口继续可绘制。此项验证原生模块组合，不替代真实 KWin desktopChanged / focus 信号链的实机检查。
- Spring 位置连续性使用生产 double projection 检查，误差限制 1e-8；KWin 的 WindowPaintData / QMatrix4x4 使用 float，source / target 提交矩阵最大差为 0.000244141，限制 0.001。Ring 与同一窗口帧的矩阵仍要求严格相等。
- 扩展 `focus-ring-isolated-paint`，确认 owner 离开再返回、off/on、缺失 attachment、真实 scene owner 销毁时的快照保护。旧的透明帧、独立颜色、原生透明度、非等比 scale 与销毁回归继续通过。

验证结果：

| 检查 | 结果 | 日志 |
| --- | --- | --- |
| Ring 插件及全部测试构建 | 通过 | `/tmp/cc-niri-phase4-build-final.log` |
| Ring 全部 9 项 CTest | 通过 | `/tmp/cc-niri-phase4-ring-tests.log` |
| Native Clip 全部 4 项 CTest | 通过 | `/tmp/cc-niri-phase4-clip-tests.log` |
| `node tools/check.js` | 85 项 JS、生成包一致性、whitespace 通过 | `/tmp/cc-niri-phase4-js-tests.log` |
| 多段绘制样本统计 | 1468 个样本通过 | `/tmp/cc-niri-phase4-samples.log` |

这些检查不创建 GL context，不证明实机最终像素、圆角与动画视觉体验；分数 scale 参数检查也不代表 Phase 6 已通过验收。

## 部署与三轮主屏实机验收完成

本阶段仅更新 Ring 原生库。沿用 immutable 安装器，保留当前已验收库，独立重载 Ring；安装 hash 以 staging 后产物为准，不能直接与构建树库的 RPATH hash 混用。

- 为准确核实桌面实际加载的新代码，将只读诊断 phase 更新为 `retarget`，新增 `frameLifetime=scene-attachment`。补充诊断后重新构建并通过全部 9 项 Ring CTest，日志 `/tmp/cc-niri-phase4-deploy-build.log` / `/tmp/cc-niri-phase4-deploy-tests.log`。
- 新 canonical：`~/.local/lib/cc-niri/focus-ring/25ee5607e3b26b138cfa7e76244e8633b1fafd70e51d4160ae2c5265a1ec3239/cc-niri-focus-ring.so`。discovery link 和安装产物 SHA256 与该 canonical 目录一致；旧 `7874eef7711ee3d80c06d054af214cdfb9e0130466b3168922305cad27a4ce59` 版本保留。
- 运行中的接口返回新 phase 与 frameLifetime，width=3、color=#7FC8FF、cornerRadius=12、cornerSource=round-corners。第一次加载 active=true、eligibleCount=5、generation=390、drawCount=1，说明新版本已实际进入边框绘制。
- 自动调用已安装的独立 `cc-niri focus-ring off` 后，effect 卸载且 endpoint 消失；`on` 后重新加载，资格名单恢复为 generation=391，active=true、drawCount=1。运行接口和偏好均恢复开启。此项只验证开关与加载生命周期，像素残留仍由人工确认。
- 部署与自动开关检查前后 KWin PID 均为 2057。审计日志未发现新增 TypeError / ReferenceError / SyntaxError / KCrash / Segmentation fault / ASSERT failure；没有重启 KWin / Plasma。
- 布局 Script、动画 Effect、Native Clip 库及 CLI 的安装 SHA256 前后相同，布局与相关效果继续加载，Bridge active。没有重新部署它们，也没有修改用户的阴影配置。
- 部署脚本 `/tmp/cc-niri-focus-phase4/deploy.py`；日志 `/tmp/cc-niri-focus-phase4/deploy.log`。备份 `/tmp/cc-niri-focus-phase4-backup-20261005-ty0x64qq`，含旧 canonical、kwinrc、`before.json`、`commands.json`、`result.json` 与 `kwin.log`，部署失败会恢复旧 discovery link、开启偏好与旧库。本次部署成功，无需回滚。

按下面的三轮主屏检查记录用户反馈：

1. 至少 3 个半宽窗口，从最左窗口快速 `Meta+L、L、H、L、H、H`，再交替 H/L。边框仅属于当前窗口，贴合移动，四侧同步出现，无闪烁、错位、消失或旧位置残留。
2. L 开始滚动后立即 J，稍后 K 返回；再在滚动中切换焦点或关闭一个临时受管窗口，检查边框归属及清理、内容点击正常。
3. 独立 `cc-niri focus-ring off` / `on` 无残留并能恢复；静止后没有持续重绘或刷日志，KWin 没有崩溃。

本阶段三轮人工反馈独立记录，不使用此前 Phase 3 或描边修复的通过状态代替。Wide / Maximize 留给 Phase 5，主屏像素对齐与清晰度留给 Phase 6；双屏不是当前前置条件。

人工进度：

- 第一轮通过：用户反馈“正常”，确认快速连续 H/L 与交替反向时边框贴合、四侧及时出现，无闪烁、消失或残留。反馈后诊断仍为 retarget / scene-attachment，KWin PID 保持 2057；审计 `manual-round1.json`。
- 第二轮通过：用户反馈“全部正常”，确认滚动中 J/K 往返、焦点切换 / 临时窗口关闭时边框唯一归属、清理、裁剪及内容点击正常；反馈后 KWin PID 仍为 2057，审计 `manual-round2.json`。
- 第三轮通过：用户反馈“全部正常”，确认独立 off 关闭无残留，on 后 3px 浅蓝边框、圆角及四侧描边正常恢复，静止时没有闪烁；审计 `manual-round3.json`。

最终检查：KWin PID 仍为 2057，新库仍加载，布局 / 动画 / Clip / Bridge 均健康；相关安装文件 SHA256 保持部署前值，完整 `final-kwin.log` 未发现上述新增异常。备份 `result.json` 的 manualStatus 已更新为 passed。下一阶段为 Phase 5 Presentation。
