import { getSystemPrompt } from "@/lib/prompts";
import { ChatRequest, ChatResponse } from "@/lib/types";

const API_KEY = process.env.GEMINI_API_KEY || "";
const MODEL = "gemini-3.1-flash-lite-preview";
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
const GEMINI_TIMEOUT_MS = 15000;

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

function getThinkingLevel(mode: ChatRequest["mode"]) {
  return mode === "ai-guesses" ? "medium" : "low";
}

function getActualTurnCount(messages: ChatRequest["messages"]) {
  return Math.max(
    0,
    messages.filter((message) => message.role === "user").length - 1
  );
}

function hasRecentWrongGuess(messages: ChatRequest["messages"]) {
  const recentUserMessages = messages
    .filter((message) => message.role === "user")
    .slice(-3)
    .map((message) => message.content);

  return recentUserMessages.some((content) =>
    content.startsWith("아니, 틀렸어. 다시 시도해봐.")
  );
}

function buildFallbackQuestion(category: string, turnCount: number): string {
  const broadTurn = Math.min(turnCount, 6);

  switch (category) {
    case "영화/드라마":
      if (broadTurn <= 2) return "흠... 먼저 크게 나눠 보자. 그 작품은 한국 작품이냐?";
      if (broadTurn <= 4) return "좋아. 그 작품은 드라마냐?";
      return "크흠... 시대를 가르겠다. 그 작품은 2020년대에 나온 작품이냐?";
    case "유명인":
      if (broadTurn <= 2) return "흠... 그 대상은 실존 인물이냐?";
      if (broadTurn <= 4) return "좋다. 그 인물은 한국인이냐?";
      return "봉신의 구슬이 묻는다. 그 인물은 지금도 생존해 있느냐?";
    case "애니 캐릭터":
      if (broadTurn <= 2) return "흠... 그 캐릭터는 일본 작품에 나오는 존재냐?";
      if (broadTurn <= 4) return "좋다. 그 캐릭터는 주인공이냐?";
      return "크흠... 그 캐릭터는 인간형 존재냐?";
    case "사물":
      if (broadTurn <= 2) return "흠... 그 사물은 전자제품이냐?";
      if (broadTurn <= 4) return "좋다. 그건 손으로 들고 쓰는 물건이냐?";
      return "봉신의 구슬이 말하길... 그 물건은 집 안에서 주로 쓰이느냐?";
    case "동물":
      if (broadTurn <= 2) return "흠... 그 동물은 포유류냐?";
      if (broadTurn <= 4) return "좋다. 그 동물은 사람이 흔히 반려동물로 기르느냐?";
      return "크흠... 그 동물은 성체가 사람보다 크냐?";
    default:
      if (broadTurn <= 2) return "흠... 그건 사람이냐?";
      if (broadTurn <= 4) return "좋다. 그건 작품이냐?";
      return "봉신의 구슬이 묻는다. 그것은 현실에 실존하느냐?";
  }
}

