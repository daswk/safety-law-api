export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const { query } = req.query;
    if (!query) return res.status(200).json({ total: 0, results: [] });

    const apiKey = '4548';
    
    // 타겟 8대 법령
    const targetLaws = [
        '산업안전보건법', '산업안전보건법 시행령', '산업안전보건법 시행규칙',
        '중대재해 처벌 등에 관한 법률', '중대재해 처벌 등에 관한 법률 시행령',
        '건설기술 진흥법', '건설기술 진흥법 시행령', '건설기술 진흥법 시행규칙'
    ];

    try {
        const fetchPromises = targetLaws.map(lawName => {
            const url = `https://www.law.go.kr/DRF/lawService.do?OC=${apiKey}&target=law&type=JSON&query=${encodeURIComponent(lawName)}`;
            return fetch(url).then(r => r.json()).catch(() => null);
        });

        const lawsData = await Promise.all(fetchPromises);
        let matchedArticles = [];

        lawsData.forEach(data => {
            if (!data || !data.Law) return;
            const lawTitle = data.Law.BasicInfo.lawNm;
            let articles = data.Law.JoMuns ? data.Law.JoMuns.JoMun : [];
            if (!Array.isArray(articles)) articles = [articles];

            articles.forEach(article => {
                const articleString = JSON.stringify(article);
                // 검색어가 조항의 내용이나 제목에 포함되어 있는지 확인
                if (articleString.includes(query)) {
                    let content = article.joCtt ? article.joCtt.replace(/<[^>]*>?/gm, '') : '상세 내용 참조';
                    matchedArticles.push({
                        lawName: lawTitle,
                        content: content,
                        link: `https://www.law.go.kr/법령/${encodeURIComponent(lawTitle)}`
                    });
                }
            });
        });

        res.status(200).json({ total: matchedArticles.length, results: matchedArticles });
    } catch (error) {
        res.status(500).json({ error: '서버 데이터 처리 오류' });
    }
}
