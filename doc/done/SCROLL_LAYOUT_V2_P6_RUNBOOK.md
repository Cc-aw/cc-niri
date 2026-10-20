# Scroll Layout V2 P6 实机验收操作单

> **归档说明（2026-10-20）：** P6 部署、实机验收与回滚操作手册，随已实施的 Scroll Layout V2 归档。文中未完成的实机 / 性能 / 资源验收仍保持 Pending，不因归档视为通过。

当前阶段：2026-10-16 用户明确授权后，候选已部署并在本机开启 V2，启动核验通过；交互/性能/资源实机验收仍 Pending。源码 V2 默认关闭。结果见 [P6 记录](../../test/SCROLL_LAYOUT_V2_P6_LIVE_RESULTS.md)。以下部署、stop、模式切换、采样与回滚步骤仅在明确授权的实机验收时执行。前一准备阶段只执行离线检查、私有 KWin、只读备份和 rollback dry-run；本次部署使用刷新后的 `/tmp/cc-niri-p6-20261016-deploy` 配套备份。

## 1. 固定候选与退路

结束构建后生成验证记录，准备新的私有目录。目录包含源码、三个已验证二进制、构建缓存、配置/快捷键/持久快照和原安装组件；Native 备份同时记录仍保留在磁盘的 immutable 原路径。

```bash
python3 tools/scroll-layout-v2-p6.py prepare \
  --output /tmp/cc-niri-p6-NEW \
  --validation test/scroll-layout-v2-p6-evidence/20261016/preparation/validation.json \
  --observe-live
python3 tools/scroll-layout-v2-p6.py verify /tmp/cc-niri-p6-NEW/manifest.json --current --require-validated
/tmp/cc-niri-p6-NEW/rollback.sh
```

`prepare/verify` 不写桌面配置，`rollback.sh` 默认仅检查，不执行恢复。私有目录权限 0700；其中有用户配置与窗口信息，不提交到仓库。`/tmp` 可能被清理，验收前确认目录及旧 Native immutable 文件仍在；若准备后又修改源码、产物或配置，应重跑门禁并刷新候选和备份。当前验证记录只对应当前工作区，不能用于另一份 checkout。

`--require-validated` 核验完整源码集合、三个二进制、CMakeCache、验证记录和回滚文件。安装复用既有构建树；不在验证后重新编译候选。可读写用户目录与已有安装前缀必须匹配。

## 2. 经授权部署与短时冒烟

先确认用户已保存重要工作并同意重载 CC-Niri。在本仓库执行：

```bash
./install.sh --prepared-manifest /tmp/cc-niri-p6-NEW/manifest.json
```

安装器先校验候选和生成包，再走既有 `save-state → stop → immutable install → start`；不覆盖正在映射的 Native `.so`。本候选限定 Dockless，不与 `--with-dock` 混用。默认关闭的 V2 不被安装器自动开启。先在 V1 检查 H/L、J/K、half/full、Wide、Ring、浮动与副屏。

切到 V2 时，**先停 V1，再改开关，再启动**：

```bash
./cc-niri stop
kwriteconfig6 --file kwinrc --group Script-cc-niri-maximize --key ScrollLayoutV2Enabled --type bool true
./cc-niri start
```

先改开关再 restart 会使旧 V1 运行时缺少 V2 恢复证明，安全停止将拒绝卸载。退回 V1 同样先执行 V2 的安全 stop，再将开关写 false 后 start；新版 V1 保留 dormant V2 持久字段。

V2 的 stop 等待 Native ownership 退休和 KWin 实际 frameGeometry/opacity/minimized 恢复，再由 Bridge 返回匹配 live session 与本次 requestId 的瞬时确认。拒绝、超时、Bridge/session 变化均应中止后续卸载。此状态不写持久布局快照。遇到拒绝时记录日志和状态，保留组件，不改用强杀/强制卸载。

```bash
gdbus call --session --dest org.cc.CCNiriBridge --object-path /CCNiriBridge \
  --method org.cc.CCNiriBridge1.GetRecoveryStatus
```

## 3. 固定负载与功能记录

在目标 GPU、4K60/150% 主屏 + 2K60/100% 副屏上保存 `kscreen-doctor -j`、KWin supportInformation、组件 SHA、运行开关、工作区数量、窗口 UUID/应用/标题与几何。记录真实刷新率，不能用私有 Mesa 的 100%/150% 分别通过代替真实 mixed-DPI 验收。

