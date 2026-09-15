# Engine 解析 access，不续期

ADR 0004 把「刷新 token」列为 Engine 存在的理由之一。官方 CLI 的凭据文件里通常既有过期的 accessToken，也有仍能用的 refreshToken；粘贴的 Cursor cookie / Ollama key 没有 refresh。PUB 自己换 token 会复用官方 client id、和 CLI 抢写同一文件（ADR 0006 禁止），墙钟过期当成未登录则会在 CLI 仍能续上时显示未登录。

决定：Engine 只 `resolveAccess`（PUB 文件优先，再官方 CLI home / 环境变量）。不读 expiresAt、不调用 refresh、不写回 CLI 凭据文件。用量 HTTP 401 是 unauthorized，不是 signed-out。
