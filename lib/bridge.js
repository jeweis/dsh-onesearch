/**
 * HTTP bridge between the settings page (browser) and the Settings service.
 *
 * The client half cannot call `ctx.settings` directly, and the page must not
 * write `cordis.patch.yml` itself: every mutation goes through the Settings
 * service so revisions, secret redaction, and the profile patch stay owned by
 * the Host.
 */

import { ENGINES } from './engines/index.js'

const PREFIX = '/api/dsh-onesearch'
const MAX_BODY = 64 * 1024

function writeJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  })
  res.end(JSON.stringify(body))
}

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) return undefined
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return undefined
  }
}

/** The key an engine would use right now: config value first, then its env var. */
function keyOf(config, spec) {
  if (!spec?.key) return ''
  const direct = String(config[spec.key.field] ?? '').trim()
  if (direct) return direct
  const envName = String(config[spec.key.envField] ?? '').trim() || spec.key.env
  return envName ? String(process.env[envName] ?? '').trim() : ''
}

/** One descriptor for our own plugin entry, or undefined. */
function descriptorOf(settings, ns) {
  return settings.describe({ redactSecrets: true }).find((item) => String(item.ns) === ns)
}

/**
 * @param {object} options
 * @param {string} options.ns             profile entry id (the bundle patch id)
 * @param {() => object} options.snapshot live config, already resolved
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function registerBridge(ctx, { ns, snapshot, providerId, stats }) {
  ctx.inject(['webServer', 'settings'], (sctx) => {
    const settings = sctx.settings

    /** The `web` entry's configured search provider — authoritative for display. */
    const webProvider = () => {
      try {
        const descriptor = settings.describe({ redactSecrets: true }).find((item) => String(item.ns) === 'web')
        return String(descriptor?.value?.searchProvider ?? '')
      } catch {
        return ''
      }
    }

    const state = () => {
      const config = snapshot()
      const rows = Array.isArray(config.engines) ? config.engines : []
      return {
        ns,
        engines: rows.map((row) => {
          const spec = ENGINES[row.id]
          return {
            id: row.id,
            enabled: row.enabled !== false,
            label: spec?.label ?? row.id,
            vendor: spec?.vendor ?? '',
            hint: spec?.hint ?? '',
            needsKey: Boolean(spec?.needsKey),
            hasKey: spec?.needsKey ? Boolean(keyOf(config, spec)) : true,
            keyField: spec?.key?.field ?? '',
            keyEnv: spec?.key ? (String(config[spec.key.envField] ?? '').trim() || spec.key.env) : '',
          }
        }),
        known: Object.entries(ENGINES).map(([id, spec]) => ({
          id,
          label: spec.label,
          vendor: spec.vendor,
          hint: spec.hint,
          needsKey: spec.needsKey,
          keyField: spec.key?.field ?? '',
          keyEnv: spec.key ? (String(config[spec.key.envField] ?? '').trim() || spec.key.env) : '',
        })),
        takeOverWebSearch: webProvider() === 'onesearch',
        webProvider: webProvider(),
        activeProvider: providerId ? String(providerId() ?? '') : '',
        stats: stats ?? null,
        apiKeyEnv: config.yuanbaoApiKeyEnv ?? 'WSA_API_KEY',
        hasKey: Boolean(keyOf(config, ENGINES.yuanbao)),
      }
    }

    const mutate = async (ops) => {
      const descriptor = descriptorOf(settings, ns)
      if (!descriptor) return { ok: false, error: `settings entry "${ns}" not found` }
      await settings.mutate(ns, ops, descriptor.revision)
      return { ok: true, state: state() }
    }

    const routes = [
      {
        kind: 'exact',
        path: `${PREFIX}/state`,
        handler: async (req, res) => {
          if (req.method !== 'GET') return writeJson(res, 405, { error: 'GET only' })
          try {
            writeJson(res, 200, { ok: true, state: state() })
          } catch (error) {
            writeJson(res, 500, { ok: false, error: String(error?.message ?? error) })
          }
        },
      },
      {
        kind: 'exact',
        path: `${PREFIX}/probe`,
        handler: async (req, res) => {
          const query = new URL(req.url ?? '', 'http://localhost').searchParams.get('q') ?? ''
          if (!query) return writeJson(res, 400, { error: 'q required' })
          try {
            const seam = ctx.web
            const diag = {
              ctor: seam?.constructor?.name ?? '',
              providerId: String(seam?.searchProviderId ?? ''),
              registered: seam?.searchProviders ? [...seam.searchProviders.keys()] : null,
              flag: String(seam?.searchProviderId) === 'onesearch',
            }
            ctx.logger?.info?.(`onesearch probe: ${JSON.stringify(diag)}`)
            const result = await seam.search({ query, maxResults: 3 })
            writeJson(res, 200, {
              ok: true,
              provider: String(ctx.web.searchProviderId ?? ''),
              diag,
              sources: result.sources.slice(0, 3).map((source) => ({ url: source.url, title: source.title ?? '' })),
              content: (result.content ?? '').slice(0, 300),
            })
          } catch (error) {
            writeJson(res, 200, { ok: false, provider: String(ctx.web.searchProviderId ?? ''), error: String(error?.message ?? error) })
          }
        },
      },
      {
        kind: 'exact',
        path: `${PREFIX}/takeover`,
        handler: async (req, res) => {
          if (req.method !== 'POST') return writeJson(res, 405, { error: 'POST only' })
          const body = await readJsonBody(req)
          if (!body || typeof body.enabled !== 'boolean') return writeJson(res, 400, { ok: false, error: 'enabled required' })
          const target = body.enabled ? 'onesearch' : 'auto'
          try {
            const descriptor = settings.describe({ redactSecrets: true }).find((item) => String(item.ns) === 'web')
            if (!descriptor) return writeJson(res, 404, { ok: false, error: 'settings entry "web" not found' })
            await settings.mutate('web', [{ op: 'set', path: ['searchProvider'], value: target }], descriptor.revision)
            writeJson(res, 200, { ok: true, state: state(), restartRequired: true })
          } catch (error) {
            writeJson(res, 500, { ok: false, error: String(error?.message ?? error) })
          }
        },
      },
      {
        kind: 'exact',
        path: `${PREFIX}/mutate`,
        handler: async (req, res) => {
          if (req.method !== 'POST') return writeJson(res, 405, { error: 'POST only' })
          const body = await readJsonBody(req)
          if (!body || !Array.isArray(body.ops)) return writeJson(res, 400, { ok: false, error: 'ops[] required' })
          // Only these paths are writable from the page.
          const allowed = new Set(['engines', ...Object.values(ENGINES).map((spec) => spec.key?.field).filter(Boolean)])
          const ops = body.ops.filter((op) => op && typeof op.op === 'string'
            && Array.isArray(op.path) && op.path.length > 0 && allowed.has(op.path[0]))
          if (ops.length !== body.ops.length) return writeJson(res, 400, { ok: false, error: 'unsupported path' })
          try {
            writeJson(res, 200, await mutate(ops))
          } catch (error) {
            writeJson(res, 500, { ok: false, error: String(error?.message ?? error) })
          }
        },
      },
    ]

    const disposers = routes.map((route) => sctx.webServer.register(route))
    return () => { for (const dispose of disposers) dispose() }
  })
}
