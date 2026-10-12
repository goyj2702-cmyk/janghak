# 동국 장학 알리미

동국대학교 장학공지 게시판을 매일 아침 자동으로 수집하고, 게시글 본문·포스터 이미지·첨부 PDF를 분석해
장학명·대상·지원금액·마감일·학년별 지원 가능 여부를 정리해 보여주는 사이트입니다. (비공식 학생용)

**운영 비용 0원**: GitHub 공개 저장소 + GitHub Actions(매일 실행) + GitHub Pages(호스팅) + GitHub Models(무료 한도 AI)

```
GitHub Actions (매일 06:00 KST, 무료)
  └ scripts/crawl.mjs
      1. 장학공지 게시판에서 최근 75일 게시글을 모두 찾음 (최신 글부터 '이전글' 링크를 따라감)
      2. 본문 텍스트 + 포스터 이미지 + 첨부 PDF 텍스트를 모음
      3. 분석
         - GitHub Models (무료 한도, 포스터 이미지까지 읽음) — 하루 최대 40건, 최신 글 먼저
         - 한도에 걸리거나 쓸 수 없으면: 본문에서 마감일·금액을 규칙으로 추출 (항상 무료) → 다음 날 AI로 다시 시도
         - 이미 분석한 글은 data/cache.json에서 재사용 → 매일 새 글만 분석
      4. data/overrides.json(사람이 확인한 보정값)을 덮어쓰고 public/data/notices.json 저장 → 커밋
  └ npm run build → GitHub Pages 배포 (무료)
```

## 1. 배포하기 (한 번만, 약 10분)

1. **GitHub에 공개(Public) 저장소를 만들고** 이 폴더를 올립니다.
   - 무료로 쓰려면 공개 저장소여야 합니다. 비공개 저장소의 GitHub Pages는 유료 요금제가 필요합니다.
2. **Settings → Pages** → Build and deployment → Source를 **GitHub Actions**로 바꿉니다.
3. **Settings → Actions → General** → Workflow permissions를 **Read and write permissions**로 바꿉니다.
   (매일 갱신된 데이터를 저장소에 커밋하기 위해 필요합니다.)
4. **Actions 탭** → "장학공지 매일 갱신 (무료)" → **Run workflow**로 첫 실행을 합니다.
   - 완료되면 `https://<아이디>.github.io/<저장소이름>/` 에서 사이트가 열립니다.
   - 이후 매일 06:00(KST)에 자동으로 갱신·배포됩니다. API 키나 결제 정보는 필요 없습니다.

### 비용이 들지 않는 이유와 한도

| 구성 | 무료 조건 | 이 프로젝트 사용량 |
|---|---|---|
| GitHub Actions | 공개 저장소의 기본 러너는 무료 | 하루 1회, 5~15분 |
| GitHub Pages | 공개 저장소 무료 | 정적 사이트 1개 |
| GitHub Models | 무료 한도 (상위 모델 기준 하루 약 50건·요청당 입력 약 8000토큰, 계정 요금제에 따라 다름) | 하루 최대 40건 (`MAX_AI_CALLS`) |

- GitHub Models는 유료 사용을 직접 켜지 않는 한 요금이 청구되지 않습니다. 한도를 넘으면 요청이 거절될 뿐이고,
  이 경우 남은 글은 규칙 기반으로 처리한 뒤 다음 날 다시 AI 분석을 시도합니다.
- 첫 실행은 최근 75일치(약 40~60건)를 분석하므로 1~2일에 나눠 끝납니다. 그 뒤로는 하루 새 글 0~5건만 분석합니다.
- GitHub Models를 쓸 수 없는 계정이어도 사이트는 규칙 기반 데이터로 매일 갱신됩니다(포스터 내용은 읽지 못함).

선택 설정 (Settings → Secrets and variables → Actions → **Variables**)

| 이름 | 기본값 | 설명 |
|---|---|---|
| `AI_PROVIDER` | `auto` | `github` / `rules`(AI 끄기) / `anthropic`(유료, `ANTHROPIC_API_KEY` 시크릿 필요) |
| `AI_MODEL` | `openai/gpt-4o` | GitHub Models의 이미지 인식 가능 모델 |
| `MAX_AI_CALLS` | `40` | 하루 최대 AI 분석 건수 |
| `LOOKBACK_DAYS` | `75` | 며칠 전 게시글까지 볼지 |

## 2. 사람이 확인한 값으로 고치기

AI나 규칙 추출이 틀렸거나 포스터를 읽지 못한 공고는 `data/overrides.json`에 글 번호로 값을 넣으면 그 값이 우선합니다.
GitHub 웹에서 이 파일을 수정해 커밋하면 사이트가 바로 다시 배포됩니다. (지금은 2026-10-11에 직접 확인한 20건이 들어 있습니다.)

```json
{
  "26766441": {
    "title": "우양재단 동행 장학생",
    "benefit": "100만원",
    "deadline": "2026-10-18T23:59:00+09:00",
    "deadlineText": "~10.18(일)",
    "grades": { "fresh": "yes", "current": "yes", "transfer": "yes", "graduate": "no" }
  }
}
```

## 3. 내 컴퓨터에서 실행

```bash
npm install
npm run crawl:dry                          # AI 없이 수집 + 규칙 기반 추출
GITHUB_TOKEN=ghp_... npm run crawl         # GitHub Models로 분석 (models:read 권한의 개인 토큰)
npm run dev                                # 사이트 확인 (http://localhost:5173)
npm test                                   # 추출 로직 테스트
```

## 4. 알아둘 점

- **학교 서버가 해외(GitHub) IP를 막으면** 수집 단계가 실패합니다. 이때도 기존 데이터로 사이트 배포는 계속됩니다.
  그런 날이 계속되면 내 컴퓨터에서 `npm run crawl` 후 `public/data/notices.json`을 커밋·푸시하세요(작업 스케줄러·cron으로 매일 실행 가능).
- **HWP 첨부**는 읽을 수 없습니다. 본문·포스터·PDF에 정보가 없으면 카드에 "확인하지 못한 항목"으로 표시됩니다.
- **AI 분석은 틀릴 수 있습니다.** 자료에 없는 값은 비워 두도록 지시하며, 카드마다 원본 공지 링크를 둡니다.
- **학교 서버 배려**: 요청 사이에 0.7초씩 쉬고, 하루 한 번만 실행합니다.
- 공개 저장소에 60일간 활동이 없으면 GitHub가 예약 실행을 멈추므로 `keepalive.yml`이 매달 빈 커밋을 남깁니다.
- 게시판 HTML 구조가 바뀌면 `scripts/crawl.mjs`의 `parseDetail()`을 고치면 됩니다. `npm run crawl:dry` 로그로 확인할 수 있습니다.

## 구조

| 경로 | 역할 |
|---|---|
| `scripts/crawl.mjs` | 게시판 수집, 포스터·PDF 수집, AI 또는 규칙 기반 분석 |
| `scripts/lib/extract.mjs` | 분석 프롬프트·스키마, 규칙 기반 추출, 결과 → 사이트 데이터 변환 |
| `data/overrides.json` | 사람이 확인한 보정값 (최우선) |
| `data/cache.json` | AI 분석 결과 캐시 |
| `public/data/notices.json` | 사이트가 읽는 데이터 (매일 갱신) |
| `src/App.jsx` | 학년 선택·맞춤 추천·카드 UI |
| `.github/workflows/daily-update.yml` | 매일 수집·분석·배포 |
| `.github/workflows/keepalive.yml` | 예약 실행이 멈추지 않도록 매달 빈 커밋 |
