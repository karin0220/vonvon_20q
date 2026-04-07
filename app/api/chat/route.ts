import { getSystemPrompt } from "@/lib/prompts";
import { ChatRequest, ChatResponse } from "@/lib/types";

const API_KEY = process.env.GEMINI_API_KEY || "";
const MODEL = "gemini-3.1-flash-lite-preview";
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

export async function POST(request: Request) {
  try {
    const body: ChatRequest = await request.json();
    const { mode, category, messages } = body;

    const systemPrompt = getSystemPrompt(mode, category);

    const contents = messages.map((m) => ({
      role: m.role,
      parts: [{ text: m.content }],
    }));

    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
      }),
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

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return Response.json(
        { error: "Invalid response format", detail: text },
        { status: 500 }
      );
    }

    const parsed: ChatResponse = JSON.parse(jsonMatch[0]);
    return Response.json(parsed);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Chat API error:", msg);
    return Response.json(
      { error: "봉신의 유리구슬에 금이 갔다... 다시 시도해봐", detail: msg },
      { status: 500 }
    );
  }
}
