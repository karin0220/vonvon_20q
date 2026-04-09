/**
 * 위키피디아 + 나무위키 조회 모듈
 * AI 스무고개에서 최신 정보 보충용
 * 걷어내기: 이 파일 삭제 + route.ts에서 호출 제거
 */

const WIKI_CACHE = new Map<string, { value: string; expiresAt: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10분

/**
 * 한국어 위키피디아 API로 요약 가져오기
 */
async function searchWikipedia(query: string): Promise<string | null> {
  try {
    // 1. 검색
    const searchUrl = `https://ko.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=1&format=json&origin=*`;
    const searchRes = await fetch(searchUrl, { signal: AbortSignal.timeout(5000) });
    if (!searchRes.ok) return null;

    const searchData = await searchRes.json();
    const title = searchData?.query?.search?.[0]?.title;
    if (!title) return null;

    // 2. 요약 가져오기
    const summaryUrl = `https://ko.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const summaryRes = await fetch(summaryUrl, { signal: AbortSignal.timeout(5000) });
    if (!summaryRes.ok) return null;

    const summaryData = await summaryRes.json();
    const extract = summaryData?.extract;
    if (!extract) return null;

    // 최대 500자로 제한
    return extract.length > 500 ? extract.slice(0, 500) + "..." : extract;
  } catch {
    return null;
  }
}

/**
 * 나무위키에서 첫 문단 파싱
 */
async function searchNamuwiki(query: string): Promise<string | null> {
  try {
    const url = `https://namu.wiki/w/${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        "Accept": "text/html",
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;

    const html = await res.text();

    // 나무위키 본문에서 텍스트 추출 (HTML 태그 제거, 첫 500자)
    // wiki-content 영역에서 <p> 태그 내용을 수집
    const paragraphs: string[] = [];
    const pRegex = /<(?:p|div)[^>]*class="[^"]*wiki-paragraph[^"]*"[^>]*>([\s\S]*?)<\/(?:p|div)>/gi;
    let match;
    while ((match = pRegex.exec(html)) !== null && paragraphs.length < 5) {
      const text = match[1]
        .replace(/<[^>]+>/g, "") // HTML 태그 제거
        .replace(/\[\d+\]/g, "") // 각주 번호 제거
        .replace(/&[a-z]+;/gi, " ") // HTML 엔티티
        .replace(/\s+/g, " ")
        .trim();
      if (text.length > 20) {
        paragraphs.push(text);
      }
    }

    if (!paragraphs.length) {
      // fallback: 전체 텍스트에서 긴 텍스트 블록 추출
      const bodyText = html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&[a-z]+;/gi, " ")
        .replace(/\s+/g, " ")
        .trim();

      // "목차"나 "각주" 전까지의 내용에서 앞부분 추출
      const contentStart = bodyText.indexOf(query);
      if (contentStart >= 0) {
        const snippet = bodyText.slice(contentStart, contentStart + 500).trim();
        if (snippet.length > 50) return snippet + "...";
      }
      return null;
    }

    const result = paragraphs.join(" ");
    return result.length > 500 ? result.slice(0, 500) + "..." : result;
  } catch {
    return null;
  }
}

/**
 * 위키피디아 → 나무위키 순서로 조회, 캐시 적용
 */
export async function lookupWiki(query: string): Promise<string | null> {
  const cacheKey = query.toLowerCase().trim();
  const cached = WIKI_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  // 위키피디아와 나무위키 병렬 조회
  const [wikiResult, namuResult] = await Promise.all([
    searchWikipedia(query),
    searchNamuwiki(query),
  ]);

  // 나무위키가 보통 더 상세하므로 우선, 없으면 위키피디아
  const result = namuResult || wikiResult;

  if (result) {
    WIKI_CACHE.set(cacheKey, { value: result, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  return result;
}

/**
 * 대화 내역에서 위키 검색용 키워드 추출
 * AI 질문의 Yes 응답에서 핵심 속성을 모아 검색 쿼리 생성
 */
export function extractSearchQuery(
  messages: { role: string; content: string }[],
  category: string
): string | null {
  const yesKeywords: string[] = [];
  const noKeywords: string[] = [];

  for (let i = 0; i < messages.length - 1; i++) {
    const msg = messages[i];
    const nextMsg = messages[i + 1];
    if (msg.role !== "model" || nextMsg.role !== "user") continue;

    const answer = nextMsg.content.trim().toLowerCase();
    const isYes = answer.includes("응") || answer.includes("맞아") || answer.includes("그렇");
    const isNo = answer.includes("아니") || answer.includes("아냐") || answer.includes("땡");

    // 질문에서 핵심 키워드 추출
    const question = msg.content
      .replace(/[?？。.!！~…·]/g, "")
      .replace(/봉신[의이가은는]?/g, "")
      .replace(/유리구슬[이가은는에]?/g, "")
      .replace(/구슬[이가은는에서]?/g, "")
      .replace(/흠+|크흠+|오호+|흥+|자+\.\.\./g, "")
      .trim();

    if (isYes && question.length > 2) {
      yesKeywords.push(question);
    } else if (isNo && question.length > 2) {
      noKeywords.push(question);
    }
  }

  if (yesKeywords.length === 0) return null;

  // 카테고리 + Yes 키워드 중 주요 속성 조합
  const traits = yesKeywords.slice(-4).join(" ");
  return `${category} ${traits}`.trim();
}
