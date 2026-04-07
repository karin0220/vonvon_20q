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
  { id: "celebrity", label: "연예인", icon: "Sparkles" },
  { id: "anime", label: "애니 캐릭터", icon: "ChessKing" },
  { id: "mbti", label: "MBTI", icon: "Brain" },
  { id: "food", label: "음식", icon: "UtensilsCrossed" },
  { id: "animal", label: "동물", icon: "PawPrint" },
  { id: "movie", label: "영화", icon: "Clapperboard" },
] as const;
