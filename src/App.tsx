import { useCallback, useEffect, useRef, useState } from 'react'
import { trip, type Day } from './trip'

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
              <RichText text={stop.body} />
            </div>
          </li>
        ))}
      </ol>

      {day.move && (
        <div className="moveblock">
          <span className="mtag">這天怎麼開</span>
          <RichText text={day.move} />
        </div>
      )}

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

      <section className="panel">
        <h2 className="ptitle">行前提醒</h2>

        <nav className="noticenav" aria-label="選擇要看哪一類提醒">
          {trip.notices.map((g) => (
            <button
              key={g.tag}
              className={`noticebtn${openNotice === g.tag ? ' on' : ''}`}
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
