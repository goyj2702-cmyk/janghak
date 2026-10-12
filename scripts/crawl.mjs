#!/usr/bin/env node
/**
 * 동국대학교 장학공지 수집·분석기 (무료 운영 기본)
 *
 * 1) 장학공지(JANGHAKNOTICE) 게시판에서 최근 LOOKBACK_DAYS일 게시글을 모두 찾습니다.
 *    - 메인·목록 페이지에서 상세 글 번호를 찾고, 가장 최신 글부터 '이전글' 링크를 따라 거슬러 올라갑니다.
 * 2) 각 글의 본문 텍스트, 포스터 이미지, 첨부 PDF 텍스트를 모읍니다.
 * 3) 분석 엔진 (AI_PROVIDER, 기본 auto):
 *    - github    : GitHub Models (무료 한도 안에서 사용, GitHub Actions의 GITHUB_TOKEN으로 인증) — 포스터 이미지까지 읽음
 *    - anthropic : Claude API (유료, ANTHROPIC_API_KEY가 있을 때만)
 *    - rules     : AI 없이 본문 텍스트에서 마감일·금액을 규칙으로 추출 (항상 무료, 정확도 낮음)
 *    auto = GITHUB_TOKEN 있으면 github, 아니면 rules. AI가 한도에 걸리면 남은 글은 rules로 처리하고 다음 날 다시 AI로 분석합니다.
 *    - AI 분석 결과는 data/cache.json에 저장해 바뀌지 않은 글은 다시 분석하지 않습니다.
 * 4) data/overrides.json (사람이 확인한 보정값)을 덮어쓴 뒤 public/data/notices.json 을 씁니다.
 *
 * 실행:  node scripts/crawl.mjs                       (rules)
 *        GITHUB_TOKEN=... node scripts/crawl.mjs      (GitHub Models)
 * 옵션:  --no-ai  AI 없이 규칙 기반만 / --days=60 수집 기간(일)
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import { SCHEMA, SYSTEM_PROMPT, JSON_SHAPE_HINT, normalize, findIds, ruleExtract, cleanTitle } from "./lib/extract.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_FILE = path.join(ROOT, "public/data/notices.json");
const CACHE_FILE = path.join(ROOT, "data/cache.json");

const BASE = "https://www.dongguk.edu";
const BOARD = "JANGHAKNOTICE";
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? true]));
const LOOKBACK_DAYS = Number(args.days ?? process.env.LOOKBACK_DAYS ?? 75);
const MAX_POSTS = Number(process.env.MAX_POSTS ?? 150);
const OVERRIDES_FILE = path.join(ROOT, "data/overrides.json");
const PROVIDER = args["no-ai"] ? "rules" : (process.env.AI_PROVIDER || "auto").toLowerCase() === "auto"
  ? (process.env.GITHUB_TOKEN ? "github" : process.env.ANTHROPIC_API_KEY ? "anthropic" : "rules")
  : process.env.AI_PROVIDER.toLowerCase();
const MODEL = PROVIDER === "github" ? (process.env.AI_MODEL || "openai/gpt-4o") : PROVIDER === "anthropic" ? (process.env.AI_MODEL || "claude-sonnet-5-5") : "rules";
const MAX_AI_CALLS = Number(process.env.MAX_AI_CALLS ?? 40); // 하루 무료 한도 안쪽으로
const AI_GAP_MS = Number(process.env.AI_GAP_MS ?? 7000); // 분당 요청 한도 대비
const UA = "dongguk-alimi/2.0 (student scholarship digest; +https://github.com)";

const MAX_IMAGES = 2; // 글 하나당 분석할 이미지 수 (무료 한도: 요청당 입력 약 8000토큰)
const MAX_PDFS = 1;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_TEXT = 2000; // 본문 글자 수 (요청당 입력 토큰 한도 고려)
const MAX_PDF_BYTES = 15 * 1024 * 1024;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/* ───────────── HTTP ───────────── */
async function get(url, { binary = false, referer = BASE + "/" } = {}, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Referer: referer, "Accept-Language": "ko-KR,ko;q=0.9" }, redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const type = res.headers.get("content-type") ?? "";
      const body = binary ? Buffer.from(await res.arrayBuffer()) : await res.text();
      await sleep(700); // 학교 서버에 부담을 주지 않도록 요청 간격 유지
      return { body, type, finalUrl: res.url };
    } catch (e) {
      if (i === tries) throw new Error(`${url} → ${e.message}`);
      await sleep(1500 * i);
    }
  }
}

