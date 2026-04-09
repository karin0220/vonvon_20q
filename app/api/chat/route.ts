import { getSystemPrompt } from "@/lib/prompts";
import { ChatRequest, ChatResponse, ModelId, AVAILABLE_MODELS, THINKING_LEVELS } from "@/lib/types";
import { getKnowledgeContext } from "@/lib/supabase";
import { lookupWiki, extractSearchQuery } from "@/lib/wiki";

const API_KEY = process.env.GEMINI_API_KEY || "";
const DEFAULT_MODEL: ModelId = "gemini-3.1-flash-lite-preview";
const GEMINI_TIMEOUT_MS = 15000;

function getApiUrl(model: ModelId) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;
}
const TRANSCRIPT_TEXT_LIMIT = 72;

// --- 초반 5턴 하드코딩 오프닝 질문 (바리에이션 풀) ---
// 각 턴마다 여러 말투 변형 중 랜덤 선택 → 반복 플레이에도 신선함 유지
type OpeningTurn = { variants: string[]; axis: string; bucket: string };
type CategoryOpenings = OpeningTurn[];

const OPENING_POOL: Record<string, CategoryOpenings[]> = {
  "유명인": [
    // 세트 A: 한국인 → 남자 → 연예인 → 활동 중 → 30대 이하
    [
      {
        variants: [
          "흠... 봉신의 유리구슬에 뭔가가 비친다. 그 인물은 한국인이냐?",
          "오호... 유리구슬이 흔들린다. 네가 떠올린 인물, 한국 사람이냐?",
          "봉신이 기운을 읽어본다... 그자는 한국인이냐?",
          "자... 구슬에 형체가 잡힌다. 이 인물은 한국에서 태어난 자냐?",
        ],
        axis: "country", bucket: "1000+",
      },
      {
        variants: [
          "좋다. 그 인물은 남자냐?",
          "됐어. 그자는 남자냐?",
          "알겠다. 그 인물, 남성이냐?",
          "흥... 그래서 그자가 남자란 말이냐?",
        ],
        axis: "gender", bucket: "1000+",
      },
      {
        variants: [
          "크흠... 그 인물은 연예인이냐?",
          "봉신의 구슬이 묻는다. 그자가 연예계 사람이냐?",
          "오호... 그 인물은 연예 활동을 하는 자냐?",
          "그렇다면... 그자는 가수나 배우 같은 연예인이냐?",
        ],
        axis: "occupation", bucket: "100-999",
      },
      {
        variants: [
          "자... 그 인물은 지금도 활동하고 있는 자냐?",
          "봉신이 시간의 흐름을 더듬는다... 그자는 현재 활동 중이냐?",
          "흠... 그 인물은 지금도 현역이냐?",
        ],
        axis: "active_status", bucket: "100-999",
      },
      {
        variants: [
          "흥미롭군. 그 인물은 30대 이하냐?",
          "오호... 그자는 젊은 축이냐? 30대 이하냐?",
          "봉신의 구슬이 나이를 가늠한다. 그 인물은 30대 이하냐?",
        ],
        axis: "age_range", bucket: "100-999",
      },
    ],
    // 세트 B: 살아있냐 → 한국인 → 남자 → 가수 → 해외 유명
    [
      {
        variants: [
          "흠... 봉신의 유리구슬에 뭔가가 비친다. 그 인물은 지금 살아있는 사람이냐?",
          "오호... 유리구슬이 떨린다. 네가 떠올린 인물, 현재 살아있는 자냐?",
          "봉신이 생사를 가늠한다... 그자는 이 세상 사람이냐?",
        ],
        axis: "alive", bucket: "1000+",
      },
      {
        variants: [
          "좋다. 그 인물은 한국인이냐?",
          "됐어. 그자는 한국 사람이냐?",
          "알겠다. 그 인물, 한국에서 태어난 자냐?",
        ],
        axis: "country", bucket: "1000+",
      },
      {
        variants: [
          "크흠... 그 인물은 남자냐?",
          "봉신의 구슬이 묻는다. 그자가 남성이냐?",
          "오호... 그 인물은 남자냐?",
        ],
        axis: "gender", bucket: "1000+",
      },
      {
        variants: [
          "자... 그 인물은 노래를 부르는 가수냐?",
          "흠... 봉신의 구슬에 음악이 들린다. 그자는 가수냐?",
          "구슬이 멜로디를 타는구나... 그 인물은 가수냐?",
        ],
        axis: "singer", bucket: "100-999",
      },
      {
        variants: [
          "흥미롭군. 그 인물은 해외에서도 유명하냐?",
          "오호... 그자는 글로벌하게 알려진 인물이냐?",
          "봉신의 구슬이 세계를 비춘다. 해외에서도 이름이 알려진 자냐?",
        ],
        axis: "global_fame", bucket: "100-999",
      },
    ],
    // 세트 C: 한국인 → 연예인 → 40대 이상 → 남자 → 활동 중
    [
      {
        variants: [
          "흠... 봉신의 유리구슬에 형체가 잡힌다. 그 인물은 한국인이냐?",
          "오호... 유리구슬이 빛난다. 그자는 한국 사람이냐?",
          "봉신이 기운을 읽는다... 한국인이냐?",
        ],
        axis: "country", bucket: "1000+",
      },
      {
        variants: [
          "좋다. 그 인물은 연예인이냐?",
          "됐어. 그자는 연예계에 몸담은 사람이냐?",
          "알겠다. 그 인물, 방송이나 무대에 서는 연예인이냐?",
        ],
        axis: "occupation", bucket: "1000+",
      },
      {
        variants: [
          "크흠... 그 인물은 40대 이상이냐?",
          "봉신의 구슬이 세월을 읽는다. 그자는 40대가 넘었느냐?",
          "오호... 그 인물은 중년 이상이냐? 40대 이상이냐?",
        ],
        axis: "age_range", bucket: "100-999",
      },
      {
        variants: [
          "자... 그 인물은 남자냐?",
          "흠... 봉신이 묻는다. 그자는 남성이냐?",
          "구슬이 더 선명해진다... 남자냐?",
        ],
        axis: "gender", bucket: "100-999",
      },
      {
        variants: [
          "흥미롭군. 그 인물은 지금도 활발하게 활동 중이냐?",
          "오호... 그자는 현재도 현역이냐?",
          "봉신의 구슬이 현재를 비춘다. 지금도 활동하고 있느냐?",
        ],
        axis: "active_status", bucket: "100-999",
      },
    ],
  ],
  "캐릭터": [
    [
      { variants: ["흠... 봉신의 유리구슬에 뭔가가 비친다. 그 캐릭터는 일본 애니메이션에 나오는 존재냐?", "오호... 구슬이 떨린다. 네가 생각한 캐릭터, 일본 애니에서 온 자냐?", "봉신이 기운을 읽는다... 그 캐릭터는 일본 애니메이션 출신이냐?"], axis: "origin", bucket: "1000+" },
      { variants: ["좋다. 그 캐릭터는 남자냐?", "됐어. 그 캐릭터는 남성이냐?", "알겠다. 그자는 남자 캐릭터냐?"], axis: "gender", bucket: "1000+" },
      { variants: ["크흠... 그 캐릭터는 주인공이냐?", "봉신의 구슬이 묻는다. 그자가 작품의 주인공이냐?", "오호... 그 캐릭터는 이야기의 중심인물이냐?"], axis: "role", bucket: "100-999" },
      { variants: ["자... 그 캐릭터가 나오는 작품은 액션이나 배틀 장르냐?", "흠... 그 캐릭터의 작품에서 싸움이나 전투가 핵심이냐?", "구슬에 전투의 기운이 느껴진다. 그 캐릭터의 작품은 액션 장르냐?"], axis: "genre", bucket: "100-999" },
      { variants: ["흥미롭군. 그 캐릭터가 나온 작품은 2010년 이후 작품이냐?", "오호... 그 캐릭터의 작품은 비교적 최근, 2010년대 이후냐?", "자... 그 캐릭터가 등장한 작품, 2010년 이후에 공개된 것이냐?"], axis: "era", bucket: "10-99" },
    ],
    [
      { variants: ["흠... 봉신의 유리구슬에 뭔가가 비친다. 그 캐릭터는 만화나 애니에서 온 존재냐?", "오호... 구슬 속에 형체가 보인다. 그 캐릭터는 만화/애니 출신이냐?"], axis: "media", bucket: "1000+" },
      { variants: ["좋다. 그 캐릭터는 인간이냐?", "됐어. 그 캐릭터는 인간형 존재냐?", "알겠다. 그자는 사람의 형태를 한 존재냐?"], axis: "species", bucket: "1000+" },
      { variants: ["크흠... 그 캐릭터는 남자냐?", "봉신의 구슬이 묻는다. 그자가 남성이냐?"], axis: "gender", bucket: "100-999" },
      { variants: ["자... 그 캐릭터는 특수한 힘이나 능력을 가졌느냐?", "흠... 그 캐릭터에게 초능력이나 특별한 힘이 있느냐?"], axis: "power", bucket: "100-999" },
      { variants: ["흥미롭군. 그 캐릭터의 작품은 현재도 연재 중이거나 시리즈가 계속되고 있느냐?", "오호... 그 작품은 아직 끝나지 않았느냐?"], axis: "ongoing", bucket: "10-99" },
    ],
  ],
  "영화": [
    [
      { variants: ["흠... 봉신의 유리구슬에 뭔가가 비친다. 그 영화는 한국 영화냐?", "오호... 구슬이 떨린다. 네가 떠올린 영화, 한국 작품이냐?", "봉신이 기운을 읽는다... 그 영화는 한국에서 만든 것이냐?"], axis: "country", bucket: "1000+" },
      { variants: ["좋다. 그 영화는 액션이냐?", "됐어. 그 영화 장르가 액션이냐?", "알겠다. 그 영화에서 액션이 핵심이냐?"], axis: "genre_action", bucket: "1000+" },
      { variants: ["크흠... 그 영화는 2015년 이후에 개봉한 것이냐?", "봉신의 구슬이 시간을 가늠한다. 2015년 이후 개봉작이냐?", "오호... 비교적 최근 영화냐? 2015년 이후에 나온 것이냐?"], axis: "era", bucket: "100-999" },
      { variants: ["자... 그 영화는 시리즈물이냐? 속편이 있는 영화냐?", "흠... 그 영화에 2편이나 후속작이 존재하냐?", "구슬에 여러 편이 비치는 듯하다... 시리즈 영화냐?"], axis: "franchise", bucket: "100-999" },
      { variants: ["흥미롭군. 그 영화는 실화를 바탕으로 한 것이냐?", "오호... 그 영화의 이야기가 실제 있었던 일에서 왔냐?", "자... 그 영화는 실제 사건이나 인물을 다룬 것이냐?"], axis: "based_on_true", bucket: "10-99" },
    ],
    [
      { variants: ["흠... 봉신의 유리구슬에 스크린이 비친다. 그 영화는 한국 영화냐?", "오호... 구슬 속에 영상이 보인다. 한국에서 만든 영화냐?"], axis: "country", bucket: "1000+" },
      { variants: ["좋다. 그 영화는 2010년 이후에 나온 것이냐?", "됐어. 최근 15년 안에 개봉한 영화냐?"], axis: "era", bucket: "1000+" },
      { variants: ["크흠... 그 영화의 주인공은 남자냐?", "봉신의 구슬이 묻는다. 메인 캐릭터가 남성이냐?"], axis: "protagonist_gender", bucket: "100-999" },
      { variants: ["자... 그 영화는 천만 관객이 들었느냐?", "흠... 그 영화는 엄청난 흥행을 거뒀느냐? 천만 이상?"], axis: "box_office", bucket: "100-999" },
      { variants: ["흥미롭군. 그 영화에 유명 배우가 주연이냐?", "오호... 누구나 아는 스타가 주연을 맡은 영화냐?"], axis: "star_actor", bucket: "10-99" },
    ],
  ],
  "드라마": [
    [
      { variants: ["흠... 봉신의 유리구슬에 뭔가가 비친다. 그 드라마는 한국 드라마냐?", "오호... 구슬이 떨린다. 네가 떠올린 드라마, 한국 작품이냐?", "봉신이 기운을 읽는다... 그건 한국에서 만든 드라마냐?"], axis: "country", bucket: "1000+" },
      { variants: ["좋다. 그 드라마는 로맨스냐?", "됐어. 그 드라마의 핵심이 연애냐?", "알겠다. 그 드라마, 로맨스 장르냐?"], axis: "genre_romance", bucket: "1000+" },
      { variants: ["크흠... 그 드라마는 2020년 이후에 방영된 것이냐?", "봉신의 구슬이 시간을 더듬는다. 2020년 이후 작품이냐?", "오호... 최근 드라마냐? 2020년 이후에 나온 것이냐?"], axis: "era", bucket: "100-999" },
      { variants: ["자... 그 드라마는 넷플릭스나 티빙 같은 OTT에서 나온 것이냐?", "흠... 그 드라마는 OTT 플랫폼 오리지널이냐?", "구슬에 스트리밍의 기운이 보인다... OTT 드라마냐?"], axis: "platform", bucket: "100-999" },
      { variants: ["흥미롭군. 그 드라마는 시즌제냐? 시즌 2 이상이 있냐?", "오호... 그 드라마에 다음 시즌이 존재하냐?", "자... 그 드라마는 한 시즌으로 끝나지 않은 작품이냐?"], axis: "multi_season", bucket: "10-99" },
    ],
    [
      { variants: ["흠... 봉신의 유리구슬에 화면이 비친다. 그 드라마는 한국 드라마냐?", "오호... 구슬 속에 장면이 보인다. 한국 드라마냐?"], axis: "country", bucket: "1000+" },
      { variants: ["좋다. 그 드라마는 2015년 이후에 방영된 것이냐?", "됐어. 비교적 최근 드라마냐? 2015년 이후냐?"], axis: "era", bucket: "1000+" },
      { variants: ["크흠... 그 드라마는 판타지나 SF 요소가 있느냐?", "봉신의 구슬이 묻는다. 현실에는 없는 초자연적 요소가 있는 드라마냐?"], axis: "fantasy", bucket: "100-999" },
      { variants: ["자... 그 드라마의 주인공은 남자냐?", "흠... 메인 캐릭터가 남성이냐?"], axis: "protagonist_gender", bucket: "100-999" },
      { variants: ["흥미롭군. 그 드라마에 원작이 있느냐? 웹소설이나 웹툰 같은?", "오호... 그 드라마는 다른 매체에서 원작이 온 것이냐?"], axis: "adaptation", bucket: "10-99" },
    ],
  ],
  "노래": [
    [
      { variants: ["흠... 봉신의 유리구슬에 뭔가가 비친다. 그 노래는 한국 노래냐?", "오호... 구슬에서 멜로디가 들린다. 한국어 노래냐?", "봉신이 귀를 기울인다... 그 노래는 한국 곡이냐?"], axis: "country", bucket: "1000+" },
      { variants: ["좋다. 그 노래는 솔로 가수의 곡이냐?", "됐어. 그 노래를 부른 건 솔로 가수냐?", "알겠다. 그 노래, 그룹이 아닌 솔로 아티스트의 곡이냐?"], axis: "artist_type", bucket: "1000+" },
      { variants: ["크흠... 그 노래를 부른 가수는 남자냐?", "봉신의 구슬이 목소리를 듣는다. 남자 가수의 노래냐?", "오호... 그 노래의 가수는 남성이냐?"], axis: "artist_gender", bucket: "100-999" },
      { variants: ["자... 그 노래는 댄스곡이냐?", "흠... 그 노래에 맞춰 춤을 추게 되는 곡이냐? 댄스 장르냐?", "구슬에서 비트가 느껴진다. 그 노래, 댄스 장르냐?"], axis: "genre", bucket: "100-999" },
      { variants: ["흥미롭군. 그 노래는 2020년 이후에 나온 곡이냐?", "오호... 최근 곡이냐? 2020년 이후 발매된 노래냐?", "자... 그 노래가 세상에 나온 건 2020년 이후냐?"], axis: "era", bucket: "10-99" },
    ],
    [
      { variants: ["흠... 봉신의 유리구슬에서 선율이 들린다. 그 노래는 한국 노래냐?", "오호... 구슬이 진동한다. 한국에서 나온 곡이냐?"], axis: "country", bucket: "1000+" },
      { variants: ["좋다. 그 노래를 부른 가수는 남자냐?", "됐어. 남자 가수의 노래냐?"], axis: "artist_gender", bucket: "1000+" },
      { variants: ["크흠... 그 노래를 부른 건 아이돌 그룹이냐?", "봉신의 구슬이 묻는다. 아이돌이 부른 곡이냐?"], axis: "idol", bucket: "100-999" },
      { variants: ["자... 그 노래는 발라드냐?", "흠... 느린 템포의 감성적인 곡이냐? 발라드냐?"], axis: "genre_ballad", bucket: "100-999" },
      { variants: ["흥미롭군. 그 노래는 2015년 이후에 나온 곡이냐?", "오호... 비교적 최근 노래냐? 2015년 이후?"], axis: "era", bucket: "10-99" },
    ],
  ],
  "전체": [
    [
      { variants: ["흠... 봉신의 유리구슬에 뭔가가 비친다. 네가 떠올린 것은 사람이냐?", "오호... 구슬이 형체를 잡는다. 그것은 사람이냐?", "봉신이 기운을 읽는다... 네가 생각한 건 사람이냐?"], axis: "is_person", bucket: "1000+" },
      { variants: ["좋다. 그것은 한국과 관련된 것이냐?", "됐어. 한국에서 나온 것이냐?", "알겠다. 한국 것이냐?"], axis: "country", bucket: "1000+" },
      { variants: ["크흠... 그것은 2010년 이후에 세상에 나온 것이냐?", "봉신의 구슬이 시간을 재본다. 2010년 이후에 등장한 것이냐?", "오호... 비교적 최근 것이냐? 2010년 이후냐?"], axis: "era", bucket: "100-999" },
      { variants: ["자... 그것은 영상 콘텐츠냐? 영화나 드라마 같은?", "흠... 그건 눈으로 보는 영상물이냐?", "구슬에 화면이 비친다... 그것은 영상 작품이냐?"], axis: "media_type", bucket: "100-999" },
      { variants: ["흥미롭군. 그것은 지금도 활동 중이거나 인기 있는 것이냐?", "오호... 현재도 사람들 사이에서 화제가 되는 것이냐?", "자... 그것은 요즘에도 많이 언급되는 것이냐?"], axis: "current_relevance", bucket: "10-99" },
    ],
    [
      { variants: ["흠... 봉신의 유리구슬이 빛난다. 네가 떠올린 것은 실존하는 사람이냐?", "오호... 구슬이 묻는다. 그것은 실제로 존재하는 인물이냐?"], axis: "real_person", bucket: "1000+" },
      { variants: ["좋다. 그것은 한국에서 나온 것이냐?", "됐어. 한국과 관련이 있느냐?"], axis: "country", bucket: "1000+" },
      { variants: ["크흠... 그것은 음악과 관련이 있느냐?", "봉신의 구슬에서 소리가 들린다. 음악 관련이냐?"], axis: "music", bucket: "100-999" },
      { variants: ["자... 그것은 남성과 관련이 있느냐?", "흠... 남자냐, 혹은 남성이 만든 것이냐?"], axis: "gender", bucket: "100-999" },
      { variants: ["흥미롭군. 그것은 대중적으로 매우 유명한 것이냐?", "오호... 거의 모든 사람이 알 만한 것이냐?"], axis: "fame", bucket: "10-99" },
    ],
  ],
};

