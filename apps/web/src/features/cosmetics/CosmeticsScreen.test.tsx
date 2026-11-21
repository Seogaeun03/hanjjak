// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { cosmeticsApi, CosmeticsApiError, type DrawResponse } from "./api";
import { CosmeticsScreen } from "./CosmeticsScreen";
import { CosmeticDrawReveal } from "./CosmeticDrawReveal";
import { cosmeticDisplayName } from "./cosmetic-art";

afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); });

const banner = { bannerId: "cosmetic-banner-01", setId: "cosmetic-set-15", displayName: null, singleRiceCost: 5000, ticketBalance: 0, riceBalance: 50_000, oneDraw: { ticketCost: 0, riceCost: 5000, executable: true }, tenDraw: { ticketCost: 0, riceCost: 50_000, executable: true }, milestone: { totalSuccessfulDraws: 200, claimedBoxCount: 0, claimableBoxCount: 1, drawsUntilNextBox: 0, boxItemId: "cosmetic-selector-box-01", ownedBoxQuantity: 1 } };
const secondBanner = { ...banner, bannerId: "cosmetic-banner-02", setId: "cosmetic-set-12", singleRiceCost: 7000, ticketBalance: 2, riceBalance: 70_000, oneDraw: { ticketCost: 2, riceCost: 7000, executable: true }, tenDraw: { ticketCost: 20, riceCost: 70_000, executable: true }, milestone: { ...banner.milestone, boxItemId: "cosmetic-selector-box-01" } };
const collection = { contentVersion: "v2", states: [{ cosmeticId: "cosmetic-061", displayName: null, imageUrl: null, grade: "LEGENDARY", slot: "HEAD", registeredQuantity: 1, unregisteredQuantity: 0, reservedQuantity: 0, availableUnregisteredQuantity: 0, cosmeticStar: 1, nextStarThreshold: 2, neededForNextStar: 1, canUpgrade: false, upgradeDisabledReason: "INSUFFICIENT_DUPLICATES" }], color: null, equipment: {}, uniqueRegisteredCount: 1, setStars: {}, setEffects: {}, totalEffects: [] };
const catalog = { contentVersion: "v2", cosmetics: Array.from({ length: 6 }, (_, index) => ({ cosmeticId: `cosmetic-${String(index + 61).padStart(3, "0")}`, displayName: null, imageUrl: null, grade: "LEGENDARY", slot: ["HEAD", "TOP", "BOTTOM", "GLOVES", "SHOES", "CAPE"][index], setId: "cosmetic-set-15" })), sets: [{ setId: "cosmetic-set-15", displayName: null, grade: "LEGENDARY", members: {}, effects: {} }] };
// 콘텐츠 표시명이 비어 있으면 이름은 `세트 이름 + 부위 이름`으로 만들어진다.
const nameOf = (cosmeticId: string) => cosmeticDisplayName(catalog.cosmetics.find((item) => item.cosmeticId === cosmeticId));

const drawResponse: DrawResponse = {
  bannerId: banner.bannerId,
  ticketCost: 1,
  riceCost: 5_000,
  results: [
    { cosmeticId: "cosmetic-061", grade: "LEGENDARY", isNew: true },
    { cosmeticId: "cosmetic-062", grade: "LEGENDARY", isNew: false },
  ],
  collection,
};
function clientWithData(options: { bannerStaleTime?: number } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: options.bannerStaleTime ?? Infinity }, mutations: { retry: false } } });
  client.setQueryData(["cosmetic-banners"], [banner]);
  client.setQueryData(["cosmetic-collection"], collection);
  client.setQueryData(["cosmetic-catalog"], catalog);
  return client;
}

function renderScreen(client = clientWithData()) {
  render(<QueryClientProvider client={client}><CosmeticsScreen /></QueryClientProvider>);
  return client;
}

const drawOnce = () => fireEvent.click(screen.getByRole("button", { name: /^1회 뽑기/ }));

