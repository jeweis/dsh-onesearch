# 配置项与排障

设置页（**设置 → 插件 → 一个搜索 → 配置**）覆盖日常需要改的全部内容：引擎顺序、引擎开关、两个 API KEY、是否接管 `web_search`。本文档记录完整的配置字段、环境变量与常见问题，供手工调整或排障使用。

## 完整配置

配置属于 profile 的 patch 层，名字空间是 `onesearch`（也就是 bundle patch 里的条目 id）：

```yaml
- id: onesearch
  name: dsh-onesearch
  config:
    engines:
      - { id: yuanbao,   enabled: true }
      - { id: doubao,    enabled: true }
      - { id: bing-html, enabled: true }
    yuanbaoApiKey: ''            # 留空则读 yuanbaoApiKeyEnv
    yuanbaoApiKeyEnv: WSA_API_KEY
    doubaoApiKey: ''             # 留空则读 doubaoApiKeyEnv
    doubaoApiKeyEnv: DOUBAO_API_KEY
    defaultCount: 10
    searchTimeoutMs: 20000
```

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `engines` | `{ id, enabled }[]` | 元宝 → 豆包 → Bing | 数组顺序即优先级。未知 id 会被忽略；`enabled: false` 直接跳过 |
| `yuanbaoApiKey` | string | `''` | 元宝搜索 API KEY（`sk-…`），`role: secret`，设置页不回显 |
| `yuanbaoApiKeyEnv` | string | `WSA_API_KEY` | 上面为空时读取的环境变量名 |
| `doubaoApiKey` | string | `''` | 豆包搜索（火山引擎联网搜索）API KEY，`role: secret` |
| `doubaoApiKeyEnv` | string | `DOUBAO_API_KEY` | 上面为空时读取的环境变量名 |
| `defaultCount` | number | `10` | 默认返回条数，10–50，步长 10 |
| `searchTimeoutMs` | number | `20000` | 单引擎超时；超时视为该引擎失败，顺延下一个 |

`engines`、两个 KEY、`defaultCount`、`searchTimeoutMs` 都声明了 `.volatile()`，改动**不需要重启插件**。

设置页能写回的只有 `engines` 和两张 KEY 卡对应的字段。`defaultCount` 和 `searchTimeoutMs` 目前只能改上面的 YAML。

## KEY 的优先级

单个引擎取 key 的顺序：

1. 配置里的 `yuanbaoApiKey` / `doubaoApiKey`
2. 字段为空时，读 `yuanbaoApiKeyEnv` / `doubaoApiKeyEnv` 指向的环境变量（默认 `WSA_API_KEY` / `DOUBAO_API_KEY`）
3. 都没有 → 该引擎被判为不可用，**自动从链里跳过**，不占位、不报错

所以“配了 key 但报错”和“没配 key”是两种不同状态：后者在设置页显示 `缺少 API KEY`，前者会显示失败原因。

## 接管默认搜索

`web_search` 到底由谁作答，是 `web` 条目的配置决定的：

```yaml
- id: web
  config:
    searchProvider: onesearch   # 填 onesearch 即由本插件接管；改回去即交还
    fetchProvider: http
```

设置页的 **默认搜索** 开关写的就是这一行，并且**立即生效**：`WebRuntime` 只在构造时读配置，所以页面在写配置的同时会把运行中的 `searchProviderId` 一并改掉，不需要重启插件或 Harness。

如果重启后你发现搜索又换回了别的引擎（典型是装过 `dsh-free-search`、看到它在作答），那是它在启动时抢占了这条接缝；本插件随后会把选择纠正回来。仍不对的话看设置页 **默认搜索** 开关状态和下方排障表。

## 排障

| 现象 | 原因与处理 |
| --- | --- |
| 设置页显示 `缺少 API KEY`，但配置里明明填了 | 该引擎的 key 字段名与引擎 id 不匹配时会被忽略；确认填的是 `yuanbaoApiKey` / `doubaoApiKey`，不是环境变量名 |
| 报 `UnauthorizedOperation`（元宝） | KEY 无效或已被删除；也常见于短时间并发过高被拒。单次调用内部会静默重试一次（间隔 800ms），连续出现请降低频率 |
| 报 `ResourceUnavailable`（元宝） | 账号欠费或服务不可用，检查腾讯云费用中心 |
| 报 `Forbidden` / `Unauthorized`（豆包） | 火山引擎控制台未开通「联网搜索」，或 KEY 不属于该服务 |
| 搜索变慢、末尾出现 Bing 结果 | 前面的引擎失败或超时了，链已降级到 `bing-html`。看插件日志里的 `onesearch: … answered after …` 一行能确认是谁答的 |
| 结果里出现「（忽略时间过滤）」 | 当次查询带 `after:` / `before:`，而作答的引擎（豆包/Bing）不支持时间过滤。想让时间过滤真正生效，把元宝排在它们前面并打开 |
| `web_search` 完全不走这条链 | 先看设置页 **默认搜索** 开关。若开着却仍不走，多半是别的搜索插件（`dsh-free-search`）在启动时抢占了接缝；把本插件关掉再打开会重新纠正。排障接口 `GET /api/dsh-onesearch/state` 里的 `activeProvider` 是运行时真相，`webProvider` 是配置值，两者不一致就说明没接管成功 |
| 插件行停在 inactive、设置页不出现 | 依赖没装。`link:` 安装时宿主不会替插件解析 bare import，需要在插件目录执行一次 `npm install`，见 [开发文档](development.md) |
| 两个“配置”页搞混 | `dsh-free-search` 也会在插件页注册自己的配置行，两者互不影响，认准行名「一个搜索」 |
