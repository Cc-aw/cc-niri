# Pair→Wide 动画中切换工作区的邻窗重叠修复

日期：2026-10-05；2026-10-06 更新。状态：第一版提前停放消除了重叠，但用户反馈窗口 2 瞬间跳到 72%、窗口 1 提前消失；第二版保留离开时的动画采样已实现、通过门禁并部署，用户于 2026-10-06 确认“成功修复”。下面先记录第一版历史，第二版见文末。随后报告的双屏联动与帧率问题单独处理。

## 反馈与原因

用户在 R6 实机验收中反馈一般功能正常，但 `1|2 → 2（72%）` 动画途中按 J，旧工作区先变成 `1（50%）|2（72%）` 的重叠画面，再滑向下一工作区。本问题阻止将 R6 记为完整实机验收通过。

Pair→Wide 的目标窗口已提交真实 72% 几何，普通邻窗暂时保留原来的 50% 位置，靠 Script Effect 的 translation / opacity 移出并淡出。工作区离开路径调用 `ContextualWideCoordinator.cancel()`，直接报告 MotionParked；随后工作区 Effect cleanup 清除动画与透明 hold。此时邻窗尚未真正停车，原始 Pair 几何被重新暴露。问题位于既有 JS 工作区取消交接路径。

## 修复

`onPlanCommitted()` 保存已提交 Pair→Wide 快照里的邻窗最终 parking item。工作区取消改为 `cancelForWorkspace()`，在 Wide owner 和邻窗仍属于当前逻辑工作区时，通过既有 `GeometryCommitter` 先提交 offscreen parking / opacity / minimized 状态，再释放 motion marker / hold、取消定时器并切换工作区。此边界提交不重新启动展开动画，不依赖已被 workspaceSwitching 隔离的普通 relayout；旧工作区呈现已提交的 Wide 布局。

没有收到几何 handoff ACK 时不生成 parking item，因此取消未提交计划会保留真实 Pair 几何。普通工作区内的展开动画、正常完成后的延迟 parking、Wide→Pair、Spring / Rust runtime / Native protocol 保持原路径。模块改动位于 `src/`，使用 `node tools/build.js` 生成包；包中手写 composition 只补充 parking 回调与工作区取消调用。

## 自动验证

新增 `workspace-wide-departure.test.js` 运行实际布局 bundle，覆盖左右 owner、已提交 / 未提交 ACK、J / K / 原生 desktopChanged、被拒绝的桌面请求、迟到 ACK / timer / completion、返回 Wide 和几何不变量。测试在 ReportMotionParked 的交接点记录真实几何与 opacity，防止目标工作区挂载掩盖缺陷。

修复前失败：`park neighbor before releasing its visual isolation: 1 !== 0`，日志 `/tmp/cc-niri-wide-departure-before.log`。修复后通过。

- `node tools/check.js`：全部 **86** 项 JS 回归、生成包与 whitespace 检查通过。
- `node tools/check.js --native`：86 项 JS、Rust fmt / clippy / **26** 个单测、Bridge **5** 个 CTest / **3** 个隔离 D-Bus 集成、Clip **16** 个 CTest、Ring **23** 个 CTest及 Plasmoid 构建全部通过。
- Release Native Core CTest：**12/12**，包括保留的 Spring / Motion / Scroll / Ring / Native Protocol C++–Rust 差分，无失败。
- 当前全部 Rust 生产开关 ON 的 `build/native-r6-on` CTest：**27/27**，原有 Scroll / Ring / workspace 组合检查通过。

日志：`/tmp/cc-niri-wide-departure-check.log`、`/tmp/cc-niri-wide-departure-native-check.log`、`/tmp/cc-niri-wide-departure-differential.log`、`/tmp/cc-niri-wide-departure-r6-ctest.log`。

## 实机加载与回滚