function getGuidedSuggestions(category: string, turnCount: number): string[] {
  const phase = turnCount <= 4 ? "early" : turnCount <= 10 ? "mid" : "late";

  if (category.includes("영화") || category.includes("드라마")) {
    if (phase === "early") {
      return [
        "먼저 매체부터 갈까? 영화야?",
        "국가 축으로 좁혀볼까? 한국 작품이야?",
        "시대부터 물어볼까? 2020년 이후 작품이야?",
        "원작 여부부터 볼까? 원작이 있는 작품이야?",
      ];
    }
    if (phase === "mid") {
      return [
        "장르로 좁혀볼까? 코미디 요소가 강한 편이야?",
        "형식으로 갈까? 시리즈물로 먼저 알려진 작품이야?",
        "대상층을 볼까? 가족이 함께 보기 편한 작품이야?",
        "분위기로 좁혀볼까? 전체적으로 밝은 톤이야?",
      ];
    }
    return [
      "인지도로 더 좁혀볼까? 제목을 들으면 대부분 바로 아는 작품이야?",
      "흥행 축으로 갈까? 개봉 당시 크게 화제가 된 편이야?",
      "캐릭터성으로 볼까? 주인공 한 명의 이미지가 특히 강한 작품이야?",
      "현실감으로 좁혀볼까? 판타지 요소가 거의 없는 작품이야?",
    ];
  }

  if (category.includes("유명인")) {
    if (phase === "early") {
      return [
        "먼저 활동 분야부터 갈까? 연예인 쪽이야?",
        "시대 축으로 좁혀볼까? 지금도 활발히 활동 중이야?",
        "국가로 먼저 나눠볼까? 한국인 이야?",
        "대중 노출 방식으로 갈까? TV보다 온라인에서 더 익숙한 편이야?",
      ];
    }
    if (phase === "mid") {
      return [
        "직업군을 더 좁혀볼까? 배우 쪽이야?",
        "팀 여부를 물어볼까? 그룹 활동으로 먼저 알려졌어?",
        "세대감으로 갈까? 10대도 바로 알아볼 만큼 요즘 유명해?",
        "영역을 좁혀볼까? 스포츠 분야 인물이야?",
      ];
    }
    return [
      "대표 이미지로 갈까? 예능보다 본업 이미지가 더 강해?",
      "커리어 축으로 좁혀볼까? 데뷔한 지 10년이 넘었어?",
      "화제성으로 갈까? 최근 1~2년 안에도 크게 언급됐어?",
      "대중성으로 더 좁혀볼까? 이름만 들어도 거의 다 아는 급이야?",
    ];
  }

  if (category.includes("애니")) {
    if (phase === "early") {
      return [
        "먼저 작품 축으로 갈까? 일본 작품 캐릭터야?",
        "역할로 좁혀볼까? 주인공 쪽이야?",
        "형태부터 물어볼까? 인간형 캐릭터야?",
        "시대로 나눠볼까? 2010년 이후 작품에서 더 익숙한 캐릭터야?",
      ];
    }
    if (phase === "mid") {
      return [
        "분위기로 갈까? 진지한 작품보다 가벼운 작품 쪽이야?",
        "능력 유무를 볼까? 특별한 능력이나 기술이 핵심이야?",
        "소속으로 좁혀볼까? 팀이나 조직 이미지가 강해?",
        "인지도로 갈까? 애니를 잘 모르는 사람도 본 적 있는 캐릭터야?",
      ];
    }
    return [
      "외형 특징으로 갈까? 한눈에 떠오르는 상징 요소가 있어?",
      "성격 축으로 좁혀볼까? 밝고 장난스러운 타입이야?",
      "비중으로 갈까? 작품 전체를 끌고 가는 중심 캐릭터야?",
      "밈이나 굿즈로 볼까? 캐릭터 자체 상품성이 특히 큰 편이야?",
    ];
  }

  if (category.includes("동물")) {
    if (phase === "early") {
      return [
        "먼저 큰 분류로 갈까? 포유류야?",
        "생활권으로 좁혀볼까? 육지에서 주로 사는 동물이야?",
        "친숙함으로 갈까? 반려동물로 흔한 편이야?",
        "크기로 나눠볼까? 사람보다 작은 편이야?",
      ];
    }
    if (phase === "mid") {
      return [
        "먹이 습성으로 갈까? 초식동물이야?",
        "활동 시간으로 좁혀볼까? 야행성 이미지가 강해?",
        "서식 환경을 볼까? 물가나 바다와 더 가깝게 느껴져?",
        "대중성으로 갈까? 동물원에서 자주 보는 편이야?",
      ];
    }
    return [
      "외형 특징으로 좁혀볼까? 귀나 꼬리 이미지가 특히 강해?",
      "움직임으로 갈까? 빠르게 달리는 이미지가 강해?",
      "인식 축으로 볼까? 귀엽다기보다 무섭다는 반응이 많아?",
      "상징성으로 좁혀볼까? 특정 나라나 지역의 대표 동물 느낌이야?",
    ];
  }

  if (category.includes("물건")) {
    if (phase === "early") {
      return [
        "먼저 전자기기 쪽인지 물어볼까? 전기를 써?",
        "장소로 좁혀볼까? 집 안에서 더 자주 보는 물건이야?",
        "사용 방식으로 갈까? 손에 들고 쓰는 편이야?",
        "빈도로 나눠볼까? 거의 매일 쓰는 물건이야?",
      ];
    }
    if (phase === "mid") {
      return [
        "용도로 좁혀볼까? 생활 편의를 위한 물건이야?",
        "크기로 갈까? 책상 위에 올려둘 수 있는 정도야?",
        "휴대성으로 물어볼까? 밖에 들고 다니는 경우가 많아?",
        "공간 축으로 좁혀볼까? 주방에서 자주 보는 물건이야?",
      ];
    }
    return [
      "재질감으로 갈까? 단단한 플라스틱이나 금속 느낌이 강해?",
      "가격대로 좁혀볼까? 없어도 당장 큰일 나진 않는 물건이야?",
      "전용성으로 물어볼까? 특정 상황에서만 꺼내 쓰는 편이야?",
      "대체 가능성으로 갈까? 다른 물건으로 쉽게 대체되기 어려워?",
    ];
  }

  if (phase === "early") {
    return [
      "먼저 큰 범주부터 나눠볼까? 사람 쪽이야?",
      "익숙함으로 갈까? 일상에서 자주 접하는 편이야?",
      "시대 축으로 좁혀볼까? 요즘 더 자주 떠오르는 대상이야?",
      "공간 축으로 나눠볼까? 실내에서 더 자주 보는 편이야?",
    ];
  }
  if (phase === "mid") {
    return [
      "용도나 역할부터 더 좁혀볼까?",
      "크기나 범위로 나눠볼까?",
      "대중성으로 갈까? 대부분 바로 아는 대상이야?",
      "요즘 기준으로 더 익숙한 편인지 물어볼까?",
    ];
  }
  return [
    "대표 특징 하나를 먼저 떠올리게 하는 질문을 해볼까?",
    "비슷한 대상과 갈리는 차이점부터 물어볼까?",
    "일상성보다 상징성 쪽이 큰지 물어볼까?",
    "지금쯤은 꽤 좁혀졌는지 확인하는 질문을 해볼까?",
  ];
}

