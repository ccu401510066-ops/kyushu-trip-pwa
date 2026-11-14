import { useCallback, useEffect, useMemo, useState } from 'react'
import './ledger.css'

/**
 * 旅費記帳：家人各自登入（姓名 + PIN）、共同記帳、每筆可選分攤對象、最後結算。
 * 資料放在 Cloudflare D1（worker/），沒訊號時先存本機，有訊號再補傳。
 */

const API_BASE = (
  (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_LEDGER_API ??
  'https://kyushu-ledger.ccu401510066.workers.dev'
).replace(/\/$/, '')

const TOKEN_KEY = 'kyushu-ledger-token'
const CACHE_KEY = 'kyushu-ledger-cache'

type Member = { id: string; name: string; role: 'admin' | 'member'; active: number }
type Expense = {
  id: string
  date: string
  title: string
  category: string
  currency: 'JPY' | 'TWD'
  amount: number
  rate: number
  amountTwd: number
  payerId: string
  shares: string[]
  note: string
  createdBy: string
  updatedBy: string
  createdAt: number
  updatedAt: number
}
type State = { me: Member; members: Member[]; expenses: Expense[]; settings: { rate: number } }
type Draft = {
  id?: string
  date: string
  title: string
  category: string
  currency: 'JPY' | 'TWD'
  amount: string
  payerId: string
  shares: string[]
  note: string
}

const CATS = [
  { key: '食', cls: 'c-food' },
  { key: '住', cls: 'c-stay' },
  { key: '行', cls: 'c-move' },
  { key: '樂', cls: 'c-fun' },
]

const readJSON = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

const writeJSON = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 無痕模式就只是不記住 */
  }
}

const twd = (n: number) => `NT$${Math.round(n).toLocaleString('en-US')}`
const jpy = (n: number) => `¥${Math.round(n).toLocaleString('en-US')}`

async function api<T>(path: string, init?: { method?: string; body?: unknown; token?: string }): Promise<T> {
  if (!API_BASE) throw new Error('記帳後端還沒設定')
  const res = await fetch(API_BASE + path, {
    method: init?.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(data.error || `連線失敗（${res.status}）`)
  return data
}

/** 由花費算出每個人該收或該付多少，再配成最少的轉帳筆數。 */
function settlement(members: Member[], expenses: Expense[]) {
  const bal = new Map<string, number>()
  members.filter((m) => m.active).forEach((m) => bal.set(m.id, 0))
  for (const e of expenses) {
    const people = e.shares.filter((s) => bal.has(s))
    if (!people.length) continue
    const share = e.amountTwd / people.length
    bal.set(e.payerId, (bal.get(e.payerId) ?? 0) + e.amountTwd)
    for (const p of people) bal.set(p, (bal.get(p) ?? 0) - share)
  }
  const debtors = [...bal.entries()].filter(([, v]) => v < -1).map(([id, v]) => ({ id, v: -v }))
  const creditors = [...bal.entries()].filter(([, v]) => v > 1).map(([id, v]) => ({ id, v }))
  debtors.sort((a, b) => b.v - a.v)
  creditors.sort((a, b) => b.v - a.v)
  const transfers: { from: string; to: string; amount: number }[] = []
  let i = 0
  let j = 0
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].v, creditors[j].v)
    transfers.push({ from: debtors[i].id, to: creditors[j].id, amount: Math.round(pay) })
    debtors[i].v -= pay
    creditors[j].v -= pay
    if (debtors[i].v < 1) i++
    if (creditors[j].v < 1) j++
  }
  return { bal, transfers }
}

