import { ChatResponse } from "./types";

// --- 결정 트리 노드 ---
interface TreeNode {
  q: string;    // 코어 질문 ("그 인물은 한국인이냐?")
  axis: string; // 축 이름
  yes: string;  // Yes일 때 팩트 라벨
  no: string;   // No일 때 팩트 라벨
}

function n(q: string, axis: string, yes: string, no: string): TreeNode {
  return { q, axis, yes, no };
}

// --- 말투 오프너 풀 ---
const FIRST_OPENERS = [
  "흠... 봉신의 유리구슬에 뭔가가 비친다.",
  "오호... 유리구슬이 흔들린다.",
  "봉신이 기운을 읽어본다...",
  "자... 구슬에 형체가 잡힌다.",
];

const YES_OPENERS = [
  "좋다.", "그렇군.", "됐어.", "오호...", "흥미롭군.",
  "봉신의 구슬이 더 밝아진다.", "구슬이 맑아지는군.",
  "역시...", "그런가.",
];

const NO_OPENERS = [
  "흠...", "크흠...", "그런가.", "알겠다.", "오호...",
  "봉신의 구슬이 방향을 바꾼다.", "구슬에 다른 기운이 비친다.",
  "아닌가...", "그렇지 않군.",
];

const AMBIGUOUS_OPENERS = [
  "미묘하군...", "구슬이 흐릿해지는군.", "오호... 그런가.",
  "봉신도 갈피를 못 잡겠군.", "흠... 알 수 없는 기운이다.",
];

// --- 유저 답변 분류 ---
function classifyAnswer(content: string): "Y" | "N" | "A" {
  const c = content.trim();
  if (/^(응|맞|그래|그렇|어$)/.test(c) || c.includes("맞아")) return "Y";
  if (c.includes("애매") || c.includes("모르겠") || c.includes("글쎄")) return "A";
  return "N";
}

// 트리 탐색용: 애매한 답변은 N으로 처리 (보수적 분기)
function toTreePath(answer: "Y" | "N" | "A"): "Y" | "N" {
  return answer === "Y" ? "Y" : "N";
}

export function buildAnswerPath(
  messages: { role: string; content: string }[]
): { path: string; lastRaw: "Y" | "N" | "A" | null } {
  const userMsgs = messages.filter((m) => m.role === "user").slice(1);
  if (userMsgs.length === 0) return { path: "", lastRaw: null };
  const answers = userMsgs.map((m) => classifyAnswer(m.content));
  const path = answers.map(toTreePath).join("");
  return { path, lastRaw: answers[answers.length - 1] };
}

// --- 트리 데이터 ---
// 키: "turn:pathPrefix"
// 조회: 정확 매치 → 짧은 접두사 fallback

const FAMOUS: Record<string, TreeNode> = {
  // T0
  "0:":    n("그 인물은 한국인이냐?", "korean", "한국인", "외국인"),
  // T1
  "1:Y":   n("그 인물은 남자냐?", "gender", "남자", "여자"),
  "1:N":   n("그 인물은 현재 살아있는 사람이냐?", "alive", "생존 인물", "역사 속 인물"),
  // T2
  "2:YY":  n("그 인물은 연예인이냐?", "entertainer", "연예인", "비연예인"),
  "2:YN":  n("그 인물은 연예인이냐?", "entertainer", "연예인", "비연예인"),
  "2:NY":  n("그 인물은 남자냐?", "gender", "남자", "여자"),
  "2:NN":  n("그 인물은 남자냐?", "gender", "남자", "여자"),
  // T3
  "3:YYY": n("그 인물은 가수냐? 아이돌도 포함해서.", "singer", "가수/아이돌", "가수 아님"),
  "3:YYN": n("그 인물은 운동선수냐?", "athlete", "운동선수", "운동선수 아님"),
  "3:YNY": n("그 인물은 가수냐? 아이돌도 포함해서.", "singer", "가수/아이돌", "가수 아님"),
  "3:YNN": n("그 인물은 정치인이냐?", "politician", "정치인", "정치인 아님"),
  "3:NYY": n("그 인물은 배우냐?", "actor", "배우", "배우 아님"),
  "3:NYN": n("그 인물은 가수냐?", "singer", "가수", "가수 아님"),
  "3:NNY": n("그 인물은 정치인이나 군인이냐?", "politician", "정치/군인", "정치/군인 아님"),
  "3:NNN": n("그 인물은 정치인이냐?", "politician", "정치인", "정치인 아님"),
  // T4 — 주요 경로 + 그룹 fallback
  "4:YYYY": n("그 가수는 아이돌 그룹 소속이냐?", "idol_group", "아이돌 그룹", "솔로/비아이돌"),
  "4:YYYN": n("그 인물은 배우냐?", "actor", "배우", "배우 아님"),
  "4:YYNY": n("그 선수는 축구선수냐?", "soccer", "축구선수", "타종목"),
  "4:YYNN": n("그 인물은 현재도 활동 중이냐?", "active", "활동 중", "은퇴/비활동"),
  "4:YNYY": n("그 가수는 아이돌 그룹 소속이냐?", "idol_group", "아이돌 그룹", "솔로/비아이돌"),
  "4:YNYN": n("그 인물은 배우냐?", "actor", "배우", "배우 아님"),
  "4:YNN":  n("그 인물은 유튜버나 인플루언서냐?", "influencer", "인플루언서", "인플루언서 아님"),
  "4:NY":   n("그 인물은 미국인이냐?", "american", "미국인", "미국인 아님"),
  "4:NN":   n("그 인물은 20세기 이후 인물이냐?", "era", "근현대", "그 이전"),
  // T5 — 그룹 fallback
  "5:YYYY": n("그 인물은 현재도 활동 중이냐?", "active", "활동 중", "은퇴/비활동"),
  "5:YNYY": n("그 인물은 현재도 활동 중이냐?", "active", "활동 중", "은퇴/비활동"),
  "5:YY":   n("그 인물은 30대 이하냐?", "age", "30대 이하", "40대 이상"),
  "5:YN":   n("그 인물은 30대 이하냐?", "age", "30대 이하", "40대 이상"),
  "5:NY":   n("그 인물은 현재도 활동 중이냐?", "active", "활동 중", "은퇴/비활동"),
  "5:NN":   n("그 인물은 유럽인이냐?", "european", "유럽인", "유럽인 아님"),
};