it("renders a concise milestone row and leaves the collection to the character tab", () => {
  const html = renderToStaticMarkup(<QueryClientProvider client={clientWithData()}><CosmeticsScreen /></QueryClientProvider>);
  expect(html).toContain("치장 랜덤 뽑기");
  // 200회를 채우는 뽑기까지는 200 / 200 이고, 그 다음 한 번이 1 / 200 이 된다.
  expect(html).toContain("선택 상자 진행도 200 / 200");
  expect(html).toContain("선택 상자 1개 받기");
  expect(html).toContain("선택 치장");
  // 도감·등록·착용은 이 화면에 없다. 보유 치장 카드가 새어 나오면 안 된다.
  expect(html).not.toContain(nameOf("cosmetic-061"));
  expect(html).not.toContain("도감과 외형");
  expect(html).not.toContain("<select");
});

it("carries draws past the milestone into the next gauge and counts unclaimed boxes", () => {
  const client = clientWithData();
  // 410회를 뽑고 한 번도 받지 않은 계정. 상자 2개가 밀려 있고 나머지 10회가 다음 칸에 남는다.
  client.setQueryData(["cosmetic-banners"], [{ ...banner, milestone: { ...banner.milestone, totalSuccessfulDraws: 410, claimedBoxCount: 0, claimableBoxCount: 2, drawsUntilNextBox: 0, ownedBoxQuantity: 3 } }]);
  const html = renderToStaticMarkup(<QueryClientProvider client={client}><CosmeticsScreen /></QueryClientProvider>);

  expect(html).toContain("선택 상자 진행도 10 / 200");
  // 미수령 상자가 있으면 인벤토리 보유 수량(3)이 아니라 받을 수 있는 수량(2)을 센다.
  expect(html).toContain(">2개<");
  expect(html).not.toContain(">3개<");
});

it("renders an ordered result grid from the server response", () => {
  const html = renderToStaticMarkup(<CosmeticDrawReveal
    draw={{
      bannerId: banner.bannerId,
      ticketCost: 0,
      riceCost: 50_000,
      results: [
        { cosmeticId: "cosmetic-062", grade: "LEGENDARY", isNew: true },
        { cosmeticId: "cosmetic-061", grade: "LEGENDARY", isNew: false },
      ],
      collection,
    }}
    catalog={catalog}
  />);
  expect(html).not.toContain("획득 결과");
  expect(html).toContain("NEW");
  expect(html).not.toContain("중복");
  expect(html.indexOf(nameOf("cosmetic-062"))).toBeLessThan(html.indexOf(nameOf("cosmetic-061")));
});

it("draws immediately without a confirmation step and preserves server results", async () => {
  const draw = vi.spyOn(cosmeticsApi, "draw").mockResolvedValue(drawResponse);
  // 명령이 끝나면 배너를 다시 읽으므로, 조회도 함께 세워 둔다.
  vi.spyOn(cosmeticsApi, "banners").mockResolvedValue([banner]);
  renderScreen();
  drawOnce();
  await waitFor(() => expect(draw).toHaveBeenCalledWith(banner.bannerId, 1, expect.any(String)));
  expect(screen.queryByRole("dialog", { name: "뽑기 전 확인" })).toBeNull();
  expect((await screen.findAllByText(nameOf("cosmetic-061"))).length).toBeGreaterThan(0);
  expect(screen.getByText("NEW")).toBeTruthy();
  expect(screen.queryByText("중복")).toBeNull();
  expect(screen.getByRole("button", { name: /다시 1회 뽑기/ })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^1회 뽑기/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "돌아가기" }));
  expect(screen.getByRole("button", { name: /^1회 뽑기/ })).toBeTruthy();
  expect(draw).toHaveBeenCalledTimes(1);
});

