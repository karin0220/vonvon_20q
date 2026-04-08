import { getKnowledgeStats } from "@/lib/supabase";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");
  const answer = searchParams.get("answer");

  if (!category || !answer) {
    return Response.json({ stats: null }, { status: 400 });
  }

  const stats = await getKnowledgeStats(category, answer);
  return Response.json({ stats });
}
