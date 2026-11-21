import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LiveopsScreen } from "./LiveopsScreen";
import "../../styles.css";
import "../../app-shell.css";

const previewState = {
  eventId: "hunt-ticket-gacha-2026-09", displayName: "사냥 이벤트 뽑기",
  startsAt: "2026-09-21T00:00:00+09:00", endsAt: "2026-09-28T00:00:00+09:00",
  open: true, halted: false, ticketBalance: 12, grantedToday: 27, dailyCap: 100, secondsPerTicket: 180,
  outcomes: [
    { kind: "PRIZE", prizeId: "prize.gifticon.cyburger", displayName: "싸이버거 기프티콘", millionths: 200, probabilityDisplay: "0.02%", quantity: null, minQuantity: null, maxQuantity: null },
    { kind: "GEM_BOX", prizeId: null, displayName: null, millionths: 100_000, probabilityDisplay: "10%", quantity: 1, minQuantity: null, maxQuantity: null },
    { kind: "COSMETIC_TICKET", prizeId: null, displayName: null, millionths: 100_000, probabilityDisplay: "10%", quantity: 1, minQuantity: null, maxQuantity: null },
    { kind: "RICE", prizeId: null, displayName: null, millionths: 799_800, probabilityDisplay: "79.98%", quantity: null, minQuantity: 10, maxQuantity: 100 },
  ],
  prizes: [{ prizeId: "prize.gifticon.cyburger", displayName: "싸이버거 기프티콘", total: 5, claimed: 1, remaining: 4, alreadyWon: false }],
};

globalThis.fetch = async (_input, init) => {
  const isDraw = init?.method === "POST";
  const count = isDraw ? (JSON.parse(String(init?.body ?? "{}")) as { count?: number }).count ?? 1 : 0;
  const lines = Array.from({ length: count }, (_, index) => {
    if (index === 0) return { kind: "COSMETIC_TICKET", prizeId: null, prizeDisplayName: null, quantity: 1 };
    if (index === 1) return { kind: "GEM_BOX", prizeId: null, prizeDisplayName: null, quantity: 1 };
    return { kind: "RICE", prizeId: null, prizeDisplayName: null, quantity: 10 + index * 7 };
  });
  const gemBoxesGained = lines.filter((line) => line.kind === "GEM_BOX").length;
  const data = isDraw ? { eventId: previewState.eventId, ticketCost: count, riceGained: 0, cosmeticTicketsGained: 1, gemBoxesGained, ticketBalance: 12 - count, lines } : previewState;
  return new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } });
};

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

createRoot(document.getElementById("root")!).render(
  <React.StrictMode><QueryClientProvider client={queryClient}><main className="game-shell"><LiveopsScreen /></main></QueryClientProvider></React.StrictMode>,
);
