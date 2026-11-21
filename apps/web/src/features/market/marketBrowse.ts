/*
 * 왼쪽 칸이 어디를 보고 있는지. 세 층이 한 그루로 서 있고, 고른 줄만 그 자리에서
 * 아래로 열린다. 페이지를 갈아 끼우듯 바꾸면 방금 무엇을 눌렀는지, 형제 줄이 무엇
 * 이었는지가 화면에서 사라져 길을 잃는다. 열린 줄은 제자리에 남아 이정표가 된다.
 *
 *   분류        전체 · 강화재료 · 스킬북 · 보석 (전체는 분류를 걸지 않는다는 뜻)
 *   계열          감자 · 고구마 · 옥수수
 *   등급            감자 F등급 … 감자 A등급
 *
 * 한 층에서 열어 둘 수 있는 줄은 하나다. 형제를 누르면 앞서 열린 것이 닫힌다 —
 * 여럿을 한꺼번에 펼치면 가운데 목록이 무엇으로 좁혀졌는지 말할 수 없게 된다.
 *
 * 고르는 방법은 둘이다. 줄을 누르면 그 하나만 보되 값마다 다 펴서 보고, 오른쪽
 * 체크 표시로 여럿을 골라 두면 저마다 가장 싼 값 한 줄씩만 세워 나란히 견준다.
 * 둘은 같이 쓰지 않는다 — 하나를 파고드는 일과 여럿을 견주는 일은 다른 일이다.
 */
import { BOOK_GRADE_LABELS, MATERIAL_FAMILIES } from "./marketArt";
import type { MarketInstrument } from "./api";

export type MarketBrowseCategory = "ALL" | "MATERIAL" | "SKILL_BOOK" | "GEM";

export const BROWSE_CATEGORIES: ReadonlyArray<{ id: MarketBrowseCategory; label: string }> = [
  { id: "ALL", label: "전체" },
  { id: "MATERIAL", label: "강화재료" },
  { id: "SKILL_BOOK", label: "스킬북" },
  { id: "GEM", label: "보석" },
];

/** 가운데 목록에 무엇을 세울지. 하나를 파고들거나, 여럿을 최저가로 견주거나. */
export type MarketPick =
  | { kind: "one"; id: string }
  | { kind: "compare"; ids: string[] }
  | null;

export type MarketBrowse = {
  /** null 이면 아직 분류를 고르지 않은 맨 위 칸이다. */
  category: MarketBrowseCategory | null;
  /** marketGroupKey 와 같은 열쇠. null 이면 계열을 고르기 전이다. */
  group: string | null;
  pick: MarketPick;
  query: string;
};

export const EMPTY_BROWSE: MarketBrowse = { category: null, group: null, pick: null, query: "" };

export type MarketGroup = { key: string; label: string; category: string };

/*
 * 품목 하나가 어느 계열에 드는지. 재료는 작물, 비법서는 스킬, 보석은 옵션이 계열이고
 * 등급·레벨이 그 안의 갈래다. MarketScreen 의 marketGroupKey 와 같은 열쇠를 쓴다.
 */
export function marketGroupOf(item: MarketInstrument): MarketGroup {
  if (item.category === "MATERIAL") {
    const family = MATERIAL_FAMILIES.find(entry => item.itemId.startsWith(`${entry.id}_M`));
    return { key: `MATERIAL:${family?.id ?? item.itemId}`, label: family?.label ?? item.displayName, category: "MATERIAL" };
  }
  if (item.category === "SKILL_BOOK") {
    const grade = BOOK_GRADE_LABELS[item.attributes.grade];
    const bare = grade && item.displayName.startsWith(`${grade} `) ? item.displayName.slice(grade.length + 1) : item.displayName;
    return { key: `SKILL_BOOK:${item.attributes.skillId ?? item.itemId}`, label: bare.replace(/ 비법서$/, "") || bare, category: "SKILL_BOOK" };
  }
  const bare = item.displayName.replace(/^\d+레벨 /, "").replace(/ 보석$/, "");
  return { key: `${item.category}:${item.attributes.option ?? item.itemId}`, label: bare || item.displayName, category: item.category };
}

