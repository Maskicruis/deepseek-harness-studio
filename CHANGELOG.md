# Changelog

本文件记录 DeepSeek Harness Studio 的重要变更。各版本的详细发布说明见 `docs/RELEASE_NOTES_*.md`。

## [1.07.0] - 2026-08-xx

### 📄 文档读取（PDF / Word / Excel）
- 生态组件新增「文档读取」组件（`dsh-plugin-doc-reader`），为模型增加 `read_document` 工具。
- 支持按文件路径读取 PDF、Word（docx）、Excel（xlsx）与纯文本，任意模型模式均可调用。
- 补充使用说明：聊天输入框只收图片（PNG/JPG/WebP/GIF），读文档请用「文件路径 + read_document」。

### 🧭 使用说明
- 明确「含图片的会话切换到纯文本模型会被拒绝」是 Harness 的安全机制，并给出规避方式（有图用 `(modlens vision)` 模型 / 新建会话）。

### 📦 其他
- 版本升级至 1.07.0。

## [1.06.0] - 2026-08-xx

### 🖼️ 视觉模块简化（默认阿里千问）
- 「视觉引擎」默认只展示「阿里千问 Qwen-VL」，其余引擎（Gemini、Anthropic、Claude CLI、OpenAI 兼容等）折叠进「高级选项」，避免 Claude/codex 等选项造成困惑。
- 未配置时默认引导到阿里千问：只需粘贴阿里云百炼 DashScope API Key 即可识图。

### ⚡ 静默覆盖升级
- 更新改为静默覆盖：点击「立即更新」后自动覆盖安装到原目录并重启应用（`/S --updated`），不再弹出安装向导；首次安装仍是向导式，可选择安装目录。
- 更新前应用自动退出，安装完成后自动重启；工作区、会话、插件与设置均保留。

### 📦 其他
- 版本升级至 1.06.0（版本号规整：1.6 → 1.06，中位补零，与 1.10 等后续版本对齐）。

## [1.05.0] - 2026-08-21

### 🖼️ 视觉模块重做（接入阿里千问）
- 新增「阿里千问 Qwen-VL」视觉引擎快捷配置：接入阿里云百炼 DashScope（OpenAI 兼容端点），国内直连、无需代理。
- 自动填充 `https://dashscope.aliyuncs.com/compatible-mode/v1` 与 `qwen-vl-max`，只需粘贴 API Key 即可用。
- 保留 OpenAI 兼容、Gemini、Anthropic、Claude CLI、Antigravity CLI 引擎与自动故障转移。

### 💰 Token 余额显示
- 顶栏实时显示 DeepSeek 账户余额（读取 `~/.dsh/.credentials.yaml` 中的 `DEEPSEEK_API_KEY`），点击可刷新。
- 未配置 API Key 时明确提示；密钥不进入界面回显。

### ⚡ 更新器网络优化
- 更新下载自动走系统代理（环境变量优先，其次 Windows 系统代理）。
- 元数据请求超时 15s→30s、安装包下载超时 30s→180s。
- 保留国内社区镜像优先、GitHub 自动回退与 SHA-256 强制校验。

### 📦 构建与发布
- 新增 `scripts/publish-release.cjs` 一键发布脚本（凭据来自 Git Credential Manager）。
- 版本升级至 1.05.0。

## [1.04.1] - 2026-08-xx

### 国内更新线路
- 新增"自动（国内优先）"下载模式，内置社区镜像失败后自动回退 GitHub 官方线路。
- 新增"仅 GitHub"和"自定义镜像"模式。
- 下载界面实时显示当前线路；线路失败后自动尝试下一条线路。
- 任一线路发生 SHA-256 不一致时立即丢弃文件，只有匹配官方校验值的安装包才能启动。

## [1.04.0] - 2026-08-xx

### 视觉 API 配置
- ModLens 视觉 API 设置：配置 Gemini、Anthropic 或任意 OpenAI 兼容多模态端点。
- 检测引擎状态并在保存后自动重启 Harness；API Key 不进入项目或 Git。
- 安全策略与故障说明见 `docs/RELEASE_NOTES_1.04.0_CN.md`。

### 其他
- 社区插件中心、Skill 管理、插件启用/停用/卸载、路径识别、安装版与便携版等基础能力（详见 README）。
