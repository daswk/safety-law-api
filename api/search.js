export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const { query } = req.query;
    if (!query) return res.status(200).json({ total: 0, results: [] });

    const apiKey = '4548';
    const targetLaws = ['산업안전보건법', '중대재해 처벌 등에 관한 법률', '건설기술 진흥법'];

    try {
        let matchedArticles = [];

        // Vercel 타임아웃 방지를 위해 병렬(Promise.all)로 빠르게 스캔
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
            
            // 본문을 정식 JSON 포맷으로 요청
            const detailUrl = `https://www.law.go.kr/DRF/lawService.do?OC=${apiKey}&target=law&type=JSON&MST=${mst}`;
            const detailRes = await fetch(detailUrl);
            const detailData = await detailRes.json();

            if (!detailData.Law || !detailData.Law.JoMuns || !detailData.Law.JoMuns.JoMun) return;
            
            let articles = detailData.Law.JoMuns.JoMun;
            if (!Array.isArray(articles)) articles = [articles];

            articles.forEach(article => {
                // 1. 몇조 몇항 추출
                let joNo = article.joNo ? `제${article.joNo}조` : '';
                if (article.joBrNo && article.joBrNo !== '00') joNo += `의${article.joBrNo}`;
                
                // 2. 조항 제목 추출
                let joTitle = article.joSubTtl ? article.joSubTtl : '';
                
                // 3. 원문 전체 조립 (조문 + 항 + 호 구조 완벽 복원)
                let fullText = article.joCtt ? article.joCtt.replace(/<[^>]*>?/gm, '') : '';
                
                if (article.Hang) {
                    let hangs = Array.isArray(article.Hang) ? article.Hang : [article.Hang];
                    hangs.forEach(hang => {
                        if (hang.hangCtt) fullText += '\n' + hang.hangCtt.replace(/<[^>]*>?/gm, '');
                        if (hang.Ho) {
                            let hos = Array.isArray(hang.Ho) ? hang.Ho : [hang.Ho];
                            hos.forEach(ho => {
                                if (ho.hoCtt) fullText += '\n  ' + ho.hoCtt.replace(/<[^>]*>?/gm, '');
                            });
                        }
                    });
                }

                // 조문 제목이나 본문에 검색어가 포함되어 있으면 추출
                if (fullText.includes(query) || joTitle.includes(query)) {
                    matchedArticles.push({
                        lawName: lawName,
                        articleNo: joNo,
                        articleTitle: joTitle,
                        content: fullText.trim()
                    });
                }
            });
        });

        await Promise.all(fetchPromises);
        res.status(200).json({ total: matchedArticles.length, results: matchedArticles });
    } catch (error) {
        res.status(500).json({ error: '서버 에러 발생', details: String(error) });
    }
}
