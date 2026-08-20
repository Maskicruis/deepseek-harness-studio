# 应用内更新与 GitHub Release

DeepSeek Harness Studio 1.3.0 起支持应用内更新。程序会读取公开 GitHub 仓库的最新正式 Release，比较版本号，并由用户决定是否下载和安装。

## 从 v1.0 升级

v1.0 本身没有更新模块，因此只需要手动运行一次 1.3.0 或更高版本的安装程序。安装时选择原来的安装目录即可覆盖升级，不必先卸载。应用数据、会话、插件与 Skills 位于 `%USERPROFILE%\.dsh`，Studio 设置位于 Electron 的用户数据目录，都不会被安装程序主动删除。

从 1.3.0 开始，后续版本可在“偏好设置 → 软件更新”中完成检查、下载和覆盖安装。

## 安全规则

- 只访问 HTTPS GitHub API 和 Release 下载链接。
- 只识别名称为 `DeepSeek-Harness-Studio-Setup-<version>-x64.exe` 的安装包。
- 下载前必须从 GitHub asset digest 或 `SHA256SUMS.txt` 获得 SHA-256。
- 下载完成后再次计算 SHA-256；不一致则删除临时文件且禁止安装。
- 不静默安装。只有用户点击“安装并重启”后才启动安装程序。

## 设置更新仓库

本地构建前运行：

```powershell
npm run update:configure -- owner/repository
npm run dist
```

该命令会写入 `build/update-config.json`。最终用户也可以在设置页填写另一公开仓库；留空时使用发行包内置仓库。

## 自动发布

仓库内的 `.github/workflows/release.yml` 会在推送 `v*.*.*` 标签时：

1. 安装依赖并自动把当前 GitHub 仓库写入更新配置；
2. 运行测试并构建安装版和免安装版；
3. 生成 `SHA256SUMS.txt`；
4. 创建 GitHub Release 并上传安装包、免安装包、blockmap 与校验清单。

发布新版本时，先同步修改 `package.json` 与 `package-lock.json` 的版本，再提交并打标签：

```powershell
git tag v1.3.0
git push origin main --tags
```

应用只读取“最新正式 Release”。请勿把面向所有用户的版本标记为 draft 或 prerelease。
