import { GameMode, KnowledgeStats, RecentPlayItem } from "./types";

type SessionOutcome = "solved" | "failed" | "ai_correct" | "revealed";

interface SessionRecordInput {
  mode: GameMode;
  category: string;
  answer: string;
  outcome: SessionOutcome;
  turnCount: number;
}

interface KnowledgeRow {
  category: string;
  normalized_answer: string;
  answer: string;
  total_sessions: number;
  user_guess_plays: number;
  user_guess_wins: number;
  user_guess_total_turns: number;
  ai_guess_plays: number;
  ai_guess_successes: number;
  last_played_at: string | null;
  updated_at?: string;
}

interface SessionRow {
  answer: string;
  category: string;
  mode: GameMode;
  created_at: string;
}

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";

function getHeaders(extra?: HeadersInit) {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

export function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY);
}

export function normalizeAnswer(answer: string) {
  return answer
    .trim()
    .toLowerCase()
    .replace(/["'`]/g, "")
    .replace(/\s+/g, " ");
}

async function supabaseRest<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase env vars are not configured");
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: getHeaders(init?.headers),
    cache: "no-store",
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(detail || "Supabase REST request failed");
  }

  if (res.status === 204) {
    return null as T;
  }

  return (await res.json()) as T;
}

function mapKnowledgeRow(row: KnowledgeRow): KnowledgeStats {
  return {
    category: row.category,
    normalizedAnswer: row.normalized_answer,
    answer: row.answer,
    totalSessions: row.total_sessions,
    userGuessPlays: row.user_guess_plays,
    userGuessWins: row.user_guess_wins,
    userGuessAvgTurns:
      row.user_guess_wins > 0
        ? Number((row.user_guess_total_turns / row.user_guess_wins).toFixed(1))
        : null,
    aiGuessPlays: row.ai_guess_plays,
    aiGuessSuccesses: row.ai_guess_successes,
    lastPlayedAt: row.last_played_at,
  };
}

export async function listRecentPlayItems(limit = 24): Promise<RecentPlayItem[]> {
  if (!isSupabaseConfigured()) return [];

  const rows = await supabaseRest<SessionRow[]>(
    `game_sessions?select=answer,category,mode,created_at&order=created_at.desc&limit=${limit}`
  );

  return rows.map((row) => ({
    answer: row.answer,
    category: row.category,
    mode: row.mode,
    createdAt: row.created_at,
  }));
}

export async function getKnowledgeStats(
  category: string,
  answer: string
): Promise<KnowledgeStats | null> {
  const row = await getKnowledgeRow(category, answer);
  return row ? mapKnowledgeRow(row) : null;
}

async function getKnowledgeRow(
  category: string,
  answer: string
): Promise<KnowledgeRow | null> {
  if (!isSupabaseConfigured()) return null;

  const normalized = normalizeAnswer(answer);
  const rows = await supabaseRest<KnowledgeRow[]>(
    `answer_knowledge?select=category,normalized_answer,answer,total_sessions,user_guess_plays,user_guess_wins,user_guess_total_turns,ai_guess_plays,ai_guess_successes,last_played_at&category=eq.${encodeURIComponent(
      category
    )}&normalized_answer=eq.${encodeURIComponent(normalized)}&limit=1`
  );

  return rows.length ? rows[0] : null;
}

export async function getKnowledgeContext(
  category: string,
  limit = 12
): Promise<string> {
  if (!isSupabaseConfigured()) return "";

  const query =
    category === "전체"
      ? `answer_knowledge?select=category,answer,total_sessions&order=total_sessions.desc,last_played_at.desc&limit=${limit}`
      : `answer_knowledge?select=category,answer,total_sessions&category=eq.${encodeURIComponent(
          category
        )}&order=total_sessions.desc,last_played_at.desc&limit=${limit}`;

  const rows = await supabaseRest<
    { category: string; answer: string; total_sessions: number }[]
  >(query);

  if (!rows.length) return "";

  const items = rows
    .map((row) =>
      category === "전체"
        ? `- ${row.category}: ${row.answer} (${row.total_sessions}회)`
        : `- ${row.answer} (${row.total_sessions}회)`
    )
    .join("\n");

  return `실제 유저 플레이 기반 참고 후보 목록이다. 단, 여기에 과하게 집착하지 말고 질문 흐름을 우선해라.\n${items}`;
}

export async function recordSessionAndGetStats(
  input: SessionRecordInput
): Promise<KnowledgeStats | null> {
  if (!isSupabaseConfigured()) return null;

  const answer = input.answer.trim();
  const normalized = normalizeAnswer(answer);
  const now = new Date().toISOString();

  await supabaseRest("game_sessions", {
    method: "POST",
    body: JSON.stringify({
      mode: input.mode,
      category: input.category,
      answer,
      normalized_answer: normalized,
      outcome: input.outcome,
      turn_count: input.turnCount,
    }),
    headers: {
      Prefer: "return=minimal",
    },
  });

  const currentRow = await getKnowledgeRow(input.category, answer);

  const nextRow: KnowledgeRow = {
    category: input.category,
    normalized_answer: normalized,
    answer,
    total_sessions: (currentRow?.total_sessions ?? 0) + 1,
    user_guess_plays:
      (currentRow?.user_guess_plays ?? 0) + (input.mode === "user-guesses" ? 1 : 0),
    user_guess_wins:
      (currentRow?.user_guess_wins ?? 0) + (input.outcome === "solved" ? 1 : 0),
    user_guess_total_turns:
      (currentRow?.user_guess_total_turns ?? 0) +
      (input.outcome === "solved" ? input.turnCount : 0),
    ai_guess_plays:
      (currentRow?.ai_guess_plays ?? 0) + (input.mode === "ai-guesses" ? 1 : 0),
    ai_guess_successes:
      (currentRow?.ai_guess_successes ?? 0) + (input.outcome === "ai_correct" ? 1 : 0),
    last_played_at: now,
    updated_at: now,
  };

  const rows = await supabaseRest<KnowledgeRow[]>(
    "answer_knowledge?on_conflict=category,normalized_answer",
    {
      method: "POST",
      body: JSON.stringify(nextRow),
      headers: {
        Prefer: "resolution=merge-duplicates,return=representation",
      },
    }
  );

  return rows.length ? mapKnowledgeRow(rows[0]) : null;
}
