// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { MailMessage } from "../mail/api";
import { BattleUtilityNavigation } from "./BattleHud";

afterEach(cleanup);

const mail = (readAt: string | null, rewardStatus: MailMessage["rewardStatus"]): MailMessage => ({
  mailId: `${rewardStatus}-${readAt ?? "unread"}`,
  type: "ADMIN_GIFT",
  riceAmount: 10,
  rewardStatus,
  createdAt: "2026-09-18T00:00:00Z",
  claimedAt: rewardStatus === "CLAIMED" ? "2026-09-18T01:00:00Z" : null,
  title: "테스트 우편",
  body: "본문",
  senderName: "운영팀",
  readAt,
  rewards: [],
});

function renderNavigation(items: MailMessage[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["mails"], { items, nextCursor: null, totalItems: items.length });
  client.setQueryData(["notices"], { items: [], unreadCount: 0 });
  client.setQueryData(["market-summary"], {
    activeOrders: 0, closedOrders: 0, recoveryReviewOrders: 0,
    claimableDeliveries: 0, claimableSettlements: 0, unread: [],
  });
  render(<QueryClientProvider client={client}>
    <BattleUtilityNavigation onNavigate={vi.fn()} />
  </QueryClientProvider>);
  return screen.getByRole("button", { name: "메시지" });
}

it("받지 않은 보상이 있어도 우편을 읽었으면 레드닷을 지운다", () => {
  const button = renderNavigation([mail("2026-09-18T01:00:00Z", "PENDING")]);
  expect(button.querySelector(".cozy-utility-dot")).toBeNull();
});

it("보상 수령 여부와 무관하게 읽지 않은 우편에는 레드닷을 표시한다", () => {
  const button = renderNavigation([mail(null, "CLAIMED")]);
  expect(button.querySelector(".cozy-utility-dot")).not.toBeNull();
});
