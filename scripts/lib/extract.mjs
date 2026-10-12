/**
 * Claude 분석용 스키마·프롬프트와, 분석 결과를 사이트용 레코드로 바꾸는 함수.
 * (네트워크·외부 라이브러리 없이 동작하므로 단독으로 테스트할 수 있습니다.)
 */

const GRADE = { type: "string", enum: ["yes", "check", "no"] };
const GRADE_KEYS = ["fresh", "current", "transfer", "graduate"];
const obj = (props) => ({ type: "object", properties: props, required: Object.keys(props), additionalProperties: false });

export const SCHEMA = obj({
  notice_kind: { type: "string", enum: ["모집", "결과발표", "안내", "기타"] },
  title: { type: "string" },
  organization: { type: "string" },
  quota: { type: "string" },
  target_tags: { type: "array", items: { type: "string" } },
  benefit_amount: { type: "string" },
  benefit_note: { type: "string" },
  apply_start: { type: "string" },
  deadline_date: { type: "string" },
  deadline_time: { type: "string" },
  deadline_text: { type: "string" },
  apply_method: { type: "string" },
  grades: obj(Object.fromEntries(GRADE_KEYS.map((k) => [k, GRADE]))),
  grade_notes: obj(Object.fromEntries(GRADE_KEYS.map((k) => [k, { type: "string" }]))),
  evidence: { type: "array", items: { type: "string", enum: ["본문", "포스터", "첨부PDF"] } },
  confidence: { type: "string", enum: ["high", "medium", "low"] },
  missing: { type: "array", items: { type: "string" } },
});

export const SYSTEM_PROMPT = `당신은 동국대학교 학생을 위해 장학 공지를 정리하는 도우미입니다.
게시글 본문 텍스트와 함께 첨부된 포스터 이미지·PDF를 모두 읽고, 아래 규칙에 따라 장학 정보를 추출하세요.

규칙
- 자료에 실제로 적힌 내용만 옮깁니다. 추측하거나 지어내지 않습니다. 확인할 수 없는 값은 빈 문자열("")로 두고, 그 항목 이름을 missing 배열에 넣습니다.
- 본문과 포스터가 다르면 '기간 연장' 등 더 최근 정보로 보이는 쪽을 따르고 benefit_note나 deadline_text에 그 사실을 적습니다.
- notice_kind: 장학생을 모집·신청받는 공고면 "모집", 합격자·선발 결과 발표면 "결과발표", 대출·서류 제출·제도 안내 등이면 "안내".
- title: 짧은 장학명 (예: "윤영문화재단 신규장학생"). 학기·[홍보] 같은 말머리는 빼세요.
- organization: 장학을 주는 재단·기관.
- quota: 선발인원 (예: "2명", "학과별 배정"). 공고에 "0명", "○명"처럼 비어 있으면 "인원 미기재".
- target_tags: 지원자격을 2~12자 내외의 짧은 키워드 3~6개로 (예: "직전학기 3.0↑", "은평구 2년↑ 거주", "가계곤란자").
- benefit_amount: 핵심 금액 한 줄 (예: "200만원", "등록금 전액", "총 1,000만원"). benefit_note: 지급 방식·기간 등 보충.
- apply_start / deadline_date: "YYYY-MM-DD". deadline_time: "HH:MM" (24시간제, 없으면 ""). 연도가 없으면 게시일 기준으로 판단하세요.
  신청 단계가 여러 개면(예: 온라인 신청 후 서류 제출) 학생이 처음 해야 하는 신청의 마감을 deadline으로, 나머지는 deadline_text에 적습니다.
- deadline_text: 사람이 읽을 기간 표기 (예: "10.12 ~ 10.28(수) 18:00").
- apply_method: 신청 방법 한 줄 (예: "nDRIMS 교외장학 신청", "재단 홈페이지 온라인 접수").
- grades: 2026학년도 기준 학년별 지원 가능 여부.
  fresh=신입생(2026 입학 1학년), current=재학생(2학년 이상 학부생), transfer=편입생(2026 편입), graduate=대학원생.
  공고상 명확히 가능하면 "yes", 명시적으로 제외되거나 대상이 아니면 "no", 조건 충족 여부를 학생이 따져봐야 하면 "check".
  "check"나 "no"인 경우 grade_notes에 이유를 짧게 적습니다 (예: "직전학기 15학점·3.0 기준 확인").
- evidence: 정보를 실제로 읽은 출처 (본문/포스터/첨부PDF).
- confidence: 핵심 4항목(대상·금액·마감일·신청방법)을 모두 확인했으면 "high", 일부만이면 "medium", 거의 못 읽었으면 "low".`;

