let allLawsCache = [];
let lastCacheTime = 0;

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const { query } = req.query;
    if (!query) return res.status(200).json({ total: 0, results: [] });

    const apiKey = '4548';
    
    // 에러를 유발하는 고시류를 빼고, 가장 완벽하게 작동하던 9대 법령으로 복구
    const targetLaws = [
        '산업안전보건법', '산업안전보건법 시행령', '산업안전보건법 시행규칙', '산업안전보건기준에 관한 규칙',
        '건설기술 진흥법', '건설기술 진흥법 시행령', '건설기술 진흥법 시행규칙',
        '중대재해 처벌 등에 관한 법률', '중대재해 처벌 등에 관한 법률 시행령'
    ];

    // 요청하신 법령별 우선순위 랭킹표 유지
    const lawRanking = {
        '산업안전보건법': 1, '산업안전보건법 시행령': 2, '산업안전보건법 시행규칙': 3, '산업안전보건기준에 관한 규칙': 4,
        '건설기술 진흥법': 5, '건설기술 진흥법 시행령': 6, '건설기술 진흥법 시행규칙': 7,
        '중대재해 처벌 등에 관한 법률': 8, '중대재해 처벌 등에 관한 법률 시행령': 9
    };

    try {
        const now = Date.now();
        if (allLawsCache.length === 0 || now - lastCacheTime > 43200000) {
            let tempCache = [];
            const fetchPromises = targetLaws.map(async (lawName) => {
                try {
                    const searchUrl = `https://www.law.go.kr/DRF/lawSearch.do?OC=${apiKey}&target=law&type=XML&query=${encodeURIComponent(lawName)}`;
                    const searchRes = await fetch(searchUrl);
                    const searchText = await searchRes.text();
                    
                    const mstMatch = searchText.match(/<법령일련번호>(.*?)<\/법령일련번호>/);
                    if (!mstMatch) return;
                    const mst = mstMatch[1];

                    const detailUrl = `https://www.law.go.kr/DRF/lawService.do?OC=${apiKey}&target=law&type=XML&MST=${mst}`;
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
                        tempCache.push({ lawName, articleNo: joNo, articleTitle: joTitle, content: contentLines.join('\n') });
                    }
                } catch (e) { return; }
            });

            await Promise.all(fetchPromises);
            allLawsCache = tempCache;
            lastCacheTime = now;
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
