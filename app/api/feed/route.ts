import { listRecentPlayItems } from "@/lib/supabase";

export async function GET() {
  const items = await listRecentPlayItems();
  return Response.json({ items });
}
