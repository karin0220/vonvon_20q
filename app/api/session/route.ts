import { GameMode } from "@/lib/types";
import { recordSessionAndGetStats } from "@/lib/supabase";

type SessionOutcome = "solved" | "failed" | "ai_correct" | "revealed";

interface SessionBody {
  mode: GameMode;
  category: string;
  answer: string;
  outcome: SessionOutcome;
  turnCount: number;
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
    return Response.json({ stats: null }, { status: 400 });
  }

  const stats = await recordSessionAndGetStats(body);
  return Response.json({ stats });
}
