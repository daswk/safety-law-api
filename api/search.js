export default async function handler(req, res) {
    // 스마트폰 등 모든 곳에서의 접속 허용 (보안 에러 방지)
    res.setHeader('Access-Control-Allow-Origin', '*');

    const { query } = req.query; // 검색어
    const apiKey = '4548'; // 질문자님의 API 인증키

    // 국가법령정보센터에 검색 결과를 JSON 형태로 요청하는 주소
    const url = `https://www.law.go.kr/DRF/lawSearch.do?OC=${apiKey}&target=law&type=JSON&query=${encodeURIComponent(query)}`;

    try {
        const response = await fetch(url);
        const data = await response.json();
        res.status(200).json(data); // 결과를 내 스마트폰으로 전달
    } catch (error) {
        res.status(500).json({ error: '법령 데이터를 불러오지 못했습니다.' });
    }
}
