import { nanoid } from "nanoid";
import { GameMode, KnowledgeStats, RecentPlayItem } from "./types";

type SessionOutcome = "solved" | "failed" | "ai_correct" | "revealed";

interface ConversationMessage {
  role: "bongshin" | "user";
  content: string;
  type?: string;
}

interface SessionRecordInput {
  mode: GameMode;
  category: string;
  answer: string;
  outcome: SessionOutcome;
  turnCount: number;
  conversation?: ConversationMessage[];
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
  ai_guess_total_turns: number;
  last_played_at: string | null;
  updated_at?: string;
}

interface SessionRow {
  answer: string;
  category: string;
  mode: GameMode;
  turn_count: number;
  created_at: string;
}

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
const KNOWLEDGE_CONTEXT_CACHE_TTL_MS = 60_000;
const knowledgeContextCache = new Map<
  string,
  { value: string; expiresAt: number }
>();

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
    aiGuessAvgTurns:
      row.ai_guess_successes > 0
        ? Number((row.ai_guess_total_turns / row.ai_guess_successes).toFixed(1))
        : null,
    lastPlayedAt: row.last_played_at,
  };
}

export async function listRecentPlayItems(limit = 24): Promise<RecentPlayItem[]> {
  if (!isSupabaseConfigured()) return [];

  const rows = await supabaseRest<SessionRow[]>(
    `game_sessions?select=answer,category,mode,turn_count,created_at&outcome=in.(solved,ai_correct)&order=created_at.desc&limit=${limit}`
  );

  return rows.map((row) => ({
    answer: row.answer,
    category: row.category,
    mode: row.mode,
    turnCount: row.turn_count,
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

export async function getCategoryAvgTurns(
  category: string,
  mode: "user-guesses" | "ai-guesses"
): Promise<number | null> {
  if (!isSupabaseConfigured()) return null;

  const outcome = mode === "user-guesses" ? "solved" : "ai_correct";
  // 카테고리 내 전체 answer_knowledge 행을 합산
  const catFilter = category === "전체" ? "" : `&category=eq.${encodeURIComponent(category)}`;
  const rows = await supabaseRest<KnowledgeRow[]>(
    `answer_knowledge?select=user_guess_wins,user_guess_total_turns,ai_guess_successes,ai_guess_total_turns${catFilter}`
  );

  if (!rows.length) return null;

  let totalWins = 0;
  let totalTurns = 0;
  for (const row of rows) {
    if (mode === "user-guesses") {
      totalWins += row.user_guess_wins;
      totalTurns += row.user_guess_total_turns;
    } else {
      totalWins += row.ai_guess_successes;
      totalTurns += row.ai_guess_total_turns;
    }
  }

  return totalWins > 0 ? Number((totalTurns / totalWins).toFixed(1)) : null;
}

export async function getKnowledgeContext(
  category: string,
  limit = 12
): Promise<string> {
  if (!isSupabaseConfigured()) return "";

  const cacheKey = `${category}:${limit}`;
  const cached = knowledgeContextCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const query =
    category === "전체"
      ? `answer_knowledge?select=category,answer,total_sessions&order=total_sessions.desc,last_played_at.desc&limit=${limit}`
      : `answer_knowledge?select=category,answer,total_sessions&category=eq.${encodeURIComponent(
          category
        )}&order=total_sessions.desc,last_played_at.desc&limit=${limit}`;

  const rows = await supabaseRest<
    { category: string; answer: string; total_sessions: number }[]
  >(query);

  if (!rows.length) {
    knowledgeContextCache.set(cacheKey, {
      value: "",
      expiresAt: Date.now() + KNOWLEDGE_CONTEXT_CACHE_TTL_MS,
    });
    return "";
  }

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
): Promise<{ stats: KnowledgeStats | null; sessionId: string | null }> {
  if (!isSupabaseConfigured()) return { stats: null, sessionId: null };

  const answer = input.answer.trim();
  const normalized = normalizeAnswer(answer);
  const now = new Date().toISOString();

  const sessionId = nanoid(8);

  await supabaseRest("game_sessions", {
    method: "POST",
    body: JSON.stringify({
      session_id: sessionId,
      mode: input.mode,
      category: input.category,
      answer,
      normalized_answer: normalized,
      outcome: input.outcome,
      turn_count: input.turnCount,
      conversation: input.conversation ?? null,
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
    ai_guess_total_turns:
      (currentRow?.ai_guess_total_turns ?? 0) +
      (input.outcome === "ai_correct" ? input.turnCount : 0),
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

  const stats = rows.length ? mapKnowledgeRow(rows[0]) : null;
  return { stats, sessionId };
}

// --- 관리자 설정 (전역, Supabase 저장) ---

export interface AdminGameSettings {
  model: string;       // ModelId | ""
  thinking: string;    // ThinkingLevel | ""
  searchGrounding: boolean;
}

const ADMIN_CONFIG_KEY = "game_settings";
const adminConfigCache: { value: AdminGameSettings | null; expiresAt: number } = {
  value: null,
  expiresAt: 0,
};
const ADMIN_CONFIG_CACHE_TTL_MS = 10_000; // 10초 캐시

export async function getAdminConfig(): Promise<AdminGameSettings> {
  const defaults: AdminGameSettings = { model: "", thinking: "", searchGrounding: false };
  if (!isSupabaseConfigured()) return defaults;

  const now = Date.now();
  if (adminConfigCache.value && now < adminConfigCache.expiresAt) {
    return adminConfigCache.value;
  }

  try {
    const rows = await supabaseRest<{ key: string; value: AdminGameSettings }[]>(
      `admin_config?key=eq.${ADMIN_CONFIG_KEY}&select=key,value`
    );
    const result = rows.length ? { ...defaults, ...rows[0].value } : defaults;
    adminConfigCache.value = result;
    adminConfigCache.expiresAt = now + ADMIN_CONFIG_CACHE_TTL_MS;
    return result;
  } catch (e) {
    console.error("Failed to load admin config:", e);
    return defaults;
  }
}

export async function setAdminConfig(settings: AdminGameSettings): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  try {
    await supabaseRest(
      `admin_config?key=eq.${ADMIN_CONFIG_KEY}`,
      {
        method: "PATCH",
        body: JSON.stringify({ value: settings, updated_at: new Date().toISOString() }),
        headers: { Prefer: "return=minimal" },
      }
    );
    // 캐시 즉시 갱신
    adminConfigCache.value = settings;
    adminConfigCache.expiresAt = Date.now() + ADMIN_CONFIG_CACHE_TTL_MS;
    return true;
  } catch (e) {
    console.error("Failed to save admin config:", e);
    return false;
  }
}

// --- 프롬프트 오버라이드 (전역, Supabase 저장) ---

export type PromptOverrides = Partial<Record<string, string>>; // { "ai-guesses": "...", "user-guesses": "..." }

const PROMPT_OVERRIDES_KEY = "prompt_overrides";
const promptOverridesCache: { value: PromptOverrides | null; expiresAt: number } = {
  value: null,
  expiresAt: 0,
};

export async function getPromptOverrides(): Promise<PromptOverrides> {
  if (!isSupabaseConfigured()) return {};

  const now = Date.now();
  if (promptOverridesCache.value !== null && now < promptOverridesCache.expiresAt) {
    return promptOverridesCache.value;
  }

  try {
    const rows = await supabaseRest<{ key: string; value: PromptOverrides }[]>(
      `admin_config?key=eq.${PROMPT_OVERRIDES_KEY}&select=key,value`
    );
    const result = rows.length ? rows[0].value ?? {} : {};
    promptOverridesCache.value = result;
    promptOverridesCache.expiresAt = now + ADMIN_CONFIG_CACHE_TTL_MS;
    return result;
  } catch (e) {
    console.error("Failed to load prompt overrides:", e);
    return {};
  }
}

export async function setPromptOverrides(overrides: PromptOverrides): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  try {
    await supabaseRest(
      `admin_config?key=eq.${PROMPT_OVERRIDES_KEY}`,
      {
        method: "PATCH",
        body: JSON.stringify({ value: overrides, updated_at: new Date().toISOString() }),
        headers: { Prefer: "return=minimal" },
      }
    );
    promptOverridesCache.value = overrides;
    promptOverridesCache.expiresAt = Date.now() + ADMIN_CONFIG_CACHE_TTL_MS;
    return true;
  } catch (e) {
    console.error("Failed to save prompt overrides:", e);
    return false;
  }
}

// --- 질문 트리 오버라이드 (Supabase 저장) ---
// 형식: { "카테고리": { "turn:path": { q, axis, yes, no } } }
export type QuestionTreeOverrides = Record<string, Record<string, { q: string; axis: string; yes: string; no: string }>>;

const QUESTION_TREE_KEY = "question_tree";
const questionTreeCache: { value: QuestionTreeOverrides | null; expiresAt: number } = {
  value: null,
  expiresAt: 0,
};

export async function getQuestionTree(): Promise<QuestionTreeOverrides> {
  if (!isSupabaseConfigured()) return {};

  const now = Date.now();
  if (questionTreeCache.value !== null && now < questionTreeCache.expiresAt) {
    return questionTreeCache.value;
  }

  try {
    const rows = await supabaseRest<{ key: string; value: QuestionTreeOverrides }[]>(
      `admin_config?key=eq.${QUESTION_TREE_KEY}&select=key,value`
    );
    const result = rows.length ? rows[0].value ?? {} : {};
    questionTreeCache.value = result;
    questionTreeCache.expiresAt = now + ADMIN_CONFIG_CACHE_TTL_MS;
    return result;
  } catch (e) {
    console.error("Failed to load question tree:", e);
    return {};
  }
}
