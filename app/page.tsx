"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { GameMode, CATEGORIES } from "@/lib/types";
import { Sparkles, ChessKing, Box, UtensilsCrossed, PawPrint, Clapperboard } from "lucide-react";

const ICONS = { Sparkles, ChessKing, Box, UtensilsCrossed, PawPrint, Clapperboard } as const;

export default function Home() {
  const router = useRouter();
  const [mode, setMode] = useState<GameMode>("ai-guesses");
  const [customCategory, setCustomCategory] = useState("");
  const [showCustom, setShowCustom] = useState(false);

  function startGame(category: string) {
    const params = new URLSearchParams({ mode, category });
    router.push(`/play?${params.toString()}`);
  }

  return (
    <main className="flex-1 flex flex-col">
      {/* 히어로 이미지 + 그라데이션 */}
      <div className="relative w-full">
        <Image
          src="/bongshin.png"
          alt="봉신"
          width={480}
          height={480}
          className="w-full h-auto"
          priority
        />
        {/* 하단 그라데이션 오버레이 */}
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-black to-transparent" />
      </div>

      {/* 컨텐츠 영역 */}
      <div className="px-5 pb-8 -mt-8 relative z-10 flex flex-col items-center">
        <Image
          src="/logo.png"
          alt="봉신과 스무고개"
          width={360}
          height={60}
          className="mb-6 w-full max-w-[360px] h-auto"
        />

        {/* 모드 토글 */}
        <div className="w-full bg-bg-card rounded-full p-1 flex mb-8 border border-border">
          <button
            onClick={() => setMode("ai-guesses")}
            className={`flex-1 py-2.5 rounded-full text-sm font-medium transition-all ${
              mode === "ai-guesses"
                ? "bg-mystic text-black shadow-md"
                : "text-text-dim hover:text-text"
            }`}
          >
            봉신이 맞출게
          </button>
          <button
            onClick={() => setMode("user-guesses")}
            className={`flex-1 py-2.5 rounded-full text-sm font-medium transition-all ${
              mode === "user-guesses"
                ? "bg-mystic text-black shadow-md"
                : "text-text-dim hover:text-text"
            }`}
          >
            네가 맞춰봐
          </button>
        </div>

        {/* 카테고리 선택 */}
        <p className="text-sm text-mystic-light mb-3">
          {mode === "ai-guesses"
            ? "무엇을 떠올릴 건가?"
            : "봉신이 무엇을 떠올릴까?"}
        </p>
        <div className="grid grid-cols-3 gap-3 w-full mb-4">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => startGame(cat.label)}
              className="flex flex-col items-center gap-1.5 py-4 px-2 rounded-2xl bg-bg-card hover:bg-bg-card-hover border border-border hover:border-mystic/50 transition-all"
            >
              {(() => { const Icon = ICONS[cat.icon]; return <Icon className="w-6 h-6 text-mystic" />; })()}
              <span className="text-sm font-medium text-text">
                {cat.label}
              </span>
            </button>
          ))}
        </div>

        {/* 직접 입력 */}
        {!showCustom ? (
          <button
            onClick={() => setShowCustom(true)}
            className="text-sm text-text-dim hover:text-mystic-light underline underline-offset-4 transition-colors"
          >
            직접 입력하기
          </button>
        ) : (
          <div className="flex gap-2 w-full">
            <input
              type="text"
              value={customCategory}
              onChange={(e) => setCustomCategory(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && customCategory.trim()) {
                  startGame(customCategory.trim());
                }
              }}
              placeholder="카테고리를 입력해봐"
              className="flex-1 px-4 py-2.5 rounded-xl bg-bg-card border border-border focus:border-mystic/50 focus:outline-none text-sm text-text placeholder:text-text-dim"
              autoFocus
            />
            <button
              onClick={() => {
                if (customCategory.trim()) startGame(customCategory.trim());
              }}
              className="px-5 py-2.5 rounded-xl bg-mystic text-black text-sm font-medium hover:bg-mystic-light transition-colors"
            >
              시작
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
