// 법제처 Open API에서 targets.json의 법령·행정규칙 본문을 받아 data/laws.json 으로 저장합니다.
// GitHub Actions(.github/workflows/update-laws.yml)에서 매일 실행됩니다.
//   - 법령(law)      : lawSearch → 정확한 법령명 일치 → lawService (MST=법령일련번호)
//   - 행정규칙(admrul): lawSearch → 정확한 행정규칙명 일치(현행) → lawService (ID=행정규칙일련번호)
//   - 받아오기 실패한 항목은 이전 자료를 그대로 유지하고 data/report.md 에 기록합니다.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OC = process.env.LAW_OC || '4548';
const BASE = 'https://www.law.go.kr/DRF';
const OUT = path.join(ROOT, 'data', 'laws.json');
const REPORT = path.join(ROOT, 'data', 'report.md');

const { targets } = JSON.parse(fs.readFileSync(path.join(ROOT, 'targets.json'), 'utf8'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const norm = (s) => (s || '').replace(/[\s·ㆍ・‧∙]/g, '').trim();
const cdata = (s) => (s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
const strip = (s) => cdata(s).replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
const field = (xml, tag) => { const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)); return m ? strip(m[1]).trim() : ''; };

async function get(url, tries = 3) {
    for (let i = 1; i <= tries; i++) {
        try {
            const res = await fetch(url, { headers: { 'User-Agent': 'safety-law-api-builder' } });
            const text = await res.text();
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            if (/사용자 정보 검증에 실패|미신청된 목록|인증/.test(text) && text.length < 2000) throw new Error('인증 오류: ' + strip(text).slice(0, 120));
            return text;
        } catch (e) {
            if (i === tries) throw e;
            await sleep(1500 * i);
        }
    }
}

async function findSerial(t) {
    const tag = t.type === 'law' ? 'law' : 'admrul';
    const url = `${BASE}/lawSearch.do?OC=${OC}&target=${tag}&type=XML&display=100&query=${encodeURIComponent(t.name)}` + (t.type === 'admrul' ? '&nw=1' : '');
    const xml = await get(url);
    const items = [...xml.matchAll(new RegExp(`<${tag}\\s[^>]*>([\\s\\S]*?)</${tag}>`, 'g'))].map(m => m[1]);
    const rows = items.map(x => t.type === 'law'
        ? { name: field(x, '법령명한글'), serial: field(x, '법령일련번호'), eff: field(x, '시행일자'), cur: field(x, '현행연혁코드') }
        : { name: field(x, '행정규칙명'), serial: field(x, '행정규칙일련번호'), eff: field(x, '시행일자'), cur: field(x, '현행연혁구분') });
    const exact = rows.filter(r => norm(r.name) === norm(t.name));
    // 현행 우선, 그다음 시행일자 최신
    exact.sort((a, b) => ((/현행/.test(b.cur) ? 1 : 0) - (/현행/.test(a.cur) ? 1 : 0)) || (Number(b.eff || 0) - Number(a.eff || 0)));
    return { hit: exact[0] || null, candidates: rows.slice(0, 6).map(r => r.name) };
}

function parseLaw(xml) {
    const out = [];
    for (const m of xml.matchAll(/<조문단위[^>]*>([\s\S]*?)<\/조문단위>/g)) {
        const jo = m[1];
        if (field(jo, '조문여부') && field(jo, '조문여부') !== '조문') continue; // 장·절 제목(전문) 제외
        const no = field(jo, '조문번호');
        const br = field(jo, '조문가지번호');
        const articleNo = no ? `제${no}조${br && br !== '00' && br !== '0' ? '의' + Number(br) : ''}` : '';
        const title = field(jo, '조문제목');
        const lines = [];
        for (const c of jo.matchAll(/<(조문내용|항내용|호내용|목내용)[^>]*>([\s\S]*?)<\/\1>/g)) {
            let text = strip(c[2]).trim();
            if (!text) continue;
            if (c[1] === '호내용') text = '  ' + text;
            if (c[1] === '목내용') text = '    ' + text;
            lines.push(text);
        }
        if (articleNo || lines.length) out.push([articleNo, title, lines.join('\n')]);
    }
    return out;
}

function parseAdmrul(xml) {
    const parts = [...xml.matchAll(/<조문내용[^>]*>([\s\S]*?)<\/조문내용>/g)].map(m => strip(m[1]).replace(/\r/g, '').trim()).filter(Boolean);
    // 장·절·관 제목 줄 제거
    const full = parts.join('\n').split('\n').filter(l => !/^\s*제\s*\d+\s*(장|절|관)(\s|$)/.test(l)).join('\n');
    const out = [];
    const re = /(^|\n)\s*(제\s*(\d+)\s*조(?:\s*의\s*(\d+))?)\s*(?:\(([^)\n]*)\))?/g;
    // 조문번호가 앞으로 나아가는 것만 조문 시작으로 인정(본문 속 "제3조에 따라…" 줄 오인 방지)
    const marks = []; let last = 0;
    for (const m of full.matchAll(re)) {
        const v = Number(m[3]) + (m[4] ? Number(m[4]) / 1000 : 0);
        if (v > last && (m[5] !== undefined || v === Math.floor(last) + 1 || last === 0)) { marks.push(m); last = v; }
    }
    if (marks.length) {
        marks.forEach((m, i) => {
            const start = m.index + m[1].length;
            const end = i + 1 < marks.length ? marks[i + 1].index : full.length;
            const body = full.slice(start, end).trim();
            const articleNo = `제${m[3]}조${m[4] ? '의' + m[4] : ''}`;
            out.push([articleNo, (m[5] || '').trim(), body]);
        });
    } else if (full) {
        // 조문 형식이 아닌 지침: 문단 단위로 나눔
        const paras = full.split(/\n{2,}|\n(?=\s*[0-9]+\.\s)/).map(s => s.trim()).filter(Boolean);
        let buf = '', n = 1;
        for (const p of paras) {
            if ((buf + '\n' + p).length > 900 && buf) { out.push([`본문 ${n++}`, '', buf.trim()]); buf = ''; }
            buf += (buf ? '\n' : '') + p;
        }
        if (buf) out.push([`본문 ${n}`, '', buf.trim()]);
    }
    return out;
}

