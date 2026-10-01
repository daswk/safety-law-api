export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const { query } = req.query;
    if (!query) return res.status(200).json({ total: 0, results: [] });

    const apiKey = '4548';
    const targetLaws = ['산업안전보건법', '중대재해 처벌 등에 관한 법률', '건설기술 진흥법'];

    try {
        let matchedArticles = [];

        // 서버가 터지지 않도록 3대 법령을 '하나씩 순서대로(for...of)' 안전하게 요청합니다.
        for (const lawName of targetLaws) {
            try {
                // 1. 법령 ID(MST) 찾기 (안정성을 위해 XML 사용)
                const searchUrl = `https://www.law.go.kr/DRF/lawSearch.do?OC=${apiKey}&target=law&type=XML&query=${encodeURIComponent(lawName)}`;
                const searchRes = await fetch(searchUrl);
                const searchText = await searchRes.text();
                
                const mstMatch = searchText.match(/<법령일련번호>(.*?)<\/법령일련번호>/);
                if (!mstMatch) continue;
                const mst = mstMatch[1];

                // 2. 조항 원문 가져오기 (고장 나지 않는 XML 원본 추출)
                const detailUrl = `https://www.law.go.kr/DRF/lawService.do?OC=${apiKey}&target=law&type=XML&MST=${mst}`;
                const detailRes = await fetch(detailUrl);
                const detailText = await detailRes.text();

                // 3. <조문> 단위로 쪼개기
                const joRegex = /<조문[^>]*>([\s\S]*?)<\/조문>/g;
                let match;

                while ((match = joRegex.exec(detailText)) !== null) {
                    const joXml = match[1];

                    // 조문 번호(제O조의O) 추출
                    let joNoMatch = joXml.match(/<조문번호>(.*?)<\/조문번호>/);
                    let joNo = joNoMatch ? `제${joNoMatch[1]}조` : '';
                    let joBrNoMatch = joXml.match(/<조문가지번호>(.*?)<\/조문가지번호>/);
                    if (joBrNoMatch && joBrNoMatch[1] !== '00') joNo += `의${joBrNoMatch[1]}`;

                    // 제목 추출
                    let joTitleMatch = joXml.match(/<조문제목>(.*?)<\/조문제목>/);
                    let joTitle = joTitleMatch ? joTitleMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim() : '';

                    // 내용 추출 (조항, 항, 호, 목의 구조와 들여쓰기 완벽 유지)
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
                    
                    const isTitleMatch = joTitle.includes(query);
                    const isContentMatch = fullText.includes(query);

                    if (isTitleMatch || isContentMatch) {
                        matchedArticles.push({
                            lawName: lawName,
                            articleNo: joNo,
                            articleTitle: joTitle,
                            content: fullText,
                            priority: isTitleMatch ? 1 : 2 // 제목 일치 시 1순위 부여
                        });
                    }
                }
            } catch (e) {
                continue; // 중간에 하나 에러가 나도 서버가 멈추지 않고 계속 검색
            }
        }

        // 제목 일치(1순위)를 무조건 맨 위로 끌어올림
        matchedArticles.sort((a, b) => a.priority - b.priority);

        res.status(200).json({ total: matchedArticles.length, results: matchedArticles });
        
    } catch (error) {
        res.status(500).json({ error: '서버 에러 발생', details: String(error) });
    }
}
