export type MaterialType = "POTATO" | "SWEET_POTATO" | "CORN";
export type RankingAppearance = {
  head: string | null;
  face: string | null;
  top: string | null;
  bottom: string | null;
  gloves: string | null;
  shoes: string | null;
  cape: string | null;
  /** 그 사람이 고른 색. 색만 다른 세트를 입었을 때만 쓴다. */
  color: string | null;
};
export type RankingEntry = {
  rank: number;
  overallRank: number;
  /* 스테이지 순위는 서버가 매긴다. 더 높이 깬 사람이 위, 같으면 먼저 깬 사람이 위다. */
  stageRank: number;
  stageOverallRank: number;
  nickname: string;
  level: number;
  materialType: MaterialType;
  displayName: string;
  combatPower: number;
  highestClearedStageId: string | null;
  highestClearedAt: string | null;
  appearance: RankingAppearance;
  updatedAt: string;
};
export type MaterialRanking = { materialType: MaterialType; displayName: string; entries: RankingEntry[] };
export type CombatPowerRanking = {
  formulaVersion: string;
  generatedAt: string;
  sourceStateVersion: number;
  overallTop: RankingEntry[];
  specializations: MaterialRanking[];
  myEntry: RankingEntry | null;
};

type Envelope<T> = { data: T };

async function json<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as Envelope<T> & { code?: string; messageKey?: string };
  if (!response.ok) throw Object.assign(new Error(body.code || body.messageKey || `HTTP ${response.status}`), body);
  return body.data;
}

export const rankingApi = {
  /* 한도를 넘기지 않으면 보드 전체가 온다. 내 전투력 한 줄만 필요한 곳은 1을 넘긴다. */
  combatPower: (limit?: number) => fetch(
    limit === undefined ? "/api/v1/rankings/combat-power" : `/api/v1/rankings/combat-power?limit=${limit}`,
    { credentials: "include", headers: { Accept: "application/json" } },
  ).then(json<CombatPowerRanking>),
};
