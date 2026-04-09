/**
 * 위키피디아 조회 모듈
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
    const searchUrl = `https://ko.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=3&format=json&origin=*`;
    const searchRes = await fetch(searchUrl, { signal: AbortSignal.timeout(5000) });
    if (!searchRes.ok) return null;

    const searchData = await searchRes.json();
    const results = searchData?.query?.search;
    if (!results?.length) return null;

    // 2. 상위 결과들의 요약 병렬 조회 (최대 3개)
    const summaries = await Promise.all(
      results.slice(0, 3).map(async (r: { title: string }) => {
        try {
          const summaryUrl = `https://ko.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(r.title)}`;
          const summaryRes = await fetch(summaryUrl, { signal: AbortSignal.timeout(5000) });
          if (!summaryRes.ok) return null;
          const data = await summaryRes.json();
          return data?.extract ? `[${r.title}] ${data.extract}` : null;
        } catch {
          return null;
        }
      })
    );

    const validSummaries = summaries.filter(Boolean) as string[];
    if (!validSummaries.length) return null;

    const combined = validSummaries.join("\n\n");
    return combined.length > 800 ? combined.slice(0, 800) + "..." : combined;
  } catch {
    return null;
  }
}

/**
 * 위키피디아 조회, 캐시 적용
 */
export async function lookupWiki(query: string): Promise<string | null> {
  const cacheKey = query.toLowerCase().trim();
  const cached = WIKI_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const result = await searchWikipedia(query);

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

  for (let i = 0; i < messages.length - 1; i++) {
    const msg = messages[i];
    const nextMsg = messages[i + 1];
    if (msg.role !== "model" || nextMsg.role !== "user") continue;

    const answer = nextMsg.content.trim().toLowerCase();
    const isYes = answer.includes("응") || answer.includes("맞아") || answer.includes("그렇");

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
    }
  }

  if (yesKeywords.length === 0) return null;

  // 카테고리 + Yes 키워드 중 주요 속성 조합
  const traits = yesKeywords.slice(-4).join(" ");
  return `${category} ${traits}`.trim();
}
