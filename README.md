# 一个搜索 · dsh-onesearch

一个搜索接缝（`ctx.web`）+ 一条**有序引擎链**。每个引擎单独开关、可拖动排序；前一个失败或返回 0 条就自动顺延下一个；默认接管 DSH 的内置 `web_search`。

## 它解决什么

DSH 的搜索是「一个 provider 说了算」：哪个插件最后抢到 `ctx.web.searchProviderId`，`web_search` 就用谁，失败了就直接报错。一个搜索把这层换成一个**可排序的链**：

```
web_search → onesearch → ① 元宝搜索 ─失败/0条→ ② 豆包搜索 ─失败/0条→ ③ Bing 网页
```

- 顺序 = 优先级，`engines` 数组第 0 位最先跑
- 每个引擎有独立开关，关掉的直接跳过
- 单个引擎失败**不**让整次搜索失败，只在全部失败时汇总报错，并带上每个引擎的原因
- 需要 key 的引擎没配 key 会被自动跳过（不会占着第一位空转）

## 引擎

| id | 名称 | 需要 key | 说明 |
|---|---|---|---|
| `yuanbao` | 元宝搜索 | ✅ `sk-…` | 腾讯 WSA，中文优先，支持站点/时效/垂域过滤 |
| `doubao` | 豆包搜索 | ✅ | 火山引擎联网搜索，中文与资讯覆盖好、响应快；支持站点过滤，不读时间区间 |
| `bing-html` | Bing 网页 | ❌ | 免密钥兜底，防止主引擎挂掉时整个搜索失败 |

新增引擎：在 `lib/engines/` 加一个模块，在 `lib/engines/index.js` 的 `ENGINES` 里登记（`needsKey` + `key: { field, envField, env }` + `run(query, { maxResults, signal, cfg, filters, raw })`），设置页会自动出现这一行和它的 API KEY 输入框。

## 配置界面

**Settings → Plugins → 一个搜索** 行点「配置」进入页面：

- **引擎优先级**：拖动左侧 `⠿` 把手调整顺序，右侧开关单独启停；顺序与开关即时生效（`Config` 字段声明了 `.volatile()`，不需要重启插件）
- **每个引擎的 API KEY**：需要 key 的引擎各一张卡（元宝、豆包），密码框写入、永不回显，只显示「已配置/缺少」
- **默认搜索**：是否接管内置 `web_search`

页面通过 Host 的 `/api/dsh-onesearch/*` 读写，落盘由 Settings 服务完成（写进 `cordis.patch.yml`），页面本身不碰文件。

## 工具

本插件**不新增任何工具**。模型侧仍然只有 DSH 内置的 `web_search` / `web_fetch`，不含任何搜索引擎的名字：

| 工具 | 归属 | 变化 |
|---|---|---|
| `web_search` | DSH 内置 | 内容改由本插件的引擎链回答 |
| `web_fetch` | DSH 内置 | 不变 |


### 用通用操作符表达过滤

引擎的站点/时间过滤不另开工具，而是走任何搜索框都懂的操作符，由**支持它的引擎**翻译，不支持的引擎忽略：

| 写法 | 含义 | 元宝 | 豆包 |
|---|---|---|---|
| `site:cloud.tencent.com 关键词` | 只搜这个域 | `Site` | `Filter.Sites` |
| `关键词 -site:csdn.net -site:zhihu.com` | 排除域名（最多 5 个） | `Site: exclude:a\|b` | 不支持，忽略 |
| `关键词 after:2026-01-01` | 该日期之后 | `Freshness` 区间 | 不支持，忽略 |
| `关键词 before:2026-06-30` | 该日期之前 | `Freshness` 区间 | 不支持，忽略 |

`after`/`before` 可以只写一个；解析由 `lib/query.js` 完成，Bing 引擎拿到的是**未剥离**的原始查询（它自己也认这些操作符）。

带过滤条件时，**支持该过滤的引擎排到前面**；不支持的引擎不会被直接丢掉，而是排到后面作为降级选项，真到它作答时结果会带 `（忽略时间过滤）` 这样的标注——宁可比要求的宽一点，也不空手而归。

## 配置

```yaml
- id: onesearch
  name: dsh-onesearch
  config:
    engines:
      - { id: yuanbao, enabled: true }
      - { id: doubao, enabled: true }
      - { id: bing-html, enabled: true }
    yuanbaoApiKey: 'sk-…'          # 或留空读 yuanbaoApiKeyEnv
    yuanbaoApiKeyEnv: WSA_API_KEY
    doubaoApiKey: '…'              # 或留空读 doubaoApiKeyEnv
    doubaoApiKeyEnv: DOUBAO_API_KEY
    defaultCount: 10
    searchTimeoutMs: 20000
```

## 和其他搜索插件的关系

- **dsh-free-search**：它注册自己的 provider 和自己的工具（`advanced_search` / `multi_search` / `platform_search` / `web_fetch` 等）。一个搜索只接管 **`web_search` 这一个入口**；free-search 的其它工具照常可用，但它内部仍走它自己的引擎，不经过本链。接管靠的是 `web` 条目的 `searchProvider` 配置（运行时给 `ctx.web.searchProviderId` 赋值不会生效——服务在构造时就读取了它）。
- **ds-bot 的 `auto` provider**（原生搜索 + 免密钥兜底）：同一个接缝上的另一个 provider，不冲突，只是二选一；被本插件接管时它不再服务 `web_search`。
- 想切回来：设置页关掉「默认搜索」（它会把 `web.searchProvider` 写回 `auto`），或手工在 `cordis.patch.yml` 里改 `- id: web` 的 `searchProvider`。

## 开发

```bash
npm install                 # linked 安装时宿主不替插件解析下列依赖
node --test test/*.test.mjs # 纯逻辑单测（解析 + 优先级链），不联网
```

`@deepseek-ai/schemastery` 是运行期真实依赖：`link:` 安装时模块按真实路径解析，缺了会在加载阶段 `ERR_MODULE_NOT_FOUND`，插件行停在 inactive，设置页也不会出现。