function TransferDetail({
  from,
  to,
  names,
  expenses,
}: {
  from: string
  to: string
  names: Record<string, string>
  expenses: Expense[]
}) {
  const share = (e: Expense) => e.amountTwd / e.shares.length
  const toForFrom = expenses.filter((e) => e.payerId === to && e.shares.includes(from))
  const fromForTo = expenses.filter((e) => e.payerId === from && e.shares.includes(to))
  const sumTo = toForFrom.reduce((n, e) => n + share(e), 0)
  const sumFrom = fromForTo.reduce((n, e) => n + share(e), 0)
  const diff = Math.round(sumTo - sumFrom)

  const rows = (list: Expense[], whoPays: string) =>
    list.length ? (
      list.map((e) => (
        <div key={e.id} className="lg-drow">
          <span className="lg-ddate">{e.date.slice(5)}</span>
          <span className="lg-dname">
            <b>{e.title}</b>
            <span>
              {names[whoPays] ?? ''} 付 {e.currency === 'JPY' ? jpy(e.amount) : twd(e.amount)}・{e.shares.length} 人分
            </span>
          </span>
          <span className="lg-damt">{twd(share(e))}</span>
        </div>
      ))
    ) : (
      <p className="lg-hint lg-dempty">沒有</p>
    )

  return (
    <div className="lg-detail">
      <div className="lg-dhead">
        {names[to]} 幫 {names[from]} 墊的
      </div>
      {rows(toForFrom, to)}
      <div className="lg-dsum">
        <span>小計</span>
        <b>{twd(sumTo)}</b>
      </div>

      <div className="lg-dhead">
        {names[from]} 幫 {names[to]} 墊的
      </div>
      {rows(fromForTo, from)}
      <div className="lg-dsum">
        <span>小計</span>
        <b>{twd(sumFrom)}</b>
      </div>

      <div className="lg-dnet">
        <span>
          這兩人單獨對帳：
          {diff >= 0 ? `${names[from]} 給 ${names[to]}` : `${names[to]} 給 ${names[from]}`}
        </span>
        <b>{twd(Math.abs(diff))}</b>
      </div>

    </div>
  )
}

/** 只算「這兩個人之間」誰欠誰，完全不透過第三人對沖。 */
function pairTransfers(members: Member[], expenses: Expense[]) {
  const act = members.filter((m) => m.active)
  const out: { from: string; to: string; amount: number }[] = []
  for (let i = 0; i < act.length; i++) {
    for (let j = i + 1; j < act.length; j++) {
      const a = act[i].id
      const b = act[j].id
      let ab = 0 // 正數 = a 欠 b
      for (const e of expenses) {
        const share = e.amountTwd / e.shares.length
        if (e.payerId === b && e.shares.includes(a)) ab += share
        if (e.payerId === a && e.shares.includes(b)) ab -= share
      }
      const v = Math.round(ab)
      if (v >= 1) out.push({ from: a, to: b, amount: v })
      else if (v <= -1) out.push({ from: b, to: a, amount: -v })
    }
  }
  return out.sort((x, y) => y.amount - x.amount)
}

