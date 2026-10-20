/**
 * 「一个搜索」 settings page — the browser half of dsh-onesearch.
 *
 * Rendered in the Plugins page's per-row configuration slot
 * (`plugins.row.config`, key `<package>#<row>`). It talks to the Host through
 * `/api/dsh-onesearch/*`; the Host owns the Settings service and the profile
 * patch, so this file never writes files.
 *
 * Ordering is the feature: drag a row to move it up or down the priority chain.
 */
window.__ModuleLoader__.load({
  id: 'dsh-onesearch',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback } = React

    const API = '/api/dsh-onesearch'
    const ACCENT = 'var(--dsw-alias-accent, #0071e3)'
    const DANGER = '#d70015'
    const BORDER = '1px solid color-mix(in srgb, currentColor 16%, transparent)'
    const MUTED = { opacity: 0.62 }
    const SURFACE = 'color-mix(in srgb, currentColor 4%, transparent)'

    const styles = {
      card: { border: BORDER, borderRadius: 12, padding: 14, marginBottom: 10, background: SURFACE },
      title: { fontWeight: 600, fontSize: 14, color: 'inherit' },
      sub: { ...MUTED, fontSize: 12, marginTop: 2 },
      row: {
        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10,
        border: BORDER, marginBottom: 8, background: 'transparent', cursor: 'grab', userSelect: 'none',
      },
      handle: { ...MUTED, fontSize: 15, lineHeight: 1, cursor: 'grab', padding: '0 2px' },
      input: {
        font: 'inherit', fontSize: 13, color: 'inherit', background: 'transparent', border: BORDER,
        borderRadius: 8, padding: '6px 9px', minWidth: 0, flex: 1,
      },
      button: {
        font: 'inherit', fontSize: 13, cursor: 'pointer', borderRadius: 8, border: BORDER,
        background: 'transparent', color: 'inherit', padding: '6px 12px',
      },
      primary: {
        font: 'inherit', fontSize: 13, cursor: 'pointer', borderRadius: 8, border: 'none',
        background: ACCENT, color: '#fff', padding: '6px 12px',
      },
    }

    /** Accessible switch that follows the Host's `role="switch"` pattern. */
    function Switch({ checked, onChange, label }) {
      const knob = {
        position: 'absolute', top: 2, left: checked ? 20 : 2, width: 20, height: 20,
        borderRadius: '50%', transition: 'left 160ms ease',
        background: checked ? '#fff' : 'color-mix(in srgb, currentColor 45%, transparent)',
      }
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': checked,
        'aria-label': label,
        onClick: () => onChange(!checked),
        style: {
          flex: 'none', width: 42, height: 24, borderRadius: 999, padding: 0, cursor: 'pointer',
          border: BORDER, background: checked ? ACCENT : 'transparent', position: 'relative',
          transition: 'background 160ms ease',
        },
      }, h('span', { 'aria-hidden': true, style: knob }))
    }

    /** One draggable engine row. */
    function EngineRow({ engine, index, onToggle, onDragStart, onDragOver, onDrop, onDragEnd, dimmed }) {
      const keyLabel = engine.hasKey ? '已配置 key' : '缺少 API KEY'
      const meta = [engine.vendor, engine.hint].filter(Boolean).join(' · ')
      const title = h('div', { style: styles.title },
        engine.label,
        engine.needsKey ? h('span', { style: { ...styles.sub, marginLeft: 8, color: engine.hasKey ? 'inherit' : DANGER } }, keyLabel) : null)
      return h('div', {
        draggable: true,
        onDragStart,
        onDragOver,
        onDrop,
        onDragEnd,
        style: {
          ...styles.row,
          opacity: dimmed ? 0.55 : 1,
          borderStyle: dimmed ? 'dashed' : 'solid',
        },
      },
      h('span', { style: styles.handle, title: '拖动调整顺序' }, '⠿'),
      h('span', { style: { ...MUTED, fontSize: 12, minWidth: 16, textAlign: 'right' } }, String(index + 1)),
      h('div', { style: { flex: 1, minWidth: 0 } }, title, h('div', { style: styles.sub }, meta)),
      h(Switch, { checked: engine.enabled, label: `启用 ${engine.label}`, onChange: onToggle }))
    }

    /** The ordered engine list with drag-to-reorder. */
    function EngineList({ engines, onReorder, onToggle }) {
      const dragIndex = useRef(null)
      const [over, setOver] = useState(null)

      const drop = (target) => {
        const from = dragIndex.current
        dragIndex.current = null
        setOver(null)
        if (from === null || from < 0 || from === target) return
        const rows = engines.map((engine) => ({ id: engine.id, enabled: engine.enabled }))
        const moved = rows.splice(from, 1)[0]
        rows.splice(target, 0, moved)
        onReorder(rows)
      }

      const rows = engines.map((engine, index) => {
        const active = over === index && dragIndex.current !== null && dragIndex.current !== index
        return h(EngineRow, {
          key: engine.id,
          engine,
          index,
          dimmed: active,
          onToggle: (value) => onToggle(engine.id, value),
          onDragStart: () => { dragIndex.current = index },
          onDragOver: (event) => { event.preventDefault(); setOver(index) },
          onDrop: (event) => { event.preventDefault(); drop(index) },
          onDragEnd: () => { dragIndex.current = null; setOver(null) },
        })
      })

      return h('div', { style: styles.card },
        h('div', { style: styles.title }, '引擎优先级'),
        h('div', { style: { ...styles.sub, marginBottom: 10 } },
          '从上到下依次尝试：前一个失败或返回 0 条，自动顺延下一个。拖动左侧把手调整优先级。'),
        rows.length === 0 ? h('div', { style: styles.sub }, '没有启用的引擎。') : rows)
    }

    /** API key entry; the value is never read back. */
    function KeyCard({ title, hasKey, apiKeyEnv, placeholder, busy, onSave }) {
      const [draft, setDraft] = useState('')
      const save = () => {
        const value = draft.trim()
        if (!value) return
        onSave(value)
        setDraft('')
      }
      return h('div', { style: styles.card },
        h('div', { style: styles.title }, title),
        h('div', { style: { ...styles.sub, marginBottom: 8 } },
          `留空则读取环境变量 ${apiKeyEnv}。写入后不会回显，只显示是否已保存。`),
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
          h('input', {
            type: 'password',
            value: draft,
            placeholder: hasKey ? '已保存（重新输入可覆盖）' : (placeholder || '粘贴 API KEY'),
            onChange: (event) => setDraft(event.target.value),
            style: styles.input,
            autoComplete: 'off',
            spellCheck: false,
          }),
          h('button', { type: 'button', disabled: busy, onClick: save, style: styles.primary }, '保存')))
    }

    /** Takeover switch — writes the `web` entry's `searchProvider`. */
    function DefaultCard({ checked, onChange, note }) {
      const label = checked ? 'web_search 由「一个搜索」回答' : 'web_search 仍由其他 provider 回答'
      return h('div', { style: styles.card },
        h('div', { style: styles.title }, '默认搜索'),
        h('div', { style: { ...styles.sub, marginBottom: 8 } },
          '接管 DSH 内置的 web_search，让它走上面的引擎链。'),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
          h(Switch, { checked, label: '接管默认搜索', onChange }),
          h('div', { style: { flex: 1 } },
            label,
            note ? h('div', { style: styles.sub }, note) : null)))
    }

    /** One line for the row's summary view, before the page is opened. */
    function Summary({ state }) {
      if (!state) return h('span', { style: styles.sub }, '一个搜索')
      const chain = (state.engines ?? []).filter((engine) => engine.enabled).map((engine) => engine.label)
      const note = state.takeOverWebSearch ? '接管 web_search' : '不接管 web_search'
      return h('span', { style: styles.sub },
        `${chain.length > 0 ? chain.join(' → ') : '没有启用的引擎'} · ${note}`)
    }

    function OneSearchConfig(props) {
      const summary = props && props.view === 'summary'
      const [state, setState] = useState(null)
      const [error, setError] = useState(null)
      const [busy, setBusy] = useState(false)
      const [takeoverNote, setTakeoverNote] = useState('')

      const load = useCallback(async () => {
        try {
          const res = await fetch(`${API}/state`, { credentials: 'same-origin' })
          const body = await res.json()
          if (!body.ok) throw new Error(body.error || 'cannot read state')
          setState(body.state)
          setError(null)
        } catch (cause) {
          setError(String(cause.message || cause))
        }
      }, [])

      useEffect(() => { load() }, [load])

      const mutate = useCallback(async (ops, optimistic) => {
        setBusy(true)
        try {
          const res = await fetch(`${API}/mutate`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ ops }),
          })
          const body = await res.json()
          if (!body.ok) throw new Error(body.error || 'write failed')
          setState(body.state)
          setError(null)
        } catch (cause) {
          setError(String(cause.message || cause))
          if (optimistic) load()
        } finally {
          setBusy(false)
        }
      }, [load])

      if (summary) return h(Summary, { state })

      if (!state) {
        const text = error ? `读取配置失败：${error}` : '读取配置…'
        return h('div', { style: styles.card }, h('div', { style: styles.sub }, text))
      }

      const engines = state.engines ?? []
      const reorder = (rows) => mutate([{ op: 'set', path: ['engines'], value: rows }])
      const toggle = (id, value) => {
        const rows = engines.map((engine) => ({
          id: engine.id,
          enabled: engine.id === id ? value : engine.enabled,
        }))
        mutate([{ op: 'set', path: ['engines'], value: rows }], true)
      }

      return h('div', null,
        h(EngineList, { engines, onReorder: reorder, onToggle: toggle }),
        ...engines.filter((engine) => engine.needsKey).map((engine) => h(KeyCard, {
          key: `key-${engine.id}`,
          title: `${engine.label} API KEY`,
          hasKey: engine.hasKey,
          apiKeyEnv: engine.keyEnv,
          busy,
          onSave: (value) => mutate([{ op: 'set', path: [engine.keyField], value }]),
        })),
        h(DefaultCard, {
          checked: state.takeOverWebSearch,
          note: takeoverNote,
          onChange: async (value) => {
            setBusy(true)
            try {
              const res = await fetch(`${API}/takeover`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ enabled: value }),
              })
              const body = await res.json()
              if (!body.ok) throw new Error(body.error || 'write failed')
              setState(body.state)
              setTakeoverNote('已写入 web.searchProvider，重载该插件后生效')
              setError(null)
            } catch (cause) {
              setError(String(cause.message || cause))
            } finally {
              setBusy(false)
            }
          },
        }),
        error ? h('div', { style: { ...styles.sub, color: DANGER } }, `写入失败：${error}`) : null,
        busy ? h('div', { style: styles.sub }, '保存中…') : null)
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
          name: 'plugins.row.config',
          key: 'dsh-onesearch#onesearch',
        }, OneSearchConfig))
      },
    }
  },
})
