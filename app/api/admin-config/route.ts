import {
  getAdminConfig, setAdminConfig, AdminGameSettings,
  getPromptOverrides, setPromptOverrides, PromptOverrides,
} from "@/lib/supabase";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");

  if (type === "prompts") {
    const overrides = await getPromptOverrides();
    return Response.json(overrides);
  }

  const config = await getAdminConfig();
  return Response.json(config);
}

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type");

    if (type === "prompts") {
      const body: PromptOverrides = await request.json();
      const ok = await setPromptOverrides(body);
      if (!ok) return Response.json({ error: "저장 실패" }, { status: 500 });
      return Response.json({ ok: true });
    }

    const body: AdminGameSettings = await request.json();
    const ok = await setAdminConfig(body);
    if (!ok) return Response.json({ error: "저장 실패" }, { status: 500 });
    return Response.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
