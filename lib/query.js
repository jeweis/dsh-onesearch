/**
 * Generic query operators.
 *
 * The agent-facing contract stays `web_search(query)` — one string, no vendor
 * vocabulary. Filters an engine can honour (site, date range) are expressed
 * with the operators every search box already understands, then translated by
 * the engine that supports them. Engines that do not support a filter simply
 * ignore it; the words were removed from the query either way.
 *
 * Supported:
 *   site:example.com        only this host
 *   -site:example.com       exclude this host (repeatable)
 *   after:2026-01-01        published on/after this date
 *   before:2026-12-31       published on/before this date
 */

const OPERATOR = /(?:^|\s)(-)?site:(\S+)|(?:^|\s)(after|before):(\d{4}-\d{2}-\d{2})(?=\s|$)/gi

/**
 * Split operators out of a query.
 * @param {string} query
 * @returns {{ text: string, site: string, exclude: string[], after: string, before: string }}
 */
export function parseQuery(query) {
  const raw = String(query ?? '')
  const exclude = []
  let site = ''
  let after = ''
  let before = ''

  const text = raw.replace(OPERATOR, (match, negated, host, dateKind, dateValue) => {
    if (host) {
      const clean = host.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase()
      if (!clean) return ''
      if (negated) {
        if (!exclude.includes(clean) && exclude.length < 5) exclude.push(clean)
      } else if (!site) {
        site = clean
      }
      return ''
    }
    if (dateKind && dateValue) {
      if (dateKind.toLowerCase() === 'after') after = dateValue
      else before = dateValue
      return ''
    }
    return match
  })

  return {
    text: text.replace(/\s+/g, ' ').trim(),
    site,
    exclude,
    after,
    before,
  }
}
