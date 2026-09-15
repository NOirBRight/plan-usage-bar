# 登录优先走官方 CLI 的浏览器授权

让用户去开发者工具里复制 token 太难，也容易贴错。Claude、Codex、Grok 的官方 CLI 已经有浏览器 OAuth，登录后写下的文件正是 Engine 回退读取的那几份。

决定：Provider 页的登录按凭据类型分三种。

- Claude、Codex、Grok：「在浏览器中登录」启动官方 CLI 的登录命令（`claude auth login`、`codex login`、`grok login --oauth`），等它退出后刷新。PUB 不自己实现 OAuth，也不复用官方客户端的 client id。
  Claude Code 在浏览器没有回调到本机时，会让 claude.ai 显示一段 `code#state` 授权码，并从标准输入读取。PUB 在等待卡片里提供授权码输入框，提交后按行写进 CLI 的标准输入。
- Cursor：`cursor-agent login` 写入 `~/.config/cursor/auth.json`。JWT 的 `sub` 就是用量 Cookie 需要的 userId，粘贴 JWT 或 `userId::token` 都可以。网站 Cookie 仍可用。
- Ollama Cloud：打开 ollama.com 创建 API key 后粘贴。

粘贴仍对所有 Provider 可用，写入 `credentials.json` 并优先于 CLI 文件，与 0005 一致。凭据来自 CLI 时 PUB 不提供「退出登录」，因为那会把用户在 CLI 里的登录也登出。
