import { expect, test } from "@playwright/test";

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`purchase limit and confirmation remain usable at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const requests: Array<{ quantity: number; limitUnitPrice: number; timeInForce: string }> = [];
    let otherPrice: number | null = 40;
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/**", async route => {
      const url = new URL(route.request().url());
      let data: unknown = {};
      if (url.pathname === "/api/v1/market/instruments") {
        data = [{ instrumentId: "potato", itemId: "POTATO_M1", bestAskUnitPrice: 30 }];
      } else if (url.pathname.endsWith("/order-quote")) {
        const quantity = Number(url.searchParams.get("quantity"));
        const limit = Number(url.searchParams.get("limitUnitPrice"));
        const filled = otherPrice !== null && limit >= otherPrice ? Math.min(quantity, 60) : 0;
        data = { instrumentId: "potato", requestedQuantity: quantity, expectedFilledQuantity: filled, expectedRemainingQuantity: quantity - filled,
          lowestFilledUnitPrice: filled ? otherPrice : null, highestFilledUnitPrice: filled ? otherPrice : null,
          weightedAverageUnitPrice: filled ? otherPrice : null, totalPrice: filled * (otherPrice ?? 0), availableRice: 61_238, marketRevision: 1 };
      } else if (url.pathname === "/api/v1/market/orders") {
        requests.push(route.request().postDataJSON());
        await route.fulfill({ status: 400, json: { code: "MARKET_NO_FILL" } });
        return;
      } else if (url.pathname.includes("cosmetics")) {
        await route.fulfill({ status: 404, json: {} });
        return;
      }
      await route.fulfill({ json: { data } });
    });
    await page.goto("/equipment-preview.html");
    await page.getByRole("button", { name: "감자 한 조각 거래소에서 구매" }).click();
    const dialog = page.getByRole("dialog", { name: "거래소" });
    const buy = dialog.getByRole("button", { name: "구매", exact: true });
    const price = dialog.getByRole("textbox", { name: "개당 최대 단가" });
    await expect(buy).toBeEnabled();
    await expect(price).toHaveValue("40");
    await expect(dialog.getByText("2,400", { exact: true })).toBeVisible();
    await price.fill("30");
    await expect(buy).toBeDisabled();
    await expect(dialog.getByText("최대 단가가 현재 구매 가능 최저가보다 낮습니다.")).toBeVisible();
    await expect(dialog.getByText("구매할 수 있는 다른 사용자의 매도 주문이 없습니다.")).toHaveCount(0);
    await price.fill("50");
    await expect(buy).toBeEnabled();
    const box = await buy.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await dialog.screenshot({ path: testInfo.outputPath("purchase-dialog.png") });
    await buy.click();
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0]).toMatchObject({ quantity: 80, limitUnitPrice: 50, timeInForce: "IOC" });
    otherPrice = null;
    await page.reload();
    await page.getByRole("button", { name: "감자 한 조각 거래소에서 구매" }).click();
    await expect(dialog.getByText("구매할 수 있는 다른 사용자의 매도 주문이 없습니다.")).toBeVisible();
    await expect(buy).toBeDisabled();
    expect(errors).toEqual([]);
  });
}