it("refreshes balances and milestone before showing draw actions or returning to the board", async () => {
  const beforeDraw = {
    ...banner,
    ticketBalance: 150,
    riceBalance: 120_431,
    tenDraw: { ticketCost: 10, riceCost: 0, executable: true },
    milestone: { ...banner.milestone, totalSuccessfulDraws: 110, claimableBoxCount: 0, drawsUntilNextBox: 90 },
  };
  const afterDraw = {
    ...beforeDraw,
    ticketBalance: 140,
    milestone: { ...beforeDraw.milestone, totalSuccessfulDraws: 120, drawsUntilNextBox: 80 },
  };
  const tenDrawResponse: DrawResponse = {
    ...drawResponse,
    ticketCost: 10,
    riceCost: 0,
    results: Array.from({ length: 10 }, (_, index) => ({
      cosmeticId: index % 2 === 0 ? "cosmetic-061" : "cosmetic-062",
      grade: "LEGENDARY",
      isNew: index === 0,
    })),
  };
  const client = clientWithData();
  client.setQueryData(["cosmetic-banners"], [beforeDraw]);
  vi.spyOn(cosmeticsApi, "draw").mockResolvedValue(tenDrawResponse);
  const banners = vi.spyOn(cosmeticsApi, "banners").mockResolvedValue([afterDraw]);
  renderScreen(client);

  fireEvent.click(screen.getByRole("button", { name: /^10회 뽑기/ }));

  expect(await screen.findByLabelText("선택 상자 진행도 120 / 200")).toBeTruthy();
  expect(screen.getByRole("button", { name: /다시 10회 뽑기 뽑기권 140장 · 쌀 120,431/ })).toBeTruthy();
  expect(banners).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole("button", { name: "돌아가기" }));
  expect(screen.getByLabelText("뽑기권 140개")).toBeTruthy();
  expect(screen.getByLabelText("쌀 120,431")).toBeTruthy();
});

it("refreshes the rice balance after a rice-funded draw", async () => {
  const beforeDraw = {
    ...banner,
    riceBalance: 120_431,
    milestone: { ...banner.milestone, totalSuccessfulDraws: 110, claimableBoxCount: 0, drawsUntilNextBox: 90 },
  };
  const afterDraw = {
    ...beforeDraw,
    riceBalance: 115_431,
    milestone: { ...beforeDraw.milestone, totalSuccessfulDraws: 111, drawsUntilNextBox: 89 },
  };
  const client = clientWithData();
  client.setQueryData(["cosmetic-banners"], [beforeDraw]);
  vi.spyOn(cosmeticsApi, "draw").mockResolvedValue({ ...drawResponse, ticketCost: 0, riceCost: 5_000 });
  vi.spyOn(cosmeticsApi, "banners").mockResolvedValue([afterDraw]);
  renderScreen(client);

  drawOnce();

  expect(await screen.findByLabelText("선택 상자 진행도 111 / 200")).toBeTruthy();
  expect(screen.getByRole("button", { name: /다시 1회 뽑기 뽑기권 0장 · 쌀 115,431/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "돌아가기" }));
  expect(screen.getByLabelText("쌀 115,431")).toBeTruthy();
});

it("reuses the same draw request when the post-draw banner refresh is uncertain", async () => {
  const draw = vi.spyOn(cosmeticsApi, "draw").mockResolvedValue(drawResponse);
  const banners = vi.spyOn(cosmeticsApi, "banners")
    .mockRejectedValueOnce(new TypeError("network lost after draw"))
    .mockResolvedValueOnce([banner]);
  vi.spyOn(crypto, "randomUUID").mockReturnValue("same-post-draw-key" as ReturnType<typeof crypto.randomUUID>);
  renderScreen();

  drawOnce();
  fireEvent.click(await screen.findByRole("button", { name: "같은 요청 다시 확인" }));

  expect(await screen.findByLabelText("치장 뽑기 결과")).toBeTruthy();
  expect(draw).toHaveBeenCalledTimes(2);
  expect(draw).toHaveBeenNthCalledWith(1, banner.bannerId, 1, "same-post-draw-key");
  expect(draw).toHaveBeenNthCalledWith(2, banner.bannerId, 1, "same-post-draw-key");
  expect(banners).toHaveBeenCalledTimes(2);
});

it("refetches authoritative state without replaying a draw after a deterministic banner refresh error", async () => {
  const afterDraw = {
    ...banner,
    riceBalance: 45_000,
    milestone: { ...banner.milestone, totalSuccessfulDraws: 201, claimableBoxCount: 1, drawsUntilNextBox: 199 },
  };
  const draw = vi.spyOn(cosmeticsApi, "draw").mockResolvedValue(drawResponse);
  const banners = vi.spyOn(cosmeticsApi, "banners")
    .mockRejectedValueOnce(new CosmeticsApiError(409, "COSMETIC_STATE_CONFLICT"))
    .mockResolvedValue([afterDraw]);
  const client = clientWithData();
  vi.spyOn(client, "refetchQueries").mockImplementation(async (filters) => {
    if (filters?.queryKey?.[0] === "cosmetic-banners") {
      client.setQueryData(["cosmetic-banners"], await cosmeticsApi.banners());
    }
  });
  renderScreen(client);

  drawOnce();
  await screen.findByText("치장 상태가 변경되었습니다. 최신 상태를 확인해 주세요.");
  fireEvent.click(screen.getByRole("button", { name: "오류 닫기" }));

  await waitFor(() => expect(banners).toHaveBeenCalledTimes(2));
  expect(draw).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.getByLabelText("쌀 45,000")).toBeTruthy());
});

