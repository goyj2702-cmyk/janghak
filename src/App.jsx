import { useCallback, useEffect, useMemo, useState } from "react";
import headImg from "./assets/head.png";
import jacketImg from "./assets/jacket.png";
import sitImg from "./assets/sit.png";
import wagonImg from "./assets/wagon.png";
import standImg from "./assets/stand.png";

/* 매일 갱신되는 분석 결과 (scripts/crawl.mjs 가 본문·포스터·첨부를 분석해 생성) */
const DATA_URL = `${import.meta.env.BASE_URL}data/notices.json`;
const BOARD_URL = "https://www.dongguk.edu/article/JANGHAKNOTICE/list";

const GRADES = [
  { id: "all", label: "전체 보기", sub: "모든 공고" },
  { id: "fresh", label: "신입생", sub: "2026 입학 1학년" },
  { id: "current", label: "재학생", sub: "2학년 이상" },
  { id: "transfer", label: "편입생", sub: "2026 편입" },
];
const gradeLabel = (g) => GRADES.find((x) => x.id === g)?.label ?? "";
const eligibleFor = (n, g) => g === "all" || n.grades?.[g] !== "no";
const NEW_DAYS = 7; // 게시일 기준 며칠 동안 NEW 표시
const kstDay = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(d);
const daysAgo = (ymd, now) => (ymd ? Math.round((new Date(kstDay(now) + "T00:00:00+09:00") - new Date(ymd + "T00:00:00+09:00")) / 86400000) : Infinity);
const isNew = (n, now) => daysAgo(n.posted, now) <= NEW_DAYS;
const safeGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 저장 불가 환경 */ } };
const fmtDate = (iso) => {
  if (!iso) return "";
  const p = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(iso));
  const g = (t) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("month")}.${g("day")}(${g("weekday")}) ${g("hour")}:${g("minute")}`;
};

/* ───────────────────────── 아이콘 ───────────────────────── */
const Svg = ({ children, className = "size-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">{children}</svg>
);
const IconUser = (p) => <Svg {...p}><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></Svg>;
const IconUsers = (p) => <Svg {...p}><path d="M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19" /><circle cx="10" cy="7.5" r="3.5" /><path d="M20 19v-1.2a3 3 0 0 0-2.3-2.9M15.5 4.3a3.3 3.3 0 0 1 0 6.4" /></Svg>;
const IconCal = (p) => <Svg {...p}><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></Svg>;
const IconClip = (p) => <Svg {...p}><path d="m20 11.5-7.8 7.8a5 5 0 0 1-7.1-7.1l8.2-8.2a3.3 3.3 0 0 1 4.7 4.7l-8.2 8.2a1.7 1.7 0 0 1-2.4-2.4l7.4-7.4" /></Svg>;
const IconArrow = (p) => <Svg {...p}><path d="M7 17 17 7M9 7h8v8" /></Svg>;
const IconSearch = (p) => <Svg {...p}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></Svg>;
const IconInfo = (p) => <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8v.1" /></Svg>;
const IconImage = (p) => <Svg {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="9" cy="9.5" r="1.6" /><path d="m20.5 15.5-4.5-4.5-8 8" /></Svg>;
const IconRefresh = (p) => <Svg {...p}><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" /></Svg>;

/* ───────────────────────── 카드 ───────────────────────── */
function Row({ icon, children }) {
  return (
    <div className="grid grid-cols-[18px_minmax(0,1fr)] items-start gap-2.5">
      <span className="mt-0.5 text-mute">{icon}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function NewBadge() {
  return <span className="ml-1.5 inline-flex -translate-y-0.5 items-center rounded-md bg-brand-500 px-1.5 py-0.5 align-middle text-[11px] font-bold leading-none tracking-wide text-white">NEW</span>;
}

function NoticeCard({ n, grade, now }) {
  const note = grade !== "all" && n.grades?.[grade] !== "yes" ? n.notes?.[grade] : null;
  const fromPoster = n.posterCount > 0 && n.analyzed;
  return (
    <a
      href={n.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${n.title} 원본 공지 열기`}
      className="group flex flex-col gap-4 rounded-2xl border border-line bg-white p-5 shadow-card transition duration-200 hover:-translate-y-0.5 hover:border-brand-500/60 hover:shadow-lift"
    >
      <div className="flex min-w-0 items-center gap-2 text-[13px] text-mute">
        <span className="size-2 flex-none rounded-full bg-brand-500" />
        <span className="truncate">{n.org || "장학공지"}</span>
        {n.posted && <span className="ml-auto flex-none tabular-nums">{n.posted.slice(5).replace("-", ".")} 게시</span>}
      </div>

      <div className="flex flex-col gap-1">
        <h3 className="text-[18px] font-bold leading-snug">{n.title}{isNew(n, now) && <NewBadge />}</h3>
        <p className="font-display text-[26px] leading-tight text-brand-600">{n.benefit || "금액 원문 확인"}</p>
        {n.benefitNote && <p className="text-[13px] text-mute">{n.benefitNote}</p>}
      </div>

      <div className="flex flex-col gap-3">
        {n.target?.length > 0 && (
          <Row icon={<IconUser />}>
            <div className="flex flex-wrap gap-1.5">
              {n.target.map((t) => <span key={t} className="rounded-full bg-paper px-2.5 py-0.5 text-[12.5px] text-ink/85 ring-1 ring-line">{t}</span>)}
            </div>
          </Row>
        )}
        {n.quota && <Row icon={<IconUsers />}><span className="text-[14px]">{n.quota}</span></Row>}
        <Row icon={<IconCal />}>
          <p className="text-[14px] font-semibold tabular-nums">{n.deadlineText || fmtDate(n.deadline) || "마감일 원문 확인"}</p>
          {n.apply && <p className="text-[12.5px] text-mute">{n.apply}</p>}
        </Row>
      </div>

      {note && (
        <p className="flex items-start gap-2 rounded-xl bg-wine-50 px-3 py-2 text-[13px] text-wine-700">
          <IconInfo className="mt-0.5 size-4 flex-none" />
          <span>{gradeLabel(grade)}: {note}</span>
        </p>
      )}
      {n.missing?.length > 0 && <p className="text-[12.5px] text-mute">공고에서 확인하지 못한 항목: {n.missing.join(", ")}</p>}

      <div className="mt-auto flex flex-col gap-2 border-t border-line pt-3">
        {(n.files?.length > 0 || n.posterCount > 0) && (
          <p className="flex min-w-0 items-start gap-2 text-[12.5px] text-mute">
            <IconClip className="mt-0.5 size-4 flex-none" />
            <span className="min-w-0 truncate">
              {n.files.length > 0 ? n.files[0] : "포스터 이미지"}
              {n.files.length > 1 && ` 외 ${n.files.length - 1}개`}
              {n.files.length > 0 && n.posterCount > 0 && " · 포스터"}
            </span>
          </p>
        )}
        <div className="flex items-center gap-2">
          <span className="min-w-0 truncate text-[12px] text-mute">
            {n.analysisSource ? `분석 근거: ${n.analysisSource.label}` : fromPoster ? "포스터 내용까지 분석" : ""}
          </span>
          <span className="ml-auto inline-flex flex-none items-center gap-1 text-[13.5px] font-semibold text-brand-700 group-hover:text-brand-600">
            원본 공지 <IconArrow className="size-4" />
          </span>
        </div>
      </div>
    </a>
  );
}

