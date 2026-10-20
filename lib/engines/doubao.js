/**
 * Volcengine 联网搜索 / 豆包搜索 (NetworkedSearch) client.
 *
 * Endpoint:  POST https://open.feedcoopapi.com/search_api/web_search
 * Auth:      Authorization: Bearer <API KEY>
 * Request:   { Query, SearchType: 'web', Count, Filter: { NeedContent, NeedUrl, Sites? } }
 * Response:  { ResponseMetadata: { RequestId, Error? }, Result: { ResultCount, WebResults[] } }
 *
 * Differences from 元宝 worth knowing:
 *   - results are plain objects (no double-encoded `Pages`);
 *   - `Sites` takes one host and does not support exclusion lists;
 *   - no documented date-range filter, so `after:`/`before:` are ignored here
 *     (the chain still falls through to an engine that can honour them).
 */

export const DEFAULT_ENDPOINT = 'https://open.feedcoopapi.com/search_api/web_search'

const ERROR_HINTS = {
  InvalidParameter: '参数不合法，检查 Query/Count/Filter 的取值。',
  Unauthorized: 'API KEY 无效或未授权，检查火山引擎控制台的联网搜索 API KEY。',
  Forbidden: '接口未开通或无权限，请在火山引擎控制台开通「联网搜索」。',
  TooManyRequests: '超过并发/QPS 限制，请降低调用频率。',
  InternalError: '服务端内部错误，可重试。',
}

/** Error carrying the API's own code so the chain can report precisely. */
export class DoubaoError extends Error {
  constructor(code, message, requestId) {
    super(message)
    this.name = 'DoubaoError'
    this.code = code
    this.requestId = requestId
  }
}

/** Trim one `WebResults` entry to the fields worth showing a model. */
export function normalizeHit(hit) {
  const snippet = typeof hit.Snippet === 'string' ? hit.Snippet : ''
  const summary = typeof hit.Summary === 'string' ? hit.Summary : ''
  return {
    title: String(hit.Title ?? '').trim(),
    url: String(hit.Url ?? '').trim(),
    site: String(hit.SiteName ?? '').trim(),
    date: String(hit.PublishTime ?? '').trim(),
    score: typeof hit.RankScore === 'number' ? Number(hit.RankScore.toFixed(3)) : null,
    authority: String(hit.AuthInfoDes ?? '').trim(),
    summary: (summary || snippet).replace(/\s+/g, ' ').trim(),
  }
}

/**
 * Run one 豆包 search.
 * @param {object} options
 * @param {string} options.apiKey
 * @param {string} options.query
 * @param {string} [options.site]      `example.com` — one host only
 * @param {number} [options.count]     1-50
 * @param {number} [options.timeoutMs]
 * @param {string} [options.endpoint]
 */
export async function searchWeb(options) {
  const {
    apiKey,
    query,
    site,
    count = 10,
    timeoutMs = 20_000,
    endpoint = DEFAULT_ENDPOINT,
    signal,
  } = options

  if (!apiKey) {
    throw new DoubaoError(
      'MissingApiKey',
      '未配置豆包搜索 API KEY：在插件设置页填写，或设置环境变量 DOUBAO_API_KEY。',
    )
  }

  const body = {
    Query: query,
    SearchType: 'web',
    Count: Math.min(Math.max(Number(count) || 10, 1), 50),
    Filter: {
      NeedContent: false,
      NeedUrl: true,
      ...(site ? { Sites: site } : {}),
    },
  }

  const started = Date.now()
  // Keep both bounds: passing `signal` alone used to drop the timeout entirely,
  // so a hung request would block the whole chain.
  const timeout = AbortSignal.timeout(timeoutMs)
  const abort = signal ? AbortSignal.any([signal, timeout]) : timeout
  let res
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: abort,
    })
  } catch (error) {
    if (signal?.aborted) throw new DoubaoError('Aborted', '豆包搜索已取消。')
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new DoubaoError('Timeout', `豆包搜索超时（${timeoutMs}ms）。`)
    }
    throw new DoubaoError('NetworkError', `豆包搜索请求失败：${error?.message ?? error}`)
  }

  const text = await res.text()
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    throw new DoubaoError('BadResponse', `豆包搜索返回了非 JSON 内容（HTTP ${res.status}）：${text.slice(0, 200)}`)
  }

  const meta = payload?.ResponseMetadata ?? {}
  const error = meta.Error
  if (error) {
    throw new DoubaoError(error.Code ?? 'ApiError', error.Message ?? '豆包搜索返回错误', meta.RequestId)
  }
  if (!res.ok) {
    throw new DoubaoError(`HTTP${res.status}`, `豆包搜索返回 HTTP ${res.status}：${text.slice(0, 200)}`, meta.RequestId)
  }

  const results = payload?.Result?.WebResults ?? []
  return {
    query,
    requestId: meta.RequestId ?? '',
    resultCount: payload?.Result?.ResultCount ?? results.length,
    tookMs: Date.now() - started,
    hits: results.map(normalizeHit).filter((hit) => hit.url),
  }
}

/** Human-readable explanation for a thrown {@link DoubaoError}. */
export function describeError(error) {
  if (error instanceof DoubaoError) {
    const hint = ERROR_HINTS[error.code]
    return hint ? `${error.code}: ${error.message}（${hint}）` : `${error.code}: ${error.message}`
  }
  return error?.message ?? String(error)
}