const CHARACTER: Record<string, TreeNode> = {
  "0:":    n("그 캐릭터는 일본 애니메이션이나 만화에서 나오는 존재냐?", "japanese_anime", "일본 애니/만화", "일본 애니/만화 아님"),
  "1:Y":   n("그 캐릭터는 남자냐?", "gender", "남자", "여자"),
  "1:N":   n("그 캐릭터는 게임에서 나오는 존재냐?", "game", "게임 캐릭터", "게임 아님"),
  "2:YY":  n("그 캐릭터가 나오는 작품은 소년만화냐? 점프나 매거진 같은.", "shonen", "소년만화", "소년만화 아님"),
  "2:YN":  n("그 캐릭터는 그 작품의 주인공이냐?", "protagonist", "주인공", "주인공 아님"),
  "2:NY":  n("그 캐릭터는 남자냐?", "gender", "남자", "여자"),
  "2:NN":  n("그 캐릭터는 한국 웹툰이나 드라마에서 나오는 존재냐?", "korean_media", "한국 웹툰/드라마", "기타 매체"),
  "3:YYY": n("그 캐릭터는 그 작품의 주인공이냐?", "protagonist", "주인공", "주인공 아님"),
  "3:YYN": n("그 캐릭터는 그 작품의 주인공이냐?", "protagonist", "주인공", "주인공 아님"),
  "3:YNY": n("그 캐릭터는 인간이냐?", "human", "인간", "비인간"),
  "3:YNN": n("그 캐릭터는 인간이냐?", "human", "인간", "비인간"),
  "3:NYY": n("그 캐릭터는 인간이냐?", "human", "인간", "비인간"),
  "3:NYN": n("그 캐릭터는 인간이냐?", "human", "인간", "비인간"),
  "3:NNY": n("그 캐릭터는 남자냐?", "gender", "남자", "여자"),
  "3:NNN": n("그 캐릭터는 남자냐?", "gender", "남자", "여자"),
  // T4
  "4:YY":  n("그 캐릭터는 특수한 능력을 가졌느냐?", "power", "능력자", "비능력자"),
  "4:YN":  n("그 캐릭터는 학생이냐?", "student", "학생", "학생 아님"),
  "4:NY":  n("그 캐릭터는 특수한 능력을 가졌느냐?", "power", "능력자", "비능력자"),
  "4:NN":  n("그 캐릭터는 주인공이냐?", "protagonist", "주인공", "주인공 아님"),
  // T5
  "5:Y":   n("그 캐릭터가 나오는 작품은 현재도 연재 중이거나 시리즈가 계속되고 있느냐?", "ongoing", "연재/방영 중", "완결"),
  "5:N":   n("그 캐릭터가 나오는 작품은 2010년 이후에 나온 것이냐?", "era", "2010년 이후", "2010년 이전"),
};

