// @vitest-environment happy-dom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Banner, CosmeticShowcase } from "./api";
import { CosmeticGachaBoard, CosmeticWalletBalance } from "./CosmeticGachaBoard";

afterEach(() => { document.body.innerHTML = ""; });

const banner: Banner = {
  bannerId: "banner-01", setId: "set-01", displayName: null, singleRiceCost: 5000,
  ticketBalance: 4, riceBalance: 50_000,
  oneDraw: { ticketCost: 1, riceCost: 5000, executable: true },
  tenDraw: { ticketCost: 10, riceCost: 50_000, executable: false },
  milestone: { totalSuccessfulDraws: 7, claimedBoxCount: 0, claimableBoxCount: 0, drawsUntilNextBox: 193, boxItemId: "box-01", ownedBoxQuantity: 0 },
};
const board = (banners = [banner], overrides: Partial<Parameters<typeof CosmeticGachaBoard>[0]> = {}) => <CosmeticGachaBoard banners={banners} onDraw={vi.fn()} {...overrides} />;

it("renders server balances in the wallet row", () => {
  render(<CosmeticWalletBalance banner={banner} />);
  const wallet = screen.getByLabelText("보유 재화");
  expect(within(wallet).getByText("4", { selector: "strong" })).toBeTruthy();
  expect(within(wallet).getByText("50,000", { selector: "strong" })).toBeTruthy();
});

it("renders executable draw estimates without a probability action", () => {
  const onDraw = vi.fn();
  render(board([banner], { onDraw }));
  expect(screen.getByRole("button", { name: /1회/ })).not.toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: /10회/ })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: /1회/ }));
  expect(onDraw).toHaveBeenCalledWith(banner, 1);
  expect(screen.queryByRole("button", { name: /확률/ })).toBeNull();
});

it("keeps the selector box locked until the milestone is reached", () => {
  const onDraw = vi.fn();
  const onCommand = vi.fn();
  const almostReady = { ...banner, milestone: { ...banner.milestone, totalSuccessfulDraws: 199, drawsUntilNextBox: 1 } };
  render(board([almostReady], { onDraw, onCommand }));

  // 상자가 모이기 전에는 누를 것이 없다. 뽑기는 위의 뽑기 버튼으로만 한다.
  const box = screen.getByRole("button", { name: "선택 상자까지 1회 남음" });
  expect((box as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(box);
  expect(onDraw).not.toHaveBeenCalled();
  expect(onCommand).not.toHaveBeenCalled();
});

it("leaves the box button inert once every milestone box is claimed", () => {
  const onCommand = vi.fn();
  // 받은 상자는 인벤토리에서 연다. 여기서는 더 받을 것이 없으면 누를 수 없다.
  const claimed = { ...banner, milestone: { ...banner.milestone, totalSuccessfulDraws: 200, claimedBoxCount: 1, claimableBoxCount: 0, drawsUntilNextBox: 200, ownedBoxQuantity: 1 } };
  render(board([claimed], { onCommand }));

  const box = screen.getByRole("button", { name: "선택 상자까지 200회 남음" });
  expect((box as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(box);
  expect(onCommand).not.toHaveBeenCalled();
});

it("renders one general draw without legendary set selectors", () => {
  const second = { ...banner, bannerId: "banner-02", setId: "set-02" };
  const onDraw = vi.fn();
  render(<CosmeticGachaBoard banners={[banner, second]} onDraw={onDraw} />);

  expect(screen.queryByRole("button", { name: "달토끼" })).toBeNull();
  expect(screen.queryByRole("button", { name: "스시야" })).toBeNull();
  expect(screen.getAllByRole("button", { name: /1회 뽑기/ })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: /1회 뽑기/ }));
  expect(onDraw).toHaveBeenCalledWith(banner, 1);
});

it("shows exactly one image from the administrator selection", () => {
  const showcase: CosmeticShowcase = {
    version: 3,
    sets: [
      { setId: "white-fox-spirit", displayName: "구미호 세트", imageUrl: "/fox.png" },
    ],
  };
  const { container } = render(board([banner], { showcase }));

  expect(screen.getByText("구미호 세트")).toBeTruthy();
  expect(screen.getByRole("img", { name: "구미호 세트 키 아트" })).toBeTruthy();
  expect(screen.getAllByRole("img", { name: /키 아트/ })).toHaveLength(1);
  const frameImages = container.querySelectorAll(".cosmetic-showcase-frame > img");
  expect(frameImages).toHaveLength(2);
  expect(frameImages[0]?.getAttribute("alt")).toBe("구미호 세트 키 아트");
  expect(frameImages[1]?.classList.contains("cosmetic-showcase-frame-overlay")).toBe(true);
  expect(frameImages[1]?.getAttribute("alt")).toBe("");
  expect(frameImages[1]?.getAttribute("aria-hidden")).toBe("true");
});

it("can render every fixed showcase image regardless of the former admin selection", () => {
  const showcase: CosmeticShowcase = {
    version: 4,
    sets: [
      { setId: "cardboard-crayon-warrior", displayName: "골판지 크레용 전사", imageUrl: "/assets/cosmetics/showcase/%EA%B3%A8%ED%8C%90%EC%A7%80%20%ED%81%AC%EB%A0%88%EC%9A%A9%20%EC%A0%84%EC%82%AC.webp" },
      { setId: "forest-spirit", displayName: "숲의정령", imageUrl: "/assets/cosmetics/showcase/%EC%88%B2%EC%9D%98%EC%A0%95%EB%A0%B9.webp" },
      { setId: "snake-water-guardian", displayName: "뱀물수호자", imageUrl: "/assets/cosmetics/showcase/%EB%B1%80%EB%AC%BC%EC%88%98%ED%98%B8%EC%9E%90.webp" },
    ],
  };
  const random = vi.spyOn(Math, "random").mockReturnValue(.99);
  render(board([banner], { showcase }));

  expect(screen.getByText("뱀물수호자")).toBeTruthy();
  expect(screen.getByRole("img", { name: "뱀물수호자 키 아트" }).getAttribute("src")).toContain("%EB%B1%80%EB%AC%BC%EC%88%98%ED%98%B8%EC%9E%90.webp");
  random.mockRestore();
});