/* ───────────── 파싱 ───────────── */
const detailUrl = (id) => `${BASE}/article/${BOARD}/detail/${id}`;
const abs = (u) => { try { return new URL(u, BASE).href; } catch { return null; } };
const FILE_RE = /\.(hwpx?|pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|webp|zip)(\s|$|\()/i;

export function parseDetail(html, id) {
  const $ = cheerio.load(html);
  $("script, style, noscript, header, footer, nav").remove();

  // 글 본문 영역: '이전글'과 '등록일/조회'를 모두 포함하는 가장 작은 블록
  let box = null, best = Infinity;
  $("div, section, article, table").each((_, el) => {
    const t = $(el).text();
    if (t.includes("이전글") && (t.includes("등록일") || t.includes("조회"))) {
      if (t.length < best) { best = t.length; box = el; }
    }
  });
  const $box = box ? $(box) : $("body");

  // 이전글/다음글
  let prevId = null, nextId = null;
  $box.find(`a[href*="/${BOARD}/detail/"]`).each((_, a) => {
    const m = ($(a).attr("href") ?? "").match(/detail\/(\d+)/);
    if (!m || m[1] === id) return;
    const around = $(a).closest("li, tr, dl, p, div").text();
    if (around.includes("이전글") && !prevId) prevId = m[1];
    else if (around.includes("다음글") && !nextId) nextId = m[1];
  });

  // 본문 텍스트 (이전글 목록 앞까지)
  let text = $box.text().replace(/[ \t ]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  const cut = text.lastIndexOf("이전글");
  if (cut > 200) text = text.slice(0, cut);
  text = text.slice(0, 15000);

  const dm = text.match(/등록일\s*:?\s*(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/) || text.match(/(20\d{2})\.(\d{1,2})\.(\d{1,2})\./);
  const posted = dm ? `${dm[1]}-${dm[2].padStart(2, "0")}-${dm[3].padStart(2, "0")}` : null;

  // 본문 포스터 이미지
  const images = [];
  $box.find("img[src]").each((_, img) => {
    const src = $(img).attr("src");
    if (!src || /chatbot|\/resources\/images\/|logo|icon/i.test(src)) return;
    const u = abs(src);
    if (u && !images.includes(u)) images.push(u);
  });

  // 첨부파일
  const files = [];
  $box.find("a").each((_, a) => {
    const name = $(a).text().replace(/\s+/g, " ").trim();
    if (!FILE_RE.test(name + " ")) return;
    const href = $(a).attr("href") ?? "";
    let url = /^javascript:|^#/.test(href) ? null : abs(href);
    if (!url) {
      const m = ($(a).attr("onclick") ?? href).match(/['"]([^'"]*(?:fileDown|download)[^'"]*)['"]/i);
      if (m) url = abs(m[1]);
    }
    const clean = name.replace(/\s*\(\s*[\d.,]+\s*[KMG]?B\s*\)\s*$/i, "");
    if (!files.some((f) => f.name === clean)) files.push({ name: clean, url });
  });

  const title =
    cleanTitle($box.find("h3, h4, .tit, .title, [class*='subject'], [class*='title']").first().text()) || null;

  return { id, url: detailUrl(id), title, posted, text, images, files, prevId, nextId };
}

/* ───────────── 게시글 찾기 ───────────── */
async function discover() {
  const seeds = new Set();
  for (const page of [`${BASE}/main`, ...[1, 2, 3, 4, 5].map((n) => `${BASE}/article/${BOARD}/list?pageIndex=${n}`)]) {
    try { findIds((await get(page)).body).forEach((i) => seeds.add(i)); }
    catch (e) { log("목록 실패:", e.message); }
  }
  if (!seeds.size) throw new Error("게시글 번호를 하나도 찾지 못했습니다. 사이트 구조가 바뀌었는지 확인하세요.");

  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10);
  const posts = new Map();
  const visit = async (id) => {
    if (posts.has(id) || posts.size >= MAX_POSTS) return null;
    const { body } = await get(detailUrl(id), { referer: `${BASE}/article/${BOARD}/list` });
    const p = parseDetail(body, id);
    posts.set(id, p);
    return p;
  };

  // 가장 최신 글부터 '이전글'을 따라 기간 끝까지
  let cur = [...seeds].sort((a, b) => Number(b) - Number(a))[0];
  while (cur && posts.size < MAX_POSTS) {
    const p = await visit(cur);
    if (!p) break;
    log(`#${p.id} ${p.posted ?? "?"} ${p.title ?? ""}`.slice(0, 90));
    if (p.posted && p.posted < cutoff) break;
    cur = p.prevId;
  }
  // 목록에서 찾았지만 체인에 없던 글(상단 고정글 등)
  for (const id of seeds) {
    if (posts.has(id)) continue;
    try { const p = await visit(id); if (p) log(`+ #${p.id} ${p.posted ?? "?"} (고정/추가)`); } catch (e) { log("상세 실패:", e.message); }
  }
  return [...posts.values()].filter((p) => !p.posted || p.posted >= cutoff);
}

/* ───────────── 자료 모으기 ───────────── */
function sniffImage(buf, type) {
  if (/image\/(jpeg|png|gif|webp)/.test(type)) return type.match(/image\/(jpeg|png|gif|webp)/)[0];
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49) return "image/gif";
  if (buf.slice(8, 12).toString() === "WEBP") return "image/webp";
  return null;
}
const isPdf = (buf) => buf.slice(0, 4).toString() === "%PDF";

let pdfjs;
async function pdfText(buf) {
  pdfjs ??= await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, isEvalSupported: false }).promise;
  let out = "";
  for (let i = 1; i <= Math.min(doc.numPages, 4); i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    out += c.items.map((t) => t.str).join(" ") + "\n";
  }
  return out.replace(/\s+\n/g, "\n").trim();
}

