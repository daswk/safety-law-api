// 일회성: 부분 검색어로 법제처에 등록된 정확한 명칭을 찾아 data/find-report.md 로 저장
import fs from 'node:fs';
const OC = process.env.LAW_OC || '4548';
const qs = JSON.parse(fs.readFileSync('find.json', 'utf8'));
const strip = s => (s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim();
const f = (x, t) => { const m = x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)); return m ? strip(m[1]) : ''; };
let out = '# 명칭 찾기 결과\n';
for (const { q, type, search } of qs) {
  const tag = type === 'law' ? 'law' : 'admrul';
  const url = `https://www.law.go.kr/DRF/lawSearch.do?OC=${OC}&target=${tag}&type=XML&display=50&query=${encodeURIComponent(q)}${search ? '&search=' + search : ''}`;
  const xml = await (await fetch(url)).text();
  const items = [...xml.matchAll(new RegExp(`<${tag}\\s[^>]*>([\\s\\S]*?)</${tag}>`, 'g'))].map(m => m[1]);
  out += `\n## "${q}" (${tag}) — ${items.length}건\n`;
  for (const x of items.slice(0, 25)) out += `- ${type === 'law' ? f(x, '법령명한글') : f(x, '행정규칙명')} | ${type === 'law' ? '' : f(x, '소관부처명') + ' | ' + f(x, '행정규칙종류') + ' | ' + f(x, '현행연혁구분')} | ${f(x, '시행일자')}\n`;
  await new Promise(r => setTimeout(r, 400));
}
fs.writeFileSync('data/find-report.md', out); console.log(out);
