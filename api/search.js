export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const { query } = req.query;
    if (!query) return res.status(200).json({ total: 0, results: [] });

    const apiKey = '4548';
    const targetLaws = ['산업안전보건법', '중대재해 처벌 등에 관한 법률', '건설기술 진흥법'];

    try {
        let matchedArticles = [];

        const fetchPromises = targetLaws.map(async (lawName) => {
            // 1단계: 법령 번호(MST) 찾기
            const searchUrl = `https://www.law.go.kr/DRF/lawSearch.do?OC=${apiKey}&target=law&type=JSON&query=${encodeURIComponent(lawName)}`;
            const searchRes = await fetch(searchUrl);
            const searchData = await searchRes.json();
            
            if (!searchData.LawSearch || !searchData.LawSearch.law) return;
            let laws = searchData.LawSearch.law;
            if (!Array.isArray(laws)) laws = [laws];
            
            const exactLaw = laws.find(l => l.법령명한글 && l.법령명한글.replace(/\s/g, '') === lawName.replace(/\s/g, ''));
            if (!exactLaw) return;
            const mst = exactLaw.법령일련번호;
            
            // 2단계: ★ 제가 실수했던 부분. 에러 나는 JSON 대신 무조건 성공하는 XML 방식으로 원상복구
            const detailUrl = `https://www.law.go.kr/DRF/lawService.do?OC=${apiKey}&target=law&type=XML&MST=${mst}`;
            const detailRes = await fetch(detailUrl);
            const detailText = await detailRes.text();

            // 3단계: XML에서 <조문> 덩어리를 뜯어내고, 번호와 제목을 예쁘게 분리
            const joRegex = /<조문[^>]*>(.*?)<\/조문>/gs;
            let match;
            
            while ((match = joRegex.exec(detailText)) !== null) {
                const joXml = match[1];
                
                // [조문 번호 추출]
                let joNoMatch = joXml.match(/<조문번호>(.*?)<\/조문번호>/);
                let joNo = joNoMatch ? `제${joNoMatch[1]}조` : '';
                
                let joBrNoMatch = joXml.match(/<조문가지번호>(.*?)<\/조문가지번호>/);
                if (joBrNoMatch && joBrNoMatch[1] !== '00') joNo += `의${joBrNoMatch[1]}`;
                
                // [조문 제목 추출]
                let joTitleMatch = joXml.match(/<조문제목>(.*?)<\/조문제목>/);
                let joTitle = joTitleMatch ? joTitleMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1') : '';
                
                // [조문 원문 100% 추출 (지저분한 태그 제거)]
                let cleanContent = joXml
                    .replace(/<조문번호>.*?<\/조문번호>/g, '')
                    .replace(/<조문가지번호>.*?<\/조문가지번호>/g, '')
                    .replace(/<조문제목>.*?<\/조문제목>/g, '')
                    .replace(/<조문시행일자>.*?<\/조문시행일자>/g, '')
                    .replace(/<조문변경여부>.*?<\/조문변경여부>/g, '')
                    .replace(/<제개정유형>.*?<\/제개정유형>/g, '');
                    
                // CDATA와 남은 XML 태그 걷어내고 순수 텍스트만 남기기
                cleanContent = cleanContent.replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                
                // 검색어가 제목이나 본문에 있다면 배열에 담기
                if (cleanContent.includes(query) || joTitle.includes(query)) {
                    matchedArticles.push({
                        lawName: lawName,
                        articleNo: joNo,
                        articleTitle: joTitle,
                        content: cleanContent
                    });
                }
            }
        });

        // 3개 법령 병렬 스캔 완료 대기
        await Promise.all(fetchPromises);
        res.status(200).json({ total: matchedArticles.length, results: matchedArticles });
        
    } catch (error) {
        res.status(500).json({ error: '서버 에러 발생', details: String(error) });
    }
}