async function gatherMedia(post) {
  const images = [], pdfTexts = [], skipped = [];
  const imageUrls = [...post.images, ...post.files.filter((f) => f.url && /\.(jpe?g|png|gif|webp)$/i.test(f.name)).map((f) => f.url)];
  for (const u of imageUrls.slice(0, MAX_IMAGES)) {
    try {
      const { body, type } = await get(u, { binary: true, referer: post.url });
      const mt = sniffImage(body, type);
      if (!mt) { skipped.push(`이미지 형식 불명: ${u}`); continue; }
      if (body.length > MAX_IMAGE_BYTES) { skipped.push(`이미지 용량 초과: ${u}`); continue; }
      images.push({ mt, data: body.toString("base64") });
    } catch (e) { skipped.push(e.message); }
  }
  for (const f of post.files.filter((f) => f.url && /\.pdf$/i.test(f.name)).slice(0, MAX_PDFS)) {
    try {
      const { body } = await get(f.url, { binary: true, referer: post.url });
      if (!isPdf(body)) { skipped.push(`PDF 아님: ${f.name}`); continue; }
      const t = await pdfText(body);
      if (t) pdfTexts.push(`[첨부 ${f.name}]\n${t.slice(0, 1200)}`);
    } catch (e) { skipped.push(`PDF 읽기 실패 ${f.name}: ${e.message}`); }
  }
  return { images, pdfTexts, skipped };
}

