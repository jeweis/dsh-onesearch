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

## 发布记录

### 0.1.0 — 本机首发（2026-10-20 16:15:18Z）

新包，npm 上不存在（404）。本机完成首发，18 个文件 / 76,116 B，`dist.integrity` 与本地 `npm pack` 一致。

**踩到的坑：npm 现在会把 `npm publish` 送进 staging 队列。** 首发不是直接上线，而是先给包名创建一个 `0.0.0-stage` 占位版本（公开可见，内容为占位 README），真正的 0.1.0 需要维护者用 2FA 在 npmjs.com 上批准后才会上线：

- 未批准前 `registry.npmjs.org/dsh-onesearch/0.1.0` 是 404，重发会得到
  `409 Conflict — Cannot publish over previously staged version "0.1.0"`
- 批准入口：npmjs.com → 包的 **Staged Packages** 标签页（或包页面的待批准提示）
- 批准后用 `GET /-/stage` 或 `npm stage list` **查不到已批准记录**，且本机 2FA 令牌读不到该队列（`total: 0`），所以这一步只能在网页完成
- `npm stage` 子命令需要 npm ≥ 11.15；本机 11.9 没有

### 0.1.1 — OIDC 自动发布验证（2026-10-20 16:19:16Z）

推 `main` 触发 GitHub Actions [运行 39456125156](https://github.com/jeweis/dsh-onesearch/actions/runs/39456125156)，verify 与 publish 两个 job 均成功：

- 工作流不引用任何 npm 发布 Token，`id-token: write` 换 OIDC
- 发布了 SLSA v1 provenance：builder 为 GitHub 托管 runner，workflow `.github/workflows/publish.yml`，repo `https://github.com/jeweis/dsh-onesearch`
- registry 侧确认：`dist-tags.latest = 0.1.1`、18 files、76,116 B、`dist.attestations` 为 true
- **OIDC 发布不进 staging 队列**，不需要人工审批——只有本机 2FA 发布会
- 刚发布时 `npm install` 可能仍拿到旧版本（镜像/缓存传播），`npm view` 已是新版；等一会儿重装即可，不要改版本重发

Trusted Publisher 配置（`npm trust github dsh-onesearch --file publish.yml --repo jeweis/dsh-onesearch --allow-publish`）：

```
type: github  id: 8107d239-69e7-4944-9bd3-c599e92bd689
file: publish.yml  repository: jeweis/dsh-onesearch  permissions: publish, stage publish
```

## 日常发布

版本号推进后推 `main` 即自动发布，不需要本机登录 npm：

```bash
npm version patch --no-git-tag-version
npm test && npm run check && npm pack --dry-run
git commit -am "release: vX.Y.Z" && git tag vX.Y.Z
git push origin main --tags
```

`npm version` 会同时更新 `package.json` 与 `package-lock.json`，两者版本必须一致，否则 `publish-check` 会因为版本判定和 tarball 不一致而混乱。同版本文档更新推送 `main` 不会重发（`publish-check.mjs` 查到 200 且元数据匹配就跳过），要发新版必须真的升版本。

## 待补齐

- [x] `.github/workflows/publish.yml` 与 `scripts/publish-check.mjs`
- [x] npm Trusted Publisher 连接
- [x] GitHub 仓库 Description 与 topics（`dsh-plugin`、`deepseek-harness`、`dsh`、`web-search`、`meta-search`、`search-provider`）
- [x] 一次真实版本升级后的 OIDC 自动发布验证（0.1.1）
- [ ] `0.0.0-stage` 占位版本会永久留在 `versions` 列表里，属于 npm 的正常行为；如需清理需在网页操作，不影响安装