function Login({ onDone }: { onDone: (token: string) => void }) {
  const [names, setNames] = useState<{ name: string; role: string }[]>([])
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [needSetup, setNeedSetup] = useState(false)

  useEffect(() => {
    if (!API_BASE) return
    api<{ names: { name: string; role: string }[] }>('/api/member-names')
      .then((d) => {
        setNames(d.names)
        if (!d.names.length) setNeedSetup(true)
        else setName(d.names[0].name)
      })
      .catch((e: Error) => setErr(e.message))
  }, [])

  const submit = async () => {
    setBusy(true)
    setErr('')
    try {
      const path = needSetup ? '/api/bootstrap' : '/api/login'
      const d = await api<{ token: string }>(path, { method: 'POST', body: { name, pin } })
      onDone(d.token)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!API_BASE) {
    return (
      <div className="lg-login">
        <h2>記帳</h2>
        <p className="lg-hint">記帳後端還沒設定，等我把 Cloudflare 接好就能用。</p>
      </div>
    )
  }

  return (
    <div className="lg-login">
      <h2>{needSetup ? '建立管理員帳號' : '登入記帳'}</h2>
      <p className="lg-hint">{needSetup ? '第一次使用，先建立你自己的帳號。' : '選名字，輸入你的 PIN。'}</p>

      {names.length > 0 && (
        <div className="lg-names">
          {names.map((n) => (
            <button
              key={n.name}
              type="button"
              className={`lg-name${name === n.name ? ' on' : ''}`}
              onClick={() => setName(n.name)}
            >
              {n.name}
            </button>
          ))}
        </div>
      )}

      {needSetup && (
        <input className="lg-input" placeholder="你的名字" value={name} onChange={(e) => setName(e.target.value)} />
      )}

      <input
        className="lg-input"
        placeholder="PIN（4–6 位數字）"
        inputMode="numeric"
        type="password"
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />

      {err && <p className="lg-err">{err}</p>}

      <button type="button" className="lg-primary" disabled={busy || !name || pin.length < 4} onClick={submit}>
        {busy ? '登入中…' : needSetup ? '建立並登入' : '登入'}
      </button>
    </div>
  )
}

function EditSheet({
  draft,
  members,
  me,
  rate,
  onSave,
  onDelete,
  onClose,
}: {
  draft: Draft
  members: Member[]
  me: Member
  rate: number
  onSave: (d: Draft) => void
  onDelete?: () => void
  onClose: () => void
}) {
  const [d, setD] = useState<Draft>(draft)
  const set = (patch: Partial<Draft>) => setD((prev) => ({ ...prev, ...patch }))
  const amount = Number(d.amount) || 0

  return (
    <div className="lg-sheetwrap" role="dialog" aria-modal="true">
      <div className="lg-sheet">
        <div className="lg-sheethead">
          <button type="button" className="lg-text" onClick={onClose}>
            取消
          </button>
          <b>{d.id ? '修改這筆' : '新增花費'}</b>
          <button type="button" className="lg-text lg-strong" disabled={!d.title || amount <= 0} onClick={() => onSave(d)}>
            儲存
          </button>
        </div>

        <label className="lg-field">
          <span>項目</span>
          <input value={d.title} onChange={(e) => set({ title: e.target.value })} placeholder="例如：柳川鰻魚飯" />
        </label>

        <div className="lg-row">
          <label className="lg-field">
            <span>日期</span>
            <input type="date" value={d.date} onChange={(e) => set({ date: e.target.value })} />
          </label>
          <label className="lg-field">
            <span>分類</span>
            <div className="lg-chips">
              {CATS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className={`lg-chip ${c.cls}${d.category === c.key ? ' on' : ''}`}
                  onClick={() => set({ category: c.key })}
                >
                  {c.key}
                </button>
              ))}
            </div>
          </label>
        </div>

        <label className="lg-field">
          <span>金額</span>
          <div className="lg-amount">
            <div className="lg-ccy">
              <button type="button" className={d.currency === 'JPY' ? 'on' : ''} onClick={() => set({ currency: 'JPY' })}>
                ¥ 日圓
              </button>
              <button type="button" className={d.currency === 'TWD' ? 'on' : ''} onClick={() => set({ currency: 'TWD' })}>
                NT$ 台幣
              </button>
            </div>
            <input
              inputMode="decimal"
              value={d.amount}
              onChange={(e) => set({ amount: e.target.value.replace(/[^\d.]/g, '') })}
              placeholder="0"
            />
          </div>
        </label>

        <label className="lg-field">
          <span>誰付的</span>
          <div className="lg-chips">
            {members
              .filter((m) => m.active)
              .map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`lg-chip${d.payerId === m.id ? ' on' : ''}`}
                  onClick={() => set({ payerId: m.id })}
                >
                  {m.name}
                  {m.id === me.id ? '（我）' : ''}
                </button>
              ))}
          </div>
        </label>

        <label className="lg-field">
          <span>誰分這筆</span>
          <div className="lg-chips">
            {members
              .filter((m) => m.active)
              .map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`lg-chip${d.shares.includes(m.id) ? ' on' : ''}`}
                  onClick={() =>
                    set({
                      shares: d.shares.includes(m.id)
                        ? d.shares.filter((s) => s !== m.id)
                        : [...d.shares, m.id],
                    })
                  }
                >
                  {m.name}
                </button>
              ))}
          </div>
          <span className="lg-sub">
            {d.shares.length ? `每人 ${twd((amount * (d.currency === 'JPY' ? rate : 1)) / d.shares.length)}` : '至少選一個人'}
          </span>
        </label>

        <label className="lg-field">
          <span>備註</span>
          <input value={d.note} onChange={(e) => set({ note: e.target.value })} placeholder="可不填" />
        </label>

        {onDelete && (
          <button type="button" className="lg-danger" onClick={onDelete}>
            刪除這筆
          </button>
        )}
      </div>
    </div>
  )
}

