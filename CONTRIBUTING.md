# Contributing

感谢你愿意改进 DeepSeek Harness Studio。

## 本地开发

```powershell
npm install
npm test
npm run dev
```

提交 Pull Request 前，请确保：

- `npm test` 全部通过；
- `npm run build:web` 可以完成；
- 界面变更在 1280×720 和 1440×900 下均可用；
- 不提交 API Key、用户会话、`.dsh` 数据或商业证书；
- 新增插件能力时说明权限边界与失败回退。

请尽量让一次 PR 只解决一个问题，并附上修改前后截图或验证记录。

## 品牌与项目身份

本项目是非官方社区项目。贡献内容不得暗示 DeepSeek 官方赞助、背书或所有权，也不得加入未经许可的第三方商标素材。