function getOpeningResponse(category: string, turnIndex: number, messages: ChatRequest["messages"]): ChatResponse | null {
  const sets = OPENING_POOL[category];
  if (!sets || sets.length === 0) return null;
  // 세션 내 일관된 세트 선택: 첫 번째 유저 메시지 길이를 시드로 사용
  const firstUserMsg = messages.find((m) => m.role === "user")?.content ?? "";
  const setIndex = (firstUserMsg.length + category.length) % sets.length;
  const turns = sets[setIndex];
  if (turnIndex < 0 || turnIndex >= turns.length) return null;
  const turn = turns[turnIndex];
  const message = turn.variants[Math.floor(Math.random() * turn.variants.length)];
  return {
    message,
    responseType: "question",
    isGuess: false,
    guess: null,
    suggestedQuestions: null,
    turnCount: turnIndex,
    isGameOver: false,
    stage: "broad",
    questionAxis: turn.axis,
    candidateBucket: turn.bucket as ChatResponse["candidateBucket"],
    shouldGuessNow: false,
    guessReasonShort: "오프닝 고정 질문",
  };
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    message: {
      type: "string",
      description: "User-facing Bongshin message. Keep it short and in character.",
    },
    responseType: {
      type: "string",
      enum: ["question", "challenge", "result"],
      description: "question for a yes/no question, challenge for a direct guess, result for end-state messaging.",
    },
    isGuess: {
      type: "boolean",
      description: "True only when responseType is challenge or the user has already won.",
    },
    guess: {
      type: ["string", "null"],
      description: "The guessed answer when challenging or finishing. Otherwise null.",
    },
    suggestedQuestions: {
      type: ["array", "null"],
      description: "Only used in user-guesses mode. Null for ai-guesses mode.",
      items: {
        type: "string",
      },
      minItems: 0,
      maxItems: 4,
    },
    turnCount: {
      type: "integer",
      minimum: 0,
      maximum: 20,
      description: "Current real turn count excluding the hidden init prompt.",
    },
    isGameOver: {
      type: "boolean",
      description: "True only for final result states.",
    },
    stage: {
      type: "string",
      enum: ["broad", "narrow", "challenge", "result"],
      description: "Internal stage of reasoning.",
    },
    questionAxis: {
      type: ["string", "null"],
      description: "The main axis used this turn, such as country, format, era, genre, size, species, occupation.",
    },
    candidateBucket: {
      type: ["string", "null"],
      enum: ["1000+", "100-999", "10-99", "2-9", "1", null],
      description: "Internal estimate of how many candidates remain.",
    },
    shouldGuessNow: {
      type: "boolean",
      description: "True only when the model believes a direct challenge is justified.",
    },
    guessReasonShort: {
      type: ["string", "null"],
      description: "Short internal reason for choosing this move.",
    },
  },
  required: [
    "message",
    "responseType",
    "isGuess",
    "guess",
    "suggestedQuestions",
    "turnCount",
    "isGameOver",
    "stage",
    "questionAxis",
    "candidateBucket",
    "shouldGuessNow",
    "guessReasonShort",
  ],
  additionalProperties: false,
} as const;

