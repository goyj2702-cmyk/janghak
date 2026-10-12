import test from "node:test";
import assert from "node:assert/strict";
import { toDeadlineISO, normalize, findIds, SCHEMA } from "../lib/extract.mjs";

const post = { id: "26766521", url: "https://www.dongguk.edu/article/JANGHAKNOTICE/detail/26766521", posted: "2026-10-08", title: "제목", text: "", images: ["https://x/a.jpg"], files: [{ name: "신청서.hwp", url: null }, { name: "포스터.png", url: "https://x/p.png" }] };
const result = {
  notice_kind: "모집", title: "동진나눔복지재단 장학생", organization: "동진나눔복지재단", quota: "", target_tags: ["학부 재학생", "15학점↑"],
  benefit_amount: "100만원", benefit_note: "생활비성", apply_start: "", deadline_date: "2026-10-23", deadline_time: "17:00", deadline_text: "10.23(금) 17:00",
  apply_method: "nDRIMS", grades: { fresh: "YES", current: "yes", transfer: "check", graduate: "no" }, grade_notes: { fresh: "", current: "", transfer: "직전학기 기준 확인", graduate: "학부생만" },
  evidence: ["본문", "포스터"], confidence: "High", missing: [],
};

test("마감 시각이 없으면 23:59(KST)", () => {
  assert.equal(toDeadlineISO("2026-10-11", ""), "2026-10-11T23:59:00+09:00");
  assert.equal(toDeadlineISO("2026-10-23", "9:00"), "2026-10-23T09:00:00+09:00");
  assert.equal(toDeadlineISO("", "17:00"), null);
  assert.equal(toDeadlineISO("10.23", ""), null);
});

test("분석 결과를 사이트 레코드로 변환", () => {
  const r = normalize(post, { result, analyzedAt: "t" });
  assert.equal(r.deadline, "2026-10-23T17:00:00+09:00");
  assert.equal(r.grades.fresh, "yes");          // 대소문자 정규화
  assert.equal(r.confidence, "high");
  assert.equal(r.quota, "인원 미기재");
  assert.deepEqual(r.files, ["신청서.hwp"]);     // 이미지 첨부는 포스터로 집계
  assert.equal(r.posterCount, 2);
  assert.equal(r.allGrades, false);
  assert.deepEqual(r.notes, { transfer: "직전학기 기준 확인", graduate: "학부생만" });
});

test("분석 전 글은 마감일 없는 레코드", () => {
  const r = normalize(post, null);
  assert.equal(r.analyzed, false);
  assert.equal(r.deadline, null);
  assert.equal(r.kind, "모집");
});

test("학부 전 학년 no + 대학원 yes 이면 대학원 전용", () => {
  const r = normalize(post, { result: { ...result, grades: { fresh: "no", current: "no", transfer: "no", graduate: "yes" } } });
  assert.equal(r.gradOnly, true);
});

test("목록 HTML에서 글 번호 찾기", () => {
  const html = `<a href="/article/JANGHAKNOTICE/detail/26766524">a</a><a href="#none" onclick="goDetail('26766521'); return false;">b</a><a onclick="fn_detail(26766513)">c</a><a href="/article/ALLIM/detail/26766543">x</a>`;
  assert.deepEqual(findIds(html).sort(), ["26766513", "26766521", "26766524"]);
});

test("스키마: 모든 객체가 required 전부 + additionalProperties false", () => {
  const walk = (s) => {
    if (s.type === "object") {
      assert.equal(s.additionalProperties, false);
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort());
      Object.values(s.properties).forEach(walk);
    }
    if (s.type === "array") walk(s.items);
  };
  walk(SCHEMA);
});

import { findDeadline, findAmount, ruleExtract } from "../lib/extract.mjs";
test("규칙 기반: 마감일 찾기", () => {
  assert.deepEqual(pick(findDeadline("신청기간: 2026. 9. 28.(월) 09:00 ~ 2026. 10. 30.(금) 18:00", "2026-09-28")), ["2026-10-30", "18:00"]);
  assert.deepEqual(pick(findDeadline("2026학년도 2학기 동진나눔복지재단 장학생 선발(~10/23(금)까지)", "2026-10-08")), ["2026-10-23", ""]);
  assert.deepEqual(pick(findDeadline("제출 마감 기한 : 10월 12일 (월) 17시 전까지", "2026-10-02")), ["2026-10-12", "17:00"]);
  assert.deepEqual(pick(findDeadline("신청: 1/15(금)까지", "2026-12-20")), ["2027-01-15", ""]); // 해 넘김
  assert.equal(findDeadline("장학금 안내입니다", "2026-10-01"), null);
});
const pick = (d) => [d?.date, d?.time];
test("규칙 기반: 금액·분류", () => {
  assert.equal(findAmount("1인당 200만원 지급"), "1인당 200만원");
  assert.equal(findAmount("등록금 전액 지원"), "등록금 전액");
  const r = ruleExtract({ id: "1", title: "[홍보] 2026-2학기 OO재단 장학생 선발(~10/23)", text: "신입생은 지원 불가. 1인당 100만원. 10.23(금)까지 nDRIMS", posted: "2026-10-08", images: ["x"] });
  assert.equal(r.notice_kind, "모집");
  assert.equal(r.title, "2026-2학기 OO재단 장학생 선발");
  assert.equal(r.grades.fresh, "no");
  assert.equal(r.deadline_date, "2026-10-23");
  assert.equal(r.apply_method, "nDRIMS 신청");
  assert.ok(r.missing.includes("포스터 내용(자동 판독 안 됨)"));
  assert.equal(ruleExtract({ id: "2", title: "2026-2학기 고양이엄마장학 장학생 선발 결과 안내", text: "", posted: "2026-10-06", images: [] }).notice_kind, "결과발표");
});