const MOVIE: Record<string, TreeNode> = {
  "0:":    n("그 영화는 한국 영화냐?", "korean", "한국 영화", "외국 영화"),
  "1:Y":   n("그 영화는 2015년 이후에 개봉한 것이냐?", "era", "2015년 이후", "2015년 이전"),
  "1:N":   n("그 영화는 미국(할리우드) 영화냐?", "hollywood", "할리우드", "할리우드 아님"),
  "2:YY":  n("그 영화의 장르가 범죄나 스릴러냐?", "crime_thriller", "범죄/스릴러", "범죄/스릴러 아님"),
  "2:YN":  n("그 영화의 장르가 범죄나 스릴러냐?", "crime_thriller", "범죄/스릴러", "범죄/스릴러 아님"),
  "2:NY":  n("그 영화는 2010년 이후에 개봉한 것이냐?", "era", "2010년 이후", "2010년 이전"),
  "2:NN":  n("그 영화는 일본 영화냐?", "japanese", "일본 영화", "기타 국가"),
  "3:YYY": n("그 영화는 시리즈물이냐? 속편이 있는 영화냐?", "franchise", "시리즈", "단독작"),
  "3:YYN": n("그 영화는 실화를 바탕으로 한 것이냐?", "true_story", "실화 기반", "실화 아님"),
  "3:YNY": n("그 영화는 시리즈물이냐?", "franchise", "시리즈", "단독작"),
  "3:YNN": n("그 영화는 실화를 바탕으로 한 것이냐?", "true_story", "실화 기반", "실화 아님"),
  "3:NYY": n("그 영화는 액션 장르냐?", "action", "액션", "액션 아님"),
  "3:NYN": n("그 영화는 액션 장르냐?", "action", "액션", "액션 아님"),
  "3:NNY": n("그 영화는 애니메이션이냐?", "animation", "애니메이션", "실사"),
  "3:NNN": n("그 영화는 애니메이션이냐?", "animation", "애니메이션", "실사"),
  // T4
  "4:YY":  n("그 영화에 천만 관객이 들었느냐?", "blockbuster", "천만 영화", "천만 미만"),
  "4:YN":  n("그 영화에 유명 배우가 주연이냐?", "star_actor", "스타 주연", "비스타"),
  "4:NY":  n("그 영화는 시리즈물이냐?", "franchise", "시리즈", "단독작"),
  "4:NN":  n("그 영화는 2000년 이후 작품이냐?", "era2", "2000년 이후", "2000년 이전"),
  // T5
  "5:Y":   n("그 영화의 주인공은 남자냐?", "protagonist_gender", "남자 주인공", "여자 주인공"),
  "5:N":   n("그 영화는 수상 경력이 있느냐? 오스카나 칸 같은.", "award", "수상작", "비수상"),
};

const DRAMA: Record<string, TreeNode> = {
  "0:":    n("그 드라마는 한국 드라마냐?", "korean", "한국 드라마", "외국 드라마"),
  "1:Y":   n("그 드라마는 2020년 이후에 방영된 것이냐?", "era", "2020년 이후", "2020년 이전"),
  "1:N":   n("그 드라마는 미국 드라마냐?", "american", "미국 드라마", "미국 아님"),
  "2:YY":  n("그 드라마는 로맨스 장르냐?", "romance", "로맨스", "로맨스 아님"),
  "2:YN":  n("그 드라마는 사극이냐?", "historical", "사극", "사극 아님"),
  "2:NY":  n("그 드라마는 2015년 이후에 방영된 것이냐?", "era", "2015년 이후", "2015년 이전"),
  "2:NN":  n("그 드라마는 일본 드라마냐?", "japanese", "일본 드라마", "기타 국가"),
  "3:YYY": n("그 드라마는 OTT 오리지널이냐? 넷플릭스나 티빙 같은.", "ott", "OTT", "지상파/케이블"),
  "3:YYN": n("그 드라마에 판타지나 SF 요소가 있느냐?", "fantasy", "판타지/SF", "현실극"),
  "3:YNY": n("그 드라마는 로맨스 장르냐?", "romance", "로맨스", "로맨스 아님"),
  "3:YNN": n("그 드라마는 로맨스 장르냐?", "romance", "로맨스", "로맨스 아님"),
  "3:NYY": n("그 드라마는 시즌제냐? 시즌 2 이상이 있냐?", "multi_season", "시즌제", "단일 시즌"),
  "3:NYN": n("그 드라마는 시즌제냐?", "multi_season", "시즌제", "단일 시즌"),
  "3:NNY": n("그 드라마는 애니메이션이냐?", "animation", "애니", "실사"),
  "3:NNN": n("그 드라마는 애니메이션이냐?", "animation", "애니", "실사"),
  // T4
  "4:YY":  n("그 드라마는 시즌제냐?", "multi_season", "시즌제", "단일 시즌"),
  "4:YN":  n("그 드라마는 OTT 오리지널이냐?", "ott", "OTT", "지상파/케이블"),
  "4:NY":  n("그 드라마의 주인공은 남자냐?", "protagonist_gender", "남자 주인공", "여자 주인공"),
  "4:NN":  n("그 드라마의 주인공은 남자냐?", "protagonist_gender", "남자 주인공", "여자 주인공"),
  // T5
  "5:Y":   n("그 드라마에 원작이 있느냐? 웹소설이나 웹툰 같은.", "adaptation", "원작 있음", "오리지널"),
  "5:N":   n("그 드라마는 해외에서도 큰 인기를 끌었느냐?", "global_hit", "글로벌 히트", "글로벌 히트 아님"),
};

