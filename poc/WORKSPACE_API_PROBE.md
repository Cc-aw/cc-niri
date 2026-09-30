# W0 Virtual Desktop API 探针

`kwin-workspace-api-probe.js` 独立加载，只读取 API、连接信号和打印日志。
不修改 geometry、Desktop、Column、Adoption 或 Dock，也不注册快捷键。
`tools/build.js` 不打包此文件。

## 加载、查看、卸载

在仓库根目录运行（使用现有 KWin 会话）：

```bash
gdbus call --session --dest org.kde.KWin --object-path /Scripting \
  --method org.kde.kwin.Scripting.loadScript \
  "$PWD/poc/kwin-workspace-api-probe.js" cc-niri-workspace-api-probe
```

返回 `(N,)` 是 script ID。用实际 N 替换下面的 `ScriptN`，仅启动此探针：

```bash
gdbus call --session --dest org.kde.KWin --object-path /Scripting/ScriptN \
  --method org.kde.kwin.Script.run
journalctl --user -f -o cat | rg --line-buffered '\[cc-niri-workspace-api\]'
```

测试后卸载；重复加载前也先卸载，避免重复监听：

```bash
gdbus call --session --dest org.kde.KWin --object-path /Scripting \
  --method org.kde.kwin.Scripting.unloadScript cc-niri-workspace-api-probe
```

默认 targetOutput 是最左、再最上的输出，与 cc-niri 默认一致。
如果日用脚本显式指定其它输出，在 `kwinrc` 的
`[Script-cc-niri-workspace-api-probe]` 组配置 `TargetOutputName` 后重新加载。
此探针不会自动读取日用脚本的配置组。日志会报告配置输出缺失及回退。

## 日志解释

每行带标签和 JSON，包括 sequence、毫秒时间戳、event。

- `desktops`：workspace.desktops 原始顺序；order 是零起始列表序号，
  x11DesktopNumber 仅用于观察，id 才是未来 Workspace 主键。
- `current`：每个输出的 Desktop，source 说明是否使用 currentDesktopForScreen；
  缺失时明确标记 global fallback，不能据此认为逐屏 API 已通过。
- `currentDesktopChanged`：实际 argumentCount、previous/current/output，
  isTargetOutput 只作标记；副屏事件也打印，以验证未来过滤逻辑。
- `window` / `window.desktopsChanged`：UUID、caption、output、desktops[]、onAllDesktops。
  覆盖启动时已有窗口和随后新增窗口。
- `missing-signal` / `read-error`：API 验证未通过，先调查再进入 W1。

API 参照：[KDE Plasma 6.7 WorkspaceWrapper 源码](https://github.com/KDE/kwin/blob/Plasma/6.7/src/scripting/workspace_wrapper.h)。
源码声明 currentDesktopChanged(previous, current, output)，以及
currentDesktopForScreen(output)；最终以目标机器日志为准。

## 人工验收（尚待实际交互）

准备至少两个已有 Desktop，记录动作和对应日志。不由探针创建或切换 Desktop。

| 动作 | 检查 |
| --- | --- |
| KDE Pager 切换并返回 | previous/current 稳定 ID、输出和 current 读数一致 |
| KDE 原生快捷键切换并返回 | 与 Pager 相同的信号语义；事件数量与时间戳 |
| Move Window to Desktop 并移回 | 同一 UUID 的 desktopsChanged；desktops[] 更新 |
| On All Desktops 开关 | onAllDesktops 与 desktops[] 的真实变化 |
| 开新窗口，再移动 Desktop | 新窗口自动接入监听，无重复监听 |
| 双屏分别切换（若 KDE 配置支持） | output 是否区分主副屏；各输出 current 是否独立 |

若 KDE 使用全局 Desktop 切换，记录其行为，不把输出为空或联动当作逐屏支持。
测试可能触发现有日用 cc-niri 的行为，建议在可控窗口环境进行。
只有实际信号行为确认可靠后进入 W1；Node mock 测试不代替此验收。

## 2026-09-30 验证记录

- 本机 `kwin-6.7.5-1.fc44.x86_64`：通过 loadScript + 单脚本 run 启动，
  journal 收到完整 startup 输出；随后 unloadScript 返回 true。
- 真实 API 暴露 currentDesktopForScreen；枚举到两个带稳定 ID 的 Desktop，
  当前输出 eDP-1、当前 Desktop 为桌面 1。
- 已有窗口可以读取 desktops[] / onAllDesktops；观察到 sticky surface 的
  desktops[] 为空且 onAllDesktops=true。未出现 missing-signal 或 read-error。
- `node tools/build.js`、`node tools/check.js --native` 通过：51 个测试文件，
  Bridge / Viewport clip / Plasmoid 三项本机 native 构建通过。生产 bundle 无变化。
- Pager、快捷键、Move to Desktop、sticky 切换、新窗口、双屏交互仍待人工验收；
  当前仅连接单输出，不能宣称双屏验证通过。远程 CI 未触发。