it("sends a claimed box to the inventory and says where it went", async () => {
  vi.spyOn(cosmeticsApi, "draw").mockResolvedValue(drawResponse);
  vi.spyOn(cosmeticsApi, "banners").mockResolvedValue([banner]);
  const claim = vi.spyOn(cosmeticsApi, "claimMilestone").mockResolvedValue({ remainingClaimableCount: 0 });
  const openInventory = vi.fn();
  render(<QueryClientProvider client={clientWithData()}><CosmeticsScreen onOpenInventory={openInventory} /></QueryClientProvider>);

  drawOnce();
  await screen.findByLabelText("치장 뽑기 결과");
  fireEvent.click(screen.getByRole("button", { name: "선택 상자 1개 받기" }));

  await waitFor(() => expect(claim).toHaveBeenCalledWith(banner.bannerId, 1, expect.any(String)));
  // 상자는 인벤토리로 들어간다. 이 화면에서 바로 치장을 고르지 않는다.
  expect(await screen.findByText("치장 선택권 박스 1개 수령하였습니다.")).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "전설 세트 선택" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "인벤토리로 이동" }));
  expect(openInventory).toHaveBeenCalledTimes(1);
});

it("claims every pending selector box in one press", async () => {
  vi.spyOn(cosmeticsApi, "banners").mockResolvedValue([{ ...banner, milestone: { ...banner.milestone, totalSuccessfulDraws: 410, claimedBoxCount: 0, claimableBoxCount: 2, drawsUntilNextBox: 0 } }]);
  const claim = vi.spyOn(cosmeticsApi, "claimMilestone").mockResolvedValue({ remainingClaimableCount: 0 });
  const client = clientWithData();
  // 받지 않은 채 410회까지 뽑아 상자 2개가 밀려 있다. 한 번 눌러 둘 다 받는다.
  client.setQueryData(["cosmetic-banners"], [{ ...banner, milestone: { ...banner.milestone, totalSuccessfulDraws: 410, claimedBoxCount: 0, claimableBoxCount: 2, drawsUntilNextBox: 0 } }]);
  renderScreen(client);

  fireEvent.click(screen.getByRole("button", { name: "선택 상자 2개 받기" }));

  await waitFor(() => expect(claim).toHaveBeenCalledWith(banner.bannerId, 2, expect.any(String)));
  expect(claim).toHaveBeenCalledTimes(1);
  expect(await screen.findByText("치장 선택권 박스 2개 수령하였습니다.")).toBeTruthy();
});

it("refreshes the claimable count at click time and applies the server remaining count", async () => {
  const freshBanner = { ...banner, milestone: { ...banner.milestone, totalSuccessfulDraws: 401, claimedBoxCount: 1, claimableBoxCount: 1, drawsUntilNextBox: 0 } };
  vi.spyOn(cosmeticsApi, "banners").mockResolvedValue([freshBanner]);
  const claim = vi.spyOn(cosmeticsApi, "claimMilestone").mockResolvedValue({ remainingClaimableCount: 0 });
  const client = clientWithData();
  client.setQueryData(["cosmetic-banners"], [{ ...banner, milestone: { ...banner.milestone, totalSuccessfulDraws: 401, claimedBoxCount: 0, claimableBoxCount: 2, drawsUntilNextBox: 0 } }]);
  renderScreen(client);

  fireEvent.click(screen.getByRole("button", { name: "선택 상자 2개 받기" }));

  await waitFor(() => expect(claim).toHaveBeenCalledWith(banner.bannerId, 1, expect.any(String)));
  expect(await screen.findByText("치장 선택권 박스 1개 수령하였습니다.")).toBeTruthy();
  const cached = client.getQueryData<typeof freshBanner[]>(["cosmetic-banners"]);
  expect(cached?.[0]?.milestone.claimableBoxCount).toBe(0);
  expect(cached?.[0]?.milestone.claimedBoxCount).toBe(2);
});

