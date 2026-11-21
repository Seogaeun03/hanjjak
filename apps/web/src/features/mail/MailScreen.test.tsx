// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MailScreen, claimableRice, giftMailOnly, sortMailForReading, type MailDataSource, type NoticeDataSource } from "./MailScreen";
import { mailDateLabel, mailTypeLabel, rewardLabel, type MailMessage, type Notice } from "./api";

afterEach(cleanup);

const mail = (mailId: string, riceAmount: number, claimed: boolean, createdAt: string, overrides: Partial<MailMessage> = {}): MailMessage => ({
  mailId,
  type: "ADMIN_GIFT",
  riceAmount,
  rewardStatus: claimed ? "CLAIMED" : "PENDING",
  createdAt,
  claimedAt: claimed ? createdAt : null,
  title: null,
  body: null,
  senderName: null,
  readAt: null,
  rewards: [],
  ...overrides,
});

const notice = (noticeId: string, title: string, readAt: string | null = null): Notice =>
  ({ noticeId, title, body: "본문입니다.", senderName: "한짝 운영팀", publishedAt: "2026-09-13T09:20:00Z", expiresAt: null, readAt });

const mails = [
  mail("old-unclaimed", 100, false, "2026-09-10T00:00:00Z"),
  mail("claimed", 999, true, "2026-09-13T00:00:00Z"),
  mail("new-unclaimed", 250, false, "2026-09-12T00:00:00Z"),
];

const notices = [notice("notice-1", "9월 점검 안내")];

function renderScreen(overrides: Partial<MailDataSource> = {}, noticeOverrides: Partial<NoticeDataSource> = {}, onClose?: () => void) {
  const dataSource: MailDataSource = {
    list: vi.fn(async () => ({ items: mails, nextCursor: null, totalItems: mails.length })),
    claim: vi.fn(async (mailId: string, _key: string, _cosmeticId?: string | null) => ({ commandId: "c", idempotencyKey: "k", status: "SUCCEEDED", result: { mailId, riceAmount: 0, claimedAt: "", walletBalance: 0, rewards: [] } })),
    claimAll: vi.fn(async () => ({ commandId: "c", idempotencyKey: "k", status: "SUCCEEDED", result: { claimedMailIds: [], totalRiceAmount: 0, walletBalance: 0, rewards: [] } })),
    read: vi.fn(async (mailId: string) => ({ mailId, readAt: "2026-09-15T00:00:00Z" })),
    remove: vi.fn(async (mailId: string) => ({ mailId, deletedAt: "2026-09-15T00:00:00Z" })),
    ...overrides,
  };
  const noticeSource: NoticeDataSource = {
    list: vi.fn(async () => ({ items: notices, unreadCount: notices.filter((item) => item.readAt == null).length })),
    read: vi.fn(async (noticeId: string) => ({ noticeId, readAt: "2026-09-15T00:00:00Z" })),
    remove: vi.fn(async (noticeId: string) => ({ noticeId, deletedAt: "2026-09-15T00:00:00Z" })),
    ...noticeOverrides,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MailScreen dataSource={dataSource} notices={noticeSource} onClose={onClose} /></QueryClientProvider>);
  return { dataSource, noticeSource };
}

/** 메시지함은 알림 탭으로 열린다. 우편 줄을 보려면 메시지 탭으로 넘어간다. */
function openMailTab() {
  fireEvent.click(screen.getByRole("button", { name: /^메시지/ }));
}

describe("sortMailForReading", () => {
  /* 받을 것이 먼저다. 받은 것은 기록으로만 남아 아래로 내려간다. */
  it("puts what can still be claimed first, newest of those on top", () => {
    expect(sortMailForReading(mails).map((item) => item.mailId)).toEqual(["new-unclaimed", "old-unclaimed", "claimed"]);
  });
});

describe("giftMailOnly", () => {
  it("leaves market settlements to the market inbox", () => {
    const settlement = mail("settlement", 10, false, "2026-09-15T00:00:00Z", { type: "MARKET_SETTLEMENT" });
    expect(giftMailOnly([...mails, settlement]).map((item) => item.mailId)).toEqual(mails.map((item) => item.mailId));
  });
});

