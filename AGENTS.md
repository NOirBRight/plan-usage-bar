# PUB

PUB is the GNOME Plan Quota strip. The TypeScript Engine prints a Snapshot; the GNOME extension only draws it.

## Layout

- `src/` — Engine. Public seam is `readSnapshot`, `resolveAccess`, and each Provider adapter's `pull`.
- `extension/` — GJS shell. `extension.js` is a thin loader; the Strip, Popover and Settings live in `pub-ui.js`.
- UI 原型不在 main：见分支 `prototype/ui-redesign`（`prototype/redesign.html` 三个方向，已选 A）。
- `CONTEXT.md` — glossary. `docs/adr/` — decisions.

## Commands

```bash
pnpm test
pnpm build
pnpm snapshot
```

`pnpm snapshot` reads PUB `credentials.json` plus official CLI homes and writes `~/.cache/pub/snapshot.json`. It does not read DSH.

Enable the extension (GNOME 50) after `pnpm build`:

```bash
ln -sfn "$PWD/extension" ~/.local/share/gnome-shell/extensions/plan-usage-bar@noirbright.github.io
gnome-extensions enable plan-usage-bar@noirbright.github.io
```

不要对 checkout 的 symlink 跑 `gnome-extensions install`，那会清空源码。也不要对 `~/.local/share/gnome-shell/extensions/plan-usage-bar@noirbright.github.io` 做 `rm -rf`（若它是指向 checkout 的 symlink，会把源码一起删掉；只删链接用 `rm` 不带 `-r`）。

当前 Wayland 会话的 gnome-shell **启动时才扫 UUID**。打开「用户扩展」或 `gnome-extensions enable` 都不会让已经在跑的进程认出新的 `plan-usage-bar@noirbright.github.io`。DBus `Eval` / `ReloadExtension` 在这台机器上不可用。

不注销的测法：Mutter Development Kit 窗口里跑临时 XDG 嵌套 gnome-shell（不动当前 dconf，下次登录不受影响）：

```bash
bash scripts/nested-shell.sh
```

桌面上会出现一个嵌套 GNOME 窗口，里面是新 gnome-shell + PUB。家目录、凭据、`XDG_RUNTIME_DIR` 仍用当前会话的；`XDG_CONFIG_HOME` / `XDG_CACHE_HOME` / `XDG_DATA_HOME` 在 `/tmp/pub-nested`。关掉那个窗口即结束。改了 `extension.js`（加载器）之后关掉再运行脚本；只改 `pub-ui.js` / `stylesheet.css` 用下面的重新加载即可。需要 `/usr/libexec/mutter-devkit`（Ubuntu 包名 `mutter-dev-bin`）。

嵌套会话里 `PUB_PROBE=1`，可以不碰鼠标驱动扩展：往 `/tmp/pub-nested/state/pub-probe.cmd` 写一条命令，扩展每 200ms 读一次，状态写回同目录的 `pub-probe.json`。

```bash
echo 'page:settings' > /tmp/pub-nested/state/pub-probe.cmd   # open | close | context | click | select:<id> | page:<overview|detail|settings|provider> | paste:<id> | watch:<id> | unwatch:<id>
echo 'shot:settings' > /tmp/pub-nested/state/pub-probe.cmd   # 截图到 state/settings.png
echo 'tap:900,250'   > /tmp/pub-nested/state/pub-probe.cmd   # move:x,y | down | up | tap:x,y，舞台坐标
```

脚本默认 `--mode=user`（上游主题，配色为默认时是深色）。本机登录的是 Ubuntu 会话（Yaru，配色为默认时是浅色），验收配色用 `PUB_NEST_MODE=ubuntu bash scripts/nested-shell.sh`。

测 CLI 登录而不动真实账号：`PUB_FAKE_CLI_DIR=<目录>` 让扩展优先在该目录找 `claude` 等命令（仅 `PUB_PROBE=1` 时生效），配合 probe 的 `login:<id>`、`code:<授权码>`。

浅色主题：`DBUS_SESSION_BUS_ADDRESS=$(cat /tmp/pub-nested/bus-address) XDG_CONFIG_HOME=/tmp/pub-nested/config gsettings set org.gnome.desktop.interface color-scheme prefer-light`。

## 不注销更新当前顶栏

`extension.js` 每次启用都从 `$XDG_RUNTIME_DIR/pub-ui/` 导入一份新命名的 `pub-ui.js` 副本，绕开 gnome-shell 的模块缓存（ADR 0007）。改了 `pub-ui.js` 或 `stylesheet.css` 后任选一种：

```bash
gnome-extensions disable plan-usage-bar@noirbright.github.io; gnome-extensions enable plan-usage-bar@noirbright.github.io
```

- 右键 Control Icon →「重新加载」
- 应用列表里 PUB 图标右键 →「重新加载」（`bash scripts/install-launcher.sh` 安装）

只有改 `extension.js` 本身、`metadata.json`，或第一次装上加载器时才需要注销。