/*
 * 등급은 갈래마다 다른 이름으로 불린다. 재료는 F~A, 비법서는 노말~전설, 보석은 1~7
 * 레벨이 그 자리를 대신한다. 한 줄에 세워 견주려면 셋을 같은 눈금으로 읽어야 한다.
 */
const BOOK_GRADE_ORDER: Record<string, number> = { normal: 1, rare: 2, epic: 3, legendary: 4 };
export function instrumentGradeRank(item: MarketInstrument): number {
  const material = item.itemId.match(/_M([1-5])$/);
  if (material) return Number(material[1]);
  if (item.category === "SKILL_BOOK") return BOOK_GRADE_ORDER[String(item.attributes.grade ?? "normal")] ?? 0;
  if (item.category === "GEM") return Number(item.attributes.level) || 0;
  return 0;
}

function matchesQuery(item: MarketInstrument, words: string[]): boolean {
  const searchable = `${item.displayName} ${item.canonicalKey} ${marketGroupOf(item).label}`.toLowerCase();
  return words.every(word => searchable.includes(word));
}
function queryWords(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/*
 * 가운데 목록이 받을 품목. 고른 것이 있으면 그것이 가장 좁은 말이라 먼저 듣는다.
 * 그 다음이 검색어, 계열, 분류 차례다. 어느 것도 없으면 거래소 전부다.
 */
export function browseMarketItems(catalog: MarketInstrument[], browse: MarketBrowse): MarketInstrument[] {
  if (browse.pick?.kind === "one") {
    const { id } = browse.pick;
    return catalog.filter(item => item.instrumentId === id);
  }
  if (browse.pick?.kind === "compare") {
    const ids = new Set(browse.pick.ids);
    return catalog.filter(item => ids.has(item.instrumentId));
  }
  const words = queryWords(browse.query);
  if (words.length) return catalog.filter(item => matchesQuery(item, words));
  if (browse.group) return catalog.filter(item => marketGroupOf(item).key === browse.group);
  if (browse.category && browse.category !== "ALL") return catalog.filter(item => item.category === browse.category);
  return catalog;
}

/** 체크 표시로 골라 둔 것끼리는 값을 견주는 자리다. 저마다 가장 싼 한 줄만 세운다. */
export function browseShowsCheapestOnly(browse: MarketBrowse): boolean {
  return browse.pick?.kind === "compare";
}

/*
 * 체크는 누를 때마다 더하고 다시 누르면 뺀다. 마지막 하나까지 빼면 견주기를 그만두고
 * 계열 전체로 돌아간다 — 아무것도 없는 목록을 보여 줄 이유가 없다.
 */
export function toggleCompare(pick: MarketPick, id: string): MarketPick {
  const current = pick?.kind === "compare" ? pick.ids : [];
  const next = current.includes(id) ? current.filter(entry => entry !== id) : [...current, id];
  return next.length ? { kind: "compare", ids: next } : null;
}

/** 체크 표시가 붙어 있는 품목. 줄을 하나만 파고드는 중이면 아무것도 붙어 있지 않다. */
export function comparedIds(pick: MarketPick): ReadonlySet<string> {
  return new Set(pick?.kind === "compare" ? pick.ids : []);
}

/*
 * 왼쪽 칸이 세울 줄. 한 그루가 평평한 줄 목록으로 펴져 나오고, depth 가 몇 번째 층인지
 * 말한다. 열린 줄은 open 을 달고 나오며 그 아래에 제 자식들이 곧바로 이어 선다.
 */
export type BrowseRow =
  | { kind: "category"; depth: 0; id: MarketBrowseCategory; label: string; count: number; open: boolean }
  | { kind: "group"; depth: 1; key: string; label: string; sample: MarketInstrument; count: number; open: boolean }
  | { kind: "item"; depth: 0 | 2; item: MarketInstrument };

type GroupRow = Extract<BrowseRow, { kind: "group" }>;

function groupRows(items: MarketInstrument[]): GroupRow[] {
  const groups = new Map<string, { group: MarketGroup; items: MarketInstrument[] }>();
  for (const item of items) {
    const group = marketGroupOf(item);
    const existing = groups.get(group.key);
    if (existing) existing.items.push(item);
    else groups.set(group.key, { group, items: [item] });
  }
  return [...groups.values()]
    .sort((a, b) => {
      const order = BROWSE_CATEGORIES.findIndex(entry => entry.id === a.group.category) - BROWSE_CATEGORIES.findIndex(entry => entry.id === b.group.category);
      if (order) return order;
      if (a.group.category === "MATERIAL") {
        return MATERIAL_FAMILIES.findIndex(family => a.group.key === `MATERIAL:${family.id}`)
          - MATERIAL_FAMILIES.findIndex(family => b.group.key === `MATERIAL:${family.id}`);
      }
      return a.group.label.localeCompare(b.group.label, "ko");
    })
    .map(entry => ({
      kind: "group" as const,
      depth: 1 as const,
      key: entry.group.key,
      label: entry.group.label,
      sample: [...entry.items].sort((a, b) => instrumentGradeRank(a) - instrumentGradeRank(b))[0],
      count: entry.items.length,
      open: false,
    }));
}

function itemRows(items: MarketInstrument[], depth: 0 | 2): BrowseRow[] {
  return [...items]
    .sort((a, b) => instrumentGradeRank(a) - instrumentGradeRank(b)
      || Number(a.attributes.value ?? 0) - Number(b.attributes.value ?? 0)
      || a.instrumentId.localeCompare(b.instrumentId))
    .map(item => ({ kind: "item" as const, depth, item }));
}

export function browseRows(catalog: MarketInstrument[], browse: MarketBrowse): BrowseRow[] {
  const words = queryWords(browse.query);
  /* 검색은 층을 건너뛴다. 이름으로 찾는 사람은 그것이 어느 계열에 드는지 이미 안다. */
  if (words.length) return itemRows(catalog.filter(item => matchesQuery(item, words)), 0);

  const rows: BrowseRow[] = [];
  for (const entry of BROWSE_CATEGORIES) {
    const within = entry.id === "ALL" ? catalog : catalog.filter(item => item.category === entry.id);
    const open = browse.category === entry.id;
    rows.push({ kind: "category", depth: 0, id: entry.id, label: entry.label, count: within.length, open });
    if (!open) continue;
    for (const group of groupRows(within)) {
      const groupOpen = browse.group === group.key;
      rows.push({ ...group, open: groupOpen });
      if (groupOpen) rows.push(...itemRows(within.filter(item => marketGroupOf(item).key === group.key), 2));
    }
  }
  return rows;
}

/*
 * 분류 줄을 누르면 열고, 열려 있으면 닫는다. 형제를 누르면 앞서 열린 것은 저절로
 * 닫힌다 — 분류는 한 번에 하나만 열려 있어야 가운데 목록이 무엇인지 말할 수 있다.
 */
export function toggleCategory(browse: MarketBrowse, id: MarketBrowseCategory): MarketBrowse {
  return browse.category === id ? EMPTY_BROWSE : { category: id, group: null, pick: null, query: "" };
}

/** 계열 줄도 같다. 닫으면 그 안에서 고른 것도 함께 놓는다. */
export function toggleGroup(browse: MarketBrowse, key: string): MarketBrowse {
  return { ...browse, group: browse.group === key ? null : key, pick: null, query: "" };
}

/*
 * 최근 본 것을 눌렀을 때. 그 품목이 선 자리까지 함께 옮겨 두어야, 돌아가기를 눌렀을 때
 * 같은 계열의 다른 등급이 나온다. 엉뚱한 분류에 떨어뜨려 두면 길을 잃는다.
 */
export function browseTo(item: MarketInstrument): MarketBrowse {
  return {
    category: item.category as MarketBrowseCategory,
    group: marketGroupOf(item).key,
    pick: { kind: "one", id: item.instrumentId },
    query: "",
  };
}