describe("claimableRice", () => {
  it("counts only what has not been taken yet", () => {
    expect(claimableRice(mails)).toBe(350);
  });
});

describe("mailTypeLabel", () => {
  it("never leaves the line blank for a type it does not know", () => {
    expect(mailTypeLabel("MARKET_SETTLEMENT")).toBe("거래소 판매 정산");
    expect(mailTypeLabel("ADMIN_GIFT")).toBe("운영자 지급");
    expect(mailTypeLabel("SOMETHING_NEW")).toBe("보관함 지급");
  });
});

describe("mailDateLabel", () => {
  /* 같은 날 여러 통이 오므로 시각까지 읽혀야 한다. */
  it("reads as a date and a time, and stays empty rather than printing nonsense", () => {
    expect(mailDateLabel("2026-09-12T00:00:00Z")).toMatch(/9월 1[12]일 \d{2}:\d{2}/);
    expect(mailDateLabel("어제")).toBe("");
  });
});

describe("rewardLabel", () => {
  it("prefers the name frozen at send time and falls back to the id", () => {
    expect(rewardLabel({ kind: "ITEM", quantity: 3, itemId: "POTATO_M1", displayName: "감자 한 조각" })).toBe("감자 한 조각 ×3");
    expect(rewardLabel({ kind: "COSMETIC", quantity: 1, cosmeticId: "cosmetic-001" })).toBe("cosmetic-001 ×1");
    expect(rewardLabel({ kind: "GEM", quantity: 2, gemLevel: 3 })).toBe("3단계 보석 ×2");
  });
});