function PendingRow({ n, now }) {
  return (
    <a href={n.url} target="_blank" rel="noopener noreferrer" aria-label={`${n.title} 원본 공지 열기`} className="group flex items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3 shadow-card transition hover:border-brand-500/60">
      <span className="grid size-10 flex-none place-items-center rounded-xl bg-brand-50 text-brand-600"><IconImage className="size-5" /></span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{n.title}{isNew(n, now) && <NewBadge />}</p>
        <p className="truncate text-[12.5px] text-mute">{[n.org, n.posted && `${n.posted.slice(5).replace("-", ".")} 게시`, "포스터·첨부 내용을 확인하지 못함"].filter(Boolean).join(" · ")}</p>
      </div>
      <span className="hidden items-center gap-1 text-[13px] font-semibold text-brand-700 sm:inline-flex">원문 <IconArrow className="size-4" /></span>
    </a>
  );
}

/* ───────────────────────── 공통 조각 ───────────────────────── */
function Mascot({ img, title, desc, bob, children }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-line bg-white px-6 py-12 text-center">
      <img src={img} alt="" className={`h-36 w-auto ${bob ? "animate-bob" : ""}`} />
      <p className="font-display text-[22px] text-ink">{title}</p>
      {desc && <p className="max-w-[44ch] text-[14px] text-mute">{desc}</p>}
      {children}
    </div>
  );
}
function Section({ title, count, desc, children }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-display text-[24px] text-ink">{title}</h2>
        <span className="text-[14px] font-semibold tabular-nums text-brand-700">{count}건</span>
        {desc && <span className="text-[13px] text-mute">{desc}</span>}
      </div>
      {children}
    </section>
  );
}
const Grid = ({ children }) => <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{children}</div>;

