import { GameMode } from "@/lib/types";
import { recordSessionAndGetStats, getCategoryAvgTurns } from "@/lib/supabase";

type SessionOutcome = "solved" | "failed" | "ai_correct" | "revealed";

interface ConversationMessage {
  role: "bongshin" | "user";
  content: string;
  type?: string;
}

interface SessionBody {
  mode: GameMode;
  category: string;
  answer: string;
  outcome: SessionOutcome;
  turnCount: number;
  conversation?: ConversationMessage[];
}

export async function POST(request: Request) {
  const body = (await request.json()) as SessionBody;

  if (
    !body.mode ||
    !body.category ||
    !body.answer ||
    !body.outcome ||
    typeof body.turnCount !== "number"
  ) {
    return Response.json({ stats: null, sessionId: null }, { status: 400 });
  }

  const [result, categoryAvgTurns] = await Promise.all([
    recordSessionAndGetStats(body),
    getCategoryAvgTurns(body.category, body.mode),
  ]);
  return Response.json({ ...result, categoryAvgTurns });
}
