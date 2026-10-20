import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decodePages, normalizeHit } from '../lib/engines/yuanbao.js'

const LIST_FIXTURE = `
<ul class="news-list">
  <li id="sogou_vr_11002601_box_0" d="x">
    <h3><a target="_blank" href="/link?url=abc&amp;type=2" id="sogou_vr_11002601_title_0"><em><!--red_beg-->大模型<!--red_end--></em>训练有多卷? &amp; 算力</a></h3>
    <p class="txt-info" id="sogou_vr_11002601_summary_0">摘要&ldquo;内容&rdquo;...</p>
    <div class="s-p"><span class="all-time-y2">钛媒体</span><span class="s2"><script>document.write(timeConvert('1697450390'))</script></span></div>
  </li>
  <li id="sogou_vr_11002601_box_1" d="y">
    <h3><a href="/link?url=def"><em><!--red_beg-->大模型<!--red_end--></em>第二篇</a></h3>
    <div class="s-p"><span class="all-time-y2">量子位</span></div>
  </li>
</ul>`

test('decodePages tolerates objects, JSON strings and garbage', () => {
  const pages = decodePages(['{"title":"a","url":"u"}', { title: 'b' }, 'not json'])
  assert.equal(pages.length, 3)
  assert.equal(pages[0].title, 'a')
  assert.equal(pages[1].title, 'b')
  assert.equal(pages[2].url, '')
})

test('normalizeHit prefers dynamic content and rounds the score', () => {
  const hit = normalizeHit({ title: ' T ', url: ' u ', passage: 'p', content: 'c  c', score: 0.87654, pics: [1, 2] })
  assert.equal(hit.title, 'T')
  assert.equal(hit.url, 'u')
  assert.equal(hit.summary, 'c c')
  assert.equal(hit.score, 0.877)
  assert.equal(hit.pics, 2)
})

// ---- the priority chain ---------------------------------------------------

import { resolveEngine, runChain } from '../lib/engines/index.js'

test('chain falls through to the next engine when one throws', async () => {
  const engines = [
    { id: 'a', label: 'A', run: async () => { throw new Error('boom') } },
    { id: 'b', label: 'B', run: async () => ({ sources: [{ url: 'https://ok.example' }] }) },
  ]
  const result = await runChain(engines, 'q', {})
  assert.equal(result.engine, 'b')
  assert.equal(result.sources.length, 1)
  assert.match(result.tried.join(' '), /A：boom/)
})

test('chain treats an empty engine as a failure', async () => {
  const engines = [
    { id: 'a', label: 'A', run: async () => ({ sources: [] }) },
    { id: 'b', label: 'B', run: async () => ({ sources: [{ url: 'https://ok.example' }] }) },
  ]
  const result = await runChain(engines, 'q', {})
  assert.equal(result.engine, 'b')
})

test('chain reports every engine when all fail', async () => {
  const engines = [
    { id: 'a', label: 'A', run: async () => { throw new Error('quota') } },
    { id: 'b', label: 'B', run: async () => { throw new Error('blocked') } },
  ]
  await assert.rejects(() => runChain(engines, 'q', {}), /A：quota → B：blocked/)
})

test('chain refuses to run with no usable engine', async () => {
  await assert.rejects(() => runChain([], 'q', {}), /没有可用的搜索引擎/)
})

test('an engine needing a key is skipped until one is configured', () => {
  const cfg = { timeoutMs: 1000, defaultCount: 10 }
  assert.equal(resolveEngine({ id: 'yuanbao', enabled: true }, cfg), null)
  const withKey = resolveEngine({ id: 'yuanbao', enabled: true }, { ...cfg, keys: { yuanbao: { apiKey: 'sk-x' } } })
  assert.equal(withKey.id, 'yuanbao')
  assert.equal(resolveEngine({ id: 'yuanbao', enabled: false }, { ...cfg, keys: { yuanbao: { apiKey: 'sk-x' } } }), null)
})

// ---- generic query operators ---------------------------------------------

import { parseQuery } from '../lib/query.js'

