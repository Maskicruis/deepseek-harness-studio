# DeepSeek Harness Studio v1.07.2

> 版本：1.07.2 ｜ [GitHub Release](https://github.com/Maskicruis/deepseek-harness-studio/releases/tag/v1.07.2)

## 🔧 更新方式调整

- 移除静默自动更新，改为「下载安装包 + 安装向导」手动覆盖安装，可自定义安装目录，更稳定可靠。

## 📄 文档读取（PDF / Word / Excel）

本版本在生态组件中新增「文档读取」组件（`dsh-plugin-doc-reader`），为模型增加 `read_document` 工具：

- 支持按**文件路径**读取 PDF、Word（docx）、Excel（xlsx）与纯文本文件；
- 该工具挂在 Harness 上、与所选模型无关，因此 `flash`、`pro`、带 `(modlens vision)` 的模型都能读文档。

**为什么用「文件路径」而不是拖拽上传？**

Harness 官方聊天输入框目前只接受图片（PNG、JPG、WebP、GIF），不能直接拖入 PDF、Word、Excel。因此读文档请直接告诉模型文件路径，例如：

```text
读取 C:\Users\你的用户名\Documents\报告.docx 的内容并总结
读取 D:\数据\统计.xlsx，统计共有多少行
```

模型会调用 `read_document` 读取并返回内容。

## 🧭 使用说明：模型切换报错

在已经包含图片的会话里，切换到纯文本模型（如 `DeepSeek-V4-Flash` / `Pro`）会报错：

> model-unavailable: Model "..." does not accept image input, but this session already contains images.

这是 Harness 的**安全机制**，不是故障：

- 会话里有图片 → 使用名称带 `(modlens vision)` 的模型；
- 想用纯文本模型 → 新建一个不含图片的会话。

## 升级

v1.06.0 及更早版本可在「偏好设置 → 软件更新」中检查并下载更新，点「安装并重启」后按安装向导完成覆盖安装（可自定义安装目录）。

> 版本号说明：小版本号中位补零（1.6 → 1.06、1.07、1.08、1.10 依此类推）。