function getThinkingLevel(_mode: ChatRequest["mode"]) {
  return "low";
}

function getActualTurnCount(messages: ChatRequest["messages"]) {
  return Math.max(
    0,
    messages.filter((message) => message.role === "user").length - 1
  );
}

function compactText(text: string, limit = TRANSCRIPT_TEXT_LIMIT) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 1)}…`;
}

function summarizeAiAnswer(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (!normalized) return "unknown";
  if (normalized.startsWith("응") || normalized.includes("맞아")) return "yes";
  if (normalized.includes("모르겠")) return "unknown";
  if (normalized.startsWith("아니")) {
    return normalized.includes("틀렸") ? "wrong-guess" : "no";
  }

  return compactText(normalized, 24);
}

function summarizeUserReply(text: string, responseType?: ChatRequest["messages"][number]["responseType"]) {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (!normalized) return responseType === "result" ? "result" : "reply";
  if (responseType === "result") return `result:${compactText(normalized, 48)}`;
  if (normalized.includes("반은 맞") || normalized.includes("글쎄") || normalized.includes("미묘")) {
    return "partial";
  }
  if (normalized.includes("아니") || normalized.includes("땡") || normalized.includes("젓는군")) {
    return "no";
  }
  if (normalized.includes("맞아") || normalized.includes("그렇지") || normalized.includes("정확")) {
    return "yes";
  }

  return compactText(normalized, 48);
}

function buildAiGuessesTranscript(messages: ChatRequest["messages"]) {
  const relevant = messages.slice(1);
  const lines: string[] = [];
  let pendingModel: ChatRequest["messages"][number] | null = null;
  let turn = 0;

  for (const message of relevant) {
    if (message.role === "model") {
      pendingModel = message;
      continue;
    }

    turn += 1;
    const answer = summarizeAiAnswer(message.content);

    if (!pendingModel) {
      lines.push(`T${turn} user=${answer}`);
      continue;
    }

    const label = pendingModel.responseType === "challenge" ? "guess" : "ask";
    lines.push(
      `T${turn} ${label}="${compactText(pendingModel.content)}" user=${answer}`
    );
    pendingModel = null;
  }

  if (pendingModel) {
    const label = pendingModel.responseType === "challenge" ? "guess" : "ask";
    lines.push(`Pending ${label}="${compactText(pendingModel.content)}"`);
  }

  return lines.join("\n");
}

function buildUserGuessesTranscript(messages: ChatRequest["messages"]) {
  const relevant = messages.slice(1);
  const lines: string[] = [];
  let pendingUser: ChatRequest["messages"][number] | null = null;
  let turn = 0;

  for (const message of relevant) {
    if (message.role === "user") {
      pendingUser = message;
      continue;
    }

    turn += 1;
    const reply = summarizeUserReply(message.content, message.responseType);

    if (!pendingUser) {
      lines.push(`T${turn} bongshin=${reply}`);
      continue;
    }

    lines.push(
      `T${turn} user="${compactText(pendingUser.content)}" bongshin=${reply}`
    );
    pendingUser = null;
  }

  if (pendingUser) {
    lines.push(`Current user="${compactText(pendingUser.content)}"`);
  }

  return lines.join("\n");
}

function buildCompressedConversation(
  mode: ChatRequest["mode"],
  messages: ChatRequest["messages"]
) {
  const transcript =
    mode === "ai-guesses"
      ? buildAiGuessesTranscript(messages)
      : buildUserGuessesTranscript(messages);
  const turnCount = getActualTurnCount(messages);

  return [
    `Compressed transcript for turn ${turnCount}. Earlier flavor text was removed to save tokens.`,
    mode === "ai-guesses"
      ? "Treat yes/no/unknown verdicts as authoritative."
      : "Respect prior answers and avoid repeating the same question.",
    transcript || "No prior turns.",
  ].join("\n");
}

function hasRecentWrongGuess(messages: ChatRequest["messages"]) {
  // 쿨다운 1턴으로 축소: 직전 유저 메시지만 체크
  const lastUserMsg = messages
    .filter((message) => message.role === "user")
    .slice(-1)[0];
  return lastUserMsg?.content.startsWith("아니, 틀렸어") ?? false;
}

function countPreviousChallenges(messages: ChatRequest["messages"]) {
  return messages.filter(
    (m) => m.role === "model" && m.responseType === "challenge"
  ).length;
}

// 카테고리별 fallback 질문 풀 — 도전 필터링 시 대체 질문으로 사용
const FALLBACK_POOLS: Record<string, string[]> = {
  "유명인": [
    "봉신의 구슬이 묻는다. 그 인물은 가수냐?",
    "흠... 그 인물은 TV 예능에 자주 나오는 사람이냐?",
    "크흠... 그 인물은 정치인이냐?",
    "자... 그 인물은 운동선수냐?",
    "오호... 그 인물은 배우냐?",
    "크흠... 그 인물은 40대 이상이냐?",
    "흠... 그 인물은 최근 5년 안에 큰 논란이 있었느냐?",
    "봉신의 구슬이 묻는다. 그 인물은 해외에서도 유명하냐?",
    "자... 그 인물은 SNS 팔로워가 수백만인 자냐?",
    "크흠... 그 인물은 사업가 출신이냐?",
  ],
  "캐릭터": [
    "크흠... 그 캐릭터는 인간형 존재냐?",
    "봉신의 구슬이 묻는다. 그 캐릭터는 특수한 힘을 가졌느냐?",
    "흠... 그 캐릭터는 학생이냐?",
    "자... 그 캐릭터의 작품은 애니메이션화가 됐느냐?",
    "크흠... 그 캐릭터는 주인공이냐?",
    "오호... 그 캐릭터는 악역이냐?",
    "흠... 그 캐릭터가 등장한 작품이 시리즈물이냐?",
  ],
  "영화": [
    "봉신의 구슬이 묻는다. 그 영화에 속편이 있느냐?",
    "크흠... 그 영화의 장르가 코미디냐?",
    "흠... 그 영화에 천만 관객이 들었느냐?",
    "자... 그 영화에 유명 배우가 주연으로 나오느냐?",
    "크흠... 그 영화는 실화를 바탕으로 했느냐?",
    "오호... 그 영화는 수상 경력이 있느냐?",
    "흠... 그 영화는 2시간이 넘느냐?",
  ],
  "드라마": [
    "봉신의 구슬이 묻는다. 그 드라마는 16부작 이상이냐?",
    "크흠... 그 드라마에 판타지 요소가 있느냐?",
    "흠... 그 드라마의 주인공이 남자냐?",
    "자... 그 드라마는 해외에서도 유명해진 작품이냐?",
    "크흠... 그 드라마는 시즌제냐?",
    "오호... 그 드라마의 원작이 웹소설이나 만화냐?",
    "흠... 그 드라마에 로맨스가 메인이냐?",
  ],
  "노래": [
    "봉신의 구슬이 묻는다. 그 노래는 발라드냐?",
    "크흠... 그 노래의 뮤직비디오 조회수가 1억 이상이냐?",
    "흠... 그 노래는 드라마나 영화 OST냐?",
    "자... 그 노래를 부른 가수가 그룹이냐?",
    "크흠... 그 노래는 영어 가사가 포함돼 있느냐?",
    "오호... 그 노래는 댄스곡이냐?",
    "흠... 그 노래는 올해 나온 곡이냐?",
  ],
  "전체": [
    "봉신의 구슬이 묻는다. 그것은 음악과 관련이 있느냐?",
    "크흠... 그것은 대중적으로 매우 유명한 것이냐?",
    "크흠... 그것은 2010년 이후에 나온 것이냐?",
    "자... 그것은 사람이 만든 것이냐?",
    "오호... 그것은 화면(영상)으로 접하는 것이냐?",
    "흠... 그것은 한국에서 만들어진 것이냐?",
  ],
};

// 이전에 사용된 fallback 질문을 대화에서 추출하여 중복 방지
function buildFallbackQuestion(category: string, turnCount: number, messages?: ChatRequest["messages"]): string {
  const pool = FALLBACK_POOLS[category] || FALLBACK_POOLS["전체"];

  // 이미 대화에 등장한 질문 제외
  const usedQuestions = new Set<string>();
  if (messages) {
    for (const msg of messages) {
      if (msg.role === "model") {
        usedQuestions.add(msg.content.trim());
      }
    }
  }

  const available = pool.filter((q) => !usedQuestions.has(q));
  if (available.length === 0) {
    // 전부 소진됐으면 일반적인 질문
    return "크흠... 봉신의 구슬이 다른 방향을 비춘다. 좀 더 생각해봐야겠군.";
  }

  // 턴 수를 시드로 사용해서 어느 정도 결정적이되, 같은 턴이면 같은 질문
  return available[turnCount % available.length];
}

function sanitizeResponse(
  parsed: ChatResponse,
  mode: ChatRequest["mode"],
  category: string,
  actualTurnCount: number,
  hadRecentWrongGuess: boolean,
  messages: ChatRequest["messages"]
): ChatResponse {
  const responseType =
    parsed.responseType ?? (parsed.isGuess ? "challenge" : parsed.isGameOver ? "result" : "question");

  const base: ChatResponse = {
    message: parsed.message,
    responseType,
    isGuess: responseType === "challenge" || parsed.isGuess,
    guess: parsed.guess ?? null,
    suggestedQuestions: mode === "user-guesses" ? parsed.suggestedQuestions ?? null : null,
    turnCount: actualTurnCount,
    isGameOver: parsed.isGameOver,
    stage: parsed.stage ?? (responseType === "challenge" ? "challenge" : responseType === "result" ? "result" : actualTurnCount <= 5 ? "broad" : "narrow"),
    questionAxis: parsed.questionAxis ?? null,
    candidateBucket: parsed.candidateBucket ?? null,
    shouldGuessNow: parsed.shouldGuessNow ?? responseType === "challenge",
    guessReasonShort: parsed.guessReasonShort ?? null,
  };

  if (mode === "ai-guesses") {
    const isLateGame = actualTurnCount >= 18;
    const challengeTooEarly = actualTurnCount < 8 && responseType === "challenge";
    // 턴 18+ 에서는 candidateBucket 체크 스킵 (마지막 기회이므로)
    const challengeWithoutEnoughCandidates =
      responseType === "challenge" &&
      !isLateGame &&
      !["2-9", "1"].includes(base.candidateBucket ?? "");
    // 턴 16+ 에서는 쿨다운 무시
    const challengeDuringCooldown =
      hadRecentWrongGuess && responseType === "challenge" && actualTurnCount < 16;
    const challengeWithoutGuess = responseType === "challenge" && !base.guess;
    // 메시지가 ?로 끝나고 guess도 없으면 실제로는 질문이지 도전이 아님
    // (guess가 유효하면 메시지 형태 무관 — 어차피 메시지는 서버에서 재구성함)
    const msgTrimmed = base.message.trim();
    const challengeIsActuallyQuestion =
      responseType === "challenge" &&
      !base.guess &&
      (msgTrimmed.endsWith("?") || msgTrimmed.endsWith("?"));
    // guess가 일반명사(나라, 장르 등)이면 진짜 정답이 아님
    const GENERIC_GUESSES = /^(미국|한국|일본|중국|남자|여자|가수|배우|아이돌|영화|드라마|노래|애니|만화|액션|로맨스|코미디|발라드|댄스|힙합|인간|동물)$/;
    const challengeWithGenericGuess =
      responseType === "challenge" &&
      base.guess &&
      GENERIC_GUESSES.test(base.guess.trim());
    // 최대 3번까지만 challenge 허용 (턴 18+ 제외)
    const tooManyChallenges =
      responseType === "challenge" &&
      !isLateGame &&
      countPreviousChallenges(messages) >= 3;

    if (
      challengeTooEarly ||
      challengeWithoutEnoughCandidates ||
      challengeDuringCooldown ||
      challengeWithoutGuess ||
      challengeIsActuallyQuestion ||
      challengeWithGenericGuess ||
      tooManyChallenges
    ) {
      return {
        ...base,
        message: buildFallbackQuestion(category, actualTurnCount, messages),
        responseType: "question",
        isGuess: false,
        guess: null,
        isGameOver: false,
        stage: actualTurnCount <= 5 ? "broad" : actualTurnCount <= 12 ? "narrow" : "challenge",
        shouldGuessNow: false,
      };
    }

    // 유효한 도전: 메시지를 강제 재구성 (Gemini가 질문형으로 쓰는 것 방지)
    if (responseType === "challenge" && base.guess) {
      const CHALLENGE_TEMPLATES = [
        `봉신의 도전이다. 네가 떠올린 것은 '${base.guess}'이다!`,
        `봉신의 유리구슬이 마침내 하나의 진실을 비춘다. 네가 떠올린 것은 '${base.guess}'이다!`,
        `크흠... 봉신의 직감이 속삭인다. 정답은 '${base.guess}'이다!`,
        `봉신의 마지막 예언이다. 네가 떠올린 것은 '${base.guess}'이다.`,
        `자... 봉신의 유리구슬이 확신한다. '${base.guess}'이다!`,
      ];
      base.message = CHALLENGE_TEMPLATES[Math.floor(Math.random() * CHALLENGE_TEMPLATES.length)];
    }
  }

  return base;
}

export async function POST(request: Request) {
  try {
    const body: ChatRequest = await request.json();
    const { mode, category, messages, fixedAnswer, promptOverride, modelOverride, thinkingOverride, searchGrounding } = body;

    const activeModel = (modelOverride && (AVAILABLE_MODELS as readonly string[]).includes(modelOverride))
      ? modelOverride : DEFAULT_MODEL;
    const activeThinking = (thinkingOverride && (THINKING_LEVELS as readonly string[]).includes(thinkingOverride))
      ? thinkingOverride : getThinkingLevel(mode);

    // ai-guesses 모드: 초반 5턴은 서버 하드코딩 질문 반환 (API 호출 절약 + 품질 보장)
    if (mode === "ai-guesses") {
      const actualTurnCount = getActualTurnCount(messages);
      const openingResponse = getOpeningResponse(category, actualTurnCount, messages);
      if (openingResponse) {
        return Response.json(openingResponse);
      }
    }

    const basePrompt = getSystemPrompt(mode, category, fixedAnswer, promptOverride);
    const knowledgeContext =
      mode === "ai-guesses" ? await getKnowledgeContext(category) : "";

    // 위키 조회: ai-guesses 모드에서 턴 6부터 매 3턴마다 실행
    const currentTurn = getActualTurnCount(messages);
    let wikiContext = "";
    if (mode === "ai-guesses" && currentTurn >= 6 && currentTurn % 3 === 0) {
      const searchQuery = extractSearchQuery(messages, category);
      if (searchQuery) {
        const wikiResult = await lookupWiki(searchQuery);
        if (wikiResult) {
          wikiContext = `\n\n[중요: 위키백과 최신 정보 — "${searchQuery}"]\n${wikiResult}\n\n위 정보는 네 학습 데이터보다 최신이다. 네 기존 지식과 위키 정보가 충돌하면 위키 정보를 우선해라. 예를 들어 네가 알던 현직 대통령/수상/리더와 위키 정보가 다르면 위키가 맞다.`;
        }
      }
    }

    const systemPrompt = [basePrompt, knowledgeContext, wikiContext]
      .filter(Boolean)
      .join("\n\n");

    const contents = [
      {
        role: "user",
        parts: [{ text: buildCompressedConversation(mode, messages) }],
      },
    ];

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

    const thinkingConfig = activeThinking === "none" ? {} : { thinkingConfig: { thinkingLevel: activeThinking } };

    // Search Grounding: 게임당 최대 2회 (턴 5=첫 API, 턴 10=중반)
    const GROUNDING_TURNS = [5, 10];
    const useGrounding = searchGrounding && mode === "ai-guesses" && GROUNDING_TURNS.includes(currentTurn);
    const groundingTools = useGrounding ? { tools: [{ googleSearch: {} }] } : {};

    const res = await fetch(getApiUrl(activeModel), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        ...groundingTools,
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: RESPONSE_SCHEMA,
          ...thinkingConfig,
        },
      }),
    }).finally(() => {
      clearTimeout(timeoutId);
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("Gemini API error:", err);
      throw new Error(err);
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      throw new Error("Empty response from Gemini");
    }

    const parsed = JSON.parse(text) as ChatResponse;
    const actualTurnCount = getActualTurnCount(messages);
    const sanitized = sanitizeResponse(
      parsed,
      mode,
      category,
      actualTurnCount,
      hasRecentWrongGuess(messages),
      messages
    );

    return Response.json(sanitized);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Chat API error:", msg);
    return Response.json(
      { error: "봉신의 유리구슬에 금이 갔다... 다시 시도해봐", detail: msg },
      { status: 500 }
    );
  }
}
