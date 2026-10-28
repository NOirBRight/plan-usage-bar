# Grok 的过期 token 让 CLI 续，Engine 只重读

Grok 的 OAuth access token 只有 6 小时（`~/.grok/auth.json` 的 `create_time` 到 `expires_at`），续期只发生在官方 CLI 里。ADR 0008 让 Engine 一律不续期，于是 CLI 一段时间没跑，下一次 Snapshot 就是 `HTTP 401`（`unauthorized`），`keepLastGood` 又把上次的 Remaining 留着，Panel 看起来就是「额度冻住 + 报错」，直到用户再跑一次 grok。

决定：只对 Grok 放开 ADR 0008 的两处。

- 读 `expires_at`（缺失时用 token 里 JWT 的 `exp`）判断是否过期；没过期照旧直接请求，不 spawn 任何东西。
- 过期时运行一次 `grok models`（非交互、本机约 1.5s、不依赖 TTY），然后重读 `~/.grok/auth.json` 用 CLI 写下的新 token。运行失败或文件没变，就沿用旧 token，`401` 仍按 `unauthorized` 报。

仍然不做的事：不自己走 OAuth refresh、不写、不改 `~/.grok/auth.json`。

顺带：`auth.json` 里有多条登录时取 `expires_at` 最新的那条（CLI 登出会留下旧条目，按 JSON 顺序取第一条会永远拿到过期 token）；`x-grok-client-version` 用 `~/.grok/version.json` 里 CLI 记下的版本，读不到时才用常量。

代价：只在 token 过期时每次 Snapshot 多 spawn 一次 `grok`；CLI 没装或续不上时，每 5 分钟一次，直到用户重新登录。