const pad = (n) => String(n).padStart(2, "0");
const isDate = (s) => /^20\d{2}-\d{2}-\d{2}$/.test(s ?? "");
const isTime = (s) => /^\d{1,2}:\d{2}$/.test(s ?? "");

export function toDeadlineISO(date, time) {
  if (!isDate(date)) return null;
  const [h, m] = isTime(time) ? time.split(":").map(Number) : [23, 59];
  return `${date}T${pad(h)}:${pad(m)}:00+09:00`;
}

/** 수집한 게시글(post) + Claude 분석(analysis|null) → 사이트에서 쓰는 레코드 */
export function normalize(post, analysis) {
  const r = analysis?.result;
  const imageFiles = post.files.filter((f) => /\.(jpe?g|png|gif|webp)$/i.test(f.name)).length;
  const base = {
    id: post.id,
    url: post.url,
    posted: post.posted,
    type: "scholarship",
    files: post.files.map((f) => f.name).filter((n) => !/\.(jpe?g|png|gif|webp)$/i.test(n)),
    posterCount: post.images.length + imageFiles,
  };
  if (!r) {
    return { ...base, analyzed: false, kind: "모집", title: post.title ?? `장학공지 #${post.id}`, org: "", target: [], quota: "", benefit: "", benefitNote: "", deadline: null, deadlineText: "", applyStart: null, apply: "", grades: { fresh: "check", current: "check", transfer: "check", graduate: "check" }, notes: {}, allGrades: false, gradOnly: false, evidence: [], confidence: "low", missing: ["분석 전"] };
  }
  const grades = Object.fromEntries(GRADE_KEYS.map((k) => [k, String(r.grades?.[k] ?? "check").toLowerCase()]));
  const notes = Object.fromEntries(GRADE_KEYS.filter((k) => r.grade_notes?.[k]).map((k) => [k, r.grade_notes[k]]));
  const ug = ["fresh", "current", "transfer"];
  return {
    ...base,
    analyzed: true,
    analyzedAt: analysis.analyzedAt,
    kind: r.notice_kind,
    title: r.title || post.title || `장학공지 #${post.id}`,
    org: r.organization,
    target: (r.target_tags ?? []).slice(0, 6),
    quota: r.quota || "인원 미기재",
    benefit: r.benefit_amount,
    benefitNote: r.benefit_note,
    applyStart: isDate(r.apply_start) ? r.apply_start : null,
    deadline: toDeadlineISO(r.deadline_date, r.deadline_time),
    deadlineText: r.deadline_text,
    apply: r.apply_method,
    grades,
    notes,
    allGrades: ug.every((k) => grades[k] === "yes"),
    gradOnly: ug.every((k) => grades[k] === "no") && grades.graduate !== "no",
    evidence: r.evidence ?? [],
    confidence: String(r.confidence ?? "low").toLowerCase(),
    missing: r.missing ?? [],
  };
}