function LedgerInner({ me, state, onRefresh, onLogout }: { me: Member; state: State; onRefresh: () => void; onLogout: () => void }) {
  const [tab, setTab] = useState<'list' | 'settle' | 'admin'>('list')
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [mode, setMode] = useState<'pair' | 'merged'>('pair')
  const [editing, setEditing] = useState<Draft | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [names, setNames] = useState<Record<string, string>>({})

  useEffect(() => {
    const map: Record<string, string> = {}
    state.members.forEach((m) => (map[m.id] = m.name))
    setNames(map)
  }, [state.members])

  const totalTwd = state.expenses.reduce((n, e) => n + e.amountTwd, 0)
  const { bal, transfers } = useMemo(() => settlement(state.members, state.expenses), [state])
  const pairs = useMemo(() => pairTransfers(state.members, state.expenses), [state])

  const token = localStorage.getItem(TOKEN_KEY) ?? ''

  const save = async (d: Draft) => {
    setBusy(true)
    setErr('')
    const body = {
      date: d.date,
      title: d.title,
      category: d.category,
      currency: d.currency,
      amount: Number(d.amount),
      payerId: d.payerId,
      shares: d.shares,
      note: d.note,
    }
    try {
      if (d.id) await api(`/api/expenses/${d.id}`, { method: 'PATCH', body, token })
      else await api('/api/expenses', { method: 'POST', body, token })
      setEditing(null)
      onRefresh()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    if (!window.confirm('刪除這筆花費？')) return
    setBusy(true)
    try {
      await api(`/api/expenses/${id}`, { method: 'DELETE', token })
      setEditing(null)
      onRefresh()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const canEdit = (e: Expense) => e.createdBy === me.id || me.role === 'admin'
  const byDate = useMemo(() => {
    const map = new Map<string, Expense[]>()
    for (const e of state.expenses) {
      const list = map.get(e.date) ?? []
      list.push(e)
      map.set(e.date, list)
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))
  }, [state.expenses])

  return (
    <div className="lg-main">
      <div className="lg-summary">
        <div className="lg-total">已登記 {twd(totalTwd)}</div>
        <div className="lg-sub">日圓換算匯率 {state.settings.rate}</div>
      </div>

      <div className="lg-tabs">
        {(
          [
            ['list', '明細'],
            ['settle', '結算'],
            ['admin', '設定'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {err && <p className="lg-err">{err}</p>}

      {tab === 'list' && (
        <div className="lg-list">
          {byDate.length === 0 && <p className="lg-hint">還沒有任何花費，按右下角「＋」開始記。</p>}
          {byDate.map(([date, list]) => (
            <section key={date} className="lg-day">
              <h4>{date}</h4>
              {list.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  className={`lg-item ${CATS.find((c) => c.key === e.category)?.cls ?? 'c-food'}`}
                  onClick={() => {
                    if (!canEdit(e)) {
                      setErr('這筆是別人記的，只有他或管理員可以修改')
                      return
                    }
                    setEditing({
                      id: e.id,
                      date: e.date,
                      title: e.title,
                      category: e.category,
                      currency: e.currency,
                      amount: String(e.amount),
                      payerId: e.payerId,
                      shares: e.shares,
                      note: e.note,
                    })
                  }}
                >
                  <span className="lg-cat">{e.category}</span>
                  <span className="lg-info">
                    <b>{e.title}</b>
                    <span>
                      {names[e.payerId] ?? '？'} 付・{e.shares.length} 人分
                      {e.createdBy !== me.id ? `・${names[e.createdBy] ?? ''} 記` : ''}
                    </span>
                  </span>
                  <span className="lg-amt">
                    <b>{e.currency === 'JPY' ? jpy(e.amount) : twd(e.amount)}</b>
                    <span>{twd(e.amountTwd)}</span>
                  </span>
                </button>
              ))}
            </section>
          ))}
        </div>
      )}

      {tab === 'settle' && (
        <div className="lg-settle">
          <h3>誰該給誰</h3>
          <div className="lg-modeswitch">
            <button type="button" className={mode === 'pair' ? 'on' : ''} onClick={() => { setMode('pair'); setOpenKey(null) }}>
              兩兩對帳
            </button>
            <button type="button" className={mode === 'merged' ? 'on' : ''} onClick={() => { setMode('merged'); setOpenKey(null) }}>
              合併最少筆數
            </button>
          </div>
          <p className="lg-modehint">
            {mode === 'pair'
              ? '只算你們兩個人之間誰欠誰，每一筆都對得到共同花費。'
              : '把互相欠的帳合併，轉帳次數最少；要看原始關係請切回「兩兩對帳」。'}
          </p>

          {(mode === 'pair' ? pairs : transfers).length === 0 && (
            <p className="lg-hint">目前不用轉帳，帳是平的。</p>
          )}
          {(mode === 'pair' ? pairs : transfers).map((t, i) => {
            const key = `${t.from}-${t.to}`
            const open = openKey === key
            return (
              <div key={i} className="lg-tblock">
                <button
                  type="button"
                  className={`lg-transfer${open ? ' open' : ''}`}
                  onClick={() => setOpenKey(open ? null : key)}
                  aria-expanded={open}
                >
                  <span>{names[t.from] ?? '？'}</span>
                  <span className="lg-arrow">→</span>
                  <span>{names[t.to] ?? '？'}</span>
                  <b>{twd(t.amount)}</b>
                  <span className="lg-chev">{open ? '▾' : '▸'}</span>
                </button>
                {open && (
                  <TransferDetail
                    from={t.from}
                    to={t.to}
                    names={names}
                    expenses={state.expenses}
                  />
                )}
              </div>
            )
          })}

          <p className="lg-modehint">
            {mode === 'pair'
              ? `共 ${pairs.length} 筆——總金額會比合併後多，因為同一筆錢可能經過好幾手；每個人最後的淨額兩邊一樣。`
              : `共 ${transfers.length} 筆`}
          </p>

          <h3>每個人的淨額</h3>
          {state.members
            .filter((m) => m.active)
            .map((m) => {
              const v = bal.get(m.id) ?? 0
              return (
                <div key={m.id} className="lg-balrow">
                  <span>{m.name}</span>
                  <b className={v >= 0 ? 'pos' : 'neg'}>{v >= 0 ? `收 ${twd(v)}` : `付 ${twd(-v)}`}</b>
                </div>
              )
            })}
        </div>
      )}

      {tab === 'admin' && (
        <AdminPanel state={state} me={me} token={token} onRefresh={onRefresh} onLogout={onLogout} />
      )}

      <button type="button" className="lg-fab" aria-label="新增花費" onClick={() => setEditing({
        date: new Date().toISOString().slice(0, 10),
        title: '',
        category: '食',
        currency: 'JPY',
        amount: '',
        payerId: me.id,
        shares: state.members.filter((m) => m.active).map((m) => m.id),
        note: '',
      })}>
        ＋
      </button>

      {editing && (
        <EditSheet
          draft={editing}
          members={state.members}
          me={me}
          rate={state.settings.rate}
          onSave={save}
          onDelete={editing.id ? () => remove(editing.id!) : undefined}
          onClose={() => setEditing(null)}
        />
      )}

      {busy && <div className="lg-busy">處理中…</div>}
    </div>
  )
}

function AdminPanel({
  state,
  me,
  token,
  onRefresh,
  onLogout,
}: {
  state: State
  me: Member
  token: string
  onRefresh: () => void
  onLogout: () => void
}) {
  const [rate, setRate] = useState(String(state.settings.rate))
  const [newName, setNewName] = useState('')
  const [newPin, setNewPin] = useState('')
  const [msg, setMsg] = useState('')
  const isAdmin = me.role === 'admin'

  const saveRate = async () => {
    setMsg('')
    try {
      await api('/api/settings', { method: 'PATCH', body: { rate: Number(rate) }, token })
      setMsg('匯率已更新，日圓帳目已重算')
      onRefresh()
    } catch (e) {
      setMsg((e as Error).message)
    }
  }

  const addMember = async () => {
    setMsg('')
    try {
      await api('/api/members', { method: 'POST', body: { name: newName, pin: newPin }, token })
      setNewName('')
      setNewPin('')
      setMsg('已新增成員')
      onRefresh()
    } catch (e) {
      setMsg((e as Error).message)
    }
  }

  const toggle = async (m: Member) => {
    try {
      await api(`/api/members/${m.id}`, { method: 'PATCH', body: { active: !m.active }, token })
      onRefresh()
    } catch (e) {
      setMsg((e as Error).message)
    }
  }

  const resetPin = async (m: Member) => {
    const pin = window.prompt(`把 ${m.name} 的 PIN 改成？（4–6 位數字）`)
    if (!pin) return
    try {
      await api(`/api/members/${m.id}`, { method: 'PATCH', body: { pin }, token })
      setMsg(`${m.name} 的 PIN 已重設`)
    } catch (e) {
      setMsg((e as Error).message)
    }
  }

  const exportCsv = () => {
    const rows = [
      ['日期', '項目', '分類', '幣別', '原幣金額', '匯率', '台幣金額', '付款人', '分攤人數'],
      ...state.expenses.map((e) => [
        e.date,
        e.title,
        e.category,
        e.currency,
        String(e.amount),
        String(e.rate),
        String(e.amountTwd),
        state.members.find((m) => m.id === e.payerId)?.name ?? '',
        String(e.shares.length),
      ]),
    ]
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `kyushu-ledger-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="lg-admin">
      {isAdmin ? (
        <>
          <h3>匯率</h3>
          <div className="lg-inline">
            <span>1 日圓 =</span>
            <input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" />
            <span>台幣</span>
            <button type="button" className="lg-primary lg-small" onClick={saveRate}>
              儲存
            </button>
          </div>
          <p className="lg-hint">改匯率時，已經記過的日圓金額會一起重算。</p>

          <h3>成員</h3>
          {state.members.map((m) => (
            <div key={m.id} className="lg-member">
              <span>
                {m.name}
                {m.role === 'admin' ? '・管理員' : ''}
                {m.active ? '' : '・已停用'}
              </span>
              <span className="lg-mact">
                <button type="button" onClick={() => resetPin(m)}>
                  重設 PIN
                </button>
                {m.id !== me.id && (
                  <button type="button" onClick={() => toggle(m)}>
                    {m.active ? '停用' : '啟用'}
                  </button>
                )}
              </span>
            </div>
          ))}

          <h3>新增成員</h3>
          <div className="lg-inline">
            <input placeholder="名字" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <input
              placeholder="PIN"
              value={newPin}
              inputMode="numeric"
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
            <button type="button" className="lg-primary lg-small" onClick={addMember}>
              新增
            </button>
          </div>
        </>
      ) : (
        <p className="lg-hint">只有管理員可以改匯率與成員。</p>
      )}

      {msg && <p className="lg-msg">{msg}</p>}

      <button type="button" className="lg-export" onClick={exportCsv}>
        匯出 CSV
      </button>
      <button type="button" className="lg-logout" onClick={onLogout}>
        登出
      </button>
    </div>
  )
}

export default function LedgerPage() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? '')
  const [state, setState] = useState<State | null>(() => readJSON<State | null>(CACHE_KEY, null))
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)

  const load = useCallback(async () => {
    if (!token) return
    try {
      const s = await api<State>('/api/state', { token })
      setState(s)
      writeJSON(CACHE_KEY, s)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load, tick])

  useEffect(() => {
    const onOnline = () => setTick((n) => n + 1)
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [])

  // 換人登入時把上一次的快取清掉，避免看到別人的畫面
  useEffect(() => {
    if (!token) {
      localStorage.removeItem(CACHE_KEY)
      setState(null)
    }
  }, [token])

  const refresh = useCallback(() => setTick((n) => n + 1), [])

  const logout = () => {
    if (token) void api('/api/logout', { method: 'POST', token }).catch(() => undefined)
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(CACHE_KEY)
    setToken('')
    setState(null)
  }

  return (
    <div className="lg-page">
      <header className="lg-top">
        <b>旅費記帳</b>
        <span className="lg-who">{state?.me.name ?? ''}</span>
      </header>

      {!token ? (
        <Login
          onDone={(t) => {
            localStorage.setItem(TOKEN_KEY, t)
            setToken(t)
          }}
        />
      ) : !state ? (
        <p className="lg-hint lg-loading">載入中…</p>
      ) : (
        <LedgerInner me={state.me} state={state} onRefresh={refresh} onLogout={logout} />
      )}

      {error && <p className="lg-err lg-floaterr">{error}</p>}
      {state && !state.me && <p className="lg-hint">請重新登入</p>}
    </div>
  )
}
