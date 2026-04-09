import { getAdminConfig, setAdminConfig, AdminGameSettings } from "@/lib/supabase";

export async function GET() {
  const config = await getAdminConfig();
  return Response.json(config);
}

export async function POST(request: Request) {
  try {
    const body: AdminGameSettings = await request.json();
    const ok = await setAdminConfig(body);
    if (!ok) {
      return Response.json({ error: "저장 실패" }, { status: 500 });
    }
    return Response.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
