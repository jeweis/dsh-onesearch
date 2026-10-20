/**
 * Engine registry for 「一个搜索」 (dsh-onesearch).
 *
 * An engine is the smallest unit the plugin can order, switch, and fall back
 * over. Two flavors exist:
 *   - API engines (`yuanbao`, `doubao`): need a key, return rich fields (date, score…).
 *   - Scrape engines (`bing-html`): keyless, exist so a failing primary engine
 *     degrades instead of breaking the answer.
 *
 * Priority is the position in the configured array — the settings UI reorders
 * that array by dragging.
 */

import * as yuanbao from './yuanbao.js'
import * as doubao from './doubao.js'
import * as bing from './bing-html.js'

/** Engine ids the plugin knows how to run. Order here is only the UI's debut order. */
export const ENGINES = {
  yuanbao: {
    id: 'yuanbao',
    label: '元宝搜索',
    vendor: '腾讯 WSA',
    needsKey: true,
    key: { field: 'yuanbaoApiKey', envField: 'yuanbaoApiKeyEnv', env: 'WSA_API_KEY' },
    filters: { site: true, exclude: true, date: true },
    hint: '中文优先，支持站点/时效/垂域过滤，返回相关度与权威度',
    /** WSA only accepts 10/20/30/40/50. */
    count: (n) => [10, 20, 30, 40, 50].find((c) => c >= n) ?? 50,
    async run(query, { maxResults, signal, cfg, filters }) {
      const result = await yuanbao.searchWsa({
        apiKey: cfg.apiKey,
        query,
        site: siteFilter(filters),
        freshness: freshnessFilter(filters),
        cnt: ENGINES.yuanbao.count(maxResults || 10),
        timeoutMs: cfg.timeoutMs,
        signal,
      })
      return {
        sources: result.hits.map((hit) => ({
          url: hit.url,
          title: hit.title,
          snippet: hit.summary,
          publishedAt: hit.date || undefined,
        })).filter((source) => source.url),
      }
    },
  },
  doubao: {
    id: 'doubao',
    label: '豆包搜索',
    vendor: '火山引擎联网搜索',
    needsKey: true,
    key: { field: 'doubaoApiKey', envField: 'doubaoApiKeyEnv', env: 'DOUBAO_API_KEY' },
    // `Sites` takes one host; no exclusion list and no date range.
    filters: { site: true, exclude: false, date: false },
    hint: '中文与资讯覆盖好，速度快；支持站点过滤，不读时间区间',
    async run(query, { maxResults, signal, cfg, filters }) {
      const result = await doubao.searchWeb({
        apiKey: cfg.apiKey,
        query,
        // `Sites` accepts one host and no exclusion list; exclusions are left
        // to the query text so a later engine can still honour them.
        site: filters?.site || undefined,
        count: Math.min(Math.max(maxResults || cfg.defaultCount || 10, 1), 50),
        timeoutMs: cfg.timeoutMs,
        signal,
      })
      return {
        sources: result.hits.map((hit) => ({
          url: hit.url,
          title: hit.title,
          snippet: hit.summary,
          publishedAt: hit.date || undefined,
        })),
      }
    },
  },
  'bing-html': {
    id: 'bing-html',
    label: 'Bing 网页',
    vendor: 'Bing（免密钥）',
    needsKey: false,
    filters: { site: true, exclude: true, date: false },
    hint: '免密钥兜底；无时效过滤，可能被临时限流',
    async run(query, { maxResults, signal, raw }) {
      // Bing understands the operators itself, so it gets the untranslated query.
      return await bing.run(raw || query, { maxResults, signal })
    },
  },
}

/** Translate the generic `site:`/`-site:` operators into WSA's `Site` field. */
function siteFilter(filters) {
  if (!filters) return undefined
  if (filters.exclude?.length) return `exclude:${filters.exclude.join('|')}`
  return filters.site || undefined
}

/** Translate `after:`/`before:` into WSA's inclusive date range. */
function freshnessFilter(filters) {
  if (!filters) return undefined
  const end = filters.before || ''
  const start = filters.after || ''
  if (!start && !end) return undefined
  const today = new Date().toISOString().slice(0, 10)
  return `${start || '2000-01-01'},${end || today}`
}

