export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const { query } = req.query;
    if (!query) return res.status(200).json({ total: 0, results: [] });

    const apiKey = '4548';
    
    // 요청하신 9대 법령 완벽 추가
    const targetLaws = [
        '산업안전보건법', '산업안전보건법 시행령', '산업안전보건법 시행규칙', '산업안전보건기준에 관한 규칙',
        '중대재해 처벌 등에 관한 법률', '중대재해 처벌 등에 관한 법률 시행령',
        '건설기술 진흥법', '건설기술 진흥법 시행령', '건설기술 진흥법 시행규칙'
    ];

    try {
        let matchedArticles = [];

        // 9개 법령을 순서대로 찾으면 너무 오래 걸려 서버가 뻗을 수 있으므로, 동시에 9개를 한 번에 스캔(Promise.all)합니다.
        const fetchPromises = targetLaws.map(async (lawName) => {
            try {
                // 1. 법령 고유 ID(MST) 찾기
                const searchUrl = `https://www.law.go.kr/DRF/lawSearch.do?OC=${apiKey}&target=law&type=XML&query=${encodeURIComponent(lawName)}`;
                const searchRes = await fetch(searchUrl);
                const searchText = await searchRes.text();
                
                const mstMatch = searchText.match(/<법령일련번호>(.*?)<\/법령일련번호>/);
                if (!mstMatch) return;
                const mst = mstMatch[1];

                // 2. 전체 원문 데이터 가져오기
                const detailUrl = `https://www.law.go.kr/DRF/lawService.do?OC=${apiKey}&target=law&type=XML&MST=${mst}`;
                const detailRes = await fetch(detailUrl);
                const detailText = await detailRes.text();

                // 3. 개별 조항(<조문단위>)으로 정확히 쪼개기
                const joRegex = /<조문단위[^>]*>([\s\S]*?)<\/조문단위>/g;
                let match;

                while ((match = joRegex.exec(detailText)) !== null) {
                    const joXml = match[1];

                    // 조항 번호 찾기
                    let joNoMatch = joXml.match(/<조문번호>(.*?)<\/조문번호>/);
                    let joNo = joNoMatch ? `제${joNoMatch[1]}조` : '';
                    let joBrNoMatch = joXml.match(/<조문가지번호>(.*?)<\/조문가지번호>/);
                    if (joBrNoMatch && joBrNoMatch[1] !== '00') joNo += `의${joBrNoMatch[1]}`;

                    // 제목 찾기
                    let joTitleMatch = joXml.match(/<조문제목>(.*?)<\/조문제목>/);
                    let joTitle = joTitleMatch ? joTitleMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim() : '';

                    // 조항의 원문 내용 찾기 (조문, 항, 호, 목)
                    let contentLines = [];
                    const contentRegex = /<(조문내용|항내용|호내용|목내용)[^>]*>([\s\S]*?)<\/\1>/g;
                    let cMatch;
                    
                    while ((cMatch = contentRegex.exec(joXml)) !== null) {
                        let text = cMatch[2].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim();
                        if (text) {
                            if (cMatch[1] === '호내용') text = '  ' + text; // 호는 2칸 들여쓰기
                            if (cMatch[1] === '목내용') text = '    ' + text; // 목은 4칸 들여쓰기
                            contentLines.push(text);
                        }
                    }

                    const fullText = contentLines.join('\n');
                    
                    // 검색어 매칭 확인
                    const isTitleMatch = joTitle.includes(query);
                    const isContentMatch = fullText.includes(query);

                    if (isTitleMatch || isContentMatch) {
                        matchedArticles.push({
                            lawName: lawName,
                            articleNo: joNo,
                            articleTitle: joTitle,
                            content: fullText,
                            priority: isTitleMatch ? 1 : 2 // 제목 일치 최우선
                        });
                    }
                }
            } catch (e) {
                // 특정 법령에서 에러가 나도 다른 법령 검색은 멈추지 않도록 무시
                return; 
            }
        });

        // 9개 법령 스캔이 모두 끝날 때까지 대기
        await Promise.all(fetchPromises);

        // 우선순위 정렬 (제목 일치 조항을 맨 위로)
        matchedArticles.sort((a, b) => a.priority - b.priority);

        res.status(200).json({ total: matchedArticles.length, results: matchedArticles });
        
    } catch (error) {
        res.status(500).json({ error: '서버 에러 발생', details: String(error) });
    }
}