/** 목록·메인 페이지 HTML에서 장학공지 상세 글 번호를 찾습니다. */
const ID_PATTERNS = [
  /\/article\/JANGHAKNOTICE\/detail\/(\d{6,})/g,
  /(?:goDetail|fn_?[A-Za-z]*[Dd]etail[A-Za-z]*|goView|fnView)\(\s*['"]?(\d{6,})/g,
];
export function findIds(html) {
  const ids = new Set();
  for (const re of ID_PATTERNS) for (const m of html.matchAll(re)) ids.add(m[1]);
  return [...ids];
}

/** 구조화 출력이 없는 API(GitHub Models 등)에 붙이는 JSON 형식 안내 */
export const JSON_SHAPE_HINT = `다른 말 없이 아래 키를 모두 가진 JSON 객체 하나로만 답하세요. 값을 모르면 "" 또는 []로 둡니다.
{"notice_kind":"모집|결과발표|안내|기타","title":"","organization":"","quota":"","target_tags":[""],
"benefit_amount":"","benefit_note":"","apply_start":"YYYY-MM-DD","deadline_date":"YYYY-MM-DD","deadline_time":"HH:MM",
"deadline_text":"","apply_method":"",
"grades":{"fresh":"yes|check|no","current":"yes|check|no","transfer":"yes|check|no","graduate":"yes|check|no"},
"grade_notes":{"fresh":"","current":"","transfer":"","graduate":""},
"evidence":["본문|포스터|첨부PDF"],"confidence":"high|medium|low","missing":[""]}`;

/* ───────────── AI 없이 쓰는 규칙 기반 추출 (무료 대체 경로) ───────────── */
const KIND_RULES = [[/결과|합격자|최종\s*선발자|발표/, "결과발표"], [/선발|모집|신청|추천|지원\s*안내|장학생/, "모집"]];

/** "10.23(금) 17:00", "~10/23", "2026. 10. 30.(금) 18:00", "10월 31일" 같은 마감 표현을 찾습니다. */
export function findDeadline(text, posted) {
  const year0 = Number((posted ?? "").slice(0, 4)) || new Date().getFullYear();
  const pm = posted ? new Date(posted + "T00:00:00+09:00") : null;
  const cands = [];
  const push = (y, m, d, hh, mm, idx) => {
    m = Number(m); d = Number(d);
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return;
    let year = y ? Number(y.length === 2 ? "20" + y : y) : year0;
    let date = new Date(`${year}-${pad(m)}-${pad(d)}T00:00:00+09:00`);
    if (!y && pm && date < new Date(pm.getTime() - 20 * 86400000)) { year += 1; date = new Date(`${year}-${pad(m)}-${pad(d)}T00:00:00+09:00`); }
    cands.push({ date: `${year}-${pad(m)}-${pad(d)}`, time: hh != null ? `${pad(hh)}:${pad(mm ?? 0)}` : "", idx });
  };
  const re = /(?:(20\d{2}|\d{2})\s*[.\-/년]\s*)?(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*일?\.?\s*(?:\([월화수목금토일]\))?\s*(?:(?:오전|오후)?\s*(\d{1,2})\s*(?::|시)\s*(\d{2})?)?/g;
  for (const m of text.matchAll(re)) {
    const ctx = text.slice(Math.max(0, m.index - 25), m.index + m[0].length + 12);
    if (!/(~|까지|마감|기한|기간|신청|접수|제출)/.test(ctx)) continue;
    let hh = m[4] != null ? Number(m[4]) : null;
    if (hh != null && /오후/.test(m[0]) && hh < 12) hh += 12;
    if (hh != null && hh > 23) hh = null;
    push(m[1], m[2], m[3], hh, m[5] != null ? Number(m[5]) : null, m.index);
  }
  if (!cands.length) return null;
  // '~' 또는 '까지' 바로 앞뒤의 날짜를 우선, 없으면 가장 늦은 날짜
  const near = cands.filter((c) => /~\s*$|^\s*$/.test(text.slice(Math.max(0, c.idx - 3), c.idx)) || /까지|마감/.test(text.slice(c.idx, c.idx + 30)));
  const pool = near.length ? near : cands;
  return pool.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).at(-1);
}

export function findAmount(text) {
  const m = text.match(/(?:1인당?|학기당|연간?|총)?\s*(\d{1,3}(?:,\d{3})+|\d+)\s*(만\s*원|원)/);
  if (m) return m[0].replace(/\s+/g, " ").trim();
  if (/등록금\s*전액/.test(text)) return "등록금 전액";
  if (/등록금/.test(text)) return "등록금 지원";
  return "";
}

/** 본문 텍스트만으로 SCHEMA 모양의 결과를 만듭니다 (신뢰도 낮음 표시). */
export function ruleExtract(post) {
  const title = (post.title ?? "").replace(/^\s*\[[^\]]*\]\s*/, "").replace(/\s*\([^)]*~[^)]*\)\s*$/, "").trim();
  const text = `${post.title ?? ""}\n${post.text ?? ""}`;
  const kind = KIND_RULES.find(([re]) => re.test(post.title ?? ""))?.[1] ?? "안내";
  const dl = findDeadline(text, post.posted);
  const amount = findAmount(text);
  const g = (re) => (re.test(text) ? "no" : "check");
  const missing = [];
  if (!dl) missing.push("마감일");
  if (!amount) missing.push("지원 금액");
  if (post.images?.length) missing.push("포스터 내용(자동 판독 안 됨)");
  return {
    notice_kind: kind, title: title || `장학공지 #${post.id}`, organization: "", quota: "",
    target_tags: [], benefit_amount: amount, benefit_note: "", apply_start: "",
    deadline_date: dl?.date ?? "", deadline_time: dl?.time ?? "", deadline_text: "",
    apply_method: /ndrims|엔드림스/i.test(text) ? "nDRIMS 신청" : "",
    grades: { fresh: g(/신입생[^.\n]{0,8}(?:제외|불가)/), current: "check", transfer: g(/편입생[^.\n]{0,8}(?:제외|불가)/), graduate: /대학원/.test(text) ? "check" : "no" },
    grade_notes: { fresh: "", current: "", transfer: "", graduate: "" },
    evidence: ["본문"], confidence: "low", missing,
  };
}
