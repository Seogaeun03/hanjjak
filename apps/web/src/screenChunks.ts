/* 첫 화면은 전투만 그린다. 나머지 화면은 메뉴를 누를 때 받아 오고, 누르기 전
   hover·focus 에서 미리 받아 둔다. `React.lazy` 와 미리 받기가 같은 loader 를 써야
   브라우저 모듈 등록부가 하나로 남아 같은 청크를 두 번 내려받지 않는다. */
export const SCREEN_CHUNKS = {
  market: () => import("./features/market/MarketPlaza"),
  gems: () => import("./features/gems/GemsScreen"),
  raid: () => import("./features/raid/RaidScreen"),
  arena: () => import("./features/arena/ArenaScreen"),
  ranking: () => import("./features/ranking/RankingScreen"),
  mail: () => import("./features/mail/MailScreen"),
  inventory: () => import("./features/inventory/InventoryScreen"),
  equipment: () => import("./features/equipment/EquipmentScreen"),
  skills: () => import("./features/skills/SkillsScreen"),
  profile: () => import("./features/profile/ProfileScreen"),
  character: () => import("./features/character/CharacterWindow"),
  cosmetics: () => import("./features/cosmetics/CosmeticsScreen"),
  liveops: () => import("./features/liveops/LiveopsScreen"),
} as const;

export type ScreenChunkName = keyof typeof SCREEN_CHUNKS;

/* 메뉴가 부르는 이름(`BattleHudRoute`·`AppScreen`)과 청크 이름은 하나씩 어긋난다.
   던전은 보석 화면이 그리고, 설정은 마이페이지 창의 탭이다. 전투와 전투 기록은
   첫 화면과 같은 청크에 있어 미리 받을 것이 없다. */
const ROUTE_CHUNKS: Readonly<Record<string, ScreenChunkName>> = {
  market: "market",
  gems: "gems",
  dungeon: "gems",
  raid: "raid",
  arena: "arena",
  ranking: "ranking",
  mail: "mail",
  inventory: "inventory",
  equipment: "equipment",
  skills: "skills",
  profile: "profile",
  settings: "profile",
  character: "character",
  cosmetics: "cosmetics",
  liveops: "liveops",
};

export function screenChunkForRoute(route: string): ScreenChunkName | undefined {
  return ROUTE_CHUNKS[route];
}

/* 미리 받기는 실패해도 화면 이동을 막지 않는다. 실제로 들어갈 때 `React.lazy` 가
   다시 부르므로, 여기서는 처리하지 않은 거절만 삼킨다. */
export function preloadScreenChunk(route: string): void {
  const chunk = ROUTE_CHUNKS[route];
  if (chunk) void SCREEN_CHUNKS[chunk]().catch(() => undefined);
}
