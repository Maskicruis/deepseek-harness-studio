# DeepSeek Harness Studio v1.07.3

> 版本：1.07.3 ｜ [GitHub Release](https://github.com/Maskicruis/deepseek-harness-studio/releases/tag/v1.07.3)

## 🐛 修复：ModLens 后可切回普通模型

此前，只要当前会话使用过 ModLens 读取图片，Harness 就会因为历史记录中含有图片而拒绝切换到 `DeepSeek-V4-Flash` 或 `DeepSeek-V4-Pro`。下拉菜单看似发生变化，实际会收到 `model-unavailable` 错误。

v1.07.3 已修复这一问题：

- 使用 ModLens 识图后，可以在同一会话直接切回普通 DeepSeek 文本模型；
- 原始提问文字、工具结果以及 ModLens 输出的图片分析结论都会继续保留；
- 纯文本 API 不会收到它无法处理的历史图片二进制数据，图片位置会替换为明确的文字占位；
- 如果输入框中仍有一张尚未发送的新图片，系统仍会要求先选择带 `(modlens vision)` 的模型，避免图片被意外忽略。

## 📦 安装与升级

- 推荐下载 `DeepSeek-Harness-Studio-Setup-1.07.3-x64.exe`；
- 安装向导支持自定义安装目录；
- 从旧版本升级时直接覆盖原安装目录，无需先卸载，会话、工作区、API 配置、插件与 Skills 均会保留；
- 便携使用可下载 `DeepSeek-Harness-Studio-Portable-1.07.3-x64.exe`；
- Release 同时提供 `SHA256SUMS.txt`，可验证安装版和便携版的完整性。

## ✅ 验证

- 完整自动化测试通过；
- DSH API Proxy 与 DeepSeek 文本适配器通过语法检查；
- 模型切换兼容补丁会在 `npm install` 和发布构建阶段自动检查并应用，后续构建不会丢失修复。
