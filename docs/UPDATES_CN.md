# 应用内更新与 GitHub Release

DeepSeek Harness Studio 1.3.0 起支持应用内更新。程序会读取公开 GitHub 仓库的最新正式 Release，比较版本号，并由用户决定是否下载和安装。自 1.6.0 起，安装改为**静默覆盖升级**：确认后自动覆盖安装到原目录并重启应用，不再弹出安装向导。

## 从 v1.0 升级

v1.0 本身没有更新模块，因此只需要手动运行一次 1.3.0 或更高版本的安装程序。安装时选择原来的安装目录即可覆盖升级，不必先卸载。应用数据、会话、插件与 Skills 位于 `%USERPROFILE%\.dsh`，Studio 设置位于 Electron 的用户数据目录，都不会被安装程序主动删除。

从 1.3.0 开始，后续版本可在“偏好设置 → 软件更新”中完成检查、下载和覆盖安装；从 1.6.0 开始，点“立即更新”即静默覆盖安装并自动重启，无需重新走安装流程。

## 安全规则

- Release 元数据与可信 SHA-256 只从 HTTPS GitHub API / GitHub Release 获取。
- 安装包传输可走内置国内社区镜像、自定义 HTTPS gh-proxy 或 GitHub 官方线路；镜像失败或校验失败时自动尝试下一条线路。
- 只识别名称为 `DeepSeek-Harness-Studio-Setup-<version>-x64.exe` 的安装包。
- 下载前必须从 GitHub asset digest 或 `SHA256SUMS.txt` 获得 SHA-256。
- 下载完成后再次计算 SHA-256；不一致则删除临时文件且禁止安装。
- 安装仍需用户点击“立即更新”确认；确认后静默覆盖安装到原目录并自动重启（one-click + `/S --updated`），不再显示安装向导，也不会删除工作区、会话、插件、Skills 或 ModLens 配置。

## 设置更新仓库

本地构建前运行：

```powershell
npm run update:configure -- owner/repository
npm run dist
```

该命令会写入 `build/update-config.json`。最终用户也可以在设置页填写另一公开仓库；留空时使用发行包内置仓库。

## 设置下载线路

“偏好设置 → 软件更新 → 更新下载线路”提供三种模式：

- **自动（国内优先）**：先尝试内置社区镜像，网络失败或 SHA-256 不一致时自动回退 GitHub。
- **仅 GitHub**：不经过镜像，直接下载官方 Release asset。
- **自定义镜像**：填写自建或团队镜像的 HTTPS 前缀，按 `<镜像前缀>/<完整 GitHub URL>` 请求；失败时仍回退 GitHub。

自定义地址兼容常见 gh-proxy 的完整 URL 转发格式，例如 `https://mirror.example.com/ghproxy`。为降低供应链风险，更新检查和校验值不会从社区镜像读取；所有线路下载完成后都必须匹配 GitHub 发布信息中的 SHA-256 才能安装。

## 可选的云端构建

仓库内的 `.github/workflows/release.yml` 可从 GitHub Actions 手动触发，它会：

1. 安装依赖并自动把当前 GitHub 仓库写入更新配置；
2. 运行测试并构建安装版和免安装版；
3. 生成 `SHA256SUMS.txt`；
4. 把安装包、免安装包、blockmap 与校验清单保存为 workflow artifact，供发布前复核。

正式 Release 由维护者在已登录的 GitHub 应用中创建并上传已复核的本地产物，避免推送标签时重复创建 Release。

发布新版本时，先同步修改 `package.json` 与 `package-lock.json` 的版本并提交源码。随后在已登录的 GitHub 应用中进入仓库的 Releases 页面，创建 `v<version>` 标签，上传安装包、blockmap 与 `SHA256SUMS.txt`，复核后发布。

应用只读取“最新正式 Release”。请勿把面向所有用户的版本标记为 draft 或 prerelease。