只更新安装的布局脚本，沿用 save-state / cc-niri stop / 更新脚本 / start 流程。当前 Script、动画 Effect、Clip、Ring 与 Bridge 均正常加载；两个 nativeProtocolBackend、Scroll Runtime / decoration geometry 与 Ring Core 仍为 Rust。KWin PID 前后均为 **2083**，当前 workspaceId、focusedUuid、列顺序与宽度状态保存一致，Ring 用户偏好保持一致。

安装脚本 SHA-256：`e5582719e42d92d1e43233df125f067e4042efc009644acb15fc99a0c6a54816`，与生成源码一致。Bridge、动画 Effect、Clip / Ring immutable library 与 CLI 安装 hash 未变。加载后 TypeError、ReferenceError、SyntaxError、INVARIANT_FAIL、FAIL_SAFE、mount failed、KCrash、Segmentation fault、ASSERT failure、Rust panic、native fallback、completion timeout 计数均为 0。加载正常不等于画面复验通过。

备份与命令审计：`/tmp/cc-niri-wide-departure-20261005-ki772qjn`；包含旧脚本、kwinrc、workspaces.json、加载前后状态、日志和回滚脚本。部署脚本 / 日志：`/tmp/cc-niri-wide-departure-deploy.py` / `/tmp/cc-niri-wide-departure-deploy.log`。

```sh
python3 /tmp/cc-niri-wide-departure-20261005-ki772qjn/rollback.py
```

脚本 stop 恢复 parked windows，恢复备份布局脚本，再 start；保留 R6 Rust 插件。`/tmp` 备份可能随重启清理。本次不创建 commit。

人工待复验：原 `1|2 → 2（72%）` 动画中按 Meta+J，Meta+K 返回，以及反向切换；确认原工作区没有邻窗重叠、返回保留 Wide，正常展开 / 收回与 H/L 仍正常。未收到修复后的反馈，不将其记为实机视觉通过。

## 第二版：保留中途画面，滑出后再停车

第一版部署后，用户反馈：“现在能看到2瞬间变为72 然后滚动下去 看不到之前的1了”。第一版把物理 parking 放到切换前，仍在 desktopChanged 清掉展开动画，消除了重叠，但提前呈现了展开终点。因此第一版不记为视觉验收通过。

当前工作区切换路径保留真实 Pair 邻窗，取消正常 finalize timer，将已提交的 parking item 转交给独立、有限重试的离开记录。通过已有 `WorkspaceTransitionActive` 查询 compositor，只有状态明确为空闲、源工作区已经休眠、窗口仍存在且归属 / output / managed eligibility 有效时，才提交 parking / opacity / minimized。返回原工作区、移动 / 关闭 target 或 neighbor、floating / fullscreen / output 变化及停止恢复会撤销旧记录或使旧回调失效。迟到查询不能再次停车。查询不可用时不猜测空闲，最多重试 60 次，之后保留到 hydrate / recovery 处理。

Script Effect 的 WorkspaceEffectGuard 在 fullscreen workspace effect 活跃、源窗口不在当前桌面时，用 KWin `freezeInTime` 保留既有 Pair/Wide 动画组；MotionSampler 查询同一个 frozen elapsed。宽度、translation、scale 和邻窗 opacity 在纵向滑动期间保持离开时的采样，迟到 animationEnded 不报告 Wide completion。Slide 空闲信号、快速返回或窗口关闭会清理冻结状态；已完成的 Wide opacity hold 也按相同工作区生命周期保留 / 释放。普通 SCROLL 仍使用原清理路径。

