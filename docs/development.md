# 开发与新增引擎

## 目录结构

```
index.js              Config 定义、provider 注册、引擎链装配
client.js             设置页（浏览器侧），占用 plugins.row.config 插槽
lib/
  bridge.js           /api/dsh-onesearch/* 路由，读写走 Settings 服务
  query.js            site: / -site: / after: / before: 解析
  engines/
    index.js          引擎注册表、resolveEngine、runChain
    yuanbao.js        腾讯元宝 WSA 客户端
    doubao.js         火山引擎联网搜索客户端
    bing-html.js      免密钥兜底（解析 Bing 结果页）
locale/{zh,en}.json   插件名与描述
test/parse.test.mjs   纯逻辑单测（解析 + 链降级 + 过滤排序 + key 门禁）
cordis.patch.yml      bundle patch 默认配置
icon.svg
```

## 本地开发

```bash
npm install                  # link: 安装时宿主不替插件解析 bare import
node --test test/*.test.mjs  # 纯逻辑单测，不联网
```

`@deepseek-ai/schemastery` 是运行期真实依赖。插件以 `link:` 方式装进 profile 时，模块按真实路径解析，宿主不会代理解析——缺了它会在加载阶段 `ERR_MODULE_NOT_FOUND`，插件行停在 `inactive`，设置页也不会出现。这就是为什么它写在 `dependencies` 而不是 `peerDependencies`。

改完代码后让宿主重载插件即可（`plugin_manager` 里 disable → enable），配置字段标了 `.volatile()` 的部分连重载都不用。

## 新增一个引擎

以加一个 `foo` 为例，四处都要动：

1. **写客户端** `lib/engines/foo.js`：导出一个 `searchFoo({ apiKey, query, site, count, timeoutMs, signal })`，返回 `{ hits, tookMs }`；抛出的错误带 `code` 字段，链会把 `code + message` 记进失败原因。
2. **注册到注册表** `lib/engines/index.js` 的 `ENGINES`：

   ```js
   foo: {
     id: 'foo', label: 'Foo 搜索', vendor: '厂商名',
     needsKey: true,
     key: { field: 'fooApiKey', envField: 'fooApiKeyEnv', env: 'FOO_API_KEY' },
     filters: { site: true, exclude: false, date: false },
     hint: '一句话说明它擅长什么、缺什么',
     count: (n) => n,                       // 必要时吸附到 API 接受的值
     async run(query, { maxResults, signal, cfg, filters }) { ... },
   }
   ```

3. **加配置字段** `index.js` 的 `Config`：`fooApiKey`（`.role('secret')`）和 `fooApiKeyEnv`。
4. **接进链** `index.js` 的 `chain()`：`keys` 对象里补 `foo: { apiKey: config.fooApiKey, apiKeyEnv: config.fooApiKeyEnv }`。

第 4 步最容易漏：`chain()` 的 `keys` 是手写的映射表，不补上新引擎的 key，它会被当成“缺 key”永远跳过。

其余部分是自动的：设置页的引擎行和 KEY 卡从 `/state` 的 `known` / `engines` 生成，`/mutate` 的白名单也从 `ENGINES` 推导。想让新引擎默认开启，再把它加进 `DEFAULT_ENGINES`。

`filters` 声明要诚实——声明了 `date: true` 却忽略时间过滤，会让链把不该提前的引擎提到前面。

## 单测

`node --test` 覆盖三类纯逻辑：

- 响应解析（`decodePages` / `normalizeHit`，含豆包字段映射）
- 链的降级语义（抛错顺延、0 条顺延、全失败汇总、空链拒绝、缺 key 剔除）
- 过滤两段式（能兑现的优先，不能兑现的作降级并标 `degraded`）

不覆盖真实网络调用。改完引擎后的手工验证可以走 bridge 的探针：

```bash
curl -s 'http://127.0.0.1:56565/api/dsh-onesearch/probe?q=腾讯云+元宝搜索' | head -c 400
```

它返回当前 `web` 选中的 provider、注册了哪些 provider，以及这一次实际拿到的前三条结果。

## 发布前自检

```bash
npm test
npm pack --dry-run      # 确认 docs/、locale/、cordis.patch.yml、icon 都在包里
```

发布流程见 [release.md](release.md)。
