import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cosmeticsApi, CosmeticsApiError, isCosmeticsLockedError, isUncertainCosmeticsError, type Catalog, type Collection, type DrawResponse } from "./api";
import { cosmeticsErrorMessage } from "./presentation";
import { CosmeticDrawReveal } from "./CosmeticDrawReveal";
import { CosmeticGachaBoard, CosmeticWalletBalance } from "./CosmeticGachaBoard";
import { CosmeticProbabilityDialog } from "./CosmeticProbabilityDialog";
import { CosmeticBoxClaimedDialog } from "./CosmeticBoxClaimedDialog";
import { TopAlert } from "../../shared/TopAlert";
import "./cosmetics.css";

// 이 화면이 보내는 명령은 뽑기와 마일스톤 수령뿐이다.
// 받은 상자를 여는 것은 인벤토리가, 등록·착용은 캐릭터 창의 치장 탭이 전담한다.
type Command =
  | { kind: "draw"; bannerId: string; count: 1 | 10; key: string }
  | { kind: "claim"; bannerId: string; count: number; key: string };
type CommandInput =
  | { kind: "draw"; bannerId: string; count: 1 | 10 }
  | { kind: "claim"; bannerId: string; count: number };
type PendingCommand = Command | { kind: "claim"; bannerId: string; key: string; count?: undefined };
type CommandResult = { command?: Command; banners?: Awaited<ReturnType<typeof cosmeticsApi.banners>>; collection?: Collection; draw?: DrawResponse; remainingClaimableCount?: number };

async function execute(command: Command): Promise<CommandResult> {
  switch (command.kind) {
    case "draw": {
      const draw = await cosmeticsApi.draw(command.bannerId, command.count, command.key);
      const banners = await cosmeticsApi.banners();
      return { command, banners, collection: draw.collection, draw };
    }
    case "claim": {
      const milestone = await cosmeticsApi.claimMilestone(command.bannerId, command.count, command.key);
      return { command, remainingClaimableCount: milestone.remainingClaimableCount };
    }
  }
}