function promptText(post, media, maxText = MAX_TEXT) {
  return `게시판: 동국대학교 장학공지\n원문 URL: ${post.url}\n게시글 제목: ${post.title ?? ""}\n게시일: ${post.posted ?? "알 수 없음"}\n` +
    `첨부파일 목록: ${post.files.map((f) => f.name).join(", ") || "없음"}\n` +
    `함께 보낸 자료: 포스터/이미지 ${media.images.length}장, PDF 본문 ${media.pdfTexts.length}개 (HWP는 읽을 수 없음)\n\n` +
    `--- 게시글 본문 텍스트 ---\n${post.text.slice(0, maxText)}\n` +
    (media.pdfTexts.length ? `\n--- 첨부 PDF에서 뽑은 텍스트 ---\n${media.pdfTexts.join("\n\n")}` : "");
}

class QuotaError extends Error {}

/* ───────────── 분석 엔진 ───────────── */
/** 응답 본문에서 JSON 객체를 꺼냅니다. 없으면 null */
function parseJsonObject(text) {
  if (!text) return null;
  const i = text.indexOf("{"), j = text.lastIndexOf("}");
  if (i < 0 || j <= i) return null;
  try { return JSON.parse(text.slice(i, j + 1)); } catch { return null; }
}

/**
 * GitHub Models 호출. 빈 응답이 오면 단계적으로 요청을 줄여 다시 시도합니다.
 *  1차: 포스터 이미지 + 본문 + JSON 모드
 *  2차: 이미지 1장 + 짧은 본문, JSON 모드 끔
 *  3차: 이미지 없이 본문만
 */
