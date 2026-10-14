# CC-Niri 全项目内存基线（M0，未完成受控A/B）

日期：2026-10-13。HEAD：`b77a40eb1e0a0fd66d053c5996a13bc88e75518b`。**项目总预算：INCONCLUSIVE；尚无可靠B0/B1差值。** 本文是现有桌面的五分钟只读观测，不是低内存验收通过记录。

## 环境与范围

- 实际16GB设备：MemTotal 16222352KiB；Fedora 44 / KWin 6.7.5 / Qt 6.11.2 / Wayland；GPU NVIDIA RTX 2060，driver 615.71.09，OpenGL EGL硬件合成。
- DP-1主屏3840×2160、scale1.5、60Hz；HDMI-A-1副屏2560×1440、scale1、60Hz；eDP-1关闭。主屏独立工作区开启。
- Script、Scroll Transition、Clip、Ring与Bridge已启动；smooth60，RustFiniteCurve工作区动画enabled=true、duration420ms；原生Slide未加载。
- 检查时保存快照2787 bytes、5个workspace、当前3列、合计8个snapshot列。当前桌面配置含`com.cc.scrolltasks` applet；Script未显式启用Dock集成，其默认false。**已配置Dock的Plasma UI成本仍可能存在，不能将关闭JS集成当作干净Dockless。** Ring查询前后eligibleCount 3→2，说明负载未固定。
- Rust / Cargo实测1.99.0；`/usr/bin/g++` GNU16.2.1。四个现有Native构建树均RelWithDebInfo，C++ compiler为指定路径，Rust按既有映射使用release。KWin映射读取受权限限制，未证明其加载产物与当前build tree逐字节一致，因此本轮不标作合格Release A/B。
- 原有工作区修改保留，包括`workspace-runtime-guards.test.js`中的layoutEligibility修复、副屏结果/测试及两份任务文档；未覆盖用户改动，未提交或部署。

## 原始观测

2026-10-13 **09:26:26–09:31:26 CST**，300.022秒，每10秒采一次，共31样本。采样工具：[tools/sample-memory.py](../tools/sample-memory.py)；原始记录：[process-observation.json](memory-data/20261013/process-observation.json)。采样开始前本轮完整JS测试已结束，临时sizeof编译与新增模型测试在采样结束后才运行。桌面仍由用户日常操作，未要求保持idle，也无法排除其它进程的活动。

数据单位KiB，MiB转换除以1024。RSS与PSS保留不同字段；缺失不填0。

| 进程（PID全程相同） | PSS min / median / max KiB | Private_Dirty min / median / max KiB | RSS辅助指标 | Swap KiB |
| --- | ---: | ---: | ---: | ---: |
| KWin 2062 | **UNAVAILABLE** | **UNAVAILABLE** | VmRSS 509584 / 540144 / 542268 KiB | VmSwap=0 |
| Bridge 1809 | 2475 / 2487 / 2487 | 1540 / 1548 / 1548 | smaps Rss 16452 / 16464 / 16464 KiB | 0 |
| Plasma 2227 | 483081 / 486552 / 491324 | 419604 / 423072 / 427776 | smaps Rss 644740 / 648208 / 653040 KiB | 0 |

- Bridge PSS中位数 **2.429MiB**，首尾2477→2487KiB（+10KiB）；Private_Dirty 1540→1548KiB（+8KiB）。它是Bridge整体常驻PSS，不能替代整套项目增量，短期变化也不证明长期无泄漏。
- Plasma PSS中位数 **475.148MiB**，整体进程内存，**不是Dock增量**。KWin只能得到RSS辅助数据，不能以其RSS增长32MiB判定cc-niri泄漏。
- MemAvailable范围8141268–8987324KiB（约7.76–8.57GiB），系统swap全程未使用。
- CPU按单核100%计，10秒区间：KWin中位12.264%、最大27.940%；Bridge中位0%、最大0.399%；Plasma中位3.393%、最大8.581%。不是严格idle CPU、GPU或动画瞬时峰值。
- 同用户访问`/proc/2062/smaps_rollup`返回Permission denied；已在桌面真实进程空间确认，超出沙箱并不能解决这个进程级权限限制。需要获准的只读权限方案才能得到KWin PSS；未尝试强杀/重登录规避限制。

