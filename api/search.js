export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const { query } = req.query;
    if (!query) return res.status(200).json({ total: 0, results: [] });

    const apiKey = '4548';
    
    // 핵심 3대 법령
    const targetLaws = ['산업안전보건법', '중대재해 처벌 등에 관한 법률', '건설기술 진흥법'];

    try {
        let matchedArticles = [];

        for (const lawName of targetLaws) {
            // 1단계: 법령의 고유 번호(MST) 찾기
            const searchUrl = `https://www.law.go.kr/DRF/lawSearch.do?OC=${apiKey}&target=law&type=JSON&query=${encodeURIComponent(lawName)}`;
            const searchRes = await fetch(searchUrl);
            const searchData = await searchRes.json();
            
            if (!searchData.LawSearch || !searchData.LawSearch.law) continue;
            
            let laws = searchData.LawSearch.law;
            if (!Array.isArray(laws)) laws = [laws];
            
            const exactLaw = laws.find(l => 
                l.법령명한글 && l.법령명한글.replace(/\s/g, '') === lawName.replace(/\s/g, '')
            );
            if (!exactLaw) continue;
            
            const mst = exactLaw.법령일련번호;

            // 2단계: 에러가 잦은 JSON 대신, 절대 고장 나지 않는 구형 'XML' 형태로 본문 요청
            const detailUrl = `https://www.law.go.kr/DRF/lawService.do?OC=${apiKey}&target=law&type=XML&MST=${mst}`;
            const detailRes = await fetch(detailUrl);
            const detailText = await detailRes.text(); // 텍스트 날것으로 가져오기
            
            // 3단계: XML 원문에서 <조문> 덩어리만 통째로 뜯어내기 (정규식 사용)
            const joRegex = /<조문[^>]*>(.*?)<\/조문>/gs;
            let match;
            
            while ((match = joRegex.exec(detailText)) !== null) {
                const articleXml = match[1];
                
                // 특수기호 및 태그를 전부 부수고 '순수 한글 텍스트'만 남기기
                let pureText = articleXml.replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                
                // 순수 텍스트 안에 사용자가 검색한 단어("안전", "위험" 등)가 포함되어 있다면!
                if (pureText.includes(query)) {
                    // 화면에 너무 길게 나오지 않도록 200자 내외로 자르기
                    let displayContent = pureText.length > 200 ? pureText.substring(0, 200) + '...' : pureText;
                    
                    matchedArticles.push({
                        lawName: lawName,
                        content: displayContent,
                        link: `https://www.law.go.kr/법령/${encodeURIComponent(lawName)}`
                    });
                }
            }
        }

        res.status(200).json({ total: matchedArticles.length, results: matchedArticles });
    } catch (error) {
        res.status(500).json({ error: '서버 에러 발생', details: String(error) });
    }
}