export function CosmeticsScreen({ onClose, onOpenInventory }: { onClose?: () => void; onOpenInventory?: () => void } = {}) {
  const queryClient = useQueryClient();
  const [selectedBannerId, setSelectedBannerId] = useState<string | null>(null);
  const [drawResult, setDrawResult] = useState<DrawResponse | null>(null);
  const [revealSequence, setRevealSequence] = useState(0);
  const [claimedBannerId, setClaimedBannerId] = useState<string | null>(null);
  const [claimedBoxCount, setClaimedBoxCount] = useState(0);
  const [oddsBannerId, setOddsBannerId] = useState<string | null>(null);
  const [currentCommand, setCurrentCommand] = useState<PendingCommand | null>(null);
  const [deterministicErrorRefreshing, setDeterministicErrorRefreshing] = useState(false);

  const banners = useQuery({ queryKey: ["cosmetic-banners"], queryFn: cosmeticsApi.banners, retry: false });
  const showcase = useQuery({ queryKey: ["cosmetic-showcase"], queryFn: cosmeticsApi.showcase, retry: false, refetchOnMount: "always" });
  const collection = useQuery({ queryKey: ["cosmetic-collection"], queryFn: cosmeticsApi.collection, retry: false });
  const catalog = useQuery({ queryKey: ["cosmetic-catalog"], queryFn: cosmeticsApi.catalog, retry: false });
  const effectiveBannerId = selectedBannerId ?? banners.data?.[0]?.bannerId ?? "";
  const detail = useQuery({ queryKey: ["cosmetic-banner-detail", effectiveBannerId], queryFn: () => cosmeticsApi.detail(effectiveBannerId), enabled: Boolean(selectedBannerId), retry: false });
  useEffect(() => {
    if (banners.error) {
      // 배너가 끊기면 그 배너를 근거로 띄운 확률 창도 같이 닫는다.
      setSelectedBannerId(null);
      setOddsBannerId(null);
    }
  }, [banners.error]);

  const updateCollection = (next: Collection) => {
    queryClient.setQueryData(["cosmetic-collection"], next);
    void queryClient.invalidateQueries({ queryKey: ["character-stats"] });
  };
  const refreshAuthoritativeState = (command: PendingCommand) => Promise.all([
    queryClient.refetchQueries({ queryKey: ["cosmetic-banners"] }),
    queryClient.refetchQueries({ queryKey: ["cosmetic-collection"] }),
    queryClient.refetchQueries({ queryKey: ["cosmetic-catalog"] }),
    ...(command.kind === "draw" ? [queryClient.refetchQueries({ queryKey: ["cosmetic-banner-detail", command.bannerId] })] : []),
    queryClient.refetchQueries({ queryKey: ["character-stats"] }),
  ]).then(() => undefined);
  const inFlight = useRef(false);
  const currentCommandRef = useRef<PendingCommand | null>(null);
  const deterministicErrorRefreshingRef = useRef(false);
  const mutation = useMutation({ mutationFn: async (pending: PendingCommand) => {
    if (pending.kind === "claim" && pending.count === undefined) {
      const latest = await cosmeticsApi.banners();
      queryClient.setQueryData(["cosmetic-banners"], latest);
      const count = latest.find((entry) => entry.bannerId === pending.bannerId)?.milestone.claimableBoxCount ?? 0;
      if (count < 1) return {};
      const command: Command = { ...pending, count };
      currentCommandRef.current = command;
      setCurrentCommand(command);
      return execute(command);
    }
    return execute(pending);
  }, retry: false, onSuccess: (result) => {
    if (!result.command) { setCurrentCommand(null); return; }
    if (result.banners) queryClient.setQueryData(["cosmetic-banners"], result.banners);
    if (result.collection) updateCollection(result.collection);
    if (result.command.kind === "draw") {
      setDrawResult(result.draw ?? null);
      setRevealSequence((current) => current + 1);
      setClaimedBannerId(null);
      void queryClient.invalidateQueries({ queryKey: ["cosmetic-banner-detail", result.command.bannerId] });
    } else if (result.command.kind === "claim") {
      // 받은 상자는 인벤토리로 들어간다. 몇 개가 어디로 갔는지 알려 주고 보낼지 묻는다.
      setClaimedBannerId(result.command.bannerId);
      setClaimedBoxCount(result.command.count);
      queryClient.setQueryData<Awaited<ReturnType<typeof cosmeticsApi.banners>>>(["cosmetic-banners"], (current) => current?.map((entry) => entry.bannerId !== result.command!.bannerId ? entry : {
        ...entry,
        milestone: {
          ...entry.milestone,
          claimedBoxCount: entry.milestone.claimedBoxCount + result.command!.count,
          claimableBoxCount: result.remainingClaimableCount ?? 0,
          drawsUntilNextBox: (result.remainingClaimableCount ?? 0) > 0 ? 0 : 200 - entry.milestone.totalSuccessfulDraws % 200,
          ownedBoxQuantity: entry.milestone.ownedBoxQuantity + result.command!.count,
        },
      }));
      // 상자가 인벤토리 슬롯을 차지하므로 인벤토리 목록도 다시 읽는다.
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
    }
    setCurrentCommand(null);
  }, onError: () => {
    setCurrentCommand(currentCommandRef.current);
    setDrawResult(null);
  }, onSettled: () => {
    inFlight.current = false;
  } });
  const currentMutationUncertain = mutation.isError && isUncertainCosmeticsError(mutation.error);
  const drawMutationGachaUnavailable = mutation.isError && currentCommand?.kind === "draw" && mutation.error instanceof CosmeticsApiError && mutation.error.code === "GACHA_CONTENT_UNAVAILABLE";
  const gachaUnavailable = Boolean(banners.error) || drawMutationGachaUnavailable;
  const deterministicErrorOpen = mutation.isError && !currentMutationUncertain;
  const blocked = mutation.isPending || deterministicErrorRefreshing || deterministicErrorOpen || currentMutationUncertain;
  const run = (command: CommandInput | Command) => {
    if (inFlight.current || deterministicErrorRefreshingRef.current || blocked || (gachaUnavailable && command.kind === "draw")) return;
    const next: PendingCommand = "key" in command
      ? command
      : command.kind === "claim"
        ? { kind: "claim", bannerId: command.bannerId, key: crypto.randomUUID() }
        : { ...command, key: crypto.randomUUID() };
    if (next.kind === "claim") setClaimedBannerId(null);
    inFlight.current = true;
    currentCommandRef.current = next;
    setCurrentCommand(next);
    mutation.mutate(next);
  };
  const currentRetryCommand = currentMutationUncertain ? currentCommand : null;
  const retry = (command: PendingCommand | null) => {
    if (!command || inFlight.current || mutation.isPending || (gachaUnavailable && command.kind === "draw")) return;
    inFlight.current = true;
    currentCommandRef.current = command;
    setCurrentCommand(command);
    mutation.mutate(command);
  };
  const retrySameCommand = () => retry(currentRetryCommand);

  if (collection.isLoading || catalog.isLoading || (banners.isLoading && !banners.data)) return <p>치장 정보를 불러오는 중입니다.</p>;
  if (isCosmeticsLockedError(collection.error) || isCosmeticsLockedError(catalog.error)) return <section className="cosmetic-screen cosmetic-locked-notice" aria-labelledby="cosmetics-locked-title">
    <h2 id="cosmetics-locked-title">치장 시스템 잠금</h2>
    <p role="alert">스테이지 1-5를 최초 클리어하면 치장 뽑기와 도감이 해금됩니다.</p>
  </section>;
  if (collection.error || catalog.error) return <p role="alert">치장 정보를 불러오지 못했습니다.</p>;
  const collectionData = collection.data!;
  const catalogData = catalog.data!;
  const showCurrentUncertainRetry = currentMutationUncertain;
  const closeCurrentError = async () => {
    if (deterministicErrorRefreshingRef.current) return;
    deterministicErrorRefreshingRef.current = true;
    setDeterministicErrorRefreshing(true);
    try {
      if (currentCommand && !currentMutationUncertain) await refreshAuthoritativeState(currentCommand);
    } finally {
      mutation.reset();
      setCurrentCommand(null);
      deterministicErrorRefreshingRef.current = false;
      setDeterministicErrorRefreshing(false);
    }
  };
  const headlineBanner = banners.data?.find((banner) => banner.bannerId === effectiveBannerId) ?? banners.data?.[0];
  const resultBanner = drawResult ? banners.data?.find((banner) => banner.bannerId === drawResult.bannerId) : undefined;
  // 받지 않고 더 뽑아 밀려 있는 상자는 한 번에 받는다. 같은 아이템이라 인벤토리 슬롯도 하나만 쓴다.
  const claimableBoxCount = resultBanner?.milestone.claimableBoxCount ?? 0;
  const goToInventory = () => { setClaimedBoxCount(0); onOpenInventory?.(); };
  const claimedDialog = claimedBoxCount > 0
    ? <CosmeticBoxClaimedDialog count={claimedBoxCount} onGoToInventory={onOpenInventory && goToInventory} onClose={() => setClaimedBoxCount(0)} />
    : null;
  if (drawResult) return <section key="reveal" className="cosmetic-screen cosmetic-reveal-screen" aria-label="치장 뽑기 결과 화면">
    {/* 갓 뽑은 것을 바로 입어 보러 갈 수 있게. 닫고 나면 캐릭터 창의 치장 탭이 열린다. */}
    {onClose && <button type="button" className="cosmetic-dress-up" onClick={onClose}>치장하러 가기</button>}
    <CosmeticDrawReveal key={revealSequence} draw={drawResult} catalog={catalogData} banner={resultBanner} pending={blocked} milestoneClaimed={claimedBannerId === drawResult.bannerId} onRedraw={(count) => run({ kind: "draw", bannerId: drawResult.bannerId, count })} onClaimMilestone={claimableBoxCount ? () => run({ kind: "claim", bannerId: drawResult.bannerId, count: claimableBoxCount }) : undefined} onContinue={() => { setDrawResult(null); setClaimedBannerId(null); }} />
    {claimedDialog}
  </section>;
  return <section key="main" className="cosmetic-screen" aria-labelledby="cosmetics-title">
    {onClose && <button type="button" className="cosmetic-return" aria-label="치장 뽑기 닫기" onClick={onClose}>×</button>}
    {/* 뽑고 나면 받은 것을 보러 가고 싶다. 닫기를 찾아 헤매지 않게 지름길을 둔다. */}
    {onClose && <button type="button" className="cozy-quick-shortcut" onClick={onClose}>치장 보러 가기<i className="cozy-chevron is-next" aria-hidden="true" /></button>}
    <header className="cosmetic-screen-heading">
      {headlineBanner && !gachaUnavailable ? <button type="button" className="cosmetic-odds-button" onClick={() => { setSelectedBannerId(headlineBanner.bannerId); setOddsBannerId(headlineBanner.bannerId); }}><i aria-hidden="true" />등급별 확률</button> : <span />}
      <h2 id="cosmetics-title">치장 뽑기</h2>
      {headlineBanner && !gachaUnavailable ? <CosmeticWalletBalance banner={headlineBanner} /> : <span />}
    </header>
    {showCurrentUncertainRetry
      ? <TopAlert
        message="변경 결과를 확인하지 못했습니다. 같은 요청을 다시 확인하기 전까지 새 변경을 제한합니다."
        action={<button type="button" disabled={mutation.isPending || (gachaUnavailable && currentRetryCommand?.kind === "draw")} onClick={retrySameCommand}>같은 요청 다시 확인</button>} />
      : mutation.isError && <TopAlert
        message={cosmeticsErrorMessage(mutation.error instanceof Error ? mutation.error.message : "")}
        action={<button type="button" onClick={closeCurrentError}>오류 닫기</button>} />}
    {gachaUnavailable ? <div className="cosmetic-error cosmetic-gacha-unavailable" role="status"><strong>현재 뽑기를 이용할 수 없습니다.</strong><p>도감·등록·착용은 캐릭터 창의 치장 탭에서 계속 이용할 수 있습니다.</p></div> : banners.data && <CosmeticGachaBoard key={showcase.data?.version ?? "showcase-loading"} banners={banners.data} showcase={showcase.data} pending={blocked} claimedBannerId={claimedBannerId} onDraw={(banner, count) => { setSelectedBannerId(banner.bannerId); run({ kind: "draw", bannerId: banner.bannerId, count }); }} onCommand={run} />}
    {oddsBannerId && <CosmeticProbabilityDialog detail={detail.data?.banner.bannerId === oddsBannerId ? detail.data : undefined} error={Boolean(detail.error)} onRetry={() => void detail.refetch()} onClose={() => setOddsBannerId(null)} />}
    {claimedDialog}
  </section>;
}
