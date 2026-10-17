import { useCallback, useEffect, useRef, useState } from 'react'
import { trip, type Day, type Packing } from './trip'

type BIPEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const photoUrl = (slug: string) => `${import.meta.env.BASE_URL}photos/${slug}.jpg`
const routeMapUrl = `${import.meta.env.BASE_URL}map/kyushu-route.png`

/** 把 **粗體** 與換行轉成節點。 */
function RichText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).filter(Boolean)
  return (
    <>
      {blocks.map((block, i) => (
        <p key={i} className="rich">
          {block.split('\n').map((line, li) => (
            <span key={li}>
              {li > 0 && <br />}
              {line.split(/(\*\*[^*]+\*\*)/g).map((seg, si) =>
                seg.startsWith('**') && seg.endsWith('**') ? (
                  <strong key={si}>{seg.slice(2, -2)}</strong>
                ) : (
                  <span key={si}>{seg}</span>
                ),
              )}
            </span>
          ))}
        </p>
      ))}
    </>
  )
}

/** 只把 **粗體** 轉成節點，不切段落；給標題下的導言用。 */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((seg, i) =>
        seg.startsWith('**') && seg.endsWith('**') ? (
          <strong key={i}>{seg.slice(2, -2)}</strong>
        ) : (
          <span key={i}>{seg}</span>
        ),
      )}
    </>
  )
}

