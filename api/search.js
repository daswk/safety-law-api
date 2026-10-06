let allLawsCache = [];
let lastCacheTime = 0;

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const { query } = req.query;
    if (!query) return res.status(200).json({ total: 0, results: [] });

    const apiKey = '4548';
    
    // ★ 15대 핵심 법령 및 고시 리스트 (법률과 행정규칙을 명확히 구분)
    const targetList = [
        { name: '산업안전보건법', type: 'law' },
        { name: '산업안전보건법 시행령', type: 'law' },
        { name: '산업안전보건법 시행규칙', type: 'law' },
        { name: '산업안전보건기준에 관한 규칙', type: 'law' },
        { name: '중대재해 처벌 등에 관한 법률', type: 'law' },
        { name: '중대재해 처벌 등에 관한 법률 시행령', type: 'law' },
        { name: '건설기술 진흥법', type: 'law' },
        { name: '건설기술 진흥법 시행령', type: 'law' },
        { name: '건설기술 진흥법 시행규칙', type: 'law' },
        { name: '건설기계관리법', type: 'law' },
        { name: '사업장 위험성평가에 관한 지침', type: 'admrul' },
        { name: '건설업 산업안전보건관리비 계상 및 사용기준', type: 'admrul' },
        { name: '건설공사 안전관리 업무수행 지침', type: 'admrul' },
        { name: '굴착공사 표준안전 작업지침', type: 'admrul' },
        { name: '터널공사 표준안전 작업지침', type: 'admrul' }
    ];

    // ★ 노출 우선순위 (산안법 > 건진법 > 중처법 > 중요 고시 순)
    const lawRanking = {
        '산업안전보건법': 1, '산업안전보건법 시행령': 2, '산업안전보건법 시행규칙': 3, '산업안전보건기준에 관한 규칙': 4,
        '건설기술 진흥법': 5, '건설기술 진흥법 시행령': 6, '건설기술 진흥법 시행규칙': 7,
        '중대재해 처벌 등에 관한 법률': 8, '중대재해 처벌 등에 관한 법률 시행령': 9,
        '건설기계관리법': 10,
        '사업장 위험성평가에 관한 지침': 11, '건설업 산업안전보건관리비 계상 및 사용기준': 12
    };

    try {
        const now = Date.now();
        if (allLawsCache.length === 0 || now - lastCacheTime > 43200000) {
            let tempCache = [];
            
            // 한 번에 모든 데이터를 가장 빠르게 스캔하는 로직
            await Promise.all(targetList.map(async (target) => {
                try {
                    const searchUrl = `https://www.law.go.kr/DRF/lawSearch.do?OC=${apiKey}&target=${target.type}&type=XML&query=${encodeURIComponent(target.name)}`;
                    const searchRes = await fetch(searchUrl);
                    const searchText = await searchRes.text();
                    
                    const mstMatch = searchText.match(/<(?:법령일련번호|행정규칙일련번호)>(.*?)<\/(?:법령일련번호|행정규칙일련번호)>/);
                    if (!mstMatch) return;
                    const mst = mstMatch[1];

                    const detailUrl = `https://www.law.go.kr/DRF/lawService.do?OC=${apiKey}&target=${target.type}&type=XML&MST=${mst}`;
                    const detailRes = await fetch(detailUrl);
                    const detailText = await detailRes.text();

                    const joRegex = /<조문단위[^>]*>([\s\S]*?)<\/조문단위>/g;
                    let match;

                    while ((match = joRegex.exec(detailText)) !== null) {
                        const joXml = match[1];
                        let joNoMatch = joXml.match(/<조문번호>(.*?)<\/조문번호>/);
                        let joNo = joNoMatch ? `제${joNoMatch[1]}조` : '';
                        let joBrNoMatch = joXml.match(/<조문가지번호>(.*?)<\/조문가지번호>/);
                        if (joBrNoMatch && joBrNoMatch[1] !== '00') joNo += `의${joBrNoMatch[1]}`;

                        let joTitleMatch = joXml.match(/<조문제목>(.*?)<\/조문제목>/);
                        let joTitle = joTitleMatch ? joTitleMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim() : '';

                        let contentLines = [];
                        const contentRegex = /<(조문내용|항내용|호내용|목내용)[^>]*>([\s\S]*?)<\/\1>/g;
                        let cMatch;
                        while ((cMatch = contentRegex.exec(joXml)) !== null) {
                            let text = cMatch[2].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim();
                            if (text) {
                                if (cMatch[1] === '호내용') text = '  ' + text; 
                                if (cMatch[1] === '목내용') text = '    ' + text; 
                                contentLines.push(text);
                            }
                        }
                        tempCache.push({ lawName: target.name, articleNo: joNo, articleTitle: joTitle, content: contentLines.join('\n') });
                    }
                } catch (e) {
                    console.error(`Error processing ${target.name}`, e);
                }
            }));

            if (tempCache.length > 0) {
                allLawsCache = tempCache;
                lastCacheTime = now;
            }
        }

        let matchedArticles = [];
        allLawsCache.forEach(item => {
            const isTitleMatch = item.articleTitle.includes(query);
            const isContentMatch = item.content.includes(query);
            if (isTitleMatch || isContentMatch) {
                matchedArticles.push({ ...item, priority: isTitleMatch ? 1 : 2 });
            }
        });

        matchedArticles.sort((a, b) => {
            if (a.priority !== b.priority) return a.priority - b.priority;
            const rankA = lawRanking[a.lawName] || 99;
            const rankB = lawRanking[b.lawName] || 99;
            return rankA - rankB;
        });

        res.status(200).json({ total: matchedArticles.length, results: matchedArticles });
        
    } catch (error) {
        res.status(500).json({ error: '서버 에러', details: String(error) });
    }
}
