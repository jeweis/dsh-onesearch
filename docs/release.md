# 发布流程

本插件的发布遵守工作区规范：

- [GitHub + npm 发布规范](../../../docs/github-npm-release.md)
- [GitHub 仓库与发现规范](../../../docs/github-repository.md)

## 仓库与包标识

| 项 | 值 |
| --- | --- |
| GitHub 仓库 | `jeweis/dsh-onesearch` |
| npm 包名 | `dsh-onesearch`（无作用域；bundle patch 里的 `name` 必须与它一致） |
| bundle 条目 id | `onesearch` |
| 客户端插槽 key | `dsh-onesearch#onesearch` |
| 当前版本 | `0.1.0` |

包名、bundle patch 的 `name`、profile 里的依赖名三者必须完全一致，否则插件能装但不会挂载。

## 版本号

首次发布已手动打 tag `v0.1.0`。之后按语义化版本推进：

```bash
npm version patch --no-git-tag-version   # 同时更新 package.json 与 lockfile
npm test
npm pack --dry-run
git commit -am "release: vX.Y.Z"
git tag vX.Y.Z
git push origin main --tags
```

`npm pack --dry-run` 的清单必须包含 `index.js`、`client.js`、`lib/`、`docs/`、`locale/`、`icon.svg`、`cordis.patch.yml`。不得包含 `node_modules/`、`.env*`、本机路径。

## 首次发布状态

`dsh-onesearch` 在 npm 上**尚不存在**（查询返回 404），属于新包。按规范，新包需要先在可信终端完成一次本机首发，再为这个包单独配置 Trusted Publisher：

```bash
npm whoami --registry=https://registry.npmjs.org/
npm ci --ignore-scripts
npm test
npm pack --dry-run
npm publish --access public --registry=https://registry.npmjs.org/
```

首发成功后核对精确版本元数据、包列表与实际 tarball；短暂 404 是传播缓存，不要改版本重发。

## 待补齐

- [ ] `.github/workflows/publish.yml` 与 `scripts/publish-check.mjs`（从工作区 `templates/github-npm/` 复制，并把 `OWNER/REPOSITORY` 换成 `jeweis/dsh-onesearch`）
- [ ] npm Trusted Publisher 连接（Repository 填 `dsh-onesearch`，Workflow filename 填 `publish.yml`）
- [ ] GitHub 仓库 Description 与 topics（`dsh-plugin`、`deepseek-harness`、`dsh`、`web-search`、`meta-search`）
- [ ] 一次真实版本升级后的 OIDC 自动发布验证

在以上完成前，README 只声明 GitHub 地址安装，不声明 npm 安装。
