/**
 * 九州家族旅費記帳 API（Cloudflare Worker + D1）
 *
 * 權限：填的人可以改、刪自己記的帳；管理員可以改所有人的帳、管成員、改匯率。
 * 驗證：姓名 + PIN（PBKDF2 雜湊），登入後發一組 token，存在手機裡。
 */

export interface Env {
  DB: D1Database
}

const ALLOWED_ORIGINS = [
  'https://ccu401510066-ops.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
]

const SESSION_DAYS = 120
const PBKDF2_ROUNDS = 100000

type Member = {
  id: string
  name: string
  role: 'admin' | 'member'
  active: number
}

function corsHeaders(origin: string | null): Record<string, string> {
  const ok = origin && ALLOWED_ORIGINS.includes(origin)
  return {
    'Access-Control-Allow-Origin': ok ? origin! : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function json(data: unknown, origin: string | null, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(origin) },
  })
}

function fail(message: string, origin: string | null, status = 400) {
  return json({ error: message }, origin, status)
}

const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

const randomHex = (bytes: number) =>
  hex(crypto.getRandomValues(new Uint8Array(bytes)).buffer as ArrayBuffer)

function fromHex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16)
  return out
}

async function hashPin(pin: string, saltHex: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromHex(saltHex), iterations: PBKDF2_ROUNDS, hash: 'SHA-256' },
    key,
    256,
  )
  return hex(bits)
}

async function newPin(pin: string) {
  const salt = randomHex(16)
  return { salt, hash: await hashPin(pin, salt) }
}

async function issueToken(env: Env, memberId: string) {
  const token = randomHex(24)
  const expires = Date.now() + SESSION_DAYS * 86400000
  await env.DB.prepare('INSERT INTO sessions (token, member_id, expires_at) VALUES (?,?,?)')
    .bind(token, memberId, expires)
    .run()
  return token
}

async function currentMember(req: Request, env: Env): Promise<Member | null> {
  const auth = req.headers.get('Authorization') || ''
  const token = auth.replace(/^Bearer\s+/i, '').trim()
  if (!token) return null
  const row = await env.DB.prepare(
    `SELECT m.id, m.name, m.role, m.active, s.expires_at
       FROM sessions s JOIN members m ON m.id = s.member_id
      WHERE s.token = ?`,
  )
    .bind(token)
    .first<Member & { expires_at: number }>()
  if (!row || row.expires_at < Date.now() || !row.active) return null
  return { id: row.id, name: row.name, role: row.role, active: row.active }
}

type ExpenseRow = {
  id: string
  date: string
  title: string
  category: string
  currency: string
  amount: number
  rate: number
  amount_twd: number
  payer_id: string
  note: string | null
  created_by: string
  updated_by: string
  created_at: number
  updated_at: number
}