使用五个相同应用/内容的普通测试窗口 A–E，固定宽度 `[half,twoThirds,full,half,twoThirds]`；同样的窗口负载运行 V1 对照（V1 投影为 half/full）。准备空、单 half、单 twoThirds 和混合列工作区。逐项填写 [设计第 10 节的 V2-01…28](cc-niri_Scroll_Layout_V2_Implementation_Spec.md#10-回归测试矩阵与验收标准)，每项记录实际操作、观察、原始数据和结论。

优先顺序：

1. R 三档循环与 F 返回原非 full；单列居中、两 half gap、左右 partial 与 Full 普通列。
2. H/L 慢按、快速反向、跨五列；Shift H/L 重排；中途改变宽度与关闭窗口；不得出现跳帧、残影、丢失焦点或永久 parking。
3. partial 窗口的两次点击退路：首次只聚焦，待窗口到位再点击操作；验证左右边缘、标题栏、滚轮及 press/release 配对。H/L 为主要日常入口。
4. Fcitx5 实际输入中文、显示候选、点选候选；右键菜单、Dialog/Transient；Ring 与主屏边缘同步，副屏无泄漏。
5. J/K、数字直达/移动跟随、空工作区与回收；Fullscreen/浮动/原生最大化往返；V1/V2 往返和旧 protocol1/2 快照。
6. 安全 stop/restart/Bridge 暂离线与恢复；先只用测试窗口。效果卸载、比例切换和输出变更须单独约定时机，勿在用户正常工作中直接执行。

所有安全/input、旧 ACK、副屏泄漏或快照污染 FAIL 均阻止 V2 完成。静态模型的 5000 次取消验收单独引用，不重复对桌面注入 5000 次操作。

## 4. 有界帧数据

使用现有 Native capture；默认关闭，没有新动画时钟。每个模式至少三轮相同手动序列，记录按键时刻，H/L 和 J/K 分开采集，不在单个 H/L capture 中混入工作区切换。

```bash
python3 tools/scroll-layout-v2-p6.py capture --kind scroll --output V2-HL-round1.json
python3 tools/scroll-layout-v2-p6.py frames V2-HL-round1.json --output-name ACTUAL_PRIMARY > V2-HL-round1-analysis.json
python3 tools/scroll-layout-v2-p6.py capture --kind workspace --output V2-JK-round1.json
python3 tools/analyze-workspace-capture.py V2-JK-round1.json --transitions > V2-JK-round1-analysis.json
```

Scroll 最多 10 秒，Workspace 最多 3 秒；分别保留原始 JSON 和离线输出。比较每次转场真实 output presentation 间隔 P50/P95/P99/max、≥25ms 数量、33–50ms 数量，排除转场间 idle。记录截断、缺失完成帧、第一帧等待和 refresh。Scroll 的统计窗口目前以数值相机完成帧为界，不证明客户端最终 paint；呈现事件也没有与确切窗口内容关联。工具的 `MEASURED` 仅表示可统计，不能自动判为 4K60 PASS。既有 J/K 33–50ms 长帧必须保留在对照中。

## 5. 全项目资源 B0/V1/V2

遵守 [全项目规范](<../todo/iA Writer.md>)。结束所有大型构建和隔离测试，使用生产构建，同一负载、同一环境、同样的 Blur/Dock/Workspace 开关，先稳定 3–5 分钟。B0 是原生 KDE、CC-Niri Script/Effect/Clip/Ring/Bridge 全部退出；建立 B0 会停止组件，需明确授权。每个模式至少三轮，窗口内容和数量保持一致。原始观测不能当作归因净增量。

每轮创建 context JSON，例如 V2：

```json
{"controlled":true,"load_id":"fixed-five-windows-v1","environment_id":"host-gpu-output-config-v1","phase":"steady-idle","dock_enabled":false,"cc_niri_components_unloaded":false}
```

B0 仅在实际核验所有组件退出后将 `cc_niri_components_unloaded` 写 true；不要复制未经确认的标记。`load_id/environment_id` 必须指向另存的具体负载与环境清单。

```bash
python3 tools/sample-memory.py --duration 300 --interval 10 --scenario V2-idle-round1 --context V2-context.json --output V2-idle-round1.json
python3 tools/scroll-layout-v2-p6.py memory --baseline B0-idle-round1.json --v1 V1-idle-round1.json --v2 V2-idle-round1.json > idle-comparison.json
```

分别采集正常动画交互期间的低频 PSS 观测峰值，以及同样窗口/工作区负载下 30–60 分钟交互前后的空闲稳态。长测采样可用同工具有限 duration；active context 标记为 `phase: animation`，离线 idle 分析器会拒绝把 active 当稳态。现有分析器只算空闲 PSS/Private_Dirty 中位差，峰值/长期斜率须另存原始数据并分析，不能将其输出当作全预算验收。

同时记录每个进程、CPU/帧时间、Qt/Scene 对象、纹理和 GPU 可归因限制。smaps 权限不足、无法确认 B0 或负载不一致时标 INCONCLUSIVE；不以 RSS 替代 PSS。项目内 KWin 嵌入组件的成本由 KWin 的同负载差体现，独立 Bridge 计入合计；开启 Dock 则需额外 Plasma 对照，当前工具只接受 Dockless。

验收目标：整体 idle 净增≤32 MiB（争取≤16）、正常动画 PSS 观测峰值净增≤64 MiB；轻量特性 idle/active 增量≤2/8 MiB 并计入整体；30–60 分钟后 idle 净增长>4 MiB 须调查，持续正斜率/存活对象增长不通过。GPU/纹理尚未能归因时如实记录限制，不宣称整体通过。结果写入全项目 baseline/audit/results 三份账本。

## 6. 经授权完整回滚

先检查目录仍存在且 dry-run 成功，再执行：

```bash
/tmp/cc-niri-p6-NEW/rollback.sh
/tmp/cc-niri-p6-NEW/rollback.sh --execute
```

回滚使用冻结的安全控制器执行 stop，确认恢复后才切回旧 immutable Clip/Ring 链接，恢复 Bridge/CLI/unit、完整 Script/Effect 包、kwinrc/快捷键和备份时的布局快照，再启动旧版。**回滚恢复的是准备时的配置与布局，试用期间的新配置/布局会被替换**；应用不会被关闭。安全 stop 失败则恢复脚本中止，不继续替换文件。完整回滚尚未执行；当前只有 dry-run、私有 V2 stop 和真实桌面部署/启动证据，不能将部署成功当作 V2 启停全矩阵通过。
