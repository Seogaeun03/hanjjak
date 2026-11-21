import React, { Suspense, lazy, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { AuthGate } from "./features/auth/AuthGate";
import { authApi } from "./features/auth/api";
import { AutoBattleRuntime } from "./features/battle/AutoBattleRuntime";
import { CozySharedNavigation } from "./features/battle/BattleHud";
import { BattleScreen } from "./features/battle/BattleScreen";
import { BroadcastBanner } from "./features/broadcast/BroadcastBanner";
import { BattleHistoryScreen } from "./features/battle/BattleHistoryScreen";
import { gemsApi } from "./features/gems/api";
import { characterApi } from "./features/character/api";
import type { MarketMode } from "./features/market/MarketPlaza";
import { selectMarketItemForSale } from "./features/market/marketUiState";
import { raidApi } from "./features/raid/api";
import { MaterialPreferenceGate } from "./features/material-preference/MaterialPreferenceGate";
import { PictureInPictureController } from "./features/picture-in-picture/PictureInPictureController";
import { OfflineRewardPanel } from "./features/runtime/OfflineRewardPanel";
import type { ProfileTab } from "./features/profile/ProfileScreen";
import { SCREEN_CHUNKS, preloadScreenChunk } from "./screenChunks";
import { GlobalOverlayWindow } from "./shared/GlobalOverlayWindow";
import { RuntimeLifecycle } from "./features/runtime/RuntimeLifecycle";
import { configureBootstrapQueryDefaults } from "./features/runtime/bootstrapPrefetch";
import { applyBrowserSettings, loadBrowserSettings } from "./features/settings/browserSettings";
import { tutorialRuntimeSurface, type TutorialRuntimeSurface } from "./features/tutorial/tutorialRuntimeCatalog";
import {
  keepsBattleStageMounted,
  usesTopBarOnlyNavigation,
  openCharacterGachaFrom,
  openCosmeticsFrom,
  PRIMARY_NAV_ITEMS,
  isRaidRouteAvailable,
  resolveScreenForRaidAvailability,
  resolveHudNavigation,
  isGlobalOverlayScreen,
  usesLegacyAppHeader,
  usesCozySharedNavigation,
  type AppScreen,
  type ManagementScreen,
  type GlobalOverlayScreen,
} from "./navigationState";
import "./styles.css";
import "./app-shell.css";

/* 첫 화면은 전투다. 나머지 화면은 열 때 받아 오고, 화면마다 딸린 CSS 도 같이
   따라온다. 메뉴에 손이 닿는 순간 미리 받으므로(`preloadScreenChunk`) 실제로
   눌렀을 때는 이미 와 있는 경우가 대부분이다. */
const MarketPlaza = lazy(() => SCREEN_CHUNKS.market().then((m) => ({ default: m.MarketPlaza })));
const GemsScreen = lazy(() => SCREEN_CHUNKS.gems().then((m) => ({ default: m.GemsScreen })));
const RaidScreen = lazy(() => SCREEN_CHUNKS.raid().then((m) => ({ default: m.RaidScreen })));
const ArenaScreen = lazy(() => SCREEN_CHUNKS.arena().then((m) => ({ default: m.ArenaScreen })));
const RankingScreen = lazy(() => SCREEN_CHUNKS.ranking().then((m) => ({ default: m.RankingScreen })));
const MailScreen = lazy(() => SCREEN_CHUNKS.mail().then((m) => ({ default: m.MailScreen })));
const InventoryWindow = lazy(() => SCREEN_CHUNKS.inventory().then((m) => ({ default: m.InventoryWindow })));
const EquipmentWindow = lazy(() => SCREEN_CHUNKS.equipment().then((m) => ({ default: m.EquipmentWindow })));
const SkillWindow = lazy(() => SCREEN_CHUNKS.skills().then((m) => ({ default: m.SkillWindow })));
const ProfileScreen = lazy(() => SCREEN_CHUNKS.profile().then((m) => ({ default: m.ProfileScreen })));
const CharacterWindow = lazy(() => SCREEN_CHUNKS.character().then((m) => ({ default: m.CharacterWindow })));
const CosmeticsScreen = lazy(() => SCREEN_CHUNKS.cosmetics().then((m) => ({ default: m.CosmeticsScreen })));
const LiveopsScreen = lazy(() => SCREEN_CHUNKS.liveops().then((m) => ({ default: m.LiveopsScreen })));
/* 튜토리얼은 전투 무대 위에 겹쳐 뜨는 대화창이다. 첫 페인트를 붙잡지 않도록
   따로 받아 온다 — 어차피 진행 상태를 물어본 뒤에야 말을 건다. */
const AdventurerTutorial = lazy(() => import("./features/tutorial/AdventurerTutorial").then((m) => ({ default: m.AdventurerTutorial })));
const ProgressiveTutorialRuntime = lazy(() => import("./features/tutorial/ProgressiveTutorialRuntime").then((m) => ({ default: m.ProgressiveTutorialRuntime })));

/* 관리 화면은 전투 무대 위에 얹힌다. 받아 오는 동안 무대를 가리지 않도록
   비워 두고, 화면이 오면 그 자리에 그대로 선다. */
function LazyScreen({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={null}>{children}</Suspense>;
}

const queryClient = new QueryClient();
configureBootstrapQueryDefaults(queryClient);

function App() {
  const client = useQueryClient();
  const [screen, setScreen] = useState<AppScreen>("battle");
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileEverOpened, setProfileEverOpened] = useState(false);
  const [characterEverOpened, setCharacterEverOpened] = useState(false);
  const [profileInitialTab, setProfileInitialTab] = useState<ProfileTab>("profile");
  const profileTrigger = useRef<HTMLButtonElement>(null);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const [characterOpen, setCharacterOpen] = useState(false);
  const characterTrigger = useRef<HTMLButtonElement>(null);
  const [characterInitialTab, setCharacterInitialTab] = useState<"stats" | "cosmetics">("stats");
  const [gachaReturn, setGachaReturn] = useState<AppScreen | null>(null);
  const [marketInitialMode, setMarketInitialMode] = useState<MarketMode>("buy");
  const [globalOverlay, setGlobalOverlay] = useState<GlobalOverlayScreen | null>(null);
  const contentMenu = useRef<HTMLDetailsElement>(null);
  const usesCozySharedHud = usesCozySharedNavigation(screen);
  const sharedSession = useQuery({
    queryKey: ["auth", "session"],
    queryFn: authApi.session,
    retry: false,
    enabled: usesCozySharedHud || screen === "battle",
    refetchInterval: usesCozySharedHud ? 5_000 : false,
  });
  const sharedAccount = sharedSession.data?.account ?? null;
  const sharedGemState = useQuery({
    queryKey: ["gems"],
    queryFn: gemsApi.state,
    retry: false,
    enabled: usesCozySharedHud,
  });
  const sharedCharacterStats = useQuery({
    queryKey: ["character-stats"],
    queryFn: characterApi.stats,
    retry: false,
    enabled: usesCozySharedHud,
  });
  const sharedRaidState = useQuery({
    queryKey: ["raid"],
    queryFn: raidApi.state,
    retry: false,
    enabled: usesCozySharedHud,
    staleTime: 5_000,
  });

  const displayedScreen = resolveScreenForRaidAvailability(screen, sharedRaidState.data);
  const displayedCozyRoute = usesCozySharedNavigation(displayedScreen) ? displayedScreen : undefined;

  useEffect(() => {
    const warmImages = () => {
      void import("./features/gems/preloadDungeonImages").then(({ preloadDungeonImages }) => preloadDungeonImages()).catch(() => undefined);
      void import("./features/cosmetics/preloadGachaImages").then(({ preloadGachaImages }) => preloadGachaImages()).catch(() => undefined);
      void import("./features/gems/prefetchDungeonData").then(({ prefetchDungeonData }) => prefetchDungeonData(client)).catch(() => undefined);
    };
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(warmImages, { timeout: 3_000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(warmImages, 0);
    return () => window.clearTimeout(id);
  }, [client]);

  useEffect(() => {
    if (screen === "raid" && sharedRaidState.isSuccess && !isRaidRouteAvailable(sharedRaidState.data)) setScreen("battle");
  }, [screen, sharedRaidState.data, sharedRaidState.isSuccess]);

  useEffect(() => {
    applyBrowserSettings(loadBrowserSettings());
  }, []);


  const openCharacter = () => {
    setCharacterInitialTab("stats");
    setCharacterEverOpened(true);
    setCharacterOpen(true);
  };
  const showScreen = (next: ManagementScreen) => {
    contentMenu.current?.removeAttribute("open");
    if (next === "market") setMarketInitialMode("buy");
    if (isGlobalOverlayScreen(next)) {
      setGlobalOverlay(next);
      return;
    }
    setGlobalOverlay(null);
    setScreen(next);
  };
  const showAppScreen = (next: AppScreen) => {
    contentMenu.current?.removeAttribute("open");
    if (isGlobalOverlayScreen(next)) {
      setGlobalOverlay(next);
      return;
    }
    setGlobalOverlay(null);
    setScreen(next);
  };
  const openProfile = (tab: ProfileTab) => {
    setProfileInitialTab(tab);
    setProfileEverOpened(true);
    setProfileOpen(true);
  };
  const navigateFromBattleHud = (route: Parameters<React.ComponentProps<typeof BattleScreen>["onNavigate"]>[0]) => {
    const action = resolveHudNavigation(route);
    if (action.kind === "character") return openCharacter();
    if (action.kind === "settings") return openProfile("settings");
    if (action.kind === "cosmetics") {
      const next = openCosmeticsFrom(screen, gachaReturn);
      setGachaReturn(next.gachaReturn);
      return showAppScreen(next.screen);
    }
    showScreen(action.screen);
  };

  const leaveGacha = () => {
    showAppScreen(gachaReturn ?? "battle");
    setGachaReturn(null);
    setCharacterInitialTab("cosmetics");
    setCharacterEverOpened(true);
    setCharacterOpen(true);
    void client.invalidateQueries({ queryKey: ["cosmetic-collection"] });
    void client.invalidateQueries({ queryKey: ["character-stats"] });
  };

  /* 점진형 튜토리얼이 다음 단계의 화면을 열 때 쓴다. 사용자가 메뉴를 누른 것과 같은 길을 탄다. */
  const openTutorialSurface = (next: TutorialRuntimeSurface) => {
    if (next === "cosmetics") {
      const target = openCosmeticsFrom(screen, gachaReturn);
      setGachaReturn(target.gachaReturn);
      showAppScreen(target.screen);
      return;
    }
    if (next === "market") setMarketInitialMode("buy");
    showAppScreen(next);
  };

  const sellInventoryItem = (itemId: string) => {
    selectMarketItemForSale(window.sessionStorage, itemId);
    setMarketInitialMode("sell");
    setGlobalOverlay("market");
  };

  return (
    <AuthGate>
      <MaterialPreferenceGate>
        <main className={`game-shell ${displayedCozyRoute ? "cozy-management-shell" : ""} ${displayedScreen === "ranking" ? "cozy-ranking-shell" : ""} ${displayedScreen === "cosmetics" ? "cozy-cosmetics-shell" : ""}`}>
          <BroadcastBanner />
          <RuntimeLifecycle />
          <OfflineRewardPanel />
          <AutoBattleRuntime />
          {usesLegacyAppHeader(displayedScreen) && <header className="app-header app-shell-header">
            <h1>한짝</h1>
            <nav aria-label="관리 메뉴">
              {PRIMARY_NAV_ITEMS.map((item) => (
                <button
                  key={item.screen}
                  className={displayedScreen === item.screen ? "active" : ""}
                  onPointerEnter={() => preloadScreenChunk(item.screen)}
                  onFocus={() => preloadScreenChunk(item.screen)}
                  onClick={() => {
                    if (item.screen === "cosmetics") {
                      const next = openCosmeticsFrom(screen, gachaReturn);
                      setGachaReturn(next.gachaReturn);
                      showAppScreen(next.screen);
                      return;
                    }
                    showAppScreen(item.screen);
                  }}
                >
                  {item.label}
                </button>
              ))}
              <details ref={contentMenu} className="content-menu">
                <summary aria-label="컨텐츠 메뉴 열기" onPointerEnter={() => preloadScreenChunk("gems")}>컨텐츠<span aria-hidden="true">⌄</span></summary>
                <div className="content-menu-list">
                  <button type="button" aria-label="던전, 보석 던전과 현재 보스" onPointerEnter={() => preloadScreenChunk("dungeon")} onFocus={() => preloadScreenChunk("dungeon")} onClick={() => showScreen("dungeon")}><strong>던전</strong><small>보석 던전과 현재 보스</small></button>
                  <button type="button" aria-label="레이드, 준비 중" disabled><strong>레이드</strong><small>준비 중</small></button>
                </div>
              </details>
              <button
                ref={profileTrigger}
                className={profileOpen && profileInitialTab === "profile" ? "active" : ""}
                onPointerEnter={() => preloadScreenChunk("profile")}
                onFocus={() => preloadScreenChunk("profile")}
                onClick={() => openProfile("profile")}
                aria-haspopup="dialog"
              >
                마이페이지
              </button>
              <button
                ref={settingsTrigger}
                type="button"
                className={profileOpen && profileInitialTab === "settings" ? "active" : ""}
                onPointerEnter={() => preloadScreenChunk("settings")}
                onFocus={() => preloadScreenChunk("settings")}
                onClick={() => openProfile("settings")}
                aria-haspopup="dialog"
              >설정</button>
            </nav>
          </header>}
          <PictureInPictureController visible={displayedScreen === "battle"} />
          <div className="battle-stage-mount" hidden={!keepsBattleStageMounted(displayedScreen)}><BattleScreen onNavigate={navigateFromBattleHud} onOpenProfile={() => openProfile("profile")} /></div>
          {displayedCozyRoute && <CozySharedNavigation
            account={sharedAccount}
            activeRoute={displayedCozyRoute}
            onOpenProfile={() => openProfile("profile")}
            onNavigate={navigateFromBattleHud}
            profileTriggerRef={profileTrigger}
            gemContentUnlocked={sharedGemState.data?.unlocked}
            cosmeticContentUnlocked={sharedCharacterStats.data?.cosmeticsUnlocked === true}
            topBarOnly={usesTopBarOnlyNavigation(screen)}
            raid={sharedRaidState.data ? { featureAvailable: sharedRaidState.data.featureAvailable, unlockStageId: sharedRaidState.data.unlockStageId, unlocked: sharedRaidState.data.unlocked } : undefined}
          />}
          {displayedScreen === "battleHistory" && <BattleHistoryScreen />}
          {displayedScreen === "inventory" && <LazyScreen><InventoryWindow open onClose={() => showScreen("battle")} onSell={sellInventoryItem} /></LazyScreen>}
          {displayedScreen === "equipment" && <LazyScreen><EquipmentWindow open onClose={() => showScreen("battle")} /></LazyScreen>}
          {displayedScreen === "skills" && <LazyScreen><SkillWindow open onClose={() => showScreen("battle")} /></LazyScreen>}
          {/* 이 둘은 어느 화면 위에든 겹쳐 뜬다. 아래 창이 열린 채로 남으므로
              같은 top layer 에 올려야 뒤로 깔리지 않는다. */}
          {globalOverlay === "market" && <LazyScreen><GlobalOverlayWindow labelledBy="market-plaza-title" onClose={() => setGlobalOverlay(null)}><MarketPlaza initialMode={marketInitialMode} onClose={() => setGlobalOverlay(null)} /></GlobalOverlayWindow></LazyScreen>}
          {globalOverlay === "mail" && <LazyScreen><GlobalOverlayWindow labelledBy="mail-title" onClose={() => setGlobalOverlay(null)}><MailScreen onClose={() => setGlobalOverlay(null)} /></GlobalOverlayWindow></LazyScreen>}
          {displayedScreen === "gems" && <LazyScreen><GemsScreen mode="manage" onClose={() => showScreen("battle")} /></LazyScreen>}
          {displayedScreen === "dungeon" && <LazyScreen><GemsScreen mode="dungeon" onOpenGems={() => showScreen("gems")} /></LazyScreen>}
          {displayedScreen === "raid" && <LazyScreen><RaidScreen /></LazyScreen>}
          {displayedScreen === "arena" && <LazyScreen><ArenaScreen /></LazyScreen>}
          {displayedScreen === "ranking" && <LazyScreen><RankingScreen /></LazyScreen>}
          {displayedScreen === "cosmetics" && <LazyScreen><CosmeticsScreen onClose={leaveGacha} onOpenInventory={() => showScreen("inventory")} /></LazyScreen>}
          {displayedScreen === "liveops" && <LazyScreen><LiveopsScreen onClose={() => showScreen("battle")} /></LazyScreen>}
          {usesLegacyAppHeader(displayedScreen) && <nav className="character-launcher" aria-label="성장 메뉴">
            <button ref={characterTrigger} onPointerEnter={() => preloadScreenChunk("character")} onFocus={() => preloadScreenChunk("character")} onClick={openCharacter} aria-haspopup="dialog">캐릭터</button>
          </nav>}
          {/* 두 창은 닫힌 채로도 계속 붙어 있어야 닫기 뒤 초점 복원이 이어진다.
              그래서 처음 열릴 때 한 번 받아 오고, 그 뒤로는 계속 그 자리에 둔다. */}
          {characterEverOpened && <LazyScreen><CharacterWindow
            open={characterOpen}
            initialTab={characterInitialTab}
            triggerRef={characterTrigger}
            onClose={() => setCharacterOpen(false)}
            onGacha={() => {
              const next = openCharacterGachaFrom(screen, gachaReturn);
              setGachaReturn(next.gachaReturn);
              setCharacterOpen(false);
              showAppScreen(next.screen);
            }}
          /></LazyScreen>}
          {profileEverOpened && <LazyScreen><ProfileScreen
            open={profileOpen}
            triggerRef={profileInitialTab === "settings" ? settingsTrigger : profileTrigger}
            initialTab={profileInitialTab}
            onClose={() => setProfileOpen(false)}
          /></LazyScreen>}
          {sharedAccount && <LazyScreen><AdventurerTutorial accountId={sharedAccount.accountId} active={screen === "battle" && !profileOpen && !characterOpen && !globalOverlay} /></LazyScreen>}
          {sharedAccount && <LazyScreen><ProgressiveTutorialRuntime
            accountId={sharedAccount.accountId}
            surface={tutorialRuntimeSurface(displayedScreen)}
            blocked={profileOpen || characterOpen || Boolean(globalOverlay)}
            onNavigate={openTutorialSurface}
          /></LazyScreen>}
        </main>
      </MaterialPreferenceGate>
    </AuthGate>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
