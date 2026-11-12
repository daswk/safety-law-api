// 안전법령 검색 API
// data/laws.json(매일 GitHub Actions가 법제처에서 받아 저장)에서 바로 검색합니다.
//   GET /api/search?query=검색어[&limit=200]
//   GET /api/search?law=법령명      → 해당 법령의 전체 조문
//   GET /api/search                 → 수록 법령 목록
//   - 띄어쓰기 무시, 여러 단어는 모두 포함된 조문만(AND)
//   - 정렬: 조문제목 일치 > 본문 일치 횟수 > 법령 우선순위(targets.json 순서)
import fs from 'node:fs';
import path from 'node:path';

let DATA = null;
function load() {
    if (DATA) return DATA;
    const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'laws.json'), 'utf8'));
    const nz = (s) => (s || '').replace(/\s+/g, '').toLowerCase();
    DATA = {
        updatedAt: raw.updatedAt,
        laws: raw.laws,
        rows: raw.articles.map(([li, no, title, content]) => ({
            li, no, title, content,
            nTitle: nz(title), nBody: nz(content)
        }))
    };
    return DATA;
}

export default function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    const query = String(req.query.query || '').trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit || '200', 10) || 200, 1), 500);

    let d;
    try { d = load(); }
    catch (e) { return res.status(500).json({ error: '법령 자료를 불러오지 못했습니다', details: String(e) }); }

    // 법령 하나의 전체 조문: /api/search?law=법령명
    const lawName = String(req.query.law || '').trim();
    if (lawName) {
        const li = d.laws.findIndex(l => l.name === lawName);
        if (li < 0) return res.status(404).json({ error: '해당 법령이 없습니다', law: lawName });
        const law = d.laws[li];
        const results = d.rows.filter(r => r.li === li).map(r => ({
            lawName: law.name, lawType: law.type === 'admrul' ? '행정규칙' : '법령',
            articleNo: r.no, articleTitle: r.title, content: r.content, priority: 2
        }));
        return res.status(200).json({ law: { name: law.name, type: law.type, eff: law.eff, count: results.length }, total: results.length, updatedAt: d.updatedAt, results });
    }

    if (!query) {
        return res.status(200).json({
            total: 0, results: [], updatedAt: d.updatedAt,
            laws: d.laws.map(l => ({ name: l.name, type: l.type, count: l.count, eff: l.eff, status: l.status }))
        });
    }

    const nz = (s) => s.replace(/\s+/g, '').toLowerCase();
    const whole = nz(query);
    const tokens = query.split(/\s+/).map(nz).filter(Boolean);

    const matched = [];
    for (const r of d.rows) {
        const hay = r.nTitle + '\n' + r.nBody;
        let ok = hay.includes(whole);
        if (!ok && tokens.length > 1) ok = tokens.every(t => hay.includes(t));
        if (!ok) continue;
        const titleHit = tokens.some(t => r.nTitle.includes(t)) || r.nTitle.includes(whole);
        const freq = Math.min(r.nBody.split(tokens[0]).length - 1, 20);
        matched.push({ r, titleHit, freq });
    }

    matched.sort((a, b) =>
        (Number(b.titleHit) - Number(a.titleHit)) ||
        (a.r.li - b.r.li) ||
        (b.freq - a.freq));

    const results = matched.slice(0, limit).map(({ r, titleHit }) => {
        const law = d.laws[r.li];
        return {
            lawName: law.name,
            lawType: law.type === 'admrul' ? '행정규칙' : '법령',
            articleNo: r.no,
            articleTitle: r.title,
            content: r.content,
            priority: titleHit ? 1 : 2
        };
    });

    res.status(200).json({ total: matched.length, shown: results.length, updatedAt: d.updatedAt, results });
}