async function analyzeGithub(post, media) {
  const attempts = [
    { images: media.images, pdf: media.pdfTexts, text: MAX_TEXT, jsonMode: true },
    { images: media.images.slice(0, 1), pdf: [], text: 1200, jsonMode: false },
    { images: [], pdf: media.pdfTexts, text: MAX_TEXT, jsonMode: false },
  ];
  const problems = [];
  for (const [n, at] of attempts.entries()) {
    if (n === 2 && !media.images.length && !problems.length) break;
    if (n > 0) await sleep(4000);
    const m = { images: at.images, pdfTexts: at.pdf };
    const body = {
      model: MODEL,
      temperature: 0,
      max_tokens: 2000,
      messages: [
        { role: "system", content: `${SYSTEM_PROMPT}\n\n${JSON_SHAPE_HINT}` },
        { role: "user", content: [
          ...at.images.map((i) => ({ type: "image_url", image_url: { url: `data:${i.mt};base64,${i.data}`, detail: "high" } })),
          { type: "text", text: promptText(post, m, at.text) },
        ] },
      ],
    };
    if (at.jsonMode) body.response_format = { type: "json_object" };
    const res = await fetch("https://models.github.ai/inference/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    let json = null;
    try { json = JSON.parse(raw); } catch { /* 본문이 JSON이 아님 */ }
    const msg = json?.error?.message ?? raw.slice(0, 200);
    if (res.status === 429 || res.status === 401 || res.status === 403) throw new QuotaError(`GitHub Models ${res.status}: ${msg}`);
    if (!res.ok) { problems.push(`${n + 1}차 HTTP ${res.status}: ${msg}`); continue; }
    const choice = json?.choices?.[0];
    const content = choice?.message?.content;
    const text = Array.isArray(content) ? content.map((c) => c.text ?? "").join("") : content ?? "";
    const result = parseJsonObject(text);
    if (result) return result;
    problems.push(`${n + 1}차 빈/잘못된 응답 (finish_reason=${choice?.finish_reason ?? "?"}, 길이=${text.length}, 본문=${raw.slice(0, 160).replace(/\s+/g, " ")})`);
  }
  throw new Error(problems.join(" | "));
}

async function analyzeAnthropic(post, media) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 3000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: [
        ...media.images.map((i) => ({ type: "image", source: { type: "base64", media_type: i.mt, data: i.data } })),
        { type: "text", text: promptText(post, media) },
      ] }],
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 429) throw new QuotaError("Claude API 한도");
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${json?.error?.message ?? ""}`);
  if (json.stop_reason !== "end_turn") throw new Error(`분석 중단: ${json.stop_reason}`);
  return JSON.parse(json.content.find((b) => b.type === "text").text);
}

/* ───────────── 실행 ───────────── */
const hash = (p) => crypto.createHash("sha256").update(JSON.stringify([p.text, p.images, p.files.map((f) => f.name), MODEL])).digest("hex").slice(0, 16);

async function main() {
  const cache = JSON.parse(await fs.readFile(CACHE_FILE, "utf8").catch(() => "{}"));
  const overrides = JSON.parse(await fs.readFile(OVERRIDES_FILE, "utf8").catch(() => "{}"));
  log(`수집 시작: 최근 ${LOOKBACK_DAYS}일, 분석 엔진 ${PROVIDER}${PROVIDER !== "rules" ? ` (${MODEL}, 최대 ${MAX_AI_CALLS}건)` : ""}`);
  const posts = await discover();
  log(`게시글 ${posts.length}건 수집`);

  const notices = [];
  let aiOn = PROVIDER !== "rules", streak = 0, calls = 0, fresh = 0, reused = 0, rules = 0, failed = 0;
  // 최신 글부터 AI 분석 (한도에 걸려도 새 공고가 먼저 처리되도록)
  for (const p of [...posts].sort((a, b) => (b.posted ?? "").localeCompare(a.posted ?? ""))) {
    const h = hash(p);
    let a = cache[p.id]?.hash === h ? cache[p.id] : null;
    if (a) reused++;
    else if (aiOn && calls < MAX_AI_CALLS) {
      try {
        if (calls > 0) await sleep(AI_GAP_MS);
        calls++;
        const media = await gatherMedia(p);
        const result = await (PROVIDER === "anthropic" ? analyzeAnthropic : analyzeGithub)(p, media);
        a = { hash: h, analyzedAt: new Date().toISOString(), engine: MODEL, result, media: { images: media.images.length, pdfs: media.pdfTexts.length }, skipped: media.skipped };
        cache[p.id] = a;
        fresh++;
        log(`AI 분석 #${p.id} ← 이미지 ${media.images.length}, PDF ${media.pdfTexts.length}`);
        streak = 0;
      } catch (e) {
        failed++;
        streak++;
        log(`AI 분석 실패 #${p.id}:`, e.message);
        if (e instanceof QuotaError) { aiOn = false; log("AI 한도·권한 문제로 남은 글은 규칙 기반으로 처리하고 내일 다시 시도합니다."); }
        else if (streak >= 3) { aiOn = false; log("AI 분석이 연속 3번 실패해 오늘은 멈추고 규칙 기반으로 처리합니다 (무료 한도 아끼기)."); }
      }
    }
    if (!a) { a = { analyzedAt: new Date().toISOString(), engine: "rules", result: ruleExtract(p) }; rules++; } // 캐시하지 않음 → 다음 실행 때 AI 재시도
    const n = normalize(p, a);
    n.engine = a.engine;
    if (a.engine === "rules") n.analyzed = false;
    const { _note, ...fix } = overrides[p.id] ?? {};
    notices.push(overrides[p.id] ? { ...n, ...fix, analyzed: true, engine: "manual" } : n);
  }
  const keep = new Set(posts.map((p) => p.id));
  for (const id of Object.keys(cache)) if (!keep.has(id)) delete cache[id];

  notices.sort((x, y) => (y.posted ?? "").localeCompare(x.posted ?? ""));
  const out = { updatedAt: new Date().toISOString(), lookbackDays: LOOKBACK_DAYS, model: PROVIDER === "rules" ? null : MODEL, source: `${BASE}/article/${BOARD}/list`, notices };
  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(out, null, 2));
  await fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2));
  log(`완료: AI 새 분석 ${fresh}, 재사용 ${reused}, 규칙 기반 ${rules}, 실패 ${failed} → ${path.relative(ROOT, OUT_FILE)}`);
  if (!posts.length) process.exit(1); // 게시판을 전혀 못 읽었으면 실패로 남겨 기존 데이터를 보존
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