Native Adapter 只处理平台裁剪生命周期：desktopChanged 保留正在滑出的 Wide clip，仍清除旧 motion authority / completion 和普通 SCROLL；纵向 paint translation 同步移动 source viewport clip，Slide / 返回结束后由 Effect 清除。增加只读 `workspaceDepartureVisual=freeze-wide-until-compositor-idle` 诊断，用于确认实机加载新插件。Rust Core、Spring 参数、Scroll / Ring authority 和 wire schema 未修改。使用的 API 已对照本机 KWin headers 与 [KDE scripting API](https://develop.kde.org/docs/plasma/kwin/api/) / [KDE AnimationEffect 源码](https://raw.githubusercontent.com/KDE/kwin/master/src/effect/animationeffect.cpp)；不新增 compositor 时钟或第二个 layout authority。

新增 `workspace-wide-pose.test.js` 在实际 Effect bundle 上测试左右 anchor、20 / 80 / 180ms 中断，检查中断前后完整 visual rect 与 opacity 相同、滑动 1 秒后仍保持、迟到 completion、滑出清理与快速返回。第一版在该测试中失败：`freeze existing KWin channels instead of cancelling to 72%: 0 !== 2`，日志 `/tmp/cc-niri-wide-pose-before.log`。更新的布局回归覆盖 parking 等待 active / idle、未提交 ACK、拒绝请求、返回、移动、关闭两侧窗口、停止恢复和过期回复；原 Wide 返回与 Effect 清理测试保留。

最终验证：**87 项 JS** 回归通过；固定 Rust fmt / clippy / **26** 个单测、完整 `node tools/check.js --native`、Bridge **5 CTest / 3 隔离 D-Bus**、Clip **16 CTest**、Ring **23 CTest** 和 Plasmoid 构建通过。Release Core **12/12**（包含全部 C++–Rust 差分），当前全部 Rust ON 的 R6 native **27/27** 通过。Native 门禁后补充了 JS window lifetime preflight，最终 JS 门禁再次通过；无 Rust / FFI / CMake 改动。日志 `/tmp/cc-niri-wide-pose-{native-check,js-check,differential,r6-ctest,build}.log`。

UTC `2026-10-05T14:33:28.148112+00:00` 已配套部署布局脚本、动画 Effect 和新 immutable Clip。KWin PID 前后均为 **2083**，未重启 compositor；workspaceId、focusedUuid、四列顺序 / 宽度与 Ring 用户偏好一致。Bridge、Ring library 和 CLI hash 保持一致，全部 Rust backend 与新 `workspaceDepartureVisual` 诊断已在运行中核验。加载后前述异常项与新增 parking idle check unavailable 计数均为 0。用户于 2026-10-06 确认“成功修复”，计为本问题的画面复验通过；不据此扩展到双屏与帧率验收。

| 已安装组件 | SHA-256 |
| --- | --- |
| 布局脚本 | `f14e826b60d3f14ddd8cf6d6f5193369efb2310d3cd9d85eeddd4cc6cef39aa7` |
| 动画 Effect | `66bda22ea31b94b28ddffd79eb5ab6583e8e539ba126482fa72ec9dbbf42f86e` |
| Clip | `4223816df1a74496e655b32c3f3ff482114b22a9c1b092447677c5d8da6ba1fc` |

Clip canonical：`/home/cc/.local/lib/cc-niri/viewport-clip/4223816df1a74496e655b32c3f3ff482114b22a9c1b092447677c5d8da6ba1fc/cc-niri-viewport-clip.so`。沿用 immutable install 与 save-state / stop / start 路径，没有覆盖 KWin 已映射的 library。受保护的 process maps 限制仍适用，使用加载诊断 / hash / canonical link 验证。

备份 `/tmp/cc-niri-wide-pose-20261005-i5cm88y2`，指针 `/tmp/cc-niri-wide-pose-live-path`；包含两个旧脚本、旧 Clip canonical、状态、配置、日志与命令审计。部署脚本 / 日志：`/tmp/cc-niri-wide-pose-deploy.py` / `/tmp/cc-niri-wide-pose-deploy.log`。

```sh
python3 /tmp/cc-niri-wide-pose-20261005-i5cm88y2/rollback.py
```

回滚恢复到第一版布局 / 原动画 Effect / R6 Clip `c29510b2…`；更早的完整 R5 / R6 基线也保留。`/tmp` 备份可能随重启清理。第二版由用户确认修复成功；双屏联动与工作区帧率另行记录，不推进 R7。
