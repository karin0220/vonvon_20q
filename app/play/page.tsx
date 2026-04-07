"use client";

import { useState, useRef, useEffect, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ChatMessage, ChatResponse, GameMode } from "@/lib/types";

function GameContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const mode = (searchParams.get("mode") || "ai-guesses") as GameMode;
  const category = searchParams.get("category") || "연예인";

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [history, setHistory] = useState<
    { role: "user" | "model"; content: string }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [turnCount, setTurnCount] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [input, setInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

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
          body: JSON.stringify({ mode, category, messages: newHistory }),
        });

        if (!res.ok) throw new Error("API error");

        const data: ChatResponse = await res.json();

        const updatedHistory = [
          ...newHistory,
          { role: "model" as const, content: data.message },
        ];
        setHistory(updatedHistory);
        setTurnCount(data.turnCount);

        setMessages((prev) => [
          ...prev,
          {
            role: "bongshin",
            content: data.message,
            suggestedQuestions: data.suggestedQuestions || undefined,
            isGuess: data.isGuess,
          },
        ]);

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
    [mode, category]
  );

  // Initialize game
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const initMessage =
      mode === "ai-guesses"
        ? `게임을 시작한다. 유저가 "${category}" 카테고리에서 하나를 떠올렸다. 첫 질문을 해라.`
        : `게임을 시작한다. "${category}" 카테고리에서 하나를 골라라. 정답은 밝히지 말고 게임 시작 멘트를 해라.`;

    sendToAPI(initMessage, []);
  }, [mode, category, sendToAPI]);

  async function handleUserResponse(answer: string) {
    if (loading || gameOver) return;

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

  return (
    <div className="flex-1 flex flex-col w-full h-full">
      {/* 헤더 */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border">
        <button
          onClick={() => router.push("/")}
          className="text-text-dim hover:text-mystic-light text-sm"
        >
          ← 돌아가기
        </button>
        <div className="text-center">
          <span className="text-xs text-text-dim">{category}</span>
          <span className="text-xs text-mystic ml-2">{turnCount}/20</span>
        </div>
        <div className="text-lg">🔮</div>
      </header>

      {/* 채팅 영역 */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
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

                  {/* AI가 맞추기 모드: 추측일 때 맞다/틀리다 버튼 */}
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

                  {/* 유저 맞추기 모드: 추천 질문 */}
                  {msg.suggestedQuestions &&
                    !gameOver &&
                    i === messages.length - 1 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {msg.suggestedQuestions.map((q, j) => (
                          <button
                            key={j}
                            onClick={() => handleUserResponse(q)}
                            disabled={loading}
                            className="px-3 py-1.5 rounded-full bg-bg-card border border-border text-text-dim text-xs hover:border-mystic/50 hover:text-mystic-light transition-colors disabled:opacity-50"
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

        <div ref={chatEndRef} />
      </div>

      {/* 입력 영역 */}
      {!gameOver ? (
        mode === "ai-guesses" ? (
          <div className="px-4 py-3 border-t border-border">
            <div className="flex gap-2 justify-center">
              {["응, 맞아", "아니", "모르겠어"].map((answer) => (
                <button
                  key={answer}
                  onClick={() => handleUserResponse(answer)}
                  disabled={loading}
                  className="px-5 py-2.5 rounded-full bg-bg-card border border-border text-sm font-medium text-text hover:bg-mystic hover:text-black hover:border-mystic transition-all disabled:opacity-50"
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
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSubmitInput();
                }}
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
        <div className="px-4 py-4 border-t border-border text-center space-y-3">
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
              onClick={() => {
                const text = `봉신의 스무고개에서 ${turnCount}턴 만에 ${
                  mode === "ai-guesses" ? "봉신이 맞췄다" : "맞췄다"
                }! 🔮`;
                navigator.clipboard.writeText(text);
              }}
              className="px-5 py-2.5 rounded-full bg-bg-card border border-border text-text text-sm font-medium hover:border-mystic/50 transition-colors"
            >
              결과 공유
            </button>
          </div>
        </div>
      )}
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