it("does not send a stale claim after another tab has already received the boxes", async () => {
  vi.spyOn(cosmeticsApi, "banners").mockResolvedValue([{ ...banner, milestone: { ...banner.milestone, claimedBoxCount: 1, claimableBoxCount: 0, drawsUntilNextBox: 200 } }]);
  const claim = vi.spyOn(cosmeticsApi, "claimMilestone").mockResolvedValue({ remainingClaimableCount: 0 });
  renderScreen();

  fireEvent.click(screen.getByRole("button", { name: "선택 상자 1개 받기" }));

  await waitFor(() => expect(cosmeticsApi.banners).toHaveBeenCalledTimes(1));
  expect(claim).not.toHaveBeenCalled();
  expect(screen.queryByText(/수령하였습니다/)).toBeNull();
});

it("loads the one general banner detail for the odds dialog", async () => {
  const detail = vi.spyOn(cosmeticsApi, "detail").mockImplementation(async (bannerId) => ({
    banner: bannerId === secondBanner.bannerId ? secondBanner : banner,
    gradeProbabilityMillionths: { LEGENDARY: bannerId === secondBanner.bannerId ? 222_222 : 111_111 },
    pool: [],
  }));
  const client = clientWithData();
  client.setQueryData(["cosmetic-banners"], [banner, secondBanner]);
  renderScreen(client);
  fireEvent.click(screen.getByRole("button", { name: "등급별 확률" }));

  const dialog = await screen.findByRole("dialog", { name: "치장 뽑기 확률" });
  expect(detail).toHaveBeenCalledWith(banner.bannerId);
  expect(await within(dialog).findByText(/111,111/)).toBeTruthy();
  expect(within(dialog).queryByText(/222,222/)).toBeNull();
});

it("hides draw controls and the odds dialog when a cached banner query refetch fails", async () => {
  const client = clientWithData();
  vi.spyOn(cosmeticsApi, "detail").mockResolvedValue({ banner, gradeProbabilityMillionths: { LEGENDARY: 111_111 }, pool: [] });
  renderScreen(client);
  fireEvent.click(screen.getByRole("button", { name: "등급별 확률" }));
  expect(await screen.findByRole("dialog", { name: "치장 뽑기 확률" })).toBeTruthy();

  vi.spyOn(cosmeticsApi, "banners").mockRejectedValue(new Error("GACHA_CONTENT_UNAVAILABLE"));
  await client.refetchQueries({ queryKey: ["cosmetic-banners"] });

  expect(await screen.findByText("현재 뽑기를 이용할 수 없습니다.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^1회 뽑기/ })).toBeNull();
  expect(screen.queryByRole("dialog", { name: "치장 뽑기 확률" })).toBeNull();
  expect(screen.getByText("도감·등록·착용은 캐릭터 창의 치장 탭에서 계속 이용할 수 있습니다.")).toBeTruthy();
});

it("serves the board from cached banners without calling a failing endpoint", () => {
  const banners = vi.spyOn(cosmeticsApi, "banners").mockRejectedValue(new Error("GACHA_CONTENT_UNAVAILABLE"));
  renderScreen();
  expect(screen.getByRole("button", { name: /^1회 뽑기/ })).toBeTruthy();
  expect(screen.queryByText("현재 뽑기를 이용할 수 없습니다.")).toBeNull();
  expect(banners).not.toHaveBeenCalled();
});

it("renders the 1-5 unlock notice without gacha or management controls when cosmetics are locked", async () => {
  vi.spyOn(cosmeticsApi, "collection").mockRejectedValue(new CosmeticsApiError(403, "COSMETICS_LOCKED"));
  vi.spyOn(cosmeticsApi, "catalog").mockRejectedValue(new CosmeticsApiError(403, "COSMETICS_LOCKED"));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["cosmetic-banners"], []);
  renderScreen(client);

  expect(await screen.findByText(/1-5/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /뽑기/ })).toBeNull();
  expect(screen.queryByText("도감과 외형")).toBeNull();
});

