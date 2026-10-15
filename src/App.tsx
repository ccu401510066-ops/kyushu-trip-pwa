import { useCallback, useEffect, useState } from 'react'
import { trip, type Day } from './trip'

type BIPEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const photoUrl = (slug: string) => `${import.meta.env.BASE_URL}photos/${slug}.jpg`

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

/** 收合狀態顯示的一行摘要：日期 + 停留點數。 */
function shortMeta(day: Day) {
  const date = day.meta.split('｜')[0] ?? ''
  return `${date}・${day.stops.length} 個停留點`
}

function DayCard({
  day,
  open,
  onToggle,
}: {
  day: Day
  open: boolean
  onToggle: () => void
}) {
  return (
    <article className={`day${open ? ' open' : ''}`} id={`day-${day.id}`}>
      <button className="dayhead" onClick={onToggle} aria-expanded={open}>
        <span className="dnum">{day.id}</span>
        <span className="dtitle">
          <span className="dname">{day.title}</span>
          <span className="dsub">{shortMeta(day)}</span>
        </span>
        <span className="chev" aria-hidden="true" />
      </button>

      <div className="daybody">
        <div className="dayinner">
          <div className="metarow">
            {day.meta.split('｜').map((part, i) => (
              <span key={i} className={i === 0 ? 'mdate' : 'mchip'}>
                {part}
              </span>
            ))}
          </div>

          <ol className="stops">
            {day.stops.map((stop, i) => (
              <li className="stop" key={i}>
                <div className="stopimg">
                  <img src={photoUrl(stop.photo)} alt={stop.name} loading="lazy" />
                </div>
                <div className="stoptext">
                  <div className="stoptop">
                    <h3>{stop.name}</h3>
                    {stop.time && <span className="stime">{stop.time}</span>}
                  </div>
                  <RichText text={stop.body} />
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
        </div>
      </div>
    </article>
  )
}

export default function App() {
  // 一次只看一天；沒點任何日期時全部收合。
  const [selected, setSelected] = useState<string | null>(null)
  const [installEvt, setInstallEvt] = useState<BIPEvent | null>(null)
  const [online, setOnline] = useState(true)

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

  const pick = useCallback(
    (id: string) => {
      const next = selected === id ? null : id
      setSelected(next)
      if (next) {
        // 選到的那天可能在畫面外，等它展開後帶進視野。
        requestAnimationFrame(() => {
          document
            .getElementById(`day-${next}`)
            ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        })
      }
    },
    [selected],
  )

  const [mainTitle, subTitle] = trip.title.includes('：')
    ? trip.title.split('：')
    : [trip.title, '']

  const totalStops = trip.days.reduce((n, d) => n + d.stops.length, 0)

  return (
    <div className="page">
      <header className="hero">
        <p className="eyebrow">{trip.eyebrow}</p>
        <h1>{mainTitle}</h1>
        {subTitle && <p className="subtitle">{subTitle}</p>}
        <p className="lede">{trip.lede}</p>
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

      <section className="stats">
        {trip.stats.map((s) => (
          <div className="stat" key={s.k}>
            <span className="sk">{s.k}</span>
            <span className="sv">{s.v}</span>
            {s.n && <span className="sn">{s.n}</span>}
          </div>
        ))}
      </section>

      <section className="panel">
        <h2 className="ptitle">行前提醒</h2>
        <div className="callouts">
          {trip.callouts.map((c, i) => (
            <details className="callout" key={i}>
              <summary>
                <span className="ctag">{c.tag}</span>
                <span className="cnum">{c.items.length} 則</span>
              </summary>
              <ul>
                {c.items.map((it, j) => (
                  <li key={j}>
                    <RichText text={it} />
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="phead">
          <h2 className="ptitle">
            每日行程
            <span className="count">
              {trip.days.length} 天・{totalStops} 個停留點
            </span>
          </h2>
        </div>

        <nav className="daynav" aria-label="選擇要看哪一天的行程">
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

        <div className="days">
          {trip.days.map((day) => (
            <DayCard
              key={day.id}
              day={day}
              open={selected === day.id}
              onToggle={() => pick(day.id)}
            />
          ))}
        </div>
      </section>

      {trip.credit && (
        <footer className="credit">
          <RichText text={trip.credit} />
        </footer>
      )}
    </div>
  )
}
