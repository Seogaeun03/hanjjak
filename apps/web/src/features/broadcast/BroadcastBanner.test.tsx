// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BroadcastBanner, type BannerDataSource } from "./BroadcastBanner";
import type { Banner } from "./api";

const HOUR_LATER = "2100-01-01T00:00:00.000Z";

afterEach(cleanup);

function banner(overrides: Partial<Banner> = {}): Banner {
  return { bannerId: "banner-1", message: "오늘 22시부터 점검합니다.", tone: "INFO", expiresAt: HOUR_LATER, ...overrides };
}

function mount(source: BannerDataSource) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><BroadcastBanner dataSource={source} /></QueryClientProvider>);
}

function source(items: Banner[], dismiss = vi.fn().mockResolvedValue({ bannerId: "banner-1", dismissedAt: "2026-09-22T00:00:00.000Z" })): BannerDataSource {
  return { list: vi.fn().mockResolvedValue({ items }), dismiss };
}

it("운영자가 올린 문구를 화면에 건다", async () => {
  mount(source([banner()]));
  expect(await screen.findByText("오늘 22시부터 점검합니다.")).toBeTruthy();
});

it("올라온 배너가 없으면 아무것도 그리지 않는다", async () => {
  mount(source([]));
  await waitFor(() => expect(document.querySelector(".broadcast-banner")).toBeNull());
});

/* 노출 기간이 이미 끝난 배너가 응답에 섞여 와도 걸지 않는다. 시계는 화면이 직접 본다. */
it("기간이 끝난 배너는 응답에 있어도 걸지 않는다", async () => {
  mount(source([banner({ expiresAt: "2000-01-01T00:00:00.000Z" })]));
  await waitFor(() => expect(document.querySelector(".broadcast-banner")).toBeNull());
});

it("닫으면 그 자리에서 사라지고 서버에도 알린다", async () => {
  const dismiss = vi.fn().mockResolvedValue({ bannerId: "banner-1", dismissedAt: "2026-09-22T00:00:00.000Z" });
  mount(source([banner()], dismiss));
  fireEvent.click(await screen.findByLabelText("공지 닫기"));
  await waitFor(() => expect(document.querySelector(".broadcast-banner")).toBeNull());
  expect(dismiss).toHaveBeenCalledWith("banner-1");
});

it("결에 따라 색이 갈린다", async () => {
  mount(source([banner({ tone: "WARNING" })]));
  await waitFor(() => expect(document.querySelector(".broadcast-banner-warning")).toBeTruthy());
});

/* 여러 개가 겹치면 서버가 준 순서 그대로 위에서부터 쌓는다. */
it("여러 배너를 받은 순서대로 쌓는다", async () => {
  mount(source([banner(), banner({ bannerId: "banner-2", message: "주말 이벤트가 열렸습니다.", tone: "EVENT" })]));
  await waitFor(() => expect(document.querySelectorAll(".broadcast-banner").length).toBe(2));
  expect([...document.querySelectorAll(".broadcast-banner-text")].map((node) => node.textContent))
    .toEqual(["오늘 22시부터 점검합니다.", "주말 이벤트가 열렸습니다."]);
});
