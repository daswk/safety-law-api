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
            // 1. 법 이름으로 검색하여 고유 번호(MST) 찾기
            const searchUrl = `https://www.law.go.kr/DRF/lawSearch.do?OC=${apiKey}&target=law&type=JSON&query=${encodeURIComponent(lawName)}`;
            const searchRes = await fetch(searchUrl);
            const searchData = await searchRes.json();
            
            if (!searchData.LawSearch || !searchData.LawSearch.law) continue;
            
            let laws = searchData.LawSearch.law;
            if (!Array.isArray(laws)) laws = [laws];
            
            // ★ 수정된 부분: '법령명한글' 키값 사용 및 띄어쓰기 무시 매칭
            const exactLaw = laws.find(l => 
                l.법령명한글 && l.법령명한글.replace(/\s/g, '') === lawName.replace(/\s/g, '')
            );
            if (!exactLaw) continue;
            
            const mst = exactLaw.법령일련번호;

            // 2. 찾은 고유 번호로 해당 법령의 전체 원문(조항) 가져오기
            const detailUrl = `https://www.law.go.kr/DRF/lawService.do?OC=${apiKey}&target=law&type=JSON&MST=${mst}`;
            const detailRes = await fetch(detailUrl);
            const detailText = await detailRes.text();
            
            try {
                const detailData = JSON.parse(detailText);
                if (!detailData.Law || !detailData.Law.JoMuns || !detailData.Law.JoMuns.JoMun) continue;
                
                let articles = detailData.Law.JoMuns.JoMun;
                if (!Array.isArray(articles)) articles = [articles];

                // 3. 조항 내용 중에 검색어가 있는지 딥 스캔
                articles.forEach(article => {
                    const articleString = JSON.stringify(article);
                    if (articleString.includes(query)) {
                        // 불필요한 태그 제거 및 내용 추출
                        let content = article.joCtt ? article.joCtt.replace(/<[^>]*>?/gm, '') : '상세 내용 참조';
                        matchedArticles.push({
                            lawName: lawName,
                            content: content,
                            link: `https://www.law.go.kr/법령/${encodeURIComponent(lawName)}`
                        });
                    }
                });
            } catch(e) { continue; }
        }

        res.status(200).json({ total: matchedArticles.length, results: matchedArticles });
    } catch (error) {
        res.status(500).json({ error: '서버 에러 발생', details: String(error) });
    }
}