it("retries an uncertain command with the exact same request", async () => {
  const draw = vi.spyOn(cosmeticsApi, "draw").mockRejectedValueOnce(new TypeError("network lost")).mockResolvedValueOnce(drawResponse);
  vi.spyOn(cosmeticsApi, "banners").mockResolvedValue([banner]);
  vi.spyOn(crypto, "randomUUID").mockReturnValue("same-request-key" as ReturnType<typeof crypto.randomUUID>);
  renderScreen();
  drawOnce();
  fireEvent.click(await screen.findByRole("button", { name: "같은 요청 다시 확인" }));
  await waitFor(() => expect(draw).toHaveBeenCalledTimes(2));
  expect(draw.mock.calls[0]).toEqual(draw.mock.calls[1]);
  expect((await screen.findAllByText(nameOf("cosmetic-061"))).length).toBeGreaterThan(0);
});

it("blocks every other command until an uncertain draw is confirmed", async () => {
  const draw = vi.spyOn(cosmeticsApi, "draw").mockRejectedValue(new TypeError("network lost"));
  const claim = vi.spyOn(cosmeticsApi, "claimMilestone").mockResolvedValue({ remainingClaimableCount: 0 });
  renderScreen();
  drawOnce();
  await screen.findByRole("button", { name: "같은 요청 다시 확인" });

  const claimButton = screen.getByRole("button", { name: "선택 상자 1개 받기" });
  expect((claimButton as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: /^1회 뽑기/ }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(claimButton);
  drawOnce();
  expect(claim).not.toHaveBeenCalled();
  expect(draw).toHaveBeenCalledTimes(1);
});

it("keeps a stable gacha outage from re-sending the draw", async () => {
  const draw = vi.spyOn(cosmeticsApi, "draw").mockRejectedValue(new CosmeticsApiError(503, "GACHA_CONTENT_UNAVAILABLE"));
  renderScreen();
  drawOnce();

  expect(await screen.findByText("현재 뽑기를 이용할 수 없습니다.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^1회 뽑기/ })).toBeNull();
  const retry = screen.getByRole("button", { name: "같은 요청 다시 확인" });
  expect((retry as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(retry);
  expect(draw).toHaveBeenCalledTimes(1);
});

it("gives each command its own idempotency key", async () => {
  const draw = vi.spyOn(cosmeticsApi, "draw").mockResolvedValue(drawResponse);
  vi.spyOn(cosmeticsApi, "banners").mockResolvedValue([banner]);
  const claim = vi.spyOn(cosmeticsApi, "claimMilestone").mockResolvedValue({ remainingClaimableCount: 0 });
  renderScreen();
  drawOnce();
  await screen.findByLabelText("치장 뽑기 결과");
  fireEvent.click(screen.getByRole("button", { name: "선택 상자 1개 받기" }));

  await waitFor(() => expect(claim).toHaveBeenCalledTimes(1));
  expect(claim.mock.calls[0][2]).not.toBe(draw.mock.calls[0][2]);
});

it("retries an uncertain milestone claim with the resolved count and same key", async () => {
  vi.spyOn(cosmeticsApi, "banners").mockResolvedValue([banner]);
  const claim = vi.spyOn(cosmeticsApi, "claimMilestone")
    .mockRejectedValueOnce(new TypeError("network lost"))
    .mockResolvedValueOnce({ remainingClaimableCount: 0 });
  vi.spyOn(crypto, "randomUUID").mockReturnValue("stable-claim-key" as ReturnType<typeof crypto.randomUUID>);
  renderScreen();

  fireEvent.click(screen.getByRole("button", { name: "선택 상자 1개 받기" }));
  fireEvent.click(await screen.findByRole("button", { name: "같은 요청 다시 확인" }));

  await waitFor(() => expect(claim).toHaveBeenCalledTimes(2));
  expect(claim.mock.calls[0]).toEqual(claim.mock.calls[1]);
  expect(await screen.findByText("치장 선택권 박스 1개 수령하였습니다.")).toBeTruthy();
});

it("sends only one command for synchronous actionable clicks", async () => {
  const claimGate = Promise.withResolvers<{ remainingClaimableCount: number }>();
  vi.spyOn(cosmeticsApi, "banners").mockResolvedValue([banner, secondBanner]);
  const claim = vi.spyOn(cosmeticsApi, "claimMilestone").mockImplementation(() => claimGate.promise);
  const client = clientWithData();
  client.setQueryData(["cosmetic-banners"], [banner, secondBanner]);
  renderScreen(client);

  const claimButton = screen.getByRole("button", { name: "선택 상자 1개 받기" });
  fireEvent.click(claimButton);
  fireEvent.click(claimButton);

  await waitFor(() => expect(claim).toHaveBeenCalledTimes(1));
  claimGate.resolve({ remainingClaimableCount: 0 });
  await screen.findByText("치장 선택권 박스 1개 수령하였습니다.");
});

it("refetches authoritative cosmetics state before closing deterministic errors", async () => {
  vi.spyOn(cosmeticsApi, "banners").mockResolvedValue([banner]);
  const claim = vi.spyOn(cosmeticsApi, "claimMilestone").mockRejectedValue(new CosmeticsApiError(409, "COSMETIC_STATE_CONFLICT"));
  const client = clientWithData();
  const refetch = vi.spyOn(client, "refetchQueries");
  renderScreen(client);

  fireEvent.click(screen.getByRole("button", { name: "선택 상자 1개 받기" }));
  await waitFor(() => expect(claim).toHaveBeenCalledTimes(1));
  await screen.findByText("치장 상태가 변경되었습니다. 최신 상태를 확인해 주세요.");
  fireEvent.click(screen.getByRole("button", { name: "오류 닫기" }));

  await waitFor(() => expect(refetch).toHaveBeenCalledTimes(4));
  expect(refetch).toHaveBeenCalledWith({ queryKey: ["cosmetic-banners"] });
  expect(refetch).toHaveBeenCalledWith({ queryKey: ["cosmetic-collection"] });
  expect(refetch).toHaveBeenCalledWith({ queryKey: ["cosmetic-catalog"] });
  expect(refetch).toHaveBeenCalledWith({ queryKey: ["character-stats"] });
  await waitFor(() => expect(screen.queryByText("치장 상태가 변경되었습니다. 최신 상태를 확인해 주세요.")).toBeNull());
});

it("blocks all commands while a deterministic error is open and during close refetch", async () => {
  vi.spyOn(cosmeticsApi, "banners").mockResolvedValue([banner]);
  const claim = vi.spyOn(cosmeticsApi, "claimMilestone").mockRejectedValue(new CosmeticsApiError(409, "COSMETIC_STATE_CONFLICT"));
  const draw = vi.spyOn(cosmeticsApi, "draw").mockResolvedValue(drawResponse);
  const client = clientWithData();
  const refetchGate = Promise.withResolvers<void>();
  vi.spyOn(client, "refetchQueries").mockImplementation((filters) => {
    if (filters?.queryKey?.[0] === "cosmetic-collection") return refetchGate.promise;
    return Promise.resolve();
  });
  renderScreen(client);

  fireEvent.click(screen.getByRole("button", { name: "선택 상자 1개 받기" }));
  await waitFor(() => expect(claim).toHaveBeenCalledTimes(1));
  await screen.findByText("치장 상태가 변경되었습니다. 최신 상태를 확인해 주세요.");

  const drawButton = screen.getByRole("button", { name: /^1회 뽑기/ });
  expect((drawButton as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "선택 상자 1개 받기" }) as HTMLButtonElement).disabled).toBe(true);

  fireEvent.click(screen.getByRole("button", { name: "오류 닫기" }));
  fireEvent.click(drawButton);
  expect(draw).not.toHaveBeenCalled();
  expect((drawButton as HTMLButtonElement).disabled).toBe(true);

  refetchGate.resolve();
  await waitFor(() => expect((screen.getByRole("button", { name: /^1회 뽑기/ }) as HTMLButtonElement).disabled).toBe(false));
  drawOnce();
  await waitFor(() => expect(draw).toHaveBeenCalledTimes(1));
});

it("offers a shortcut from the draw result straight to dressing up", async () => {
  vi.spyOn(cosmeticsApi, "draw").mockResolvedValue(drawResponse);
  vi.spyOn(cosmeticsApi, "banners").mockResolvedValue([banner]);
  const onClose = vi.fn();
  render(<QueryClientProvider client={clientWithData()}><CosmeticsScreen onClose={onClose} /></QueryClientProvider>);
  drawOnce();
  await screen.findByLabelText("치장 뽑기 결과");
  // 갓 뽑은 것을 바로 입어 보러 가는 길이 결과 화면에 있어야 한다.
  fireEvent.click(screen.getByRole("button", { name: "치장하러 가기" }));
  expect(onClose).toHaveBeenCalled();
});