/** 選中那一天的完整內容。 */
function DayPanel({ day }: { day: Day }) {
  return (
    <article className="day" id={`day-${day.id}`}>
      <header className="daytop">
        <h3 className="dname">{day.title}</h3>
        <div className="metarow">
          {day.meta.split('｜').map((part, i) => (
            <span key={i} className={i === 0 ? 'mdate' : 'mchip'}>
              {part}
            </span>
          ))}
        </div>
      </header>

      <ol className="stops">
        {day.stops.map((stop, i) => (
          <li className="stop" key={i}>
            <div className="stopimg">
              <img src={photoUrl(stop.photo)} alt={stop.name} loading="lazy" />
            </div>
            <div className="stoptext">
              <div className="stoptop">
                <h4>{stop.name}</h4>
                {stop.time && <span className="stime">{stop.time}</span>}
              </div>
              {stop.body && <RichText text={stop.body} />}
              {stop.notes.length > 0 && (
                <ul className="stopnotes">
                  {stop.notes.map((note, j) => (
                    <li key={j}>
                      <span className="snote">提醒</span>
                      <Inline text={note} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ol>

      {day.fallbacks && (
        <details className="callout fb">
          <summary>
            <span className="ctag">{day.fallbacks.tag}</span>
            <span className="cnum">{day.fallbacks.items.length} 則</span>
          </summary>
          <ul>
            {day.fallbacks.items.map((it, j) => (
              <li key={j}>
                <RichText text={it} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  )
}

const PACK_KEY = 'kyushu-packing-v1'

/** 出國行李懶人包：三個頁籤切換，A 隨身包包（可打勾）、B 登機箱、C 托運行李。 */
function PackingPanel({ pack }: { pack: Packing }) {
  // 勾選只存在這支手機，各家手機互不影響；也不會回傳到筆記。
  const [done, setDone] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem(PACK_KEY)
      return raw ? (JSON.parse(raw) as Record<string, boolean>) : {}
    } catch {
      return {}
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(PACK_KEY, JSON.stringify(done))
    } catch {
      /* 無痕模式等情況就只是不記住，不影響看 */
    }
  }, [done])

  // 三個頁籤：預設停在 A 隨身包包，也就是唯一要動手勾的那一類。
  const [tab, setTab] = useState(0)
  const cur = pack.blocks[tab] ?? pack.blocks[0]
  const all = cur ? cur.checks : []
  const checked = all.filter((c) => done[c]).length

  return (
    <section className="panel packpanel" aria-label={pack.title}>
      <h2 className="ptitle packtitle">{pack.title}</h2>
      <div className="packtabs" role="tablist" aria-label="行李分類">
        {pack.blocks.map((b, i) => (
          <button
            key={b.code}
            type="button"
            role="tab"
            aria-selected={i === tab}
            className={`ptab${i === tab ? ' on' : ''}`}
            onClick={() => setTab(i)}
          >
            <span className="ptabcode">{b.code}</span>
            <span className="ptablabel">{b.short}</span>
          </button>
        ))}
      </div>
      <div className="packcard">
        {cur && (
          <div className="packblock">
            <div className="packhead">
              {cur.code && <span className="pcode">{cur.code}</span>}
              <span>{cur.label}</span>
            </div>
            {cur.sub && <p className="packsub">{cur.sub}</p>}

            {cur.warnings.length > 0 && (
              <ul className="warnlist">
                {cur.warnings.map((w, j) => (
                  <li key={j}>
                    <span className="wn" aria-hidden="true">
                      ⚠
                    </span>
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            )}

            {cur.checks.length > 0 && (
              <>
                <ul className="checklist">
                  {cur.checks.map((c) => {
                    const on = !!done[c]
                    return (
                      <li key={c}>
                        <button
                          type="button"
                          className={`chk${on ? ' on' : ''}`}
                          aria-pressed={on}
                          onClick={() =>
                            setDone((d) => ({ ...d, [c]: !d[c] }))
                          }
                        >
                          <span className="box" aria-hidden="true">
                            {on ? '✓' : ''}
                          </span>
                          <span className="ctext">{c}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
                <div className="checkfoot">
                  <span className="chkcount">
                    已勾 {checked} / {all.length}
                  </span>
                  <button
                    type="button"
                    className="clearall"
                    onClick={() => setDone({})}
                  >
                    全部取消
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

export default function App() {
  // 一次只看一天；沒點任何日期時，日期按鈕下方不顯示任何行程。
  const [selected, setSelected] = useState<string | null>(null)
  const [openNotice, setOpenNotice] = useState<string | null>(null)
  const [installEvt, setInstallEvt] = useState<BIPEvent | null>(null)
  const [online, setOnline] = useState(true)
  const navRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const onBIP = (e: Event) => {
      e.preventDefault()
      setInstallEvt(e as BIPEvent)
    }
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    setOnline(navigator.onLine)
    window.addEventListener('beforeinstallprompt', onBIP)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBIP)
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  const pick = useCallback((id: string) => {
    setSelected((prev) => (prev === id ? null : id))
  }, [])

  // 換到別天時，讓那天的標題剛好落在日期按鈕下方，不會被黏在上方的按鈕蓋住。
  useEffect(() => {
    if (!selected) return
    const el = document.getElementById(`day-${selected}`)
    if (!el) return
    const navH = navRef.current?.offsetHeight ?? 0
    const y = el.getBoundingClientRect().top + window.scrollY - navH - 10
    window.scrollTo({ top: Math.max(y, 0), behavior: 'smooth' })
  }, [selected])

  const [mainTitle, subTitle] = trip.title.includes('：')
    ? trip.title.split('：')
    : [trip.title, '']

  const totalStops = trip.days.reduce((n, d) => n + d.stops.length, 0)
  const current = trip.days.find((d) => d.id === selected) ?? null
  const notice = trip.notices.find((g) => g.tag === openNotice) ?? null

  return (
    <div className="page">
      <header className="hero">
        <p className="eyebrow">{trip.eyebrow}</p>
        <h1>{mainTitle}</h1>
        {subTitle && <p className="subtitle">{subTitle}</p>}
        <p className="lede">
          <Inline text={trip.lede} />
        </p>
        <div className="badges">
          <span className={`badge ${online ? 'ok' : 'off'}`}>
            {online ? '已連線' : '離線中・仍可查看'}
          </span>
          {installEvt && (
            <button
              className="install"
              onClick={() => {
                installEvt.prompt()
                setInstallEvt(null)
              }}
            >
              安裝到主畫面
            </button>
          )}
        </div>
      </header>

      <figure className="routemap">
        <img
          src={routeMapUrl}
          alt="九州自駕路線示意圖：熊本 → 天草 → 阿蘇 → 由布院 → 別府 → 九重夢大吊橋 → 福岡・博多，中間繞經太宰府與糸島・二見ヶ浦"
          width={900}
          height={655}
          decoding="async"
        />
        <figcaption>路線示意圖・未依實際比例</figcaption>
      </figure>

      {trip.packing && <PackingPanel pack={trip.packing} />}

      <section className="panel">
        <h2 className="ptitle">行前確認</h2>

        <nav className="noticenav" aria-label="選擇要看哪一類確認事項">
          {trip.notices.map((g) => (
            <button
              key={g.tag}
              className={`noticebtn${g.highlight ? ' hl' : ''}${
                openNotice === g.tag ? ' on' : ''
              }`}
              onClick={() =>
                setOpenNotice((prev) => (prev === g.tag ? null : g.tag))
              }
              aria-pressed={openNotice === g.tag}
            >
              <span className="nbname">{g.tag}</span>
              <span className="nbnum">
                {g.items.length ? `${g.items.length} 則` : '待補'}
              </span>
            </button>
          ))}
        </nav>

        {notice &&
          (notice.items.length > 0 ? (
            <ul className="noticelist">
              {notice.items.map((it, i) => (
                <li key={i}>
                  <RichText text={it} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="noticeempty">這一類還沒有內容</p>
          ))}
      </section>

      <section className="panel">
        <h2 className="ptitle">
          每日行程
          <span className="count">
            {trip.days.length} 天・{totalStops} 個停留點
          </span>
        </h2>

        <nav className="daynav" ref={navRef} aria-label="選擇要看哪一天的行程">
          {trip.days.map((day) => (
            <button
              key={day.id}
              className={`daybtn${selected === day.id ? ' on' : ''}`}
              onClick={() => pick(day.id)}
              aria-pressed={selected === day.id}
            >
              <span className="dbdate">{day.date}</span>
              <span className="dbshort">{day.short}</span>
            </button>
          ))}
        </nav>

        <div className="daywrap">{current && <DayPanel day={current} />}</div>
      </section>

      {trip.credit && (
        <footer className="credit">
          <RichText text={trip.credit} />
        </footer>
      )}
    </div>
  )
}