## 活动与GPU证据边界

原始KWin support与采样期间的两次Native状态查询保存在[memory-data/20261013](memory-data/20261013)。两次motion查询Scroll输出持续重绘累计数374→374、全局持续重绘0→0，两次均未运行Scroll或Workspace动画；Ring fade请求1513→1579、visual数1→0、活跃transition均0。查询只覆盖采样中的一部分时间，用户实际活动存在，不能据此通过30–60分钟idle gate或把Ring绘制累计数当作不必要repaint。

此前本会话J/K诊断只抓到一次完整切换：主屏25帧、约60fps，P95 16.702ms、最大16.703ms、超过25ms长间隔0。原始数据位于`/tmp/cc-niri-jk-diagnostic-20261013/capture3.json`。这是优化前的单次观测，不能证明卡顿已修复或覆盖所有工作区场景，且与本次内存采样未逐帧关联。

GPU工具此前一次整卡采样为6% GPU利用率、1912MiB显存。这个总数包含桌面、应用和驱动资源，**cc-niri GPU显存不可准确归因**；未执行GPU内存A/B或声称显存成本为0。

## 基线矩阵与下一步安全流程

| 场景 / 指标 | 状态 | 缺少的证据 |
| --- | --- | --- |
| B0 原生桌面 | NOT MEASURED | 尚未明确获准执行安全停用；不强杀KWin |
| B1 默认Dockless，稳态3–5分钟、三轮 | NOT MEASURED | KWin PSS读取权限、实际Dock UI隔离、固定窗口/工作区负载与产物核验 |
| B2 Dock Enabled增量 | NOT MEASURED | 同负载B1/B2 Plasma PSS与可归因GPU资料 |
| B3 单功能A/B | NOT MEASURED | 获准的开关流程与KWin PSS |
| 空闲总增量≤32MiB / 争取≤16MiB | INCONCLUSIVE | `(KWin B1−B0)+Bridge B1`缺少KWin数据与B0 |
| 动画观测净增量≤64MiB | INCONCLUSIVE | 同负载动画A/B，没有项目归因峰值 |
| 30–60分钟相同状态净增长≤4MiB | NOT MEASURED | 本次只有5分钟且负载变化，不能判PASS |

下一阶段的具体可审查流程：先解决**仅限读取目标KWin的smaps_rollup**权限；保存kwinrc / 工作区快照与组件状态，确认恢复与回滚入口；按既有`cc-niri stop`先恢复parked窗口再安全停用，确认Script / Scroll Transition / 两个Native Effect / Bridge全部停用；在同一窗口、输出、特效负载下等待3–5分钟并采B0，再用`cc-niri start`恢复并采B1，分别至少三轮。保存原兼容特效与Dock状态；若卸载映射不释放、窗口布局无法等价或自然缓存噪声过大，标记INCONCLUSIVE，另列受控会话方案，不擅自强制重登录。

上述停用与权限改变尚未执行。遵循任务文档第11节“对所有可能影响运行桌面的改动先说明并等待明确允许”；已有只读采样许可不等于组件停用或Dock配置更改许可。当前无部署变更，无需运行时回滚。

重复只读观测（在拥有真实进程视图与相应读取权限的终端运行）：

```sh
python3 tools/sample-memory.py --duration 300 --interval 10 \
  --scenario uncontrolled-existing-desktop --output /tmp/cc-niri-memory-observation.json
```

工具仅低频读/proc，输出缺失PSS的原因；不控制服务、桌面、窗口或GPU，不持续采样。`--duration 0`为单次观测；无效、非有限时长或低于10秒的间隔被拒绝。