/* ───────────────────────── 앱 ───────────────────────── */
export default function App() {
  const [grade, setGrade] = useState(() => safeGet("dgu-grade", "all"));
  const [q, setQ] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [pause, setPause] = useState(false);
  const [now] = useState(() => new Date());

  const load = useCallback(() => {
    setError(null);
    setData(null);
    fetch(DATA_URL, { cache: "no-cache" })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const pickGrade = (g) => {
    if (g === grade) return;
    setGrade(g);
    safeSet("dgu-grade", g);
    setPause(true);
    setTimeout(() => setPause(false), 450);
  };

  const { open, undated, unread, fresh, closedCount } = useMemo(() => {
    const list = data?.notices ?? []; // 장학공지 게시판의 모든 글을 보여줍니다
    return {
      open: list.filter((n) => n.deadline && new Date(n.deadline) >= now).sort((a, b) => a.deadline.localeCompare(b.deadline)),
      // 마감일이 없는 공고: 최근 30일 안의 글은 카드로 크게, 그보다 오래된 글은 아래 목록으로
      undated: list.filter((n) => !n.deadline && (n.analyzed || daysAgo(n.posted, now) <= 30)).sort((a, b) => (b.posted ?? "").localeCompare(a.posted ?? "")),
      unread: list.filter((n) => !n.deadline && !n.analyzed && daysAgo(n.posted, now) > 30),
      fresh: list.filter((n) => isNew(n, now) && !(n.deadline && new Date(n.deadline) < now)),
      closedCount: list.filter((n) => n.deadline && new Date(n.deadline) < now).length,
    };
  }, [data, now]);

  const k = q.trim();
  const textMatch = (n) => !k || [n.title, n.org, n.benefit, n.benefitNote, ...(n.target ?? [])].join(" ").includes(k);
  const eligible = open.filter((n) => eligibleFor(n, grade));
  const visible = eligible.filter(textMatch);
  const everyone = grade === "all" ? [] : visible.filter((n) => n.allGrades);
  const specific = grade === "all" ? visible : visible.filter((n) => !n.allGrades);
  const undatedShown = undated.filter((n) => eligibleFor(n, grade) && textMatch(n));
  const unreadShown = unread.filter(textMatch);
  const thisWeek = eligible.filter((n) => new Date(n.deadline) - now < 7 * 86400000).length;
  const loading = !data && !error;

  return (
    <div className="min-h-full">
      <header className="sticky top-[env(safe-area-inset-top,0px)] z-20 border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 md:px-6">
          <span className="grid size-11 flex-none place-items-center overflow-hidden rounded-2xl bg-brand-50 ring-1 ring-brand-100">
            <img src={headImg} alt="동국대 코끼리 캐릭터" className="mt-1 h-10 w-auto" />
          </span>
          <div className="min-w-0">
            <p className="font-display text-[20px] leading-none text-ink">동국 장학 알리미</p>
            <p className="mt-1 truncate text-[12px] text-mute">비공식 학생용 알리미 · 장학공지와 포스터를 분석해 매일 갱신</p>
          </div>
          {data && (
            <p className="ml-auto hidden text-right text-[12px] text-mute sm:block">
              <span className="inline-flex items-center gap-1"><IconRefresh className="size-3.5" />마지막 갱신</span>
              <br /><span className="tabular-nums">{fmtDate(data.updatedAt)}</span>
            </p>
          )}
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 pb-16 pt-6 md:px-6">
        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-wine-700 to-wine-600 px-5 py-6 text-white md:px-8 md:py-8">
          <div className="relative z-10 flex max-w-2xl flex-col gap-4">
            <div>
              <p className="text-[13px] font-semibold tracking-wide text-brand-100">맞춤 추천</p>
              <h1 className="mt-1 font-display text-[30px] leading-tight md:text-[38px]">나에게 맞는 장학금 찾기</h1>
              <p className="mt-2 text-[14.5px] text-white/80">게시글 본문과 포스터·첨부 내용까지 분석해 정리했어요. 학년을 고르면 지원할 수 있는 공고만 보여드려요.</p>
            </div>
            <div role="radiogroup" aria-label="학년 선택" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {GRADES.map((g) => {
                const on = grade === g.id;
                return (
                  <button key={g.id} id={`grade-${g.id}`} type="button" role="radio" aria-checked={on} onClick={() => pickGrade(g.id)}
                    className={`flex flex-col items-start rounded-2xl px-4 py-3 text-left transition ${on ? "bg-white text-wine-700 shadow-lift" : "bg-white/10 text-white ring-1 ring-white/20 hover:bg-white/15"}`}>
                    <span className="font-display text-[19px] leading-tight">{g.label}</span>
                    <span className={`text-[12px] ${on ? "text-mute" : "text-white/70"}`}>{g.sub}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <img src={jacketImg} alt="" className="pointer-events-none absolute -bottom-3 right-2 hidden h-56 w-auto drop-shadow-xl md:block lg:right-10" />
        </section>

        {data && (
          <section className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-3">
              {[
                { k: "지원 가능", v: eligible.length, s: grade === "all" ? "마감 전 전체" : `${gradeLabel(grade)} 기준` },
                { k: "7일 안에 마감", v: thisWeek, s: "서둘러 확인" },
                { k: "새 공고", v: fresh.length, s: `최근 ${NEW_DAYS}일 게시` },
              ].map((x) => (
                <div key={x.k} className="min-w-0 rounded-2xl border border-line bg-white px-4 py-3 shadow-card">
                  <p className="truncate text-[12.5px] font-semibold text-mute">{x.k}</p>
                  <p className="font-display text-[30px] leading-tight tabular-nums text-ink">{x.v}</p>
                  <p className="truncate text-[12px] text-mute">{x.s}</p>
                </div>
              ))}
            </div>
            {fresh.length > 0 && (
              <div className="flex flex-col gap-2 rounded-2xl border border-brand-100 bg-brand-50 px-4 py-3">
                <p className="text-[13px] font-semibold text-brand-700">새로 올라온 장학 공고</p>
                <ul className="flex flex-col gap-1.5">
                  {fresh.map((n) => (
                    <li key={n.id} className="min-w-0">
                      <a href={n.url} target="_blank" rel="noopener noreferrer" className="group flex min-w-0 items-center gap-2 text-[14px]">
                        <span className="flex-none rounded-md bg-brand-500 px-1.5 py-0.5 text-[11px] font-bold leading-none text-white">NEW</span>
                        <span className="min-w-0 truncate font-medium group-hover:text-brand-700 group-hover:underline">{n.title}</span>
                        <span className="ml-auto flex-none text-[12px] tabular-nums text-mute">{n.posted?.slice(5).replace("-", ".")}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <label className="relative sm:max-w-md">
              <span className="sr-only">장학 검색</span>
              <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mute" />
              <input id="search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="재단명·조건 검색 (예: 3.0, 생활비, 은평)"
                className="w-full rounded-2xl border border-line bg-white py-2 pl-9 pr-3 text-[14px] outline-none transition focus:border-brand-500" />
            </label>
          </section>
        )}

        {error ? (
          <Mascot img={sitImg} title="장학 정보를 불러오지 못했어요" desc={`데이터 파일을 읽는 중 문제가 생겼어요 (${error}). 잠시 뒤 다시 시도해 주세요.`}>
            <button type="button" onClick={load} className="mt-1 rounded-xl bg-brand-500 px-4 py-2 text-[14px] font-semibold text-white hover:bg-brand-600">다시 불러오기</button>
          </Mascot>
        ) : loading || pause ? (
          <Mascot img={wagonImg} bob title="조건에 맞는 공고를 찾는 중이에요!" desc={grade === "all" ? "마감 전 장학 공고를 모으고 있어요." : `${gradeLabel(grade)}이 지원할 수 있는 공고를 고르고 있어요.`} />
        ) : visible.length === 0 ? (
          <Mascot img={sitImg} title="조건에 맞는 공고가 아직 없어요" desc="검색어를 지우거나 다른 학년을 골라 보세요. 공고는 매일 아침 새로 확인해요." />
        ) : (
          <>
            {everyone.length > 0 && (
              <Section title="모든 학년 대상" count={everyone.length} desc="학년 제한 없이 지원할 수 있어요">
                <Grid>{everyone.map((n) => <NoticeCard key={n.id} n={n} grade={grade} now={now} />)}</Grid>
              </Section>
            )}
            {specific.length > 0 && (
              <Section title={grade === "all" ? "마감이 가까운 순" : `${gradeLabel(grade)} 맞춤 공고`} count={specific.length}
                desc={grade === "all" ? "학년을 고르면 맞춤 공고만 볼 수 있어요" : "조건 확인이 필요한 공고는 카드에 이유를 적었어요"}>
                <Grid>{specific.map((n) => <NoticeCard key={n.id} n={n} grade={grade} now={now} />)}</Grid>
              </Section>
            )}
          </>
        )}

        {data && !pause && undatedShown.length > 0 && (
          <Section title="마감일 확인이 필요한 공고" count={undatedShown.length} desc="새로 올라왔거나 마감일이 공고에 없는 글이에요. 원문에서 마감일을 확인하세요">
            <Grid>{undatedShown.map((n) => <NoticeCard key={n.id} n={n} grade={grade} now={now} />)}</Grid>
          </Section>
        )}

        {data && !pause && unreadShown.length > 0 && (
          <section className="flex flex-col gap-3 rounded-3xl bg-white p-5 ring-1 ring-line md:p-6">
            <div className="flex items-start gap-4">
              <img src={standImg} alt="" className="hidden h-20 w-auto sm:block" />
              <div>
                <h2 className="font-display text-[22px]">내용을 확인하지 못한 공고 <span className="tabular-nums text-brand-700">{unreadShown.length}건</span></h2>
                <p className="mt-1 text-[13.5px] text-mute">포스터와 첨부파일, 다른 공개 공고 어디에서도 내용을 확인하지 못했어요. 원문에서 직접 확인해 주세요.</p>
              </div>
            </div>
            <div className="grid gap-2 md:grid-cols-2">{unreadShown.map((n) => <PendingRow key={n.id} n={n} now={now} />)}</div>
          </section>
        )}

        <footer className="flex flex-col gap-1 text-[12.5px] text-mute">
          <p>
            출처: <a href={BOARD_URL} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-brand-700">동국대학교 장학공지</a>
            {data && <> · 최근 {data.lookbackDays}일 게시글{closedCount > 0 && ` · 마감된 ${closedCount}건은 숨김`}</>}
          </p>
          <p>학교 공식 서비스가 아닌 학생용 정리본입니다. 매일 아침 공지 본문과 포스터를 자동으로 분석하며 틀릴 수 있으니, 지원 전에 반드시 원본 공지를 확인하세요.</p>
        </footer>
      </main>
    </div>
  );
}