const toExpense = (r: ExpenseRow, shares: string[]) => ({
  id: r.id,
  date: r.date,
  title: r.title,
  category: r.category,
  currency: r.currency,
  amount: r.amount,
  rate: r.rate,
  amountTwd: r.amount_twd,
  payerId: r.payer_id,
  shares,
  note: r.note ?? '',
  createdBy: r.created_by,
  updatedBy: r.updated_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

async function loadState(env: Env, me: Member) {
  const members = await env.DB.prepare(
    'SELECT id, name, role, active FROM members ORDER BY created_at',
  ).all<Member>()
  const expenses = await env.DB.prepare(
    'SELECT * FROM expenses WHERE deleted = 0 ORDER BY date DESC, created_at DESC',
  ).all<ExpenseRow>()
  const shares = await env.DB.prepare('SELECT expense_id, member_id FROM expense_shares').all<{
    expense_id: string
    member_id: string
  }>()
  const settings = await env.DB.prepare('SELECT key, value FROM settings').all<{
    key: string
    value: string
  }>()

  const byExpense = new Map<string, string[]>()
  for (const s of shares.results ?? []) {
    const list = byExpense.get(s.expense_id) ?? []
    list.push(s.member_id)
    byExpense.set(s.expense_id, list)
  }

  const settingMap: Record<string, string> = {}
  for (const s of settings.results ?? []) settingMap[s.key] = s.value

  return {
    me,
    members: members.results ?? [],
    expenses: (expenses.results ?? []).map((r) => toExpense(r, byExpense.get(r.id) ?? [])),
    settings: {
      rate: Number(settingMap.rate ?? '0.21'),
      startDate: settingMap.startDate ?? '2027-01-22',
      endDate: settingMap.endDate ?? '2027-01-29',
    },
  }
}

type ExpenseBody = {
  date?: string
  title?: string
  category?: string
  currency?: 'JPY' | 'TWD'
  amount?: number
  payerId?: string
  shares?: string[]
  note?: string
}

async function readRate(env: Env): Promise<number> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?')
    .bind('rate')
    .first<{ value: string }>()
  return Number(row?.value ?? '0.21')
}

async function saveShares(env: Env, expenseId: string, memberIds: string[]) {
  await env.DB.prepare('DELETE FROM expense_shares WHERE expense_id = ?').bind(expenseId).run()
  const stmt = env.DB.prepare(
    'INSERT OR IGNORE INTO expense_shares (expense_id, member_id) VALUES (?,?)',
  )
  for (const id of memberIds) await stmt.bind(expenseId, id).run()
}

const CATEGORIES = new Set(['食', '住', '行', '樂'])

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get('Origin')
    const url = new URL(req.url)
    const path = url.pathname.replace(/\/$/, '') || '/'

    if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(origin) })

    try {
      // 健康檢查
      if (path === '/api/health') return json({ ok: true }, origin)

      // 第一次使用：還沒有任何成員時，建立管理員
      if (path === '/api/bootstrap' && req.method === 'POST') {
        const body = (await req.json()) as { name?: string; pin?: string }
        const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM members').first<{ n: number }>()
        if ((count?.n ?? 0) > 0) return fail('已經有成員，請改用登入', origin, 400)
        const name = (body.name ?? '').trim()
        const pin = (body.pin ?? '').trim()
        if (!name || pin.length < 4) return fail('請填名字與至少 4 位數的 PIN', origin)
        const id = crypto.randomUUID()
        const { salt, hash } = await newPin(pin)
        await env.DB.prepare(
          'INSERT INTO members (id, name, salt, pin_hash, role, active, created_at) VALUES (?,?,?,?,?,1,?)',
        )
          .bind(id, name, salt, hash, 'admin', Date.now())
          .run()
        await env.DB.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?,?)')
          .bind('rate', '0.21')
          .run()
        const token = await issueToken(env, id)
        return json({ token, me: { id, name, role: 'admin', active: 1 } }, origin)
      }

      if (path === '/api/login' && req.method === 'POST') {
        const body = (await req.json()) as { name?: string; pin?: string }
        const name = (body.name ?? '').trim()
        const pin = (body.pin ?? '').trim()
        const row = await env.DB.prepare(
          'SELECT id, name, role, active, salt, pin_hash FROM members WHERE name = ?',
        )
          .bind(name)
          .first<Member & { salt: string; pin_hash: string }>()
        if (!row || !row.active) return fail('名字或 PIN 不對', origin, 401)
        if ((await hashPin(pin, row.salt)) !== row.pin_hash) return fail('名字或 PIN 不對', origin, 401)
        const token = await issueToken(env, row.id)
        return json({ token, me: { id: row.id, name: row.name, role: row.role, active: row.active } }, origin)
      }

      if (path === '/api/logout' && req.method === 'POST') {
        const auth = req.headers.get('Authorization') || ''
        const token = auth.replace(/^Bearer\s+/i, '').trim()
        if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run()
        return json({ ok: true }, origin)
      }

      // 登入畫面要列出有哪些人（只回名字與是否管理員）
      if (path === '/api/member-names' && req.method === 'GET') {
        const rows = await env.DB.prepare(
          'SELECT name, role FROM members WHERE active = 1 ORDER BY created_at',
        ).all<{ name: string; role: string }>()
        return json({ names: rows.results ?? [] }, origin)
      }

      const me = await currentMember(req, env)
      if (!me) return fail('請先登入', origin, 401)

      if (path === '/api/state' && req.method === 'GET') {
        return json(await loadState(env, me), origin)
      }

      if (path === '/api/expenses' && req.method === 'POST') {
        const b = (await req.json()) as ExpenseBody
        const title = (b.title ?? '').trim()
        const amount = Number(b.amount)
        if (!title) return fail('請填項目名稱', origin)
        if (!Number.isFinite(amount) || amount <= 0) return fail('金額要大於 0', origin)
        if (!b.payerId) return fail('請選付款人', origin)
        const shares = (b.shares ?? []).filter(Boolean)
        if (!shares.length) return fail('請至少選一個分攤的人', origin)
        const category = CATEGORIES.has(b.category ?? '') ? b.category! : '食'
        const currency = b.currency === 'TWD' ? 'TWD' : 'JPY'
        const rate = currency === 'JPY' ? await readRate(env) : 1
        const id = crypto.randomUUID()
        const now = Date.now()
        await env.DB.prepare(
          `INSERT INTO expenses
            (id, date, title, category, currency, amount, rate, amount_twd, payer_id, note,
             created_by, updated_by, created_at, updated_at, deleted)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
        )
          .bind(
            id,
            b.date ?? new Date().toISOString().slice(0, 10),
            title,
            category,
            currency,
            amount,
            rate,
            Math.round(amount * rate),
            b.payerId,
            b.note ?? '',
            me.id,
            me.id,
            now,
            now,
          )
          .run()
        await saveShares(env, id, shares)
        return json(await loadState(env, me), origin)
      }

      const expenseMatch = path.match(/^\/api\/expenses\/([\w-]+)$/)
      if (expenseMatch) {
        const id = expenseMatch[1]
        const row = await env.DB.prepare('SELECT * FROM expenses WHERE id = ? AND deleted = 0')
          .bind(id)
          .first<ExpenseRow>()
        if (!row) return fail('找不到這筆帳', origin, 404)
        if (row.created_by !== me.id && me.role !== 'admin')
          return fail('只有記這筆帳的人或管理員可以修改', origin, 403)

        if (req.method === 'DELETE') {
          await env.DB.prepare('UPDATE expenses SET deleted = 1, updated_at = ? WHERE id = ?')
            .bind(Date.now(), id)
            .run()
          return json(await loadState(env, me), origin)
        }

        if (req.method === 'PATCH') {
          const b = (await req.json()) as ExpenseBody
          const title = b.title !== undefined ? b.title.trim() : row.title
          const amount = b.amount !== undefined ? Number(b.amount) : row.amount
          if (!title) return fail('請填項目名稱', origin)
          if (!Number.isFinite(amount) || amount <= 0) return fail('金額要大於 0', origin)
          const category = b.category && CATEGORIES.has(b.category) ? b.category : row.category
          const currency = b.currency === 'TWD' ? 'TWD' : b.currency === 'JPY' ? 'JPY' : row.currency
          const rate = currency === 'JPY' ? await readRate(env) : 1
          await env.DB.prepare(
            `UPDATE expenses SET date=?, title=?, category=?, currency=?, amount=?, rate=?,
               amount_twd=?, payer_id=?, note=?, updated_by=?, updated_at=? WHERE id=?`,
          )
            .bind(
              b.date ?? row.date,
              title,
              category,
              currency,
              amount,
              rate,
              Math.round(amount * rate),
              b.payerId ?? row.payer_id,
              b.note ?? row.note ?? '',
              me.id,
              Date.now(),
              id,
            )
            .run()
          if (b.shares && b.shares.length) await saveShares(env, id, b.shares.filter(Boolean))
          return json(await loadState(env, me), origin)
        }
      }

      if (path === '/api/members' && req.method === 'POST') {
        if (me.role !== 'admin') return fail('只有管理員可以新增成員', origin, 403)
        const b = (await req.json()) as { name?: string; pin?: string; role?: string }
        const name = (b.name ?? '').trim()
        const pin = (b.pin ?? '').trim()
        if (!name || pin.length < 4) return fail('請填名字與至少 4 位數的 PIN', origin)
        const id = crypto.randomUUID()
        const { salt, hash } = await newPin(pin)
        try {
          await env.DB.prepare(
            'INSERT INTO members (id, name, salt, pin_hash, role, active, created_at) VALUES (?,?,?,?,?,1,?)',
          )
            .bind(id, name, salt, hash, b.role === 'admin' ? 'admin' : 'member', Date.now())
            .run()
        } catch {
          return fail('這個名字已經有人用了', origin)
        }
        return json(await loadState(env, me), origin)
      }

      const memberMatch = path.match(/^\/api\/members\/([\w-]+)$/)
      if (memberMatch && req.method === 'PATCH') {
        if (me.role !== 'admin') return fail('只有管理員可以改成員', origin, 403)
        const id = memberMatch[1]
        const b = (await req.json()) as { name?: string; pin?: string; active?: boolean }
        if (b.name !== undefined)
          await env.DB.prepare('UPDATE members SET name = ? WHERE id = ?')
            .bind(b.name.trim(), id)
            .run()
        if (b.pin && b.pin.trim().length >= 4) {
          const { salt, hash } = await newPin(b.pin.trim())
          await env.DB.prepare('UPDATE members SET salt = ?, pin_hash = ? WHERE id = ?')
            .bind(salt, hash, id)
            .run()
        }
        if (b.active !== undefined)
          await env.DB.prepare('UPDATE members SET active = ? WHERE id = ?')
            .bind(b.active ? 1 : 0, id)
            .run()
        return json(await loadState(env, me), origin)
      }

      if (path === '/api/settings' && req.method === 'PATCH') {
        if (me.role !== 'admin') return fail('只有管理員可以改匯率', origin, 403)
        const b = (await req.json()) as { rate?: number }
        const rate = Number(b.rate)
        if (!Number.isFinite(rate) || rate <= 0) return fail('匯率要大於 0', origin)
        await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
          .bind('rate', String(rate))
          .run()
        // 既有日圓帳目一起用新匯率重算
        await env.DB.prepare(
          "UPDATE expenses SET rate = ?, amount_twd = ROUND(amount * ?) WHERE currency = 'JPY' AND deleted = 0",
        )
          .bind(rate, rate)
          .run()
        return json(await loadState(env, me), origin)
      }

      return fail('找不到這個路徑', origin, 404)
    } catch (err) {
      return fail(`伺服器錯誤：${(err as Error).message}`, origin, 500)
    }
  },
}