const SONG: Record<string, TreeNode> = {
  "0:":    n("그 노래는 한국 노래냐?", "korean", "한국 노래", "외국 노래"),
  "1:Y":   n("그 노래를 부른 가수는 남자냐? 남자 그룹도 포함해서.", "gender", "남자", "여자"),
  "1:N":   n("그 노래는 영어 노래냐?", "english", "영어 노래", "영어 아님"),
  "2:YY":  n("그 노래를 부른 건 아이돌이나 그룹이냐?", "idol_group", "아이돌/그룹", "솔로/비아이돌"),
  "2:YN":  n("그 노래를 부른 건 아이돌이나 그룹이냐?", "idol_group", "아이돌/그룹", "솔로/비아이돌"),
  "2:NY":  n("그 노래를 부른 가수는 남자냐?", "gender", "남자", "여자"),
  "2:NN":  n("그 노래는 일본 노래냐?", "japanese", "일본 노래", "기타"),
  "3:YYY": n("그 노래는 댄스곡이냐?", "dance", "댄스곡", "댄스 아님"),
  "3:YYN": n("그 노래는 발라드냐?", "ballad", "발라드", "발라드 아님"),
  "3:YNY": n("그 노래는 댄스곡이냐?", "dance", "댄스곡", "댄스 아님"),
  "3:YNN": n("그 노래는 발라드냐?", "ballad", "발라드", "발라드 아님"),
  "3:NYY": n("그 노래는 2010년 이후에 나온 곡이냐?", "era", "2010년 이후", "2010년 이전"),
  "3:NYN": n("그 노래는 2010년 이후에 나온 곡이냐?", "era", "2010년 이후", "2010년 이전"),
  "3:NNY": n("그 노래를 부른 가수는 남자냐?", "gender", "남자", "여자"),
  "3:NNN": n("그 노래를 부른 가수는 남자냐?", "gender", "남자", "여자"),
  // T4
  "4:YY":  n("그 노래는 2020년 이후에 나온 곡이냐?", "era", "2020년 이후", "2020년 이전"),
  "4:YN":  n("그 노래는 2020년 이후에 나온 곡이냐?", "era", "2020년 이후", "2020년 이전"),
  "4:NY":  n("그 노래는 팝 장르냐?", "pop", "팝", "팝 아님"),
  "4:NN":  n("그 노래는 애니메이션 OST냐?", "anime_ost", "애니 OST", "애니 OST 아님"),
  // T5
  "5:Y":   n("그 노래는 드라마나 영화 OST냐?", "ost", "OST", "OST 아님"),
  "5:N":   n("그 노래의 뮤직비디오 조회수가 1억 이상이냐?", "viral", "1억뷰 이상", "1억뷰 미만"),
};

