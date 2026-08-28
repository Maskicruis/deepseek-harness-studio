# DeepSeek Harness Studio v1.09.0

> 版本：1.09.0 ｜ 发布时间：2026-08-28 ｜ [GitHub Release](https://github.com/Maskicruis/deepseek-harness-studio/releases/tag/v1.09.0)

## 本次更新

### 真实互联网搜索

- 接入 Harness 官方 DeepSeek `web_search`，使用已有 DeepSeek API 配置搜索当前互联网内容。
- 搜索过程以工具卡片显示在对话中，回答可保留真实来源，不再局限于本地文件或模型训练数据。
- 为避免访问本机和内网服务，本版不启用 DSH rc.7 中缺少完整 SSRF 防护的匿名 URL 抓取组件。

### 逐次授权的电脑控制

- 新增桌面截图、可见窗口读取/聚焦、鼠标移动/点击/滚动、Unicode 文字输入与受限快捷键。
- “真实桌面控制”默认关闭，可在“偏好设置 → 智能体能力”中启用。
- 每个动作都会在 Harness 对话中显示并等待一次性批准；拒绝或审批不可用时不会执行。
- 截图要求当前模型支持图片输入；建议使用 DeepSeek V4 Flash Vision Exp。
- 密码、UAC、安全验证、支付和破坏性确认继续要求用户亲自操作。

### 跨设备与验证

- 内置组件在启动时部署到当前用户的 DSH profile，不使用开发电脑的盘符、用户名或工程路径。
- 44 项原有/新增自动化测试通过；额外通过隔离 DSH home 真实启动、窗口枚举和 1920×1080 截图冒烟验证。

## 升级

在“偏好设置 → 软件更新”检查 v1.09.0，选择国内镜像或 GitHub 线路下载，随后使用安装向导覆盖升级；会话、插件、Skills 和 API 配置仍保存在 `%USERPROFILE%\.dsh`。