test('site: operator is extracted and removed from the words', () => {
  const parsed = parseQuery('site:cloud.tencent.com 元宝搜索 WSA')
  assert.equal(parsed.site, 'cloud.tencent.com')
  assert.equal(parsed.text, '元宝搜索 WSA')
})

test('-site: is repeatable and capped', () => {
  const parsed = parseQuery('AI Agent -site:csdn.net -site:zhihu.com -site:a.com -site:b.com -site:c.com -site:d.com')
  assert.deepEqual(parsed.exclude, ['csdn.net', 'zhihu.com', 'a.com', 'b.com', 'c.com'])
  assert.equal(parsed.text, 'AI Agent')
})

test('date operators become an inclusive range', () => {
  const parsed = parseQuery('大模型 after:2026-01-01 before:2026-06-30')
  assert.equal(parsed.after, '2026-01-01')
  assert.equal(parsed.before, '2026-06-30')
  assert.equal(parsed.text, '大模型')
})

test('a plain query passes through untouched', () => {
  const parsed = parseQuery('普通 搜索 词')
  assert.equal(parsed.text, '普通 搜索 词')
  assert.equal(parsed.site, '')
})

// ---- doubao engine --------------------------------------------------------

import { normalizeHit as normalizeDoubao, DEFAULT_ENDPOINT as DOUBAO_ENDPOINT } from '../lib/engines/doubao.js'
import { ENGINES, DEFAULT_ENGINES } from '../lib/engines/index.js'

test('doubao hits keep url/title/snippet/date', () => {
  const hit = normalizeDoubao({
    Title: ' 元宝搜索 简介_腾讯云 ',
    Url: 'https://cloud.tencent.com/document/product/1806/121812',
    Snippet: '元宝搜索（Tencent Yuanbao Search，wsa）…',
    Summary: '',
    PublishTime: '2026-09-21T02:36:44+08:00',
    SiteName: '腾讯云',
    RankScore: 1.23456,
  })
  assert.equal(hit.title, '元宝搜索 简介_腾讯云')
  assert.equal(hit.url, 'https://cloud.tencent.com/document/product/1806/121812')
  assert.equal(hit.date, '2026-09-21T02:36:44+08:00')
  assert.equal(hit.score, 1.235)
  assert.match(DOUBAO_ENDPOINT, /^https:\/\/open\.feedcoopapi\.com\//)
})

test('the default chain is 元宝 → 豆包 → Bing, keyed engines gated by their own key', () => {
  assert.deepEqual(DEFAULT_ENGINES.map((row) => row.id), ['yuanbao', 'doubao', 'bing-html'])
  const rows = DEFAULT_ENGINES
  const withKey = rows
    .map((row) => resolveEngine(row, { timeoutMs: 1000, defaultCount: 10, keys: { doubao: { apiKey: 'x' } } }))
    .filter(Boolean)
  assert.deepEqual(withKey.map((engine) => engine.id), ['doubao', 'bing-html'])
  assert.equal(ENGINES.doubao.needsKey, true)
  assert.equal(ENGINES.doubao.key.field, 'doubaoApiKey')
})

test('filter-capable engines are tried first; the rest answer as degraded', async () => {
  const calls = []
  const stub = (id, filters) => ({
    id,
    label: id,
    filters,
    run: async () => { calls.push(id); return { sources: [{ url: `https://${id}.example/1` }] } },
  })
  const engines = [
    stub('plain', { site: true, exclude: false, date: false }),
    stub('dated', { site: true, exclude: true, date: true }),
  ]
  const result = await runChain(engines, '大模型', {
    maxResults: 1, filters: { site: '', exclude: [], after: '2026-01-01', before: '' },
  })
  assert.equal(result.engine, 'dated')
  assert.deepEqual(calls, ['dated'])
  assert.equal(result.degraded, false)

  const only = await runChain([engines[0]], '大模型', {
    maxResults: 1, filters: { site: '', exclude: [], after: '2026-01-01', before: '' },
  })
  assert.equal(only.engine, 'plain')
  assert.equal(only.degraded, true)
  assert.match(only.tried.join(' '), /忽略时间过滤/)
})
