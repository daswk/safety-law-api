// 안전법령 검색 API
// data/laws.json(매일 GitHub Actions가 법제처에서 받아 저장)에서 바로 검색합니다.
//   GET /api/search?query=검색어[&limit=200]
//   GET /api/search?law=법령명      → 해당 법령의 전체 조문
//   GET /api/search?query=질문&terms=[["포장",3],...] → 가중치(똑똑한) 검색, 상위 80건
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
    // 꼭 볼 조문(pins): [["법령명","제38조"],...] → 맨 위에 고정 (일반·똑똑한 검색 공통)
    const getPinned = () => {
        let pins = [];
        try { if (req.query.pins) pins = JSON.parse(String(req.query.pins)).slice(0, 15); } catch (e) { pins = []; }
        const out = [];
        pins.forEach(([ln, no]) => {
            const li = d.laws.findIndex(l => l.name === ln);
            const r = li >= 0 && d.rows.find(x => x.li === li && x.no === no);
            if (r && !out.includes(r)) out.push(r);
        });
        return out;
    };

    // ── 똑똑한 검색(가중치): &terms=[["포장",3],["피니셔",1.5],...] ──
    let wterms = null;
    try { if (req.query.terms) wterms = JSON.parse(String(req.query.terms)).map(([t, w]) => [nz(String(t)), Number(w) || 1]).filter(([t]) => t.length >= 2).slice(0, 40); } catch (e) { wterms = null; }
    if (wterms && wterms.length) {
        const maxW = Math.max(...wterms.map(x => x[1]));
        // 현장 안전 실무 관련도(행정·제작기준 성격 법령은 낮춤)
        const PRIOR = {
            '산업안전보건기준에 관한 규칙': 1.25, '건설기계관리법': 0.45, '건설기계관리법 시행령': 0.45, '건설기계관리법 시행규칙': 0.45,
            '건설기계 안전기준에 관한 규칙': 0.6, '재난 및 안전관리 기본법': 0.6, '재난 및 안전관리 기본법 시행령': 0.6,
            '화재의 예방 및 안전관리에 관한 법률': 0.7, '화재의 예방 및 안전관리에 관한 법률 시행령': 0.7, '도로교통법': 0.7,
            '지하안전관리에 관한 특별법': 0.75, '지하안전관리에 관한 특별법 시행령': 0.7, '지하안전관리에 관한 특별법 시행규칙': 0.7,
            '시설물의 안전 및 유지관리에 관한 특별법 시행령': 0.8, '시설물의 안전 및 유지관리에 관한 특별법 시행규칙': 0.8,
            '건설기술 진흥법 시행령': 0.85
        };
        const pinned = getPinned();
        const scored = [];
        for (const r of d.rows) {
            let score = 0, hit = 0, strong = 0, titleStrong = false;
            const matched = [];
            for (const [t, w] of wterms) {
                const inTitle = r.nTitle.includes(t);
                const inBody = inTitle || r.nBody.includes(t);
                if (!inBody) continue;
                hit++; matched.push(t);
                if (w >= maxW - 0.01) { strong++; if (inTitle) titleStrong = true; }
                const freq = Math.min(r.nBody.split(t).length - 1, 5);
                score += w * (inTitle ? 3 : 1) + w * 0.15 * freq;
            }
            // 핵심어가 하나도 없거나, 우연히 한 단어만 걸린 조문은 제외
            if (!strong) continue;
            if (hit < 2 && !titleStrong) continue;
            score += (hit - 1) * 1.5 + (strong - 1) * 3;
            score *= (PRIOR[d.laws[r.li].name] || 1);
            if (pinned.includes(r)) continue;
            scored.push({ r, score, matched });
        }
        scored.sort((a, b) => (b.score - a.score) || (a.r.li - b.r.li));
        const toOut = (r, extra) => {
            const law = d.laws[r.li];
            return { lawName: law.name, lawType: law.type === 'admrul' ? '행정규칙' : '법령', articleNo: r.no, articleTitle: r.title, content: r.content, priority: 2, ...extra };
        };
        const results = pinned.map(r => toOut(r, { pinned: true, priority: 1, matched: wterms.map(x => x[0]).filter(t => r.nTitle.includes(t) || r.nBody.includes(t)) }))
            .concat(scored.slice(0, Math.min(limit, 80)).map(({ r, score, matched }) => toOut(r, { score: Math.round(score * 10) / 10, matched })));
        return res.status(200).json({ mode: 'smart', total: pinned.length + scored.length, shown: results.length, pinned: pinned.length, updatedAt: d.updatedAt, results });
    }

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

    const pinnedPlain = getPinned();
    const pinnedOut = pinnedPlain.map(r => { const law = d.laws[r.li]; return { lawName: law.name, lawType: law.type === 'admrul' ? '행정규칙' : '법령', articleNo: r.no, articleTitle: r.title, content: r.content, priority: 1, pinned: true }; });
    const restMatched = matched.filter(m => !pinnedPlain.includes(m.r));
    const results = pinnedOut.concat(restMatched.slice(0, limit).map(({ r, titleHit }) => {
        const law = d.laws[r.li];
        return {
            lawName: law.name,
            lawType: law.type === 'admrul' ? '행정규칙' : '법령',
            articleNo: r.no,
            articleTitle: r.title,
            content: r.content,
            priority: titleHit ? 1 : 2
        };
    }));

    res.status(200).json({ total: restMatched.length + pinnedOut.length, shown: results.length, pinned: pinnedOut.length, updatedAt: d.updatedAt, results });
}