describe("MailScreen", () => {
  it("closes as a global overlay with Escape or a backdrop press", () => {
    const onClose = vi.fn();
    renderScreen({}, {}, onClose);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(document.querySelector(".mail-screen")!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  /* 알림이 먼저다. 열자마자 우편 줄이 쏟아지지 않는다. */
  it("opens on 알림 and only shows the mail rows once 메시지 is picked", async () => {
    renderScreen();
    expect(await screen.findByText("9월 점검 안내")).toBeTruthy();
    expect(screen.queryByText("운영자 지급")).toBeNull();

    openMailTab();
    await screen.findAllByText("운영자 지급");
    expect(document.querySelector(".mail-list")).toBeTruthy();
  });

  /* 탭 위 통수는 성격이 다르다 — 알림은 안 읽은 수, 메시지는 못 받은 수. */
  it("counts unread notices and unclaimed mails on their own tabs", async () => {
    renderScreen();
    await waitFor(() => expect(document.querySelectorAll(".mail-sidebar em")).toHaveLength(2));
    const badges = [...document.querySelectorAll(".mail-sidebar em")].map((node) => node.textContent);
    expect(badges).toEqual(["1", "2"]);
  });

  /* 목록을 스친 것은 읽은 것이 아니다. 펼쳐야 읽음이다. */
  it("marks a notice read only when its body is opened", async () => {
    const { noticeSource } = renderScreen();
    await screen.findByText("9월 점검 안내");
    expect(noticeSource.read).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("9월 점검 안내"));
    await waitFor(() => expect(noticeSource.read).toHaveBeenCalledWith("notice-1"));
    expect(screen.getByText("본문입니다.")).toBeTruthy();
  });

  it("lets a notice be thrown away from this reader's list", async () => {
    const { noticeSource } = renderScreen();
    fireEvent.click(await screen.findByText("9월 점검 안내"));
    fireEvent.click(screen.getByRole("button", { name: "9월 점검 안내 지우기" }));
    await waitFor(() => expect(noticeSource.remove).toHaveBeenCalledWith("notice-1"));
  });

  it("shows the attached rewards and hands each claim to the server", async () => {
    const withReward = [mail("gift", 500, false, "2026-09-14T00:00:00Z", {
      title: "9월 점검 보상",
      body: "기다려 주셔서 고맙습니다.",
      senderName: "한짝 운영팀",
      rewards: [{ kind: "ITEM", quantity: 10, itemId: "POTATO_M3", displayName: "감자" }],
    })];
    const { dataSource } = renderScreen({ list: vi.fn(async () => ({ items: withReward, nextCursor: null, totalItems: 1 })) });
    openMailTab();

    fireEvent.click(await screen.findByText("9월 점검 보상"));
    expect(screen.getByText("기다려 주셔서 고맙습니다.")).toBeTruthy();
    expect(screen.getByText("쌀 ×500")).toBeTruthy();
    expect(screen.getByText("감자 ×10")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "9월 점검 보상 보상 받기" }));
    await waitFor(() => expect(dataSource.claim).toHaveBeenCalledWith("gift", expect.any(String), undefined));
  });

  /* 안 받은 보상이 달린 우편은 지울 수 없다. 대신 왜 못 지우는지 말해 준다. */
  it("offers no delete button while a reward is still waiting", async () => {
    renderScreen({ list: vi.fn(async () => ({ items: [mail("waiting", 10, false, "2026-09-14T00:00:00Z")], nextCursor: null, totalItems: 1 })) });
    openMailTab();
    fireEvent.click(await screen.findByText("운영자 지급"));
    expect(screen.queryByRole("button", { name: /지우기$/ })).toBeNull();
    expect(screen.getByText("보상을 받아야 지울 수 있어요.")).toBeTruthy();
  });

  it("requires one event hood choice and sends the selected cosmetic id", async () => {
    const choiceMail = mail("hood-choice", 0, false, "2026-09-14T00:00:00Z", {
      title: "설문 참여 보상",
      rewards: [{
        kind: "COSMETIC_CHOICE",
        quantity: 1,
        cosmeticIds: ["cosmetic-188", "cosmetic-189", "cosmetic-190"],
        displayName: "싸피 후드집업 선택권",
      }],
    });
    const { dataSource } = renderScreen({ list: vi.fn(async () => ({ items: [choiceMail], nextCursor: null, totalItems: 1 })) });
    openMailTab();
    fireEvent.click(await screen.findByText("설문 참여 보상"));

    const claimButton = screen.getByRole("button", { name: "설문 참여 보상 보상 받기" }) as HTMLButtonElement;
    expect(claimButton.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /싸피 후드집업 파랑/ }));
    expect(claimButton.disabled).toBe(false);
    fireEvent.click(claimButton);

    await waitFor(() => expect(dataSource.claim).toHaveBeenCalledWith("hood-choice", expect.any(String), "cosmetic-189"));
  });

  it("offers delete once the reward has been taken", async () => {
    const { dataSource } = renderScreen({ list: vi.fn(async () => ({ items: [mail("done", 10, true, "2026-09-10T00:00:00Z")], nextCursor: null, totalItems: 1 })) });
    openMailTab();
    fireEvent.click(await screen.findByText("운영자 지급"));
    fireEvent.click(screen.getByRole("button", { name: "운영자 지급 지우기" }));
    await waitFor(() => expect(dataSource.remove).toHaveBeenCalledWith("done"));
  });

  it("keeps 모두 받기 out of reach when there is nothing left to take", async () => {
    renderScreen({ list: vi.fn(async () => ({ items: [mail("done", 10, true, "2026-09-10T00:00:00Z")], nextCursor: null, totalItems: 1 })) });
    openMailTab();
    await screen.findByText("받음");
    expect((screen.getByRole("button", { name: "모두 받기" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("says so plainly when the mailbox is empty", async () => {
    renderScreen({ list: vi.fn(async () => ({ items: [], nextCursor: null, totalItems: 0 })) });
    openMailTab();
    expect(await screen.findByText("아직 도착한 메시지가 없어요.")).toBeTruthy();
  });

  /* 서버가 막히면 화면 맨 위 한 줄로만 알린다. 목록이 밀려나지 않는다. */
  it("reports a failed claim at the top of the screen", async () => {
    renderScreen({ claim: vi.fn(async () => { throw new Error("INVENTORY_CAPACITY_EXCEEDED"); }) });
    openMailTab();
    fireEvent.click((await screen.findAllByText("운영자 지급"))[0]);

    fireEvent.click(screen.getByRole("button", { name: "운영자 지급 보상 받기" }));
    await waitFor(() => expect(document.querySelector(".top-alert")?.textContent).toContain("보상을 받지 못했어요."));
  });
});
