export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const { query } = req.query;
    if (!query) return res.status(200).json({ total: 0, results: [] });

    const apiKey = '4548';
    
    // 핵심 3대 법령 집중 스캔 (속도 최적화)
    const targetLaws = ['산업안전보건법', '중대재해 처벌 등에 관한 법률', '건설기술 진흥법'];

    try {
        let matchedArticles = [];

        // 1. 각 법령의 고유 ID(MST)를 먼저 찾고 -> 2. 전체 본문을 빼오는 2단계 방식
        for (const lawName of targetLaws) {
            // [1단계] 법 이름으로 검색해서 고유 ID(MST) 찾기
            const searchUrl = `https://www.law.go.kr/DRF/lawSearch.do?OC=${apiKey}&target=law&type=JSON&query=${encodeURIComponent(lawName)}`;
            const searchRes = await fetch(searchUrl);
            const searchData = await searchRes.json();
            
            if (!searchData.LawSearch || !searchData.LawSearch.law) continue;
            
            let laws = searchData.LawSearch.law;
            if (!Array.isArray(laws)) laws = [laws];
            
            // 정확히 이름이 일치하는 법령의 ID 추출
            const exactLaw = laws.find(l => l.법령명 === lawName);
            if (!exactLaw) continue;
            const mst = exactLaw.법령일련번호;

            // [2단계] 찾은 ID(MST)로 법령 전체 본문 가져오기
            const detailUrl = `https://www.law.go.kr/DRF/lawService.do?OC=${apiKey}&target=law&type=JSON&MST=${mst}`;
            const detailRes = await fetch(detailUrl);
            const detailText = await detailRes.text();
            
            try {
                const detailData = JSON.parse(detailText);
                if (!detailData.Law || !detailData.Law.JoMuns || !detailData.Law.JoMuns.JoMun) continue;
                
                let articles = detailData.Law.JoMuns.JoMun;
                if (!Array.isArray(articles)) articles = [articles];

                // 조문 내용 중에 사용자가 입력한 검색어가 있는지 스캔
                articles.forEach(article => {
                    const articleString = JSON.stringify(article);
                    if (articleString.includes(query)) {
                        let content = article.joCtt ? article.joCtt.replace(/<[^>]*>?/gm, '') : '상세 내용 참조';
                        matchedArticles.push({
                            lawName: lawName,
                            content: content,
                            link: `https://www.law.go.kr/법령/${encodeURIComponent(lawName)}`
                        });
                    }
                });
            } catch(e) { continue; } // 정부 에러 발생 시 무시하고 다음 법령으로 진행
        }

        res.status(200).json({ total: matchedArticles.length, results: matchedArticles });
    } catch (error) {
        res.status(500).json({ error: '서버 에러 발생', details: String(error) });
    }
}
