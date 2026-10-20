/**
 * Tencent Yuanbao Search (元宝搜索 / wsa) client — API KEY (Bearer) mode.
 *
 * Endpoint:   POST https://api.wsa.cloud.tencent.com/SearchPro
 * Auth:       Authorization: Bearer <WSA API KEY>
 * Response:   { Response: { Pages: string[], Query, Version, Msg, Error, RequestId } }
 *
 * `Pages` entries are JSON *strings*, so every consumer must decode them; that
 * double encoding is the main reason a thin wrapper (this module) is worth it.
 */

export const DEFAULT_ENDPOINT = 'https://api.wsa.cloud.tencent.com/SearchPro'

/** Business error codes documented for the API. */
const ERROR_HINTS = {
  UnauthorizedOperation: 'API KEY 无效或已被删除；也常见于短时间并发过高被拒绝，稍后重试。',
  ResourceNotFound: '元宝搜索服务未开通（控制台开通后需几分钟生效）。',
  ResourceUnavailable: '账号欠费或服务不可用，请检查腾讯云费用中心。',
  RequestLimitExceeded: '超过并发限制，请降低调用频率或申请提额。',
  InvalidParameter: '参数不合法，检查 Query/Site/Freshness/Cnt/Mode 的取值。',
  InternalError: '服务端内部错误，可重试。',
}

/** Error carrying the API's own code so callers can report precisely. */
export class WsaError extends Error {
  constructor(code, message, requestId) {
    super(message)
    this.name = 'WsaError'
    this.code = code
    this.requestId = requestId
  }
}

/** Decode `Response.Pages` (array of JSON strings) into plain objects. */
export function decodePages(pages) {
  const out = []
  for (const raw of pages ?? []) {
    if (raw && typeof raw === 'object') {
      out.push(raw)
      continue
    }
    try {
      const parsed = JSON.parse(String(raw))
      if (parsed && typeof parsed === 'object') out.push(parsed)
    } catch {
      out.push({ title: '', url: '', passage: String(raw) })
    }
  }
  return out
}

/** Trim a hit to the fields worth showing a model. */
export function normalizeHit(hit) {
  const passage = typeof hit.passage === 'string' ? hit.passage : ''
  const content = typeof hit.content === 'string' ? hit.content : ''
  return {
    title: (hit.title ?? '').trim(),
    url: (hit.url ?? '').trim(),
    site: (hit.site ?? '').trim(),
    date: (hit.date ?? '').trim(),
    score: typeof hit.score === 'number' ? Number(hit.score.toFixed(3)) : hit.score ?? null,
    authority_level: hit.authority_level ?? null,
    summary: (content || passage).replace(/\s+/g, ' ').trim(),
    pics: Array.isArray(hit.pics) ? hit.pics.length : 0,
    deeplinks: Array.isArray(hit.deeplinks) ? hit.deeplinks : [],
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Run one 元宝 search.
 * @param {object} options
 * @param {string} options.apiKey
 * @param {string} options.query
 * @param {string} [options.site]      `example.com` to include, `exclude:a.com|b.com` to exclude
 * @param {string} [options.freshness] `d7` | `m3` | `y2` | `2026-08-20` | `2026-08-20,2026-08-30`
 * @param {number} [options.mode]      0 公开网页 | 1 垂直信源 | 2 混合
 * @param {number} [options.cnt]       10/20/30/40/50
 * @param {string} [options.industry]  gov | news | acad | finance
 * @param {number} [options.timeoutMs]
 * @param {string} [options.endpoint]
 */
export async function searchWsa(options) {
  const {
    apiKey,
    query,
    site,
    freshness,
    mode,
    cnt,
    industry,
    timeoutMs = 20_000,
    endpoint = DEFAULT_ENDPOINT,
    signal,
  } = options

  if (!apiKey) {
    throw new WsaError(
      'MissingApiKey',
      '未配置元宝搜索 API KEY：在插件配置里填 apiKey，或设置环境变量 WSA_API_KEY。',
    )
  }

  const body = { Query: query }
  if (site) body.Site = site
  if (freshness) body.Freshness = freshness
  if (mode !== undefined && mode !== null) body.Mode = Number(mode)
  if (cnt !== undefined && cnt !== null) body.Cnt = Number(cnt)
  if (industry) body.Industry = industry

  const started = Date.now()
  // Both bounds matter: the per-engine timeout, and the caller's cancellation
  // (a `web_search` the model or user has already given up on).
  const timeout = AbortSignal.timeout(timeoutMs)
  const abort = signal ? AbortSignal.any([signal, timeout]) : timeout
  let lastError
  // One quiet retry absorbs the transient auth rejections the endpoint emits
  // under rapid consecutive calls.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let res
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: abort,
      })
    } catch (error) {
      if (signal?.aborted) throw new WsaError('Aborted', '元宝搜索已取消。')
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new WsaError('Timeout', `元宝搜索超时（${timeoutMs}ms）。`)
      }
      throw new WsaError('NetworkError', `元宝搜索请求失败：${error?.message ?? error}`)
    }

    const text = await res.text()
    let payload
    try {
      payload = JSON.parse(text)
    } catch {
      throw new WsaError('BadResponse', `元宝搜索返回了非 JSON 内容（HTTP ${res.status}）：${text.slice(0, 200)}`)
    }

    const r = payload?.Response ?? {}
    if (r.Error) {
      lastError = new WsaError(r.Error.Code, r.Error.Message, r.RequestId)
      if (r.Error.Code === 'UnauthorizedOperation' && attempt === 0) {
        await sleep(800)
        continue
      }
      throw lastError
    }

    const hits = decodePages(r.Pages).map(normalizeHit)
    return {
      query: r.Query ?? query,
      version: r.Version ?? '',
      msg: r.Msg ?? '',
      requestId: r.RequestId ?? '',
      tookMs: Date.now() - started,
      hits,
    }
  }
  throw lastError
}

/** Human-readable explanation for a thrown {@link WsaError}. */
export function describeWsaError(error) {
  if (error instanceof WsaError) {
    const hint = ERROR_HINTS[error.code]
    return hint ? `${error.code}: ${error.message}（${hint}）` : `${error.code}: ${error.message}`
  }
  return error?.message ?? String(error)
}
