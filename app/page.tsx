"use client";

import { useState, useMemo, Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { GameMode, CATEGORIES, RecentPlayItem, getDailyCategory } from "@/lib/types";
import { Sparkles, Wand2, Clapperboard, Tv, Music, Flame, Globe } from "lucide-react";

const ICONS = { Sparkles, Wand2, Clapperboard, Tv, Music } as const;

const RECENT_ANSWERS = [
  "아이유", "나루토", "오징어 게임", "도깨비", "Butter",
  "손흥민", "엘사", "기생충", "눈물의 여왕", "APT.",
  "루피", "블랙핑크", "올드보이", "사랑의 불시착", "좋은 날",
  "유재석", "짱구", "범죄도시", "시그널", "Super Shy",
  "뉴진스", "스파이더맨", "부산행", "미생", "밤양갱",
];

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialMode = (searchParams.get("mode") as GameMode) || "user-guesses";
  const [mode, setMode] = useState<GameMode>(initialMode);
  const [starting, setStarting] = useState(false);
  const [recentPlays, setRecentPlays] = useState<RecentPlayItem[]>([]);
  const dailyCategory = useMemo(() => getDailyCategory(), []);

  useEffect(() => {
    let active = true;

    async function loadFeed() {
      try {
        const res = await fetch("/api/feed", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { items?: RecentPlayItem[] };
        if (active && data.items?.length) {
          setRecentPlays(data.items);
        }
      } catch {
        // Keep local fallback feed.
      }
    }

    void loadFeed();
    const timer = window.setInterval(loadFeed, 30000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const marqueeItems = recentPlays.length
    ? recentPlays.map((item) => `${item.category} · ${item.answer} (${item.turnCount}턴)`)
    : RECENT_ANSWERS;

  function startGame(category: string) {
    setStarting(true);
    const params = new URLSearchParams({ mode, category });
    router.push(`/play?${params.toString()}`);
  }

  return (
    <main className="flex-1 flex flex-col">
      {/* 전광판 — 최근 플레이 정답 */}
      <div className="relative overflow-hidden bg-bg-card/80 border-b border-border py-1.5">
        <div className="marquee-track">
          {[0, 1].map((set) => (
            <span key={set} className="marquee-content">
              {marqueeItems.map((answer, i) => (
                <span key={i} className="text-xs text-text-dim whitespace-nowrap">
                  <span className="text-mystic/60 text-[10px]">&#x2726;</span> {answer}
                </span>
              ))}
            </span>
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

      </div>

      {/* powered by vonvon */}
      <div className="flex items-center justify-center gap-2 py-5 pb-8">
        <span className="text-sm text-text-dim/40">powered by</span>
        <Image
          src="/vonvon-logo.png"
          alt="vonvon"
          width={132}
          height={35}
          className="h-[30px] w-auto opacity-30 brightness-0 invert"
        />
      </div>
    </main>
  );
}

export default function Home() {
  return (
    <Suspense>
      <HomeContent />
    </Suspense>
  );
}
