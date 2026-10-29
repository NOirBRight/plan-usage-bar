# Grok 被拒的 token 让 CLI 续，Engine 只重读

Grok 的 OAuth access token 只有 6 小时（`create_time` 到 `expires_at`），续期只发生在官方 CLI 里。ADR 0008 让 Engine 一律不续期，于是 CLI 一段时间没跑，下一次 Snapshot 就是 `HTTP 401`（`unauthorized`），`keepLastGood` 又把上次的 Remaining 留着，Panel 看起来就是「额度冻住 + 报错」，直到用户再跑一次 grok。

先按 `expires_at` 判断过期再续的方案不够：CLI 的 `auth.json` 可能留着一个时间戳仍在未来、但已经被吊销或换掉的 token（重登、多账号、CLI 与 PUB 不同 `GROK_HOME`），墙上时间看不出问题，401 却一直有。

决定：Grok 的 `pull` 被拒（HTTP 401 / 403）时，Engine 运行一次 `grok models`（非交互、本机约 1.5s、不需要 TTY），然后重读 `~/.grok/auth.json`；token 变了就重试一次 `pull`，没变就照旧报 `unauthorized`。其它错误（429、传输失败）不 spawn。

这是 Provider 适配器上的一个可选钩子（`renew`），只有 Grok 实现；其它 Provider 仍按 ADR 0008 只解析、不续期。

仍然不做的事：不自己走 OAuth refresh、不写、不改 `~/.grok/auth.json`。

顺带：

- `auth.json` 里有多条登录时取 `expires_at` 最新的那条（登出会留下旧条目，按 JSON 顺序取第一条会拿到过期 token）。
- 认证文件与 `version.json` 优先读 `GROK_HOME`，没设时才用 `~/.grok`。
- `x-grok-client-version` 用 CLI 记下的版本，读不到时才用常量（现在是 1.0.70）。

代价：token 真被吊销且 CLI 也续不上时，每次 Snapshot 多 spawn 一次 `grok`，直到用户重新登录。