async function main() {
    let prev = null;
    try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { }
    const prevByName = {};
    if (prev) prev.laws.forEach((l, i) => { prevByName[l.name] = { meta: l, arts: prev.articles.filter(a => a[0] === i) }; });

    const laws = [], articles = [], report = [];
    let ok = 0;
    for (const t of targets) {
        const idx = laws.length;
        try {
            const { hit, candidates } = await findSerial(t);
            if (!hit) throw Object.assign(new Error('정확히 일치하는 명칭 없음'), { candidates });
            const url = t.type === 'law'
                ? `${BASE}/lawService.do?OC=${OC}&target=law&type=XML&MST=${hit.serial}`
                : `${BASE}/lawService.do?OC=${OC}&target=admrul&type=XML&ID=${hit.serial}`;
            const xml = await get(url);
            const arts = t.type === 'law' ? parseLaw(xml) : parseAdmrul(xml);
            if (!arts.length) throw new Error('본문 조문을 찾지 못함');
            laws.push({ name: t.name, type: t.type, serial: hit.serial, eff: hit.eff, count: arts.length, status: 'ok' });
            arts.forEach(a => articles.push([idx, ...a]));
            report.push(`| ✅ | ${t.name} | ${t.type === 'law' ? '법령' : '행정규칙'} | ${arts.length} | ${hit.eff || ''} | |`);
            ok++;
        } catch (e) {
            const old = prevByName[t.name];
            const note = (e.message || String(e)) + (e.candidates ? ` (검색결과: ${e.candidates.join(', ') || '없음'})` : '');
            if (old && old.arts.length) {
                laws.push({ ...old.meta, status: 'stale' });
                old.arts.forEach(a => articles.push([idx, a[1], a[2], a[3]]));
                report.push(`| ⚠️ | ${t.name} | ${t.type === 'law' ? '법령' : '행정규칙'} | ${old.arts.length} | ${old.meta.eff || ''} | 이전 자료 유지 — ${note} |`);
            } else {
                laws.push({ name: t.name, type: t.type, serial: '', eff: '', count: 0, status: 'missing' });
                report.push(`| ❌ | ${t.name} | ${t.type === 'law' ? '법령' : '행정규칙'} | 0 | | ${note} |`);
            }
        }
        await sleep(400);
    }

    const now = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
    const md = `# 법령 수집 결과 (${now} KST)\n\n성공 ${ok} / 전체 ${targets.length}, 조문 ${articles.length}개\n\n| 상태 | 명칭 | 구분 | 조문수 | 시행일 | 비고 |\n|---|---|---|---|---|---|\n${report.join('\n')}\n`;
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(REPORT, md);
    console.log(md);

    if (ok < Math.ceil(targets.length / 2) && prev) {
        console.error('성공 항목이 절반 미만이라 기존 자료를 유지합니다.');
        process.exit(1);
    }
    fs.writeFileSync(OUT, JSON.stringify({ updatedAt: now, laws, articles }));
}

main().catch(e => { console.error(e); process.exit(1); });
