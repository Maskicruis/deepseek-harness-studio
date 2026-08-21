# DeepSeek Harness Studio v1.06

> 版本：1.06.0 ｜ [GitHub Release](https://github.com/Maskicruis/deepseek-harness-studio/releases/tag/v1.06.0)

## 🖼️ 视觉模块简化：默认阿里千问

此前「视觉引擎」下拉框把阿里千问、Gemini、Anthropic、Claude CLI、Antigravity CLI、OpenAI 兼容等一长串选项混在一起，容易让人误以为视觉走的是 Claude / codex。本版本做了简化：

- **默认只展示「阿里千问 Qwen-VL」**：接入阿里云百炼 DashScope 的 OpenAI 兼容端点，国内直连、无需代理。
- 其余引擎（Gemini、Anthropic、Claude CLI、OpenAI 兼容等）折叠进「高级引擎」，点一下即可展开，功能不受影响。
- **未配置时默认引导到阿里千问**：只需粘贴阿里云百炼 API Key（`sk-` 开头），端点与模型已预填 `https://dashscope.aliyuncs.com/compatible-mode/v1` 与 `qwen-vl-max`。

**结论**：ModLens 是「视觉桥」，主智能体仍用 DeepSeek 文本模型；视觉交给阿里千问 Qwen-VL，不再与 Claude / codex 相关。

**配置步骤**：

1. 打开「偏好设置 → 视觉能力」；
2. 视觉引擎默认就是「阿里千问 Qwen-VL」；
3. 粘贴 [阿里云百炼控制台](https://bailian.console.aliyun.com/) 生成的 DashScope API Key；
4. 点「保存并重启」，之后直接粘贴图片或提供本地图片路径即可识别。

## ⚡ 静默覆盖升级

从本版本起，更新不再走安装向导：

- 安装包改为 **one-click 静默模式**；点击「立即更新」后，自动覆盖安装到原目录并重启应用，**无需再点下一步、无需重新选择安装目录**。
- 更新前应用自动退出释放文件占用，安装完成后自动重启；工作区、会话、插件、Skills 与 ModLens 配置全部保留。
- 仍沿用原有的 GitHub Release 检测、国内镜像优先、自动回退与 SHA-256 强制校验。

## 升级

v1.5.0 及更早版本（含旧版安装向导安装的版本）都可在「偏好设置 → 软件更新」中直接升级：先下载更新包，再点「立即更新」，即可静默覆盖安装并自动重启，无需卸载、无需重新走安装流程。

> 版本号说明：从本版本起，小版本号中位补零（1.6 → 1.06），与后续 1.07、1.08、1.10 等版本对齐。
