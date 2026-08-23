# DeepSeek Harness Studio v1.07.4

> 版本：1.07.4

## 插件启动自愈

- 应用启动、手动重启以及每次插件操作后都会检查 Harness 是否真正进入运行状态。
- 除了验证 `package.json` 和 bundle patch，还会确认 patch 引用的 loader 模块能够从当前 profile 加载。
- 若插件清单看似正常但初始化时仍导致 Harness 崩溃，Studio 会通过真实启动探测分组定位故障组件，并自动恢复其余可用组件。
- 故障插件只会被隔离，不会卸载，也不会删除独立配置。
- 隔离记录会持久保存，防止安装其他组件时被 DSH 包管理器意外重新启用。
- 更新或修复隔离组件后会重新进行真实启动验证，通过后自动恢复启用。

## 已知上游问题

`@paicat1/dsh-screenshot@1.0.0` 的 bundle patch 引用了不存在的 `dsh-screenshot` loader，因此该版本会被自动隔离，暂不提供精选安装入口。ModLens、PPTFast、DSH Backup 和文档读取组件已经通过组合启动验证。

## 验证

- 普通 DeepSeek Flash / Pro 模型目录加载正常；
- ModLens Vision Flash / Pro 模型目录加载正常；
- 模型 Provider 失败数为 0；
- 插件管理与启动隔离自动化测试全部通过。
