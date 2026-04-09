"use client";

import { useState, useRef, useEffect, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Image from "next/image";
import { BongshinResponseType, ChatMessage, ChatResponse, GameMode, KnowledgeStats, AVAILABLE_MODELS, THINKING_LEVELS, ModelId, ThinkingLevel } from "@/lib/types";
import { getDefaultPromptTemplate, getSystemPrompt } from "@/lib/prompts";

// 카테고리별 고정 질문 세트 (3세트 × 3문항) — 순서대로 노출, 겹침 없음
const SUGGESTED_SETS: Record<string, string[][]> = {
  "유명인": [
    ["한국인이야?", "남자야?", "연예인이야?"],
    ["지금 살아있는 사람이야?", "가수야?", "30대 이상이야?"],
    ["해외에서도 유명해?", "배우야?", "최근에 활동 중이야?"],
  ],
  "캐릭터": [
    ["일본 애니 캐릭터야?", "남자야?", "주인공이야?"],
    ["인간 캐릭터야?", "액션 작품이야?", "2010년 이후 작품이야?"],
    ["초능력이 있어?", "학생이야?", "한국 작품이야?"],
  ],
  "영화": [
    ["한국 영화야?", "액션이야?", "2015년 이후 개봉작이야?"],
    ["실화 기반이야?", "주인공이 남자야?", "속편이 있어?"],
    ["코미디야?", "수상작이야?", "애니메이션이야?"],
  ],
  "드라마": [
    ["한국 드라마야?", "로맨스야?", "2020년 이후 작품이야?"],
    ["지상파 드라마야?", "주인공이 남자야?", "16부작 이상이야?"],
    ["판타지야?", "시즌제야?", "원작이 있어?"],
  ],
  "노래": [
    ["한국 노래야?", "남자가 불렀어?", "댄스곡이야?"],
    ["솔로 가수가 불렀어?", "2020년 이후 곡이야?", "발라드야?"],
    ["아이돌 그룹 노래야?", "OST야?", "영어 노래야?"],
  ],
  "전체": [
    ["사람이야?", "한국 거야?", "2010년 이후에 나온 거야?"],
    ["영상 콘텐츠야?", "실존 인물이야?", "지금도 인기 있어?"],
    ["노래야?", "남성과 관련 있어?", "작품(영화/드라마/애니)이야?"],
  ],
};

function getSuggestedSet(category: string, index: number): string[] {
  const sets = SUGGESTED_SETS[category] || SUGGESTED_SETS["유명인"];
  return sets[index % sets.length];
}

function getTeasingMessage(userTurns: number, avgTurns: number): string {
  const diff = userTurns - avgTurns;
  if (diff <= -5) return "흠... 제법이군. 봉신도 인정하지 않을 수 없다.";
  if (diff <= -2) return "크흠, 꽤 빠르군. 운이 좋았을 뿐이다.";
  if (diff <= 0) return "평범하군. 봉신의 유리구슬 앞에선 다 그 정도야.";
  if (diff <= 3) return "크크크... 좀 느리지 않았나? 다른 사람들은 더 빨랐는데.";
  return "하하하! 이렇게 오래 걸리다니... 봉신이 다 걱정된다.";
}

const AI_REVEAL_PROMPT =
  "크흠... 봉신의 유리구슬이 흐려졌다. 이번은 네 승리다. 정답이 무엇이었는지 알려주겠느냐?";
interface AdminSettings {
  model: ModelId | "";
  thinking: ThinkingLevel | "";
  searchGrounding: boolean;
}

const ADMIN_DEFAULTS: AdminSettings = { model: "", thinking: "", searchGrounding: false };

async function fetchAdminSettings(): Promise<AdminSettings> {
  try {
    const res = await fetch("/api/admin-config");
    if (!res.ok) return ADMIN_DEFAULTS;
    const data = await res.json();
    return { model: data.model ?? "", thinking: data.thinking ?? "", searchGrounding: data.searchGrounding ?? false };
  } catch {
    return ADMIN_DEFAULTS;
  }
}

async function persistAdminSettings(settings: AdminSettings): Promise<boolean> {
  try {
    const res = await fetch("/api/admin-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    return res.ok;
  } catch {
    return false;
  }
}

type PromptOverrideMap = Partial<Record<GameMode, string>>;
type SessionOutcome = "solved" | "failed" | "ai_correct" | "revealed";

function resolveResponseType(data: ChatResponse, mode: GameMode): BongshinResponseType {
  if (data.responseType) return data.responseType;
  if (mode === "user-guesses") return data.isGuess ? "result" : "question";
  return data.isGuess ? "challenge" : "question";
}

async function fetchPromptOverrides(): Promise<PromptOverrideMap> {
  try {
    const res = await fetch("/api/admin-config?type=prompts");
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
}

async function persistPromptOverrides(overrides: PromptOverrideMap): Promise<boolean> {
  try {
    const res = await fetch("/api/admin-config?type=prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(overrides),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function GameContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const mode = (searchParams.get("mode") || "ai-guesses") as GameMode;
  const category = searchParams.get("category") || "유명인";
  const fixedAnswer = searchParams.get("answer")
    ? decodeURIComponent(atob(searchParams.get("answer")!))
    : undefined;

  const [showIntro, setShowIntro] = useState(true);
  const [introFading, setIntroFading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [history, setHistory] = useState<
    { role: "user" | "model"; content: string; responseType?: BongshinResponseType }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [initFailed, setInitFailed] = useState(false);
  const [turnCount, setTurnCount] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [finalAnswer, setFinalAnswer] = useState<string | null>(null);
  const [awaitingGuessConfirmation, setAwaitingGuessConfirmation] = useState(false);
  const [input, setInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [showedHintEnd, setShowedHintEnd] = useState(false);
  const [revealInput, setRevealInput] = useState("");
  const [showReveal, setShowReveal] = useState(false);
  const [answerStats, setAnswerStats] = useState<KnowledgeStats | null>(null);
  const [categoryAvgTurns, setCategoryAvgTurns] = useState<number | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [completedOutcome, setCompletedOutcome] = useState<SessionOutcome | null>(null);
  const [suggestedUsedCount, setSuggestedUsedCount] = useState(0);
  const [showPromptGate, setShowPromptGate] = useState(false);
  const [showPromptAdmin, setShowPromptAdmin] = useState(false);
  const [promptEditorMode, setPromptEditorMode] = useState<GameMode>("ai-guesses");
  const [promptOverrides, setPromptOverrides] = useState<PromptOverrideMap>({});
  const [promptConfigReady, setPromptConfigReady] = useState(false);
  const [promptGateValue, setPromptGateValue] = useState("");
  const [promptGateError, setPromptGateError] = useState(false);
  const [promptDrafts, setPromptDrafts] = useState<Record<GameMode, string>>({
    "ai-guesses": getDefaultPromptTemplate("ai-guesses"),
    "user-guesses": getDefaultPromptTemplate("user-guesses"),
  });
  const [adminModel, setAdminModel] = useState<ModelId | "">(""); // "" = 기본값 사용
  const [adminThinking, setAdminThinking] = useState<ThinkingLevel | "">(""); // "" = 기본값 사용
  const [adminGrounding, setAdminGrounding] = useState(false);
  const [adminSaved, setAdminSaved] = useState(false);
  const adminSavedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 어드민 설정 서버에서 복원
  useEffect(() => {
    fetchAdminSettings().then((stored) => {
      setAdminModel(stored.model);
      setAdminThinking(stored.thinking);
      setAdminGrounding(stored.searchGrounding);
    });
  }, []);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const promptGateInputRef = useRef<HTMLInputElement>(null);
  const initialized = useRef(false);
  const turnCountRef = useRef(0);
  const recordedSessionRef = useRef<string | null>(null);
  const orbTapCountRef = useRef(0);
  const orbTapTimerRef = useRef<number | null>(null);

  // 인트로 → 페이드아웃 → 게임 시작
  useEffect(() => {
    const fadeTimer = setTimeout(() => setIntroFading(true), 1800);
    const hideTimer = setTimeout(() => setShowIntro(false), 2600);
    return () => { clearTimeout(fadeTimer); clearTimeout(hideTimer); };
  }, []);

  // bootstrapping 안전장치 — 30초 후 강제 해제
  useEffect(() => {
    if (!bootstrapping) return;
    const safety = setTimeout(() => {
      setBootstrapping(false);
      setInitFailed(true);
    }, 30000);
    return () => clearTimeout(safety);
  }, [bootstrapping]);

  useEffect(() => {
    fetchPromptOverrides().then((stored) => {
      setPromptOverrides(stored);
      setPromptDrafts({
        "ai-guesses":
          stored["ai-guesses"] || getDefaultPromptTemplate("ai-guesses"),
        "user-guesses":
          stored["user-guesses"] || getDefaultPromptTemplate("user-guesses"),
      });
      setPromptConfigReady(true);
    });
  }, []);

  useEffect(() => {
    setPromptEditorMode(mode);
  }, [mode]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = chatContainerRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior });
    });
  }, []);

  // DOM 변화 감지로 자동 스크롤 — messages useEffect보다 확실함
  useEffect(() => {
    const el = chatContainerRef.current;
    if (!el) return;

    const observer = new MutationObserver(() => {
      scrollToBottom();
    });

    observer.observe(el, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [scrollToBottom]);

  // 모바일 키보드 올라올 때 채팅 스크롤 처리
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const handleResize = () => {
      scrollToBottom();
    };

    viewport.addEventListener("resize", handleResize);
    return () => viewport.removeEventListener("resize", handleResize);
  }, [scrollToBottom]);

  useEffect(() => {
    return () => {
      if (orbTapTimerRef.current) {
        window.clearTimeout(orbTapTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!showPromptGate) return;
    requestAnimationFrame(() => {
      promptGateInputRef.current?.focus();
    });
  }, [showPromptGate]);

  useEffect(() => {
    let active = true;

    async function persistAndLoadStats() {
      const answerForStats =
        mode === "user-guesses" ? fixedAnswer || finalAnswer : finalAnswer;

      if (!completedOutcome || !answerForStats) return;

      const recordKey = [
        mode,
        category,
        answerForStats,
        completedOutcome,
        turnCountRef.current,
      ].join("|");

      if (recordedSessionRef.current === recordKey) return;
      recordedSessionRef.current = recordKey;

      try {
        const res = await fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode,
            category,
            answer: answerForStats,
            outcome: completedOutcome,
            turnCount: turnCountRef.current,
            conversation: messages.map((m) => ({
              role: m.role,
              content: m.content,
              type: m.responseType ?? (m.role === "user" ? "answer" : "message"),
            })),
          }),
        });

        if (!res.ok) throw new Error("session log failed");
        const data = (await res.json()) as { stats?: KnowledgeStats | null; sessionId?: string | null; categoryAvgTurns?: number | null };
        if (active) {
          setAnswerStats(data.stats ?? null);
          setCategoryAvgTurns(data.categoryAvgTurns ?? null);
          if (data.sessionId) setSessionId(data.sessionId);
        }
      } catch {
        try {
          const params = new URLSearchParams({
            category,
            answer: answerForStats,
          });
          const res = await fetch(`/api/stats?${params.toString()}`, {
            cache: "no-store",
          });
          if (!res.ok) return;
          const data = (await res.json()) as { stats?: KnowledgeStats | null };
          if (active) {
            setAnswerStats(data.stats ?? null);
          }
        } catch {
          // Ignore stats fetch failures.
        }
      }
    }

    void persistAndLoadStats();

    return () => {
      active = false;
    };
  }, [category, completedOutcome, finalAnswer, fixedAnswer, mode]);

  const showHintAfterResponse = useRef(false);

  const sendToAPI = useCallback(
    async (
      userMessage: string,
      currentHistory: { role: "user" | "model"; content: string; responseType?: BongshinResponseType }[],
      isInit = false
    ) => {
      setLoading(true);
      if (mode === "ai-guesses") {
        setAwaitingGuessConfirmation(false);
      }
      try {
        const newHistory = [
          ...currentHistory,
          { role: "user" as const, content: userMessage },
        ];
        const nextTurnCount = isInit ? 0 : turnCountRef.current + 1;
        const fetchStart = Date.now();

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);

        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            mode,
            category,
            messages: newHistory,
            fixedAnswer,
          }),
        }).finally(() => clearTimeout(timeout));

        if (!res.ok) throw new Error("API error");

        const data: ChatResponse = await res.json();

        // 응답이 너무 빠르면 (하드코딩 오프닝 등) 자연스러운 딜레이 추가
        const elapsed = Date.now() - fetchStart;
        const minDelay = mode === "ai-guesses" ? 1800 : 1200;
        if (elapsed < minDelay) {
          await new Promise((r) => setTimeout(r, minDelay - elapsed));
        }

        const responseType = resolveResponseType(data, mode);

        const updatedHistory = [
          ...newHistory,
          { role: "model" as const, content: data.message, responseType },
        ];
        setHistory(updatedHistory);
        if (!isInit) {
          turnCountRef.current = nextTurnCount;
          setTurnCount(nextTurnCount);
        }

        const shouldForceAiReveal =
          mode === "ai-guesses" &&
          !isInit &&
          nextTurnCount >= 20 &&
          responseType !== "challenge";

        setMessages((prev) => {
          const updated = [
            ...prev,
            {
              role: "bongshin" as const,
              content: shouldForceAiReveal ? AI_REVEAL_PROMPT : data.message,
              suggestedQuestions: data.suggestedQuestions || undefined,
              isGuess: responseType === "challenge",
              responseType: shouldForceAiReveal ? "result" : responseType,
            },
          ];
          // 추천 질문 4번 사용 후 API 응답 뒤에 힌트 메시지 삽입
          if (showHintAfterResponse.current) {
            showHintAfterResponse.current = false;
            setShowedHintEnd(true);
            updated.push({
              role: "bongshin",
              content: "크흠... 이제는 직접 질문하거라. 봉신이 계속 힌트를 줄 수는 없지.",
              responseType: "question",
            });
          }
          return updated;
        });

        // 정답 캡처: guess 필드가 있으면 저장, 없으면 메시지에서 추출 시도
        if (data.guess) {
          setFinalAnswer(data.guess);
        }

        if (mode === "ai-guesses") {
          setAwaitingGuessConfirmation(shouldForceAiReveal ? false : responseType === "challenge");
        }

        if (mode === "user-guesses" && data.isGameOver) {
          setGameOver(true);
          setCompletedOutcome("solved");
        }

        if (shouldForceAiReveal) {
          setGameOver(true);
          setShowReveal(true);
        }

        return updatedHistory;
      } catch {
        // 1회 자동 재시도
        try {
          const retryHistory = [
            ...currentHistory,
            { role: "user" as const, content: userMessage },
          ];
          const retryRes = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: AbortSignal.timeout(20000),
            body: JSON.stringify({
              mode,
              category,
              messages: retryHistory,
              fixedAnswer,
            }),
          });
          if (!retryRes.ok) throw new Error("retry failed");
          const retryData: ChatResponse = await retryRes.json();
          const retryType = resolveResponseType(retryData, mode);
          const retryUpdatedHistory = [
            ...retryHistory,
            { role: "model" as const, content: retryData.message, responseType: retryType },
          ];
          setHistory(retryUpdatedHistory);
          if (!isInit) {
            const nextTurn = turnCountRef.current + 1;
            turnCountRef.current = nextTurn;
            setTurnCount(nextTurn);
          }
          if (retryData.guess) setFinalAnswer(retryData.guess);
          const shouldForceAiReveal =
            mode === "ai-guesses" && !isInit && (turnCountRef.current) >= 20 && retryType !== "challenge";
          setMessages((prev) => [
            ...prev,
            {
              role: "bongshin" as const,
              content: shouldForceAiReveal ? AI_REVEAL_PROMPT : retryData.message,
              suggestedQuestions: retryData.suggestedQuestions || undefined,
              isGuess: retryType === "challenge",
              responseType: shouldForceAiReveal ? "result" : retryType,
            },
          ]);
          if (mode === "ai-guesses") {
            setAwaitingGuessConfirmation(shouldForceAiReveal ? false : retryType === "challenge");
          }
          if (mode === "user-guesses" && retryData.isGameOver) {
            setGameOver(true);
            setCompletedOutcome("solved");
          }
          if (shouldForceAiReveal) {
            setGameOver(true);
            setShowReveal(true);
          }
          return retryUpdatedHistory;
        } catch {
          // 재시도도 실패 — 유저의 마지막 응답을 취소하고 다시 시도하도록
          setAwaitingGuessConfirmation(false);
          setMessages((prev) => {
            // 마지막 유저 메시지를 제거 (없던 걸로)
            const lastUserIdx = prev.findLastIndex((m) => m.role === "user");
            const cleaned = lastUserIdx >= 0 ? prev.filter((_, i) => i !== lastUserIdx) : prev;
            return [
              ...cleaned,
              {
                role: "bongshin",
                content: "유리구슬에 금이 갔다... 다시 답해줘",
                responseType: "question",
              },
            ];
          });
          return currentHistory;
        }
      } finally {
        setLoading(false);
      }
    },
    [mode, category, fixedAnswer]
  );

  useEffect(() => {
    if (!promptConfigReady) return;
    if (initialized.current) return;
    initialized.current = true;

    let active = true;
    const initMessage =
      mode === "ai-guesses"
        ? `게임을 시작한다. 유저가 "${category}" 카테고리에서 하나를 떠올렸다. 첫 질문을 해라.`
        : `게임을 시작한다. "${category}" 카테고리에서 하나를 골라라. 정답은 밝히지 말고 게임 시작 멘트를 해라.`;

    void (async () => {
      const result = await sendToAPI(initMessage, [], true);
      if (active) {
        setBootstrapping(false);
        // sendToAPI가 에러 시 currentHistory(빈 배열)를 리턴함
        if (result.length === 0) {
          setInitFailed(true);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [mode, category, sendToAPI, promptConfigReady]);

  async function restartGame() {
    setMessages([]);
    setHistory([]);
    setGameOver(false);
    setCompletedOutcome(null);
    setFinalAnswer(null);
    setAwaitingGuessConfirmation(false);
    setInput("");
    setCopied(false);
    setShowedHintEnd(false);
    setRevealInput("");
    setShowReveal(false);
    setAnswerStats(null);
    setCategoryAvgTurns(null);
    setSessionId(null);
    setSuggestedUsedCount(0);
    setTurnCount(0);
    setInitFailed(false);
    turnCountRef.current = 0;
    recordedSessionRef.current = null;
    initialized.current = true; // prevent useEffect from double-firing
    setBootstrapping(true);
    setShowIntro(true);
    setIntroFading(false);
    setTimeout(() => setIntroFading(true), 1800);
    setTimeout(() => setShowIntro(false), 2600);

    const initMessage =
      mode === "ai-guesses"
        ? `게임을 시작한다. 유저가 "${category}" 카테고리에서 하나를 떠올렸다. 첫 질문을 해라.`
        : `게임을 시작한다. "${category}" 카테고리에서 하나를 골라라. 정답은 밝히지 말고 게임 시작 멘트를 해라.`;
    const result = await sendToAPI(initMessage, [], true);
    setBootstrapping(false);
    if (result.length === 0) {
      setInitFailed(true);
    }
  }

  async function handleUserResponse(answer: string, fromSuggested = false) {
    if (bootstrapping || loading || gameOver || awaitingGuessConfirmation || turnCountRef.current >= 20) return;
    if (fromSuggested) {
      const newCount = suggestedUsedCount + 1;
      setSuggestedUsedCount(newCount);
      if (newCount >= 3 && !showedHintEnd) {
        showHintAfterResponse.current = true;
      }
    }
    setMessages((prev) => [...prev, { role: "user", content: answer }]);
    await sendToAPI(answer, history);
  }

  async function handleGuessResponse(correct: boolean) {
    if (bootstrapping || loading || gameOver || !awaitingGuessConfirmation) return;

    setAwaitingGuessConfirmation(false);
    const response = correct
      ? "맞아! 정답이야!"
      : "아니, 틀렸어. 다시 시도해봐.";
    setMessages((prev) => [...prev, { role: "user", content: response }]);

    if (correct) {
      setGameOver(true);
      setCompletedOutcome("ai_correct");
      setMessages((prev) => [
        ...prev,
        {
          role: "bongshin",
          content:
            "크흠... 봉신의 유리구슬은 거짓말을 하지 않지. 역시 봉신이다!",
          isCorrect: true,
          responseType: "result",
        },
      ]);
    } else if (turnCountRef.current >= 19) {
      // 19턴에서 도전 실패 = 20턴 소비 → 게임 종료
      turnCountRef.current = 20;
      setTurnCount(20);
      setGameOver(true);
      setShowReveal(true);
      setMessages((prev) => [
        ...prev,
        {
          role: "bongshin",
          content: AI_REVEAL_PROMPT,
          responseType: "result",
        },
      ]);
    } else {
      // 도전 실패도 1턴 소비 (도전+응답 = 한 턴의 대화)
      await sendToAPI(response, history);
    }
  }

  // 20턴 도달 시 강제 종료
  useEffect(() => {
    if (mode === "user-guesses" && turnCount >= 20 && !gameOver) {
      setGameOver(true);
      setCompletedOutcome("failed");
      const answer = finalAnswer || "알 수 없는 무언가";
      setMessages((prev) => [
        ...prev,
        {
          role: "bongshin",
          content: `시간이 다 됐다... 봉신이 떠올린 건 "${answer}"이었지. 다음엔 더 날카롭게 파고들어 봐.`,
          responseType: "result",
        },
      ]);
    }
  }, [turnCount, mode, gameOver, finalAnswer]);

  function handleSubmitInput() {
    if (!input.trim() || bootstrapping || loading || gameOver) return;
    const msg = input.trim();
    setInput("");
    handleUserResponse(msg);
  }

  function handleRevealSubmit() {
    if (!revealInput.trim()) return;
    const answer = revealInput.trim();
    setFinalAnswer(answer);
    setCompletedOutcome("revealed");
    setShowReveal(false);
    setMessages((prev) => [
      ...prev,
      { role: "user", content: answer },
      {
        role: "bongshin",
        content: `${answer}이라... 기억해 두마. 다음에는 반드시 맞추겠다.`,
        responseType: "result",
      },
    ]);
  }

  function handleShare() {
    const origin = window.location.origin;

    if (mode === "user-guesses" && finalAnswer) {
      const encoded = btoa(encodeURIComponent(finalAnswer));
      const shareUrl = `${origin}/play?mode=user-guesses&category=${encodeURIComponent(category)}&answer=${encoded}`;
      const text = `봉신이 낸 문제를 ${turnCount}번 만에 맞췄다! 너도 도전해봐 🔮\n${shareUrl}`;
      navigator.clipboard.writeText(text);
    } else {
      const text = `봉신과 스무고개 - 봉신이 유리구슬로 당신의 마음을 읽습니다 🔮\n${origin}`;
      navigator.clipboard.writeText(text);
    }

    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleOrbTap() {
    orbTapCountRef.current += 1;
    if (orbTapTimerRef.current) {
      window.clearTimeout(orbTapTimerRef.current);
    }
    if (orbTapCountRef.current >= 10) {
      orbTapCountRef.current = 0;
      setPromptEditorMode(mode);
      setPromptGateValue("");
      setPromptGateError(false);
      setShowPromptGate(true);
      return;
    }
    orbTapTimerRef.current = window.setTimeout(() => {
      orbTapCountRef.current = 0;
    }, 2200);
  }

  function handlePromptGateSubmit() {
    if (promptGateValue.trim() !== "봉신이간다") {
      setPromptGateError(true);
      return;
    }
    setPromptGateError(false);
    setPromptGateValue("");
    setShowPromptGate(false);
    setShowPromptAdmin(true);
  }

  function handlePromptDraftChange(nextValue: string) {
    setPromptDrafts((prev) => ({
      ...prev,
      [promptEditorMode]: nextValue,
    }));
  }

  function handleSavePromptTemplate() {
    const nextOverrides: PromptOverrideMap = {
      ...promptOverrides,
      [promptEditorMode]: promptDrafts[promptEditorMode],
    };
    setPromptOverrides(nextOverrides);
    persistPromptOverrides(nextOverrides).then((ok) => {
      if (adminSavedTimer.current) clearTimeout(adminSavedTimer.current);
      setAdminSaved(true);
      adminSavedTimer.current = setTimeout(() => setAdminSaved(false), ok ? 1500 : 3000);
    });
  }

  function handleResetPromptTemplate() {
    const nextOverrides: PromptOverrideMap = { ...promptOverrides };
    delete nextOverrides[promptEditorMode];
    setPromptOverrides(nextOverrides);
    persistPromptOverrides(nextOverrides).then((ok) => {
      if (adminSavedTimer.current) clearTimeout(adminSavedTimer.current);
      setAdminSaved(true);
      adminSavedTimer.current = setTimeout(() => setAdminSaved(false), ok ? 1500 : 3000);
    });
    setPromptDrafts((prev) => ({
      ...prev,
      [promptEditorMode]: getDefaultPromptTemplate(promptEditorMode),
    }));
  }

  const knownAnswerForStats =
    mode === "user-guesses" ? fixedAnswer || finalAnswer : finalAnswer;
  const answerAvgTurns = mode === "user-guesses"
    ? (answerStats?.userGuessAvgTurns ?? null)
    : (answerStats?.aiGuessAvgTurns ?? null);
  const avgTurns = answerAvgTurns ?? categoryAvgTurns;
  const isAnswerSpecific = answerAvgTurns !== null;
  const hasChatActivity = messages.length > 0 || loading;
  const activePromptTemplate = promptDrafts[promptEditorMode];
  const activePromptPreview = getSystemPrompt(
    promptEditorMode,
    category,
    fixedAnswer,
    activePromptTemplate
  );

  return (
    <div className="flex flex-col w-full h-dvh relative overflow-hidden">
      {/* 배경 봉신 이미지 */}
      <div className="absolute inset-0 z-0 pointer-events-none animate-bg-fade-in">
        <Image
          src="/chat-bg.jpg"
          alt=""
          fill
          className="object-cover object-top"
          priority
        />
      </div>

      {/* 인트로 오버레이 */}
      {showIntro && (
        <div className={`absolute inset-0 z-50 flex flex-col items-center justify-center bg-black transition-opacity duration-700 ${introFading ? "opacity-0" : "opacity-100"}`}>
          <p className="text-mystic text-2xl font-bold animate-intro-text tracking-wide">
            {mode === "user-guesses"
              ? "스무 번 질문 내에 정답을 맞춰라"
              : "봉신이 너의 마음을 읽겠다"}
          </p>
          <p className="text-text-dim text-base mt-4 animate-intro-sub">
            {category}
          </p>
        </div>
      )}

      {/* 헤더 — 고정 */}
      <header className="z-20 bg-bg/90 backdrop-blur-sm flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <button
          onClick={() => router.push("/")}
          className="text-text-dim hover:text-mystic-light text-sm"
        >
          ←
        </button>
        <div className="text-center">
          <span className="text-xs text-text-dim">{category}</span>
          <span className="text-xs text-mystic ml-2">{turnCount}/20</span>
          {bootstrapping && (
            <span className="text-[9px] text-red-400 ml-1">
              [{promptConfigReady ? "API" : "cfg"}{loading ? "…" : ""}{initFailed ? "✗" : ""}]
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={handleOrbTap}
          className="text-lg select-none"
          aria-label="봉신의 유리구슬"
        >
          🔮
        </button>
      </header>

      {showPromptGate && (
        <div className="absolute inset-0 z-40 bg-black/70 px-4 py-6 backdrop-blur-sm">
          <div className="mx-auto flex h-full max-h-[calc(100dvh-3rem)] w-full max-w-md items-center justify-center">
            <div className="w-full rounded-3xl border border-border bg-bg-card px-5 py-5 shadow-2xl">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-text-bright">관리자 인증</p>
                <p className="text-xs text-text-dim">암호를 입력하면 숨김 프롬프트 관리자가 열린다.</p>
              </div>
              <div className="mt-4 space-y-3">
                <input
                  ref={promptGateInputRef}
                  type="password"
                  value={promptGateValue}
                  onChange={(e) => {
                    setPromptGateValue(e.target.value);
                    if (promptGateError) setPromptGateError(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handlePromptGateSubmit();
                  }}
                  placeholder="암호 입력"
                  className="w-full rounded-2xl border border-border bg-bg px-4 py-3 text-sm text-text outline-none focus:border-mystic/50"
                />
                {promptGateError && (
                  <p className="text-xs text-red-300">암호가 맞지 않는다.</p>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowPromptGate(false);
                      setPromptGateValue("");
                      setPromptGateError(false);
                    }}
                    className="flex-1 rounded-2xl border border-border px-4 py-3 text-sm text-text-dim hover:border-mystic/50 hover:text-text"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={handlePromptGateSubmit}
                    className="flex-1 rounded-2xl bg-mystic px-4 py-3 text-sm font-semibold text-black hover:bg-mystic-light"
                  >
                    확인
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showPromptAdmin && (
        <div className="absolute inset-0 z-40 bg-black/70 px-3 py-3 backdrop-blur-sm sm:px-4 sm:py-4">
          <div className="mx-auto flex h-full max-h-[calc(100dvh-1.5rem)] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-border bg-bg-card shadow-2xl sm:max-h-[calc(100dvh-2rem)]">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <p className="text-sm font-semibold text-text-bright">숨김 프롬프트 관리자</p>
                <p className="text-xs text-text-dim">모드별 템플릿을 수정하고 즉시 저장할 수 있다.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowPromptAdmin(false)}
                className="rounded-full border border-border px-3 py-1.5 text-xs text-text-dim hover:border-mystic/50 hover:text-text"
              >
                닫기
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
              {(["ai-guesses", "user-guesses"] as GameMode[]).map((editorMode) => (
                <button
                  key={editorMode}
                  type="button"
                  onClick={() => setPromptEditorMode(editorMode)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    promptEditorMode === editorMode
                      ? "bg-mystic text-black"
                      : "border border-border text-text-dim hover:border-mystic/50 hover:text-text"
                  }`}
                >
                  {editorMode}
                </button>
              ))}
              <div className="ml-auto flex gap-2">
                <button
                  type="button"
                  onClick={handleResetPromptTemplate}
                  className="rounded-full border border-border px-3 py-1.5 text-xs text-text-dim hover:border-mystic/50 hover:text-text"
                >
                  기본값 복원
                </button>
                <button
                  type="button"
                  onClick={handleSavePromptTemplate}
                  className="rounded-full bg-mystic px-3 py-1.5 text-xs font-semibold text-black hover:bg-mystic-light"
                >
                  저장
                </button>
              </div>
            </div>

            {adminSaved && (
              <div className="fixed inset-0 z-[200] flex items-center justify-center pointer-events-none" style={{ animation: "adminToastFade 1.5s ease-in-out forwards" }}>
                <div className="rounded-2xl bg-black/80 px-8 py-4 text-sm font-semibold text-white shadow-lg backdrop-blur-sm" style={{ animation: "adminToastScale 0.2s ease-out forwards" }}>
                  저장됨
                </div>
                <style>{`
                  @keyframes adminToastFade { 0% { opacity: 0; } 10% { opacity: 1; } 75% { opacity: 1; } 100% { opacity: 0; } }
                  @keyframes adminToastScale { 0% { transform: scale(0.8); } 100% { transform: scale(1); } }
                `}</style>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-2 relative">
              <span className="text-[10px] text-text-dim">모델</span>
              <select
                value={adminModel}
                onChange={(e) => {
                  const v = e.target.value as ModelId | "";
                  setAdminModel(v);
                  persistAdminSettings({ model: v, thinking: adminThinking, searchGrounding: adminGrounding }).then((ok) => { if (adminSavedTimer.current) clearTimeout(adminSavedTimer.current); setAdminSaved(true); adminSavedTimer.current = setTimeout(() => setAdminSaved(false), ok ? 1500 : 3000); });
                }}
                className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-2 py-1.5 text-xs text-text outline-none focus:border-mystic/50"
              >
                <option value="">기본값 (gemini-3.1-flash-lite-preview)</option>
                {AVAILABLE_MODELS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <span className="text-[10px] text-text-dim">Thinking</span>
              <select
                value={adminThinking}
                onChange={(e) => {
                  const v = e.target.value as ThinkingLevel | "";
                  setAdminThinking(v);
                  persistAdminSettings({ model: adminModel, thinking: v, searchGrounding: adminGrounding }).then((ok) => { if (adminSavedTimer.current) clearTimeout(adminSavedTimer.current); setAdminSaved(true); adminSavedTimer.current = setTimeout(() => setAdminSaved(false), ok ? 1500 : 3000); });
                }}
                className="w-24 rounded-lg border border-border bg-bg px-2 py-1.5 text-xs text-text outline-none focus:border-mystic/50"
              >
                <option value="">기본값</option>
                {THINKING_LEVELS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <label className="flex items-center gap-1.5 ml-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={adminGrounding}
                  onChange={(e) => {
                    setAdminGrounding(e.target.checked);
                    persistAdminSettings({ model: adminModel, thinking: adminThinking, searchGrounding: e.target.checked }).then((ok) => { if (adminSavedTimer.current) clearTimeout(adminSavedTimer.current); setAdminSaved(true); adminSavedTimer.current = setTimeout(() => setAdminSaved(false), ok ? 1500 : 3000); });
                  }}
                  className="accent-mystic w-3.5 h-3.5"
                />
                <span className="text-[10px] text-text-dim">Search Grounding</span>
              </label>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="flex min-h-0 flex-[1.1] flex-col border-b border-border">
                <div className="px-5 py-3">
                  <p className="text-xs text-text-dim">
                    치환값: <code>{"{{category}}"}</code>, <code>{"{{hint}}"}</code>, <code>{"{{answerInstruction}}"}</code>
                  </p>
                </div>
                <div className="min-h-0 flex-1 px-5 pb-5">
                  <textarea
                    value={activePromptTemplate}
                    onChange={(e) => handlePromptDraftChange(e.target.value)}
                    className="h-full min-h-[180px] w-full resize-none rounded-2xl border border-border bg-bg px-4 py-4 text-xs leading-6 text-text outline-none focus:border-mystic/50"
                    spellCheck={false}
                  />
                </div>
              </div>

              <div className="flex min-h-0 flex-[0.9] flex-col">
                <div className="border-b border-border px-5 py-3">
                  <p className="text-xs text-text-dim">
                    현재 미리보기 기준: <span className="text-text">{promptEditorMode}</span> / <span className="text-text">{category}</span>
                  </p>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden px-5 py-4">
                  <pre className="h-full overflow-y-auto whitespace-pre-wrap break-words rounded-2xl border border-border bg-bg px-4 py-4 text-[11px] leading-6 text-text">
                    {activePromptPreview}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 채팅 영역 — 메시지가 하단부터 쌓임 (카톡 방식) */}
      <div ref={chatContainerRef} className="flex-1 min-h-0 overflow-y-auto flex flex-col relative z-10">
        <div className={`px-4 py-4 relative z-10 ${hasChatActivity ? "mt-auto space-y-4" : "flex min-h-full items-center justify-center"}`}>
        {hasChatActivity ? (
          <>
        {messages.map((msg, i) => (
          <div key={i}>
            {msg.role === "bongshin" ? (
              <div className="flex gap-2 items-start">
                <div className="w-8 h-8 rounded-full bg-mystic/20 flex items-center justify-center text-sm shrink-0">
                  🔮
                </div>
                <div className="max-w-[80%]">
                  {mode === "ai-guesses" && msg.responseType && (
                    <div className="mb-1 flex items-center gap-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide ${
                          msg.responseType === "challenge"
                            ? "bg-mystic text-black"
                            : msg.responseType === "result"
                            ? "bg-mystic-dark text-text-bright"
                            : "bg-bg-card border border-border text-text-dim"
                        }`}
                      >
                        {msg.responseType === "challenge"
                          ? "도전"
                          : msg.responseType === "result"
                          ? "결과"
                          : "질문"}
                      </span>
                    </div>
                  )}
                  <div
                    className={`px-4 py-3 rounded-2xl rounded-tl-sm text-sm leading-relaxed ${
                      msg.responseType === "challenge"
                        ? "bg-mystic text-black font-medium"
                        : msg.isCorrect
                        ? "bg-mystic-dark text-text-bright"
                        : "bg-bg-card border border-border text-text"
                    }`}
                  >
                    {msg.content}
                  </div>

                  {msg.responseType === "challenge" &&
                    !msg.isCorrect &&
                    !gameOver &&
                    mode === "ai-guesses" &&
                    awaitingGuessConfirmation &&
                    i === messages.length - 1 && (
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={() => handleGuessResponse(true)}
                          className="px-4 py-1.5 rounded-full bg-mystic text-black text-xs font-medium hover:bg-mystic-light transition-colors"
                        >
                          정답이야
                        </button>
                        <button
                          onClick={() => handleGuessResponse(false)}
                          className="px-4 py-1.5 rounded-full bg-bg-card border border-border text-text-dim text-xs font-medium hover:border-mystic/50 transition-colors"
                        >
                          틀렸어
                        </button>
                      </div>
                    )}

                  {msg.suggestedQuestions &&
                    mode === "user-guesses" &&
                    !gameOver &&
                    suggestedUsedCount < 3 &&
                    i === messages.length - 1 &&
                    getSuggestedSet(category, suggestedUsedCount).length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {getSuggestedSet(category, suggestedUsedCount).map((q, j) => (
                          <button
                            key={j}
                            onClick={() => handleUserResponse(q, true)}
                            disabled={loading || bootstrapping}
                            className="px-3 py-1.5 rounded-full bg-bg-card border border-border text-text-dim text-xs active:border-mystic/50 active:text-mystic-light transition-colors disabled:opacity-50"
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                    )}
                </div>
              </div>
            ) : (
              <div className="flex justify-end">
                <div className="max-w-[80%] px-4 py-3 rounded-2xl rounded-tr-sm bg-mystic/20 text-text-bright text-sm leading-relaxed">
                  {msg.content}
                </div>
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex gap-2 items-start">
            <div className="w-8 h-8 rounded-full bg-mystic/20 flex items-center justify-center text-sm shrink-0">
              🔮
            </div>
            <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-bg-card border border-border">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-mystic/50 rounded-full animate-bounce" />
                <span
                  className="w-2 h-2 bg-mystic/50 rounded-full animate-bounce"
                  style={{ animationDelay: "0.1s" }}
                />
                <span
                  className="w-2 h-2 bg-mystic/50 rounded-full animate-bounce"
                  style={{ animationDelay: "0.2s" }}
                />
              </div>
            </div>
          </div>
        )}
          </>
        ) : (
          <div className="rounded-2xl border border-border bg-bg/85 px-4 py-3 text-center text-sm text-text-dim backdrop-blur-sm">
            {initFailed ? (
              <div className="space-y-2">
                <p>유리구슬 연결에 실패했다...</p>
                <button
                  type="button"
                  onClick={restartGame}
                  className="rounded-full bg-mystic px-4 py-1.5 text-xs font-semibold text-black hover:bg-mystic-light"
                >
                  다시 시도
                </button>
              </div>
            ) : (
              "봉신이 첫 질문을 고르는 중..."
            )}
          </div>
        )}
        </div>
      </div>

      {/* 하단 입력 영역 — 고정 */}
      <div className="z-20 bg-bg/90 backdrop-blur-sm shrink-0">
        {bootstrapping ? (
          <div className="px-4 py-3 border-t border-border">
            <p className="text-center text-sm text-text-dim">
              봉신이 첫 질문을 고르는 중...
            </p>
          </div>
        ) : !gameOver ? (
          mode === "ai-guesses" ? (
            <div className="px-4 py-3 border-t border-border">
              {awaitingGuessConfirmation ? (
                <p className="text-center text-sm text-text-dim">
                  위의 버튼으로 대답해줘
                </p>
              ) : (
                <div className="flex gap-2 justify-center">
                  {["응, 맞아", "아니", "애매해", "모르겠어"].map((answer) => (
                    <button
                      key={answer}
                      onClick={() => handleUserResponse(answer)}
                      disabled={loading || bootstrapping}
                      className="px-5 py-2.5 rounded-full bg-bg-card border border-border text-sm font-medium text-text active:bg-mystic active:text-black active:border-mystic transition-all disabled:opacity-50"
                    >
                      {answer}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="px-4 py-3 border-t border-border">
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSubmitInput();
                  }}
                  onFocus={() => scrollToBottom()}
                  placeholder="질문하거나 정답을 말해봐"
                  className="flex-1 px-4 py-2.5 rounded-xl bg-bg-card border border-border focus:border-mystic/50 focus:outline-none text-sm text-text placeholder:text-text-dim"
                  disabled={loading}
                />
                <button
                  onClick={handleSubmitInput}
                  disabled={loading || !input.trim()}
                  className="px-4 py-2.5 rounded-xl bg-mystic text-black text-sm font-medium hover:bg-mystic-light transition-colors disabled:opacity-50"
                >
                  전송
                </button>
              </div>
            </div>
          )
        ) : showReveal ? (
          <div className="px-4 py-3 border-t border-border">
            <div className="flex items-stretch gap-2">
              <input
                type="text"
                value={revealInput}
                onChange={(e) => setRevealInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleRevealSubmit(); }}
                placeholder="정답을 입력해줘"
                className="min-w-0 flex-1 rounded-2xl bg-bg-card border border-border px-4 py-3 text-base leading-6 text-text placeholder:text-text-dim focus:border-mystic/50 focus:outline-none"
                autoFocus
              />
              <button
                onClick={handleRevealSubmit}
                disabled={!revealInput.trim()}
                className="min-w-[72px] rounded-2xl bg-mystic px-4 py-3 text-sm font-semibold text-black hover:bg-mystic-light transition-colors disabled:opacity-50"
              >
                전송
              </button>
            </div>
          </div>
        ) : (
          <div className="px-4 py-5 border-t border-border text-center space-y-4">
            {avgTurns !== null && (
              <div className="bg-bg-card border border-border rounded-2xl px-4 py-3 space-y-1">
                {knownAnswerForStats && answerStats && answerStats.totalSessions > 1 && (
                  <p className="text-xs text-text-dim">
                    <span className="text-text-bright">{knownAnswerForStats}</span> 누적 플레이{" "}
                    <span className="text-mystic font-bold">{answerStats.totalSessions}회</span>
                  </p>
                )}
                <p className="text-xs text-text-dim">
                  {isAnswerSpecific
                    ? (mode === "user-guesses" ? "이 정답 유저 평균" : "이 정답 봉신 평균")
                    : `${category} 카테고리 평균`}{" "}
                  <span className="text-mystic font-bold">{avgTurns}턴</span>
                </p>
                <p className="text-sm text-mystic-light font-medium">
                  {getTeasingMessage(turnCount, avgTurns)}
                </p>
              </div>
            )}

            <p className="text-sm text-mystic font-medium">
              게임 종료! ({turnCount}턴)
            </p>

            <div className="flex gap-2 justify-center">
              <button
                onClick={restartGame}
                className="px-5 py-2.5 rounded-full bg-mystic text-black text-sm font-medium hover:bg-mystic-light transition-colors"
              >
                다시 하기
              </button>
              <button
                onClick={handleShare}
                className="px-5 py-2.5 rounded-full bg-bg-card border border-border text-text text-sm font-medium hover:border-mystic/50 transition-colors"
              >
                {copied ? "복사됨!" : mode === "user-guesses" ? "도전장 보내기" : "공유하기"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function PlayPage() {
  return (
    <Suspense
      fallback={
        <div className="flex-1 flex items-center justify-center">
          <div className="text-mystic animate-pulse-slow">
            봉신이 유리구슬을 닦고 있다...
          </div>
        </div>
      }
    >
      <GameContent />
    </Suspense>
  );
}
