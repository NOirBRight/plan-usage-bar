# API key 类 Provider：网页开 key，再粘贴；CLI 可选

ADR 0006 为 Claude / Codex / Cursor / Grok 选择「启动官方 CLI 打开浏览器」。OpenCode Go、Command Code、Ollama Cloud 的凭据是 API key，本机未必装官方 CLI，「在浏览器中登录」若等于启动 CLI，没装就无法登录。

决定：这三家 Provider 页的主路径是打开官网（创建或复制 key）再粘贴进 `credentials.json`。官方 CLI 若在 PATH 上，可作为第三条回退（写入的文件仍按 ADR 0005 读取）。PUB 仍然自己不做 OAuth。Engine 解析顺序不变：PUB 文件优先于 CLI 文件和环境变量。
