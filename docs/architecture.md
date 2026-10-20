# 内部机制

给维护者看的说明：插件怎么接管搜索、链怎么跑、为什么是这些设计。

## 只接管接缝，不新增工具

Harness 的搜索是一个服务接缝：`web_search` 工具本身不关心谁在回答，它只调用 `ctx.web` 选中的 provider。

所以本插件的做法是往 `ctx.web` 注册一个 id 为 `onesearch` 的 provider，然后让 `web.searchProvider` 选中它。工具、系统提示、模型看到的调用方式全都不变。

**不注册 `yuanbao_search` / `doubao_search` 这类工具**是刻意的：工具面必须保持通用，不能被某个搜索服务的名字绑住；否则换引擎就等于换工具，模型的行为也会跟着变。过滤能力因此走 `site:` / `after:` 这类任何搜索框都懂的操作符，由引擎各自翻译。

## 谁来服务 `web_search`

`WebRuntime` 在**构造时**读一次 `searchProvider`，之后既不重读配置，也不因插件重载而更新——运行时给 `ctx.web.searchProviderId` 赋值才是真正改变选择的动作（它是 TypeScript `private`，不是 `#private`，可以被写）。

这带来一个坑：同一条接缝上的 `dsh-free-search` 会在自己的 `apply` 里做运行时接管——只要发现字段为空或仍是出厂默认 `deepseek-official`，就把 `searchProviderId` 改成它的 `ddg`。于是可能出现「设置里写着 onesearch，实际却是 ddg 在作答」：启动瞬间我们的 patch 还没进到运行时，`ddg` 先占住了位置。

因此本插件不依赖配置被读取，而是**主动重申**：

- `apply` 之后（bridge 注入完成时）如果配置里选的是 `onesearch` 而运行时不是，直接赋值把它改回来；
- 设置页的 **默认搜索** 开关除了写配置，也立即赋值，所以切换即时生效、不需要重启；
- 反过来，只要配置里不是 `onesearch`，本插件绝不去抢——用户显式选了别人就是别人。

顺序无关安全：free-search 只在字段为空或官方默认时接管，我们把字段写成 `onesearch` 之后它就只警告不抢。

## 引擎链

`lib/engines/index.js` 是注册表，每个引擎声明：

- `needsKey` + `key`：需要哪个配置字段 / 环境变量；缺 key 的引擎在解析阶段就被剔除，不进链
- `filters`：能兑现哪些过滤（`site` / `exclude` / `date`）
- `count(n)`：把请求条数吸附到该 API 接受的值（元宝只接受 10/20/30/40/50）
- `run(query, { maxResults, signal, cfg, filters, raw })`

`runChain` 的执行规则：

1. 空链直接抛错（所有引擎都关掉或都没 key）
2. 按 `filters` 把链**切成两段**：能兑现全部过滤的在前，只能部分兑现的在后
3. 依次执行；某个引擎抛错或返回 0 条，记一条失败原因后继续下一个
4. 第一个返回结果的引擎即为答案；第二段里的引擎作答时，结果标记 `degraded: true`
5. 全链失败才抛错，错误信息里按优先级列出每个引擎各自的原因

单引擎失败永远不致命——这是这个插件存在的理由，任何让它变成“一个引擎挂了整次搜索失败”的改动都是回归。

## 为什么不直接丢掉不支持过滤的引擎

带时间过滤时，把不支持时间过滤的引擎直接排除，看似更“正确”，实际会让可用引擎数骤减（豆包和 Bing 都不读时间区间，关掉元宝后链就空了）。

所以选择是：**先问能兑现的，再问不能兑现的，并用 `degraded` 标记告知“这次的时间过滤没生效”**。宁可结果宽一点，也不要空手而归，更不要假装过滤过。

## 设置页与 Host 的分工

浏览器侧（`client.js`）只做渲染，从不读写文件：

```
client.js  ──HTTP──▶  lib/bridge.js  ──▶  Settings 服务  ──▶  cordis.patch.yml
```

- bridge 注册三条路由：`GET /api/dsh-onesearch/state`、`POST /api/dsh-onesearch/mutate`、`POST /api/dsh-onesearch/takeover`（另有一条 `GET /probe` 供排障）
- 写操作有白名单：只有 `engines` 和引擎 KEY 字段可以经 `mutate` 写入，其他路径一律 400
- 每次写都读一次 descriptor 的 revision 再提交，避免和别的设置写入互相覆盖
- 落盘由 Settings 服务完成，所以 revision、secret 脱敏、patch 格式都归 Host 管，页面不碰 YAML

## 客户端渲染位置

`client.js` 占用插槽 `plugins.row.config`，key 为 `dsh-onesearch#onesearch`，也就是插件页里本插件那一行的配置位。同一个插槽被多个插件占用时各占一行，互不覆盖。

页面同时实现 `view === 'summary'`（行内一行摘要：`元宝搜索 → 豆包搜索 → Bing 网页 · 接管 web_search`）和完整页面两种形态。
