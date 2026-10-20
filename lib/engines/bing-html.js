/**
 * Bing HTML endpoint — a keyless engine so 「一个搜索」 still answers when the
 * preferred engine errors out (quota, missing key, risk control).
 *
 * Deliberately NOT the preferred engine: no ranking metadata, no time filter,
 * and Bing rate-limits bursts from one IP. It exists for graceful degradation,
 * which is the whole point of the priority chain.
 */

const ENDPOINT = 'https://cn.bing.com/search'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** @returns {boolean} always usable — no credentials needed. */
export function available() {
  return true
}

/**
 * Run one Bing search.
 * @param {string} query
 * @param {{ maxResults?: number, signal?: AbortSignal }} options
 */
export async function run(query, options = {}) {
  const limit = Math.min(Math.max(Number(options.maxResults) || 10, 1), 30)
  const params = new URLSearchParams({ q: query, setlang: 'zh-CN', count: String(limit) })
  const timeout = AbortSignal.timeout(15_000)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout

  const res = await fetch(`${ENDPOINT}?${params}`, {
    headers: {
      'User-Agent': UA,
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
    redirect: 'follow',
    signal,
  })
  if (!res.ok) throw new Error(`Bing HTTP ${res.status}`)
  const html = await res.text()

  const sources = parseResults(html).slice(0, limit)
  if (sources.length === 0) throw new Error('Bing 返回 0 条（可能被临时限流）')
  return { sources }
}

/** Parse `<li class="b_algo">` blocks into normalized sources. */
export function parseResults(html) {
  const out = []
  for (const block of html.split(/<li class="b_algo"/).slice(1)) {
    const head = block.match(/<h2>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
    if (!head) continue
    const url = head[1].replace(/&amp;/g, '&')
    if (!url.startsWith('http')) continue
    const snippet = block.match(/<p class="[^"]*b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/)
      || block.match(/<p[^>]*>([\s\S]*?)<\/p>/)
    out.push({
      url,
      title: text(head[2]),
      snippet: snippet ? text(snippet[1]) : '',
    })
  }
  return out
}

/** Strip tags and the entities Bing emits, collapse whitespace. */
function text(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
