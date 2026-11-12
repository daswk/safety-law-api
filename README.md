# safety-law-api

한국도로공사 안전법령 통합검색 플랫폼의 법령 검색 API

- `targets.json` : 수집할 법령·행정규칙 목록 (법제처 등록 명칭 그대로)
- `scripts/build-laws.mjs` : 법제처 Open API에서 본문을 받아 `data/laws.json` 생성
- `.github/workflows/update-laws.yml` : 매일 03:17(KST) 자동 갱신, Actions 탭에서 수동 실행 가능
- `data/report.md` : 최근 수집 결과(성공/실패, 조문 수, 시행일)
- `api/search.js` : `GET /api/search?query=검색어` — 저장된 자료에서 즉시 검색

법령을 추가하려면 `targets.json`에 한 줄 추가 후 저장하면 자동으로 수집됩니다.
법제처 인증값(OC)은 저장소 Settings → Secrets → Actions 의 `LAW_OC`에 넣는 것을 권장합니다.
