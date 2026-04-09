export type GameMode = "ai-guesses" | "user-guesses";
export type BongshinResponseType = "question" | "challenge" | "result";

export interface ChatMessage {
  role: "bongshin" | "user";
  content: string;
  suggestedQuestions?: string[];
  isGuess?: boolean;
  isCorrect?: boolean;
  responseType?: BongshinResponseType;
  debugFacts?: string;
  debugTurnInstruction?: string;
}

export const AVAILABLE_MODELS = [
  "gemini-3.1-flash-lite-preview",
  "gemini-3-flash-preview",
  "gemini-2.5-flash-lite",
] as const;

export const THINKING_LEVELS = ["none", "low", "medium", "high"] as const;

export type ModelId = (typeof AVAILABLE_MODELS)[number];
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export interface ChatRequest {
  mode: GameMode;
  category: string;
  messages: { role: "user" | "model"; content: string; responseType?: BongshinResponseType }[];
  fixedAnswer?: string;
  promptOverride?: string;
  modelOverride?: ModelId;
  thinkingOverride?: ThinkingLevel;
  searchGrounding?: boolean;
}

export interface ChatResponse {
  message: string;
  isGuess: boolean;
  guess: string | null;
  suggestedQuestions: string[] | null;
  turnCount: number;
  isGameOver: boolean;
  responseType?: BongshinResponseType;
  stage?: "broad" | "narrow" | "challenge" | "result";
  questionAxis?: string | null;
  candidateBucket?: "1000+" | "100-999" | "10-99" | "2-9" | "1" | null;
  shouldGuessNow?: boolean;
  guessReasonShort?: string | null;
}

export interface KnowledgeStats {
  category: string;
  normalizedAnswer: string;
  answer: string;
  totalSessions: number;
  userGuessPlays: number;
  userGuessWins: number;
  userGuessAvgTurns: number | null;
  aiGuessPlays: number;
  aiGuessSuccesses: number;
  aiGuessAvgTurns: number | null;
  lastPlayedAt: string | null;
}

export interface RecentPlayItem {
  answer: string;
  category: string;
  mode: GameMode;
  turnCount: number;
  createdAt: string;
}

export const CATEGORIES = [
  { id: "famous", label: "유명인", icon: "Sparkles" },
  { id: "character", label: "캐릭터", icon: "Wand2" },
  { id: "movie", label: "영화", icon: "Clapperboard" },
  { id: "drama", label: "드라마", icon: "Tv" },
  { id: "song", label: "노래", icon: "Music" },
] as const;

// 오늘의 주제: 날짜 기반으로 매일 다른 카테고리
export function getDailyCategory(): string {
  const today = new Date();
  const seed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
  const index = seed % CATEGORIES.length;
  return CATEGORIES[index].label;
}