function sanitizeResponse(
  parsed: ChatResponse,
  mode: ChatRequest["mode"],
  category: string,
  actualTurnCount: number,
  hadRecentWrongGuess: boolean
): ChatResponse {
  const responseType =
    parsed.responseType ?? (parsed.isGuess ? "challenge" : parsed.isGameOver ? "result" : "question");

  const base: ChatResponse = {
    message: parsed.message,
    responseType,
    isGuess: responseType === "challenge" || parsed.isGuess,
    guess: parsed.guess ?? null,
    suggestedQuestions: mode === "user-guesses" ? getGuidedSuggestions(category, actualTurnCount) : null,
    turnCount: actualTurnCount,
    isGameOver: parsed.isGameOver,
    stage: parsed.stage ?? (responseType === "challenge" ? "challenge" : responseType === "result" ? "result" : actualTurnCount <= 5 ? "broad" : "narrow"),
    questionAxis: parsed.questionAxis ?? null,
    candidateBucket: parsed.candidateBucket ?? null,
    shouldGuessNow: parsed.shouldGuessNow ?? responseType === "challenge",
    guessReasonShort: parsed.guessReasonShort ?? null,
  };

  if (mode === "ai-guesses") {
    const challengeTooEarly = actualTurnCount < 8 && responseType === "challenge";
    const challengeWithoutEnoughCandidates =
      responseType === "challenge" &&
      !["2-9", "1"].includes(base.candidateBucket ?? "");
    const challengeDuringCooldown = hadRecentWrongGuess && responseType === "challenge";
    const challengeWithoutGuess = responseType === "challenge" && !base.guess;

    if (
      challengeTooEarly ||
      challengeWithoutEnoughCandidates ||
      challengeDuringCooldown ||
      challengeWithoutGuess
    ) {
      return {
        ...base,
        message: buildFallbackQuestion(category, actualTurnCount),
        responseType: "question",
        isGuess: false,
        guess: null,
        isGameOver: false,
        stage: actualTurnCount <= 5 ? "broad" : "narrow",
        shouldGuessNow: false,
      };
    }
  }

  return base;
}

export async function POST(request: Request) {
  try {
    const body: ChatRequest = await request.json();
    const { mode, category, messages, fixedAnswer } = body;

    const systemPrompt = getSystemPrompt(mode, category, fixedAnswer);

    const contents = messages.map((m) => ({
      role: m.role,
      parts: [{ text: m.content }],
    }));

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: RESPONSE_SCHEMA,
          thinkingConfig: {
            thinkingLevel: getThinkingLevel(mode),
          },
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
      hasRecentWrongGuess(messages)
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
