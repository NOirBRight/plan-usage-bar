# Engine 是跨仓库契约，Shell 可以不止一个

AM01S 副屏版（Omarchy/Hyprland 上的 Quickshell 插件）只适用于那块 960×400 屏，放在独立仓库 `pub-am01s`。它要画 Snapshot，还要做主屏设置面板（Enabled、Remaining 读法、CLI 登录、粘贴 API key）。这些知识现在都在 `pub-ui.js` 里：直接改写 `settings.json` / `credentials.json`，自带 `LOGIN` 表、Provider 名字和图标。再在 QML 里抄一份，两边很快就会不一致。

决定：

- 可见外壳不止 GNOME 扩展一个。GNOME 扩展是 GNOME 上的 Shell；`pub-am01s` 是 Omarchy + AM01S 上的 Shell。部分取代 0002。
- Shell 与 PUB 之间只经过 Engine CLI：
  - `pub-engine snapshot`：照旧写 Snapshot，每个 Shell 自己定时驱动（0004 不变）。
  - `pub-engine catalog`：Provider 目录（名字、图标、凭据类型、登录命令、官网 URL、提示文字）。
  - `pub-engine settings set …`：Enabled、Pinned、顺序、Remaining 读法、Primary Window。
  - `pub-engine credentials set <id>`：凭据走 stdin，写进 `credentials.json`（0005 不变）。
- Snapshot 带 `schemaVersion`，并为窄屏 Shell 带短名：Provider 的 `shortName`（OpenCode Go → OpenCode）、Quota Window 的 `shortLabel`（Cursor Models → Cursor）。Shell 遇到不认识的版本就显示「需要更新」，不去猜。
- 每次发版把构建好的 `pub-engine.mjs`（单文件、只依赖 `node:`）作为 GitHub Release 附件。其他 Shell 固定 Engine 的方式是下载 tag `vX.Y.Z` 的 Release 附件 `pub-engine.mjs`，而不是把本仓库当作 git 依赖。
- GNOME 扩展也改走这些命令，`pub-ui.js` 里的 `LOGIN` 表和 JSON 读写搬进 Engine。

## 契约：errorKind

上面的决定不改。Snapshot 里 Provider 抓取失败时带可选的 `errorKind`，只有这四个值：

- `signed-out`：没有可用凭据（`error` 为 `signed out`）。这不是抓取失败。Shell 可以藏起该 Provider，例如 AM01S 的 Meter Bank。
- `unauthorized`：凭据被拒绝（HTTP 401 或 403）。不是 signed-out。若盘上还有上次成功的 Remaining，Engine 会留着它。
- `rate-limit`：HTTP 429。
- `transport`：其余 HTTP 状态、网络错误，以及无法解析的回复。

## 版本查询

`pub-engine --version` 和 `pub-engine version` 在 stdout 打印 JSON：`version` 是 Engine 的 package 版本，`schemaVersion` 是它写出的 Snapshot 版本（当前为 1）。成功时退出码 0。
