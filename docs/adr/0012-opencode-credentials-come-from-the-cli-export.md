# OpenCode Go 的凭据从 CLI export 读，auth.json 只作回退

OpenCode 2 把凭据搬进自己的数据库，`~/.local/share/opencode/auth.json` 不再随登录更新。继续只读这份文件会拿到上一次登录的旧 key，用量请求 401，而 Engine 的 `keepLastGood` 又让 Panel 一直显示旧数字，看起来就是「额度不更新」。

决定：OpenCode Go 先运行 `opencode auth export opencode-go`，取其中 active 的 key；命令失败、没装 OpenCode，或返回里没有 key 时，再回退 `auth.json`（OpenCode 1 / 旧登录），最后回退 `OPENCODE_API_KEY` / `OPENCODE_GO_API_KEY`。仍然遵守 ADR 0008：只解析 access，不续期、不写回 OpenCode 的数据库或 `auth.json`。PUB 自己粘贴的 `credentials.json` 依旧优先。

代价：每次 Snapshot 会多 spawn 一次 `opencode`（本机约 100ms），并且 export 会带出该 integration 的明文 key；它只在 Engine 进程内存里用，不落盘。
