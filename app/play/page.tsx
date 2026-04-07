"use client";

import { useState, useRef, useEffect, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Image from "next/image";
import { ChatMessage, ChatResponse, GameMode } from "@/lib/types";

function getFakeAverage(answer: string): number {
  let hash = 0;
  for (let i = 0; i < answer.length; i++) {
    hash = (hash * 31 + answer.charCodeAt(i)) | 0;
  }
  return 10 + (Math.abs(hash) % 7);
}

function getTeasingMessage(userTurns: number, avgTurns: number): string {
  const diff = userTurns - avgTurns;
  if (diff <= -5) return "흠... 제법이군. 봉신도 인정하지 않을 수 없다.";
  if (diff <= -2) return "크흠, 꽤 빠르군. 운이 좋았을 뿐이다.";
  if (diff <= 0) return "평범하군. 봉신의 유리구슬 앞에선 다 그 정도야.";
  if (diff <= 3) return "크크크... 좀 느리지 않았나? 다른 사람들은 더 빨랐는데.";
  return "하하하! 이렇게 오래 걸리다니... 봉신이 다 걱정된다.";
}

function GameContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const mode = (searchParams.get("mode") || "ai-guesses") as GameMode;
  const category = searchParams.get("category") || "유명인";
  const fixedAnswer = searchParams.get("answer")
    ? decodeURIComponent(atob(searchParams.get("answer")!))
    : undefined;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [history, setHistory] = useState<
    { role: "user" | "model"; content: string }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [turnCount, setTurnCount] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [finalAnswer, setFinalAnswer] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [showedHintEnd, setShowedHintEnd] = useState(false);
  const [suggestedUsedCount, setSuggestedUsedCount] = useState(0);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const initialized = useRef(false);

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

  const showHintAfterResponse = useRef(false);

  const sendToAPI = useCallback(
    async (
      userMessage: string,
      currentHistory: { role: "user" | "model"; content: string }[]
    ) => {
      setLoading(true);
      try {
        const newHistory = [
          ...currentHistory,
          { role: "user" as const, content: userMessage },
        ];

        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode,
            category,
            messages: newHistory,
            fixedAnswer,
          }),
        });

        if (!res.ok) throw new Error("API error");

        const data: ChatResponse = await res.json();

        const updatedHistory = [
          ...newHistory,
          { role: "model" as const, content: data.message },
        ];
        setHistory(updatedHistory);
        setTurnCount(data.turnCount);

        setMessages((prev) => {
          const updated = [
            ...prev,
            {
              role: "bongshin" as const,
              content: data.message,
              suggestedQuestions: data.suggestedQuestions || undefined,
              isGuess: data.isGuess,
            },
          ];
          // 추천 질문 4번 사용 후 API 응답 뒤에 힌트 메시지 삽입
          if (showHintAfterResponse.current) {
            showHintAfterResponse.current = false;
            setShowedHintEnd(true);
            updated.push({
              role: "bongshin",
              content: "크흠... 이제는 직접 질문하거라. 봉신이 계속 힌트를 줄 수는 없지.",
            });
          }
          return updated;
        });

        // 정답 캡처: guess 필드가 있으면 저장, 없으면 메시지에서 추출 시도
        if (data.guess) {
          setFinalAnswer(data.guess);
        }

        if (data.isGameOver) {
          setGameOver(true);
        }

        return updatedHistory;
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            role: "bongshin",
            content: "유리구슬에 금이 갔다... 다시 시도해봐",
          },
        ]);
        return currentHistory;
      } finally {
        setLoading(false);
      }
    },
    [mode, category, fixedAnswer]
  );

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const initMessage =
      mode === "ai-guesses"
        ? `게임을 시작한다. 유저가 "${category}" 카테고리에서 하나를 떠올렸다. 첫 질문을 해라.`
        : `게임을 시작한다. "${category}" 카테고리에서 하나를 골라라. 정답은 밝히지 말고 게임 시작 멘트를 해라.`;

    sendToAPI(initMessage, []);
  }, [mode, category, sendToAPI]);

  async function handleUserResponse(answer: string, fromSuggested = false) {
    if (loading || gameOver) return;
    if (fromSuggested) {
      const newCount = suggestedUsedCount + 1;
      setSuggestedUsedCount(newCount);
      if (newCount >= 4 && !showedHintEnd) {
        showHintAfterResponse.current = true;
      }
    }
    setMessages((prev) => [...prev, { role: "user", content: answer }]);
    await sendToAPI(answer, history);
  }

  async function handleGuessResponse(correct: boolean) {
    const response = correct
      ? "맞아! 정답이야!"
      : "아니, 틀렸어. 다시 시도해봐.";
    setMessages((prev) => [...prev, { role: "user", content: response }]);

    if (correct) {
      setGameOver(true);
      setMessages((prev) => [
        ...prev,
        {
          role: "bongshin",
          content:
            "크흠... 봉신의 유리구슬은 거짓말을 하지 않지. 역시 봉신이다!",
          isCorrect: true,
        },
      ]);
    } else {
      await sendToAPI(response, history);
    }
  }

  function handleSubmitInput() {
    if (!input.trim() || loading || gameOver) return;
    const msg = input.trim();
    setInput("");
    handleUserResponse(msg);
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

  const avgTurns = finalAnswer ? getFakeAverage(finalAnswer) : null;

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
        </div>
        <div className="text-lg">🔮</div>
      </header>

      {/* 채팅 영역 — 메시지가 하단부터 쌓임 (카톡 방식) */}
      <div ref={chatContainerRef} className="flex-1 min-h-0 overflow-y-auto flex flex-col relative z-10">
        <div className="mt-auto px-4 py-4 space-y-4 relative z-10">
        {messages.map((msg, i) => (
          <div key={i}>
            {msg.role === "bongshin" ? (
              <div className="flex gap-2 items-start">
                <div className="w-8 h-8 rounded-full bg-mystic/20 flex items-center justify-center text-sm shrink-0">
                  🔮
                </div>
                <div className="max-w-[80%]">
                  <div
                    className={`px-4 py-3 rounded-2xl rounded-tl-sm text-sm leading-relaxed ${
                      msg.isGuess
                        ? "bg-mystic text-black font-medium"
                        : msg.isCorrect
                        ? "bg-mystic-dark text-text-bright"
                        : "bg-bg-card border border-border text-text"
                    }`}
                  >
                    {msg.content}
                  </div>

                  {msg.isGuess &&
                    !msg.isCorrect &&
                    !gameOver &&
                    mode === "ai-guesses" && (
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={() => handleGuessResponse(true)}
                          className="px-4 py-1.5 rounded-full bg-mystic text-black text-xs font-medium hover:bg-mystic-light transition-colors"
                        >
                          맞아!
                        </button>
                        <button
                          onClick={() => handleGuessResponse(false)}
                          className="px-4 py-1.5 rounded-full bg-bg-card border border-border text-text-dim text-xs font-medium hover:border-mystic/50 transition-colors"
                        >
                          아니야
                        </button>
                      </div>
                    )}

                  {msg.suggestedQuestions &&
                    mode === "user-guesses" &&
                    !gameOver &&
                    suggestedUsedCount < 4 &&
                    i === messages.length - 1 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {msg.suggestedQuestions.map((q, j) => (
                          <button
                            key={j}
                            onClick={() => handleUserResponse(q, true)}
                            disabled={loading}
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
        </div>
      </div>

      {/* 하단 입력 영역 — 고정 */}
      <div className="z-20 bg-bg/90 backdrop-blur-sm shrink-0">
        {!gameOver ? (
          mode === "ai-guesses" ? (
            <div className="px-4 py-3 border-t border-border">
              <div className="flex gap-2 justify-center">
                {["응, 맞아", "아니", "모르겠어"].map((answer) => (
                  <button
                    key={answer}
                    onClick={() => handleUserResponse(answer)}
                    disabled={loading}
                    className="px-5 py-2.5 rounded-full bg-bg-card border border-border text-sm font-medium text-text active:bg-mystic active:text-black active:border-mystic transition-all disabled:opacity-50"
                  >
                    {answer}
                  </button>
                ))}
              </div>
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
        ) : (
          <div className="px-4 py-5 border-t border-border text-center space-y-4">
            {mode === "user-guesses" && avgTurns && (
              <div className="bg-bg-card border border-border rounded-2xl px-4 py-3 space-y-1">
                <p className="text-xs text-text-dim">
                  다른 사람들은 평균 <span className="text-mystic font-bold">{avgTurns}번</span> 만에 맞췄다
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
                onClick={() => router.push("/")}
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
