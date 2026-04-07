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
