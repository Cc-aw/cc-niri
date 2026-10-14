# R7 runtime — 副屏 Safe Area 工作区判断修复

日期：2026-10-12。首次修复时按用户要求跳过测试；随后用户明确要求补齐回归测试并完整运行 Native 门禁，后续结果见下文。

## 问题与范围

副屏窗口被主屏 `eligible()` 的当前工作区条件过滤。主副屏显示不同工作区时，副屏最大化请求、启动接管和重新应用布局跳过 Safe Area，窗口保持 KWin 原生最大化。

- 新增 JS `LayoutEligibility`，按 `window.output` 的当前桌面判断窗口归属。主屏继续等待自身 workspace mount；副屏不依赖主屏切换状态，仍受全局 enabled / stopped 和 WindowPolicy 控制。
- 主屏 Scroll / Column 接管的 membership 与 authority 保持原实现。
- Frame geometry 回调改用所在输出的 workspace 条件；待接管 Column 的几何处理仅作用于主屏，避免吞掉副屏 tile 恢复。
- 输出桌面变化时重新应用 managed layouts，接管启动时因副屏桌面不活跃而跳过的 native-maximized 窗口。
- 更新手写 runtime 入口与 bundle 清单，使用 `node tools/build.js` 生成模块段；没有手改生成模块。
- Native、FFI、Ring、动画参数和配置边距未修改。

## 首次修复时的检查与限制

- `node tools/build.js`：生成完成。
- `node --check package/contents/code/main.js`：语法检查通过。
- `git diff --check`：通过。
- 按用户明确要求，未新增或运行自动测试，未运行 `node tools/check.js` / Native 门禁，也未执行快捷键、跨屏、工作区、fullscreen / Quick Tile 的实机测试矩阵。下述现场读取仅用于确认安装结果。
- 没有性能 benchmark；新增资格判断使用既有工作区 / 输出数据，重新应用布局只在既有桌面变化事件中执行。

## 应用结果

备份：`/home/cc/.local/state/cc-niri/backups/secondary-safe-20261012-105855`。先保存 Bridge 当前状态，再 stop → `kpackagetool6 --type=KWin/Script --upgrade package` → start；只更新布局脚本，未替换 Native 插件。

- Installed main.js SHA-256：`94145022b0303d541afe6b445c4670763ebec251e4dac46769a7af73552a4869`，与仓库生成包一致，脚本已加载。
- KWin PID 2050 未重启；两屏桌面仍不同，主屏实际焦点与原窗口状态恢复。
- 目标副屏窗口从 `{x:2560,y:0,width:2560,height:1440}` 调整为 `{x:2584,y:24,width:2512,height:1392}`，四周各 24 logical px。
- 保存的全部 normal windows 中，安装前后仅该窗口 geometry 改变；其他窗口几何、minimized / fullscreen、桌面及实际焦点相同。

安装操作和现场读取在备份中的 `commands.json`、`original-windows.json`、`live/after.json`、`after-state.json`、`applied.json`。

## 后续回归补齐

本次仅修改测试夹具、增加回归测试并补充记录，没有修改生产 JS / Native / FFI，也没有重新部署或进行桌面操作。

- 复现 `workspace-runtime-guards.test.js` 的 `ReferenceError: layoutEligibility is not defined`。引入生产 `LayoutEligibility`，使用原有 WindowPolicy、WorkspaceMembership、appState 和共享 workspace mount 夹具构造实例并注入 VM；保留原来的 sticky / foreign workspace / floating / parking-release 检查。
- 新增 `secondary-safe-layout.test.js`，调用实际 runtime 的资格、最大化、还原、启动、frame geometry 和桌面切换函数。使用生产配置、输出拓扑、SafeArea 几何和 FullscreenController，而非重新实现布局规则。
- 7 个回归用例：副屏独立桌面与主屏 mount 未就绪；sticky / 多桌面 / foreign desktop / fullscreen / dialog / global disabled / stopped 排除；最大化信号取消 native maximize 并应用 24px gaps、再次请求还原最初普通几何；启动接管 native-maximized 副屏窗口；激活启动时跳过的副屏桌面；fullscreen 退出恢复 Safe Area 并保留 normal restore；native tile geometry reset 恢复边距；主屏 Column 继续委托 presentation authority。首个用例包含多项负向场景，总用例数为 7。
- 定向执行 `node --test test/workspace-runtime-guards.test.js test/secondary-safe-layout.test.js` 通过；直接执行新测试文件确认 7 / 7 PASS。
- 完整 `node tools/check.js --native`：PASS，使用根固定 Rust / Cargo 1.99.0 和既有 `/usr/bin/g++` GNU 16.2.1 构建树；四个构建树均显式配置该 C++ 编译器。

| 完整门禁检查 | 结果 |
| --- | --- |
| 生成包一致性 / whitespace | PASS |
| JS suite | 101 个测试文件；TAP 107 / 107 PASS |
| `cargo fmt --manifest-path native/rust/Cargo.toml --all --check` | PASS |
| `cargo clippy --manifest-path native/rust/Cargo.toml --locked --workspace --all-targets -- -D warnings` | PASS |
| `cargo test --manifest-path native/rust/Cargo.toml --locked --workspace` | 60 / 60 PASS |
| Bridge build / CTest | 18 / 18 PASS |
| 隔离 D-Bus restart / workspace / SCROLL / legacy motion / compatibility | 全部 PASS |
| Viewport Clip build / CTest | 17 / 17 PASS |
| Focus Ring build / CTest | 25 / 25 PASS |
| Bridge / Clip / Ring production architecture boundary | 全部 PASS |
| Plasmoid build | PASS |

完整日志：`build/secondary-safe-regression/native-gate.log`。既有 Spring / Viewport Motion / Scroll / Ring / Native Protocol Golden differential 和编译器策略检查继续通过。

测试夹具同步模拟 KWin maximize 信号与几何修改，未模拟 Wayland configure / ACK 延迟或实际 paint-to-present。没有新增实机测试矩阵、GPU 时间或功耗测量，自动回归不能替代实体桌面验收。

## 回滚

备份 `old-package` 保留原完整 KWin Script 包，`rollback-component.sh` 执行 stop → upgrade 原包 → start，不覆盖 kwinrc。原 main.js SHA-256：`1f8c6fada3d89a0c65ee4ca782e258f4c354b7e9c1360db8def10acec9600ead`。回滚前先保存当时的 Bridge / 窗口状态，停启后可使用备份 `live-support.py` 恢复 primary parking、Pair anchor、副屏 minimized 和实际焦点。
