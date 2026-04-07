"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { GameMode, CATEGORIES, getDailyCategory } from "@/lib/types";
import { Sparkles, ChessKing, Box, PawPrint, Clapperboard, Flame, Globe } from "lucide-react";

const ICONS = { Sparkles, ChessKing, Box, PawPrint, Clapperboard } as const;

const RECENT_ANSWERS = [
  "아이유", "나루토 우즈마키", "피카���", "오징어 게임", "짱구는 못말려",
  "손��민", "엘���", "루피", "방탄소년단", "고양이",
  "아이폰", "에스프레소 머신", "해리포터와 마법사의 돌", "슈퍼마리오", "이순신 장군",
  "이웃집 토토로", "��랙핑크", "기생충", "골든 리트리버", "신라면",
  "뽀로로", "김치찌개", "스파이더맨", "테슬라", "유재석",
];

export default function Home() {
  const router = useRouter();
  const [mode, setMode] = useState<GameMode>("user-guesses");
  const [starting, setStarting] = useState(false);
  const dailyCategory = useMemo(() => getDailyCategory(), []);

  function startGame(category: string) {
    setStarting(true);
    const params = new URLSearchParams({ mode, category });
    router.push(`/play?${params.toString()}`);
  }

  return (
    <main className="flex-1 flex flex-col">
      {/* 전광판 — 최근 플레이 정답 */}
      <div className="relative overflow-hidden bg-bg-card/80 border-b border-border py-2">
        <div className="flex animate-marquee">
          {[0, 1].map((set) => (
            <div key={set} className="flex shrink-0" style={{ gap: "2rem" }}>
              {RECENT_ANSWERS.map((answer, i) => (
                <span key={i} className="text-text-dim whitespace-nowrap" style={{ fontSize: `${11 + (answer.length % 3)}px`, marginRight: set === 0 && i === RECENT_ANSWERS.length - 1 ? "2rem" : undefined }}>
                  <span className="text-mystic/70">🔮</span> {answer}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* 히어로 이미지 + 그라데이션 */}
      <div className="relative w-full animate-hero-in" style={{ aspectRatio: "2016/1917" }}>
        <Image
          src="/bongshin.png"
          alt="봉신"
          fill
          className="object-cover"
          priority
        />
        {/* 유리구슬 glow */}
        <div
          className="absolute animate-orb-glow rounded-full pointer-events-none"
          style={{
            width: "30%",
            height: "30%",
            left: "37%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            background: "radial-gradient(circle, rgba(180,220,240,0.6) 0%, rgba(168,216,234,0.3) 30%, rgba(168,216,234,0.1) 50%, transparent 70%)",
          }}
        />
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-black to-transparent" />
      </div>

      {/* 컨텐츠 영역 */}
      <div className="px-5 pb-8 -mt-12 relative z-10 flex flex-col items-center">
        <div className="mb-6 w-full max-w-[360px] animate-logo-in" style={{ aspectRatio: "4400/1237" }}>
          <Image
            src="/logo.png"
            alt="봉신과 스무고개"
            width={440}
            height={124}
            className="w-full h-auto"
          />
        </div>

        {/* 모드 토글 */}
        <div className="w-full bg-bg-card rounded-full p-1 flex mb-8 border border-border">
          <button
            onClick={() => setMode("user-guesses")}
            className={`flex-1 py-2.5 rounded-full text-sm font-medium transition-all ${
              mode === "user-guesses"
                ? "bg-mystic text-black shadow-md"
                : "text-text-dim hover:text-text"
            }`}
          >
            봉신이 문제낼게
          </button>
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
        </div>

        {/* 카테고리 선택 */}
        <div className="grid grid-cols-3 gap-3 w-full">
          {/* 오늘의 주제 / 전체 */}
          <button
            onClick={() => startGame(mode === "user-guesses" ? dailyCategory : "전체")}
            disabled={starting}
            className={`flex flex-col items-center gap-1.5 py-4 px-2 rounded-2xl bg-bg-card hover:bg-bg-card-hover transition-all disabled:opacity-50 ${
              mode === "user-guesses"
                ? "border border-mystic/30 hover:border-mystic/60 animate-gold-glow"
                : "border border-border hover:border-mystic/50"
            }`}
          >
            {mode === "user-guesses"
              ? <Flame className="w-6 h-6 text-mystic" />
              : <Globe className="w-6 h-6 text-mystic" />
            }
            <span className={`text-sm font-medium ${mode === "user-guesses" ? "text-mystic" : "text-text"}`}>
              {mode === "user-guesses" ? "오늘의 주제" : "전체"}
            </span>
          </button>

          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => startGame(cat.label)}
              disabled={starting}
              className="flex flex-col items-center gap-1.5 py-4 px-2 rounded-2xl bg-bg-card hover:bg-bg-card-hover border border-border hover:border-mystic/50 transition-all disabled:opacity-50"
            >
              {(() => { const Icon = ICONS[cat.icon]; return <Icon className="w-6 h-6 text-mystic" />; })()}
              <span className="text-sm font-medium text-text">
                {cat.label}
              </span>
            </button>
          ))}
        </div>

        {/* {starting && (
          <div className="mt-6 text-mystic animate-pulse-slow text-sm">
            봉신이 유리구슬을 닦고 있다...
          </div>
        )} */}
      </div>
    </main>
  );
}
