import { getSystemPrompt } from "@/lib/prompts";
import { ChatRequest, ChatResponse } from "@/lib/types";

const API_KEY = process.env.GEMINI_API_KEY || "";
const MODEL = "gemini-3.1-flash-lite-preview";
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
const GEMINI_TIMEOUT_MS = 15000;

// --- 초반 3턴 하드코딩 오프닝 질문 ---
const OPENING_QUESTIONS: Record<string, { messages: string[]; axes: string[] }> = {
  "유명인": {
    messages: [
      "흠... 봉신의 유리구슬에 뭔가가 비친다. 그 인물은 한국인이냐?",
      "좋다. 그 인물은 남자냐?",
      "크흠... 그 인물은 연예인이냐?",
    ],
    axes: ["country", "gender", "occupation"],
  },
  "캐릭터": {
    messages: [
      "흠... 봉신의 유리구슬에 뭔가가 비친다. 그 캐릭터는 일본 애니메이션에 나오는 존재냐?",
      "좋다. 그 캐릭터는 남자냐?",
      "크흠... 그 캐릭터는 주인공이냐?",
    ],
    axes: ["origin", "gender", "role"],
  },
  "영화": {
    messages: [
      "흠... 봉신의 유리구슬에 뭔가가 비친다. 그 영화는 한국 영화냐?",
      "좋다. 그 영화는 액션이냐?",
      "크흠... 그 영화는 2015년 이후에 개봉한 것이냐?",
    ],
    axes: ["country", "genre", "era"],
  },
  "드라마": {
    messages: [
      "흠... 봉신의 유리구슬에 뭔가가 비친다. 그 드라마는 한국 드라마냐?",
      "좋다. 그 드라마는 로맨스냐?",
      "크흠... 그 드라마는 2020년 이후에 방영된 것이냐?",
    ],
    axes: ["country", "genre", "era"],
  },
  "노래": {
    messages: [
      "흠... 봉신의 유리구슬에 뭔가가 비친다. 그 노래는 한국 노래냐?",
      "좋다. 그 노래는 솔로 가수의 곡이냐?",
      "크흠... 그 노래는 2020년 이후에 나온 곡이냐?",
    ],
    axes: ["country", "artist_type", "era"],
  },
};

function getOpeningResponse(category: string, turnIndex: number): ChatResponse | null {
  const data = OPENING_QUESTIONS[category];
  if (!data || turnIndex < 0 || turnIndex >= data.messages.length) return null;
  return {
    message: data.messages[turnIndex],
    responseType: "question",
    isGuess: false,
    guess: null,
    suggestedQuestions: null,
    turnCount: turnIndex,
    isGameOver: false,
    stage: "broad",
    questionAxis: data.axes[turnIndex],
    candidateBucket: "1000+",
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

function buildFallbackQuestion(category: string, turnCount: number): string {
  switch (category) {
    case "유명인":
      if (turnCount <= 3) return "흠... 그 인물은 한국인이냐?";
      if (turnCount <= 6) return "좋다. 그 인물은 남자냐?";
      if (turnCount <= 10) return "봉신의 구슬이 묻는다. 그 인물은 연예인이냐?";
      if (turnCount <= 14) return "크흠... 그 인물은 지금 30대 이하냐?";
      return "자... 그 인물은 TV에 자주 나오는 사람이냐?";
    case "캐릭터":
      if (turnCount <= 3) return "흠... 그 캐릭터는 일본 작품에 나오는 존재냐?";
      if (turnCount <= 6) return "좋다. 그 캐릭터는 주인공이냐?";
      if (turnCount <= 10) return "크흠... 그 캐릭터는 인간형 존재냐?";
      if (turnCount <= 14) return "봉신의 구슬이 묻는다. 그 캐릭터는 특수한 힘을 가졌느냐?";
      return "자... 그 작품은 2010년 이후에 나온 것이냐?";
    case "영화":
      if (turnCount <= 3) return "흠... 그 영화는 한국 영화냐?";
      if (turnCount <= 6) return "좋아. 그 영화는 액션이냐?";
      if (turnCount <= 10) return "크흠... 그 영화는 2015년 이후에 개봉했느냐?";
      if (turnCount <= 14) return "봉신의 구슬이 묻는다. 그 영화에 속편이 있느냐?";
      return "자... 그 영화는 실화를 바탕으로 한 것이냐?";
    case "드라마":
      if (turnCount <= 3) return "흠... 그 드라마는 한국 드라마냐?";
      if (turnCount <= 6) return "좋아. 그 드라마는 로맨스냐?";
      if (turnCount <= 10) return "크흠... 그 드라마는 2020년 이후에 방영됐느냐?";
      if (turnCount <= 14) return "봉신의 구슬이 묻는다. 그 드라마는 넷플릭스에서 볼 수 있느냐?";
      return "자... 그 드라마는 16부작 이상이냐?";
    case "노래":
      if (turnCount <= 3) return "흠... 그 노래는 한국 노래냐?";
      if (turnCount <= 6) return "좋아. 그 노래는 솔로 가수의 곡이냐?";
      if (turnCount <= 10) return "크흠... 그 노래는 2020년 이후에 나온 곡이냐?";
      if (turnCount <= 14) return "봉신의 구슬이 묻는다. 그 노래는 댄스곡이냐?";
      return "자... 그 노래는 남자가 부른 곡이냐?";
    default:
      if (turnCount <= 3) return "흠... 그건 사람이냐?";
      if (turnCount <= 6) return "좋다. 그건 실존하는 것이냐?";
      if (turnCount <= 10) return "봉신의 구슬이 묻는다. 그것은 한국 것이냐?";
      if (turnCount <= 14) return "크흠... 그것은 2010년 이후에 나온 것이냐?";
      return "자... 그것은 사람이 만든 것이냐?";
  }
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
      tooManyChallenges
    ) {
      return {
        ...base,
        message: buildFallbackQuestion(category, actualTurnCount),
        responseType: "question",
        isGuess: false,
        guess: null,
        isGameOver: false,
        stage: actualTurnCount <= 5 ? "broad" : actualTurnCount <= 12 ? "narrow" : "challenge",
        shouldGuessNow: false,
      };
    }
  }

  return base;
}

export async function POST(request: Request) {
  try {
    const body: ChatRequest = await request.json();
    const { mode, category, messages, fixedAnswer, promptOverride } = body;

    // ai-guesses 모드: 초반 3턴은 서버 하드코딩 질문 반환 (API 호출 절약 + 품질 보장)
    if (mode === "ai-guesses") {
      const actualTurnCount = getActualTurnCount(messages);
      const openingResponse = getOpeningResponse(category, actualTurnCount);
      if (openingResponse) {
        return Response.json(openingResponse);
      }
    }

    const systemPrompt = getSystemPrompt(mode, category, fixedAnswer, promptOverride);

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
