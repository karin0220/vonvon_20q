export type GameMode = "ai-guesses" | "user-guesses";

export interface ChatMessage {
  role: "bongshin" | "user";
  content: string;
  suggestedQuestions?: string[];
  isGuess?: boolean;
  isCorrect?: boolean;
}

export interface ChatRequest {
  mode: GameMode;
  category: string;
  messages: { role: "user" | "model"; content: string }[];
  fixedAnswer?: string;
}

export interface ChatResponse {
  message: string;
  isGuess: boolean;
  guess: string | null;
  suggestedQuestions: string[] | null;
  turnCount: number;
  isGameOver: boolean;
}

export const CATEGORIES = [
  { id: "famous", label: "유명인", icon: "Sparkles" },
  { id: "anime", label: "애니 캐릭터", icon: "ChessKing" },
  { id: "object", label: "사물", icon: "Box" },
  { id: "animal", label: "동물", icon: "PawPrint" },
  { id: "movie", label: "영화/드라마", icon: "Clapperboard" },
] as const;

// 오늘의 주제: 날짜 기반으로 매일 다른 카테고리
export function getDailyCategory(): string {
  const today = new Date();
  const seed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
  const index = seed % CATEGORIES.length;
  return CATEGORIES[index].label;
}