/** Config-shaped default: the two API engines first, keyless Bing last. */
export const DEFAULT_ENGINES = [
  { id: 'yuanbao', enabled: true },
  { id: 'doubao', enabled: true },
  { id: 'bing-html', enabled: true },
]

/** Resolve one config row into a runnable engine, or null when it cannot run. */
export function resolveEngine(row, { timeoutMs, defaultCount, keys = {} }) {
  const spec = ENGINES[row?.id]
  if (!spec) return null
  if (row.enabled === false) return null

  const source = keys[row.id] ?? {}
  const apiKey = source.apiKey || (source.apiKeyEnv ? process.env[source.apiKeyEnv] : '') || ''
  if (spec.needsKey && !apiKey) return null

  return {
    id: spec.id,
    label: spec.label,
    needsKey: spec.needsKey,
    filters: spec.filters ?? { site: false, exclude: false, date: false },
    run: (query, options) => spec.run(query, {
      ...options,
      cfg: { apiKey, timeoutMs: row.timeoutMs ?? timeoutMs, defaultCount },
    }),
  }
}

/**
 * Try engines in priority order until one returns sources.
 *
 * Failure of one engine is never fatal: the next one runs, and only when the
 * whole chain is exhausted does the call fail — with a per-engine reason, so the
 * model can tell a missing key from a rate limit.
 *
 * @param {Array<ReturnType<typeof resolveEngine>>} engines resolved, in priority order
 * @param {string} query
 * @param {{ maxResults?: number, signal?: AbortSignal }} options
 */
export async function runChain(engines, query, options = {}) {
  if (engines.length === 0) {
    throw new Error('没有可用的搜索引擎：「一个搜索」里所有引擎都被关闭或缺少 API KEY。')
  }

  // Engines that can honour every active filter go first; the rest still run,
  // but only after those — and their answer is labelled as filter-degraded.
  const honouring = engines.filter((engine) => !unsupportedFilter(engine, options.filters))
  const degraded = engines.filter((engine) => unsupportedFilter(engine, options.filters))
  const ordered = honouring.concat(degraded)

  const failures = []
  for (const engine of ordered) {
    if (options.signal?.aborted) throw options.signal.reason ?? new Error('搜索已取消。')
    const gap = unsupportedFilter(engine, options.filters)
    const started = Date.now()
    try {
      const result = await engine.run(query, options)
      const sources = (result.sources ?? []).filter((source) => source?.url)
      if (sources.length === 0) {
        failures.push(`${engine.label}：0 条结果${gap ? `（且忽略${gap}）` : ''}`)
        continue
      }
      // Say so in the answer itself: a degraded engine silently dropping a
      // filter would look like a filter that produced no matches.
      const notice = gap ? `（本次结果来自${engine.label}，它不支持${gap}，该过滤条件已忽略。）` : ''
      return {
        content: [notice, result.content].filter(Boolean).join('\n\n') || undefined,
        sources: options.maxResults ? sources.slice(0, options.maxResults) : sources,
        truncated: Boolean(options.maxResults && sources.length > options.maxResults),
        engine: engine.id,
        degraded: Boolean(gap),
        tried: failures.concat(`${engine.label}：${Date.now() - started}ms${gap ? `（忽略${gap}）` : ''}`),
      }
    } catch (error) {
      // Cancellation is not a failure to route around: stop the chain instead of
      // spending the next engine's quota on an answer nobody is waiting for.
      if (options.signal?.aborted) throw error
      failures.push(`${engine.label}：${describeFailure(error)}${gap ? `（且忽略${gap}）` : ''}`)
    }
  }

  throw new Error(`所有搜索引擎都失败了（按优先级）：${failures.join(' → ')}`)
}

/** The filter an engine cannot honour for this query, or '' when it can. */
function unsupportedFilter(engine, filters) {
  if (!filters) return ''
  const can = engine.filters ?? {}
  if (filters.site && !can.site) return 'site: 过滤'
  if (filters.exclude?.length && !can.exclude) return '-site: 排除'
  if ((filters.after || filters.before) && !can.date) return '时间过滤'
  return ''
}

/** One-line reason for the fallback log. */
function describeFailure(error) {
  const code = error?.code ? `${error.code} ` : ''
  const message = String(error?.message ?? error)
  return `${code}${message}`.replace(/\s+/g, ' ').slice(0, 120)
}