const ALL: Record<string, TreeNode> = {
  "0:":    n("네가 떠올린 것은 실존하는 사람이냐?", "real_person", "실존 인물", "실존 인물 아님"),
  "1:Y":   n("그 인물은 한국인이냐?", "korean", "한국인", "외국인"),
  "1:N":   n("그것은 영상 작품이냐? 영화나 드라마 같은.", "visual_media", "영상 작품", "영상 아님"),
  "2:YY":  n("그 인물은 남자냐?", "gender", "남자", "여자"),
  "2:YN":  n("그 인물은 남자냐?", "gender", "남자", "여자"),
  "2:NY":  n("그 작품은 한국 작품이냐?", "korean", "한국 작품", "외국 작품"),
  "2:NN":  n("그것은 노래냐?", "song", "노래", "노래 아님"),
  "3:YYY": n("그 인물은 연예인이냐?", "entertainer", "연예인", "비연예인"),
  "3:YYN": n("그 인물은 연예인이냐?", "entertainer", "연예인", "비연예인"),
  "3:YNY": n("그 인물은 연예인이냐?", "entertainer", "연예인", "비연예인"),
  "3:YNN": n("그 인물은 연예인이냐?", "entertainer", "연예인", "비연예인"),
  "3:NYY": n("그 작품은 영화냐?", "movie", "영화", "드라마"),
  "3:NYN": n("그 작품은 영화냐?", "movie", "영화", "드라마"),
  "3:NNY": n("그 노래는 한국 노래냐?", "korean", "한국 노래", "외국 노래"),
  "3:NNN": n("그것은 가상의 캐릭터냐?", "character", "캐릭터", "캐릭터 아님"),
  // T4
  "4:YY":  n("그 인물은 가수냐?", "singer", "가수", "가수 아님"),
  "4:YN":  n("그 인물은 가수냐?", "singer", "가수", "가수 아님"),
  "4:NY":  n("그 작품은 2015년 이후에 나온 것이냐?", "era", "2015년 이후", "2015년 이전"),
  "4:NN":  n("그것은 남자와 관련이 있느냐?", "gender", "남성 관련", "여성 관련"),
  // T5
  "5:Y":   n("그 인물은 30대 이하냐?", "age", "30대 이하", "40대 이상"),
  "5:N":   n("그것은 2010년 이후에 나온 것이냐?", "era", "2010년 이후", "2010년 이전"),
};

const TREES: Record<string, Record<string, TreeNode>> = {
  "유명인": FAMOUS,
  "캐릭터": CHARACTER,
  "영화": MOVIE,
  "드라마": DRAMA,
  "노래": SONG,
  "전체": ALL,
};

// --- 트리 조회 ---
function lookupNode(
  tree: Record<string, TreeNode>,
  turn: number,
  path: string
): TreeNode | null {
  // 정확 매치 → 점점 짧은 접두사 fallback
  for (let len = path.length; len >= 0; len--) {
    const key = `${turn}:${path.slice(0, len)}`;
    if (tree[key]) return tree[key];
  }
  return null;
}

// --- 팩트 요약 빌더 (트리 종료 후 Gemini에 전달) ---
export function buildFactSummary(category: string, path: string): string {
  const tree = TREES[category] ?? TREES["전체"];
  const facts: string[] = [];

  for (let turn = 0; turn < path.length; turn++) {
    const subpath = path.slice(0, turn);
    const node = lookupNode(tree, turn, subpath);
    if (node) {
      const answer = path[turn];
      if (answer === "Y") {
        facts.push(`"${node.q}" → 예 (${node.yes} 확인됨)`);
      } else {
        facts.push(`"${node.q}" → 아니오 (${node.no} 확인됨)`);
      }
    }
  }

  return facts.length > 0
    ? `[결정 트리에서 확인된 사실]\n${facts.join("\n")}\n위 정보는 유저가 직접 확인한 것이므로 100% 신뢰해라. 이 사실과 모순되는 질문을 절대 하지 마라.`
    : "";
}

// --- 메인 엔트리: 트리 응답 생성 ---
export function getTreeResponse(
  category: string,
  messages: { role: string; content: string }[]
): ChatResponse | null {
  const { path, lastRaw } = buildAnswerPath(messages);
  const turn = path.length;

  // 트리는 턴 0-5만 커버 (6턴)
  if (turn > 5) return null;

  const tree = TREES[category] ?? TREES["전체"];
  const node = lookupNode(tree, turn, path);
  if (!node) return null;

  // 오프너 선택
  let opener: string;
  if (turn === 0) {
    opener = FIRST_OPENERS[Math.floor(Math.random() * FIRST_OPENERS.length)];
  } else if (lastRaw === "A") {
    opener = AMBIGUOUS_OPENERS[Math.floor(Math.random() * AMBIGUOUS_OPENERS.length)];
  } else if (lastRaw === "Y") {
    opener = YES_OPENERS[Math.floor(Math.random() * YES_OPENERS.length)];
  } else {
    opener = NO_OPENERS[Math.floor(Math.random() * NO_OPENERS.length)];
  }

  const message = `${opener} ${node.q}`;

  return {
    message,
    responseType: "question",
    isGuess: false,
    guess: null,
    suggestedQuestions: null,
    turnCount: turn,
    isGameOver: false,
    stage: turn <= 2 ? "broad" : "narrow",
    questionAxis: node.axis,
    candidateBucket: turn <= 1 ? "1000+" : turn <= 3 ? "100-999" : "10-99",
    shouldGuessNow: false,
    guessReasonShort: "결정 트리 질문",
  };
}
