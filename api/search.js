export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const { query } = req.query;
    if (!query) return res.status(200).json({ total: 0, results: [] });

    const apiKey = '4548';
    const targetLaws = ['산업안전보건법', '중대재해 처벌 등에 관한 법률', '건설기술 진흥법'];

    try {
        let matchedArticles = [];

        const fetchPromises = targetLaws.map(async (lawName) => {
            const searchUrl = `https://www.law.go.kr/DRF/lawSearch.do?OC=${apiKey}&target=law&type=JSON&query=${encodeURIComponent(lawName)}`;
            const searchRes = await fetch(searchUrl);
            const searchData = await searchRes.json();
            
            if (!searchData.LawSearch || !searchData.LawSearch.law) return;
            let laws = searchData.LawSearch.law;
            if (!Array.isArray(laws)) laws = [laws];
            
            const exactLaw = laws.find(l => l.법령명한글 && l.법령명한글.replace(/\s/g, '') === lawName.replace(/\s/g, ''));
            if (!exactLaw) return;
            const mst = exactLaw.법령일련번호;
            
            // 안정적인 JSON 구조로 본문 요청
            const detailUrl = `https://www.law.go.kr/DRF/lawService.do?OC=${apiKey}&target=law&type=JSON&MST=${mst}`;
            const detailRes = await fetch(detailUrl);
            const detailData = await detailRes.json();

            if (!detailData.Law || !detailData.Law.JoMuns || !detailData.Law.JoMuns.JoMun) return;
            let articles = detailData.Law.JoMuns.JoMun;
            if (!Array.isArray(articles)) articles = [articles];

            articles.forEach(article => {
                let joNo = article.joNo ? `제${article.joNo}조` : '';
                if (article.joBrNo && article.joBrNo !== '00') joNo += `의${article.joBrNo}`;
                
                let joTitle = article.joSubTtl ? article.joSubTtl : '';
                
                // 조, 항, 호의 줄바꿈과 들여쓰기를 완벽하게 유지하여 텍스트 조립
                let contentLines = [];
                if (article.joCtt) contentLines.push(article.joCtt.replace(/<[^>]*>?/gm, '').trim());
                
                if (article.Hang) {
                    let hangs = Array.isArray(article.Hang) ? article.Hang : [article.Hang];
                    hangs.forEach(hang => {
                        if (hang.hangCtt) contentLines.push(hang.hangCtt.replace(/<[^>]*>?/gm, '').trim());
                        if (hang.Ho) {
                            let hos = Array.isArray(hang.Ho) ? hang.Ho : [hang.Ho];
                            hos.forEach(ho => {
                                // '호'는 들여쓰기 2칸 추가
                                if (ho.hoCtt) contentLines.push('  ' + ho.hoCtt.replace(/<[^>]*>?/gm, '').trim());
                            });
                        }
                    });
                }

                const fullText = contentLines.join('\n');
                
                // 검색어가 제목에 있는지, 내용에 있는지 구분
                const isTitleMatch = joTitle.includes(query);
                const isContentMatch = fullText.includes(query);

                if (isTitleMatch || isContentMatch) {
                    matchedArticles.push({
                        lawName: lawName,
                        articleNo: joNo,
                        articleTitle: joTitle,
                        content: fullText,
                        // 제목에 포함되면 1순위, 내용에만 있으면 2순위
                        priority: isTitleMatch ? 1 : 2 
                    });
                }
            });
        });

        await Promise.all(fetchPromises);
        
        // 정렬 로직: 1. 제목 일치 우선 -> 2. 법령 및 조항 순서대로 정렬
        matchedArticles.sort((a, b) => a.priority - b.priority);

        res.status(200).json({ total: matchedArticles.length, results: matchedArticles });
        
    } catch (error) {
        res.status(500).json({ error: '서버 에러 발생', details: String(error) });
    }
}
