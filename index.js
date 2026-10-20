/**
 * 「一个搜索」 (dsh-onesearch) — one search seam, many engines.
 *
 * What it owns:
 *   - a `ctx.web` search provider (`onesearch`) that walks the configured engine
 *     list in priority order and falls through to the next engine on failure;
 *   - nothing else: no vendor-named tool, no content-source tool. The agent
 *     keeps talking to the generic `web_search` and `web_fetch` only.
 *
 * Priority is the array order in `config.engines`; the settings UI reorders it
 * by dragging. Engine-specific filtering reaches the agent through generic
 * query operators (`site:` / `-site:` / `after:` / `before:`), never through a
 * vendor-named tool. Selecting `onesearch` as `web.searchProvider` makes the
 * built-in `web_search` tool answer through this chain.
 */

import z from '@deepseek-ai/schemastery'

import { DEFAULT_ENGINES, resolveEngine, runChain } from './lib/engines/index.js'
import { registerBridge } from './lib/bridge.js'
import { parseQuery } from './lib/query.js'

/** Services this plugin needs before `apply` runs. */
export const inject = ['web']

const PROVIDER_ID = 'onesearch'
export const Config = z.object({
  engines: z.array(z.object({
    id: z.string(),
    enabled: z.boolean().default(true),
  })).default(DEFAULT_ENGINES).volatile()
    .description('搜索引擎优先级：从上到下依次尝试，失败或 0 条自动顺延下一个。'),

  yuanbaoApiKey: z.string().default('').role('secret').volatile()
    .description('元宝搜索 API KEY（sk-…）。留空则读取下面的环境变量。'),
  yuanbaoApiKeyEnv: z.string().default('WSA_API_KEY').volatile()
    .description('元宝 key 为空时读取的环境变量名。'),

  doubaoApiKey: z.string().default('').role('secret').volatile()
    .description('豆包搜索（火山引擎联网搜索）API KEY。留空则读取下面的环境变量。'),
  doubaoApiKeyEnv: z.string().default('DOUBAO_API_KEY').volatile()
    .description('豆包 key 为空时读取的环境变量名。'),

  defaultCount: z.number().step(1).min(10).max(50).default(10).volatile()
    .description('默认返回条数（10/20/30/40/50）。'),
  searchTimeoutMs: z.number().step(1).min(1000).default(20_000).volatile()
    .description('单个引擎的超时（毫秒）；超时即顺延下一个。'),

})

/**
 * Unwrap `.volatile()` fields: the Loader hands `apply` live references so
 * settings edits land without remounting the plugin, and each volatile field
 * exposes `.get()`.
 */
function resolveConfig(config) {
  const out = {}
  for (const [key, value] of Object.entries(config ?? {})) {
    out[key] = value !== null && typeof value === 'object' && typeof value.get === 'function' ? value.get() : value
  }
  return out
}

/** Resolve `config.engines` into runnable engines, preserving priority order. */
function chain(config) {
  const rows = Array.isArray(config.engines) && config.engines.length > 0 ? config.engines : DEFAULT_ENGINES
  return rows
    .map((row) => resolveEngine(row, {
      timeoutMs: config.searchTimeoutMs,
      defaultCount: config.defaultCount,
      keys: {
        yuanbao: { apiKey: config.yuanbaoApiKey, apiKeyEnv: config.yuanbaoApiKeyEnv },
        doubao: { apiKey: config.doubaoApiKey, apiKeyEnv: config.doubaoApiKeyEnv },
      },
    }))
    .filter(Boolean)
}

/** Register the tools and the provider. */
export function apply(ctx, config) {
  const live = () => resolveConfig(config)
  const engines = () => chain(live())

  // Diagnostics surfaced on the settings page: proves whether `web_search`
  // actually reached this provider.
  const stats = { calls: 0, lastEngine: '', lastQuery: '', lastError: '' }

  // ---- settings page bridge --------------------------------------------
  // The browser half ("一个搜索" page in Plugins) reads and reorders the engine
  // chain through the Host's Settings service, never by editing files.
  registerBridge(ctx, { ns: 'onesearch', snapshot: live, providerId: () => ctx.web.searchProviderId, stats })

  // ---- the seam ---------------------------------------------------------
  // `web_search` (dsh-tool-web) calls whatever provider `ctx.web` selects. By
  // taking the selection over we replace the default search without touching
  // the tool, and the priority chain applies to every caller.
  ctx.web.registerSearchProvider({
    id: PROVIDER_ID,
    available: () => engines().length > 0,
    async search(request, signal) {
      stats.calls += 1
      stats.lastQuery = String(request.query ?? '')
      // Generic operators (`site:`, `-site:`, `after:`, `before:`) are parsed
      // here, so the tool contract stays a single plain query string.
      const parsed = parseQuery(request.query)
      const result = await runChain(engines(), parsed.text || String(request.query ?? ''), {
        maxResults: request.maxResults,
        signal,
        filters: parsed,
        raw: String(request.query ?? ''),
      })
      stats.lastEngine = result.engine
      stats.lastError = ''
      if (result.tried.length > 1) {
        ctx.logger?.info?.(`onesearch: ${result.engine} answered after ${result.tried.join(' → ')}`)
      }
      return { content: result.content, sources: result.sources, truncated: result.truncated }
    },
  })

  // Selection is a *config* decision on the `web` entry: the service reads
  // `searchProvider` when it is constructed, so assigning the property at
  // runtime does not stick. The settings page writes that config through the
  // Settings service; here we only report a mismatch.
  const selected = String(ctx.web.searchProviderId ?? '')
  if (selected !== PROVIDER_ID) {
    ctx.logger?.warn?.(
      `onesearch: web.searchProvider is "${selected || 'unset'}", not "${PROVIDER_ID}" — `
      + 'web_search will keep using it until the settings page (or `- id: web`) selects onesearch.',
    )
  }
}
