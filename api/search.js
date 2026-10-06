let allLawsCache = [];
let lastCacheTime = 0;

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const { query } = req.query;
    if (!query) return res.status(200).json({ total: 0, results: [] });

    const apiKey = '4548';
    
    // 30여 개 법령 리스트 (기존과 동일)
    const targetLaws = [
        '산업안전보건법', '산업안전보건법 시행령', '산업안전보건법 시행규칙', '산업안전보건기준에 관한 규칙',
        '건설기술 진흥법', '건설기술 진흥법 시행령', '건설기술 진흥법 시행규칙',
        '중대재해 처벌 등에 관한 법률', '중대재해 처벌 등에 관한 법률 시행령',
        '건설기계관리법', '건설기계관리법 시행령', '건설기계관리법 시행규칙',
        '시설물의 안전 및 유지관리에 관한 특별법', '시설물의 안전 및 유지관리에 관한 특별법 시행령', '시설물의 안전 및 유지관리에 관한 특별법 시행규칙',
        '지하안전관리에 관한 특별법', '지하안전관리에 관한 특별법 시행령', '지하안전관리에 관한 특별법 시행규칙',
        '건설산업기본법', '건설산업기본법 시행령', '건설산업기본법 시행규칙',
        '소음·진동관리법', '소음·진동관리법 시행령', '소음·진동관리법 시행규칙',
        '폐기물관리법', '폐기물관리법 시행령', '폐기물관리법 시행규칙',
        '자연재해대책법', '자연재해대책법 시행령', '자연재해대책법 시행규칙',
        '건설업 산업안전보건관리비 계상 및 사용기준',
        '사업장 위험성평가에 관한 지침',
        '건설공사 안전관리 업무수행 지침',
        '굴착공사 표준안전 작업지침',
        '터널공사 표준안전 작업지침',
        '콘크리트공사 표준안전 작업지침'
    ];

    // ★ 추가된 핵심 로직: 법령별 노출 우선순위 랭킹표 ★
    const lawRanking = {
        '산업안전보건법': 1,
        '산업안전보건법 시행령': 2,
        '산업안전보건법 시행규칙': 3,
        '산업안전보건기준에 관한 규칙': 4,
        '건설기술 진흥법': 5,
        '건설기술 진흥법 시행령': 6,
        '건설기술 진흥법 시행규칙': 7,
        '중대재해 처벌 등에 관한 법률': 8,
        '중대재해 처벌 등에 관한 법률 시행령': 9
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
                // 제목 일치면 priority 1, 아니면 2
                matchedArticles.push({ ...item, priority: isTitleMatch ? 1 : 2 });
            }
        });

        // ★ 정렬 알고리즘 적용 부분 ★
        matchedArticles.sort((a, b) => {
            // 1차 정렬: 제목 일치(priority 1)가 무조건 최우선
            if (a.priority !== b.priority) {
                return a.priority - b.priority;
            }
            
            // 2차 정렬: 우선순위가 같다면(둘 다 본문 일치라면) 지정된 9대 핵심 법령 순서대로 정렬
            // lawRanking 표에 없는 나머지 법령이나 고시들은 99등으로 처리하여 맨 밑으로 내림
            const rankA = lawRanking[a.lawName] || 99;
            const rankB = lawRanking[b.lawName] || 99;
            
            return rankA - rankB;
        });

        res.status(200).json({ total: matchedArticles.length, results: matchedArticles });
        
    } catch (error) {
        res.status(500).json({ error: '서버 에러', details: String(error) });
    }
}
