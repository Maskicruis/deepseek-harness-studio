# DeepSeek Harness Studio v1.05.0

> 版本：1.05.0 ｜ 发布时间：2026-08-21 ｜ [GitHub Release](https://github.com/Maskicruis/deepseek-harness-studio/releases/tag/v1.5.0)

## 🖼️ 视觉模块重做：接入阿里千问

- **新增「阿里千问 Qwen-VL」视觉引擎**：设置 → 视觉 API 中一键选择，接入阿里云百炼 DashScope 的 OpenAI 兼容端点，国内直连、无需代理。
- **自动填充端点与模型**：`https://dashscope.aliyuncs.com/compatible-mode/v1` 与 `qwen-vl-max` 已预填，只需粘贴阿里云百炼 API Key（`sk-` 开头）即可使用。
- 底层复用 ModLens 的 OpenAI 兼容引擎，保留原有引擎：OpenAI 兼容、Gemini、Anthropic、Claude CLI、Antigravity CLI，以及自动故障转移。
- 修复了此前"视觉引擎不可用"的问题（ModLens 已安装但未配置任何可用引擎、默认引擎缺失）。

**配置步骤**：

1. 打开「偏好设置 → 视觉能力」；
2. 视觉引擎选择「阿里千问 Qwen-VL」；
3. 粘贴 [阿里云百炼控制台](https://bailian.console.aliyun.com/) 生成的 DashScope API Key；
4. 点「保存并重启」，之后直接粘贴图片或提供本地图片路径即可识别。

## 💰 新增 Token 余额显示

- 顶栏新增余额徽标，实时显示 DeepSeek 账户余额（`¥ xx.xx`），点击可手动刷新。
- 自动读取 `~/.dsh/.credentials.yaml` 中的 `DEEPSEEK_API_KEY`，调用 DeepSeek 官方 `/user/balance` 接口查询。
- 未配置 API Key 时显示「未配置 Key」，查询失败时显示「查询失败」并给出原因；密钥不会进入界面回显或任何日志。

## ⚡ 更新器网络优化

- 更新下载**自动走系统代理**：优先读取 `HTTPS_PROXY` / `HTTP_PROXY` 等环境变量，其次读取 Windows 系统代理（HKCU Internet Settings），无代理时自动直连。
- 放宽超时：元数据请求 15s → 30s，安装包下载 30s → 180s，减少大文件断流。
- 保留 v1.04.1 的国内社区镜像优先、GitHub 自动回退与 SHA-256 强制校验策略。

**效果**：配合系统代理（如 Clash）时，146 MB 安装包下载从约 130 KB/s（且频繁断流）提升到 10+ MB/s。

## 📦 构建与发布

- 新增 `scripts/publish-release.cjs`：一键发布 Release 到 GitHub（通过 Git Credential Manager 读取凭据，不硬编码 Token），自动上传安装包、blockmap 与 SHA256SUMS.txt。
- 构建产物：`DeepSeek-Harness-Studio-Setup-1.05.0-x64.exe`（安装版）、`DeepSeek-Harness-Studio-Portable-1.05.0-x64.exe`（便携版）。

## 升级

v1.04.x 用户可在「偏好设置 → 软件更新」中直接检查并覆盖升级，无需卸载，也不会删除工作区、会话、插件、Skills 或 ModLens 配置。
