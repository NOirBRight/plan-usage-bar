# 热重载加载器与应用列表启动器

gnome-shell 进程内的 ES 模块只加载一次，扩展 `disable` 再 `enable` 仍用旧代码，每次改界面都得注销。用户也希望 PUB 能像应用一样从应用列表启动和退出。

决定：

- `extension.js` 只做加载器。每次 `enable` 把 `pub-ui.js` 复制成 `$XDG_RUNTIME_DIR/pub-ui/pub-ui-<时间戳>.js` 再动态导入，新文件名不在模块缓存里。`pub-ui.js` 的 GType 名每次加随机后缀，避免重复注册。
- 重新加载 = 加载器 `disable` → 重载 `stylesheet.css` → `enable`，入口是右键菜单「重新加载」和 `gnome-extensions disable/enable`。
- `scripts/install-launcher.sh` 在 `~/.local/share/applications` 放一个 PUB 启动器：点开 = 启用扩展，动作里有「重新加载」「退出」。

可见外壳仍是扩展（ADR 0002 不变），启动器只是开关，不是独立窗口。代价：每次重新加载都会在内存里多留一份旧模块，只影响开发时的频繁重载。改加载器本身仍需注销一次。
