// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CostumePanel, GalleryPanel } from "./CosmeticPanels";
import type { CharacterCollection, CosmeticCatalog } from "./api";

const catalog: CosmeticCatalog = {
  contentVersion: "cosmetics-v2-placeholder",
  cosmetics: [{ cosmeticId: "cosmetic-999", displayName: null, imageUrl: null, grade: "NORMAL", slot: "HEAD", setId: "cosmetic-set-99" }],
  sets: [{ setId: "cosmetic-set-99", displayName: null, grade: "NORMAL", members: { HEAD: "cosmetic-999" }, effects: { "1": [{ statId: "attackPercent", value: 20, unit: "BASIS_POINTS" }] } }],
};
const collection: CharacterCollection = {
  contentVersion: catalog.contentVersion,
  states: [{ cosmeticId: "cosmetic-999", displayName: null, imageUrl: null, grade: "NORMAL", slot: "HEAD", registeredQuantity: 1, unregisteredQuantity: 0, reservedQuantity: 0, availableUnregisteredQuantity: 0, cosmeticStar: 1, nextStarThreshold: 3, neededForNextStar: 2, canUpgrade: false, upgradeDisabledReason: "INSUFFICIENT_DUPLICATES" }],
  color: null, equipment: { HEAD: "cosmetic-999" }, uniqueRegisteredCount: 1, setStars: { "cosmetic-set-99": 1 },
  setEffects: { "cosmetic-set-99": [{ statId: "attackPercent", value: 20, unit: "BASIS_POINTS" }] },
  totalEffects: [{ statId: "attackPercent", value: 20, unit: "BASIS_POINTS" }],
};

it("uses numbered fallback names and explicit image placeholders", () => {
  const costume = renderToStaticMarkup(<CostumePanel collection={collection} catalog={catalog} pending={false} send={() => {}} sendBatch={() => {}} onGacha={() => {}} />);
  expect(costume).toContain("치장 #999");
  expect(costume).toContain("이미지 준비 중");
  expect(costume).toContain("cosmetic-999");
  const gallery = renderToStaticMarkup(<GalleryPanel collection={collection} catalog={catalog} pending={false} send={() => {}} />);
  expect(gallery).toContain("세트 #99");
  expect(gallery).toContain("공격력");
  expect(gallery).toContain("0.2%");
});

it("uses one muted concept icon for every empty cosmetic slot", () => {
  const emptyCollection: CharacterCollection = { ...collection, equipment: {} };
  const { container } = render(<CostumePanel collection={emptyCollection} catalog={catalog} pending={false} send={() => {}} sendBatch={() => {}} onGacha={() => {}} />);

  const emptySlotImages = [...container.querySelectorAll<HTMLImageElement>(".costume-slot-card .is-empty-slot-art img")];
  expect(emptySlotImages).toHaveLength(7);
  expect(emptySlotImages.map(image => image.alt)).toEqual(expect.arrayContaining([
    "머리 비어 있음",
    "얼굴 비어 있음",
    "상의 비어 있음",
    "장갑 비어 있음",
    "신발 비어 있음",
    "망토 비어 있음",
    "무기 비어 있음",
  ]));
  expect(emptySlotImages.map(image => image.src)).toEqual(expect.arrayContaining([
    expect.stringContaining("empty-slot-head.png"),
    expect.stringContaining("empty-slot-face.png"),
    expect.stringContaining("empty-slot-top.png"),
    expect.stringContaining("empty-slot-gloves.png"),
    expect.stringContaining("empty-slot-shoes.png"),
    expect.stringContaining("empty-slot-cape.png"),
    expect.stringContaining("empty-slot-weapon.png"),
  ]));
});

afterEach(cleanup);

it("keeps preview reset in the stage and starts the closet with slot tabs", () => {
  const sendBatch = vi.fn();
  const { container } = render(<CostumePanel collection={collection} catalog={catalog} pending={false} send={() => {}} sendBatch={sendBatch} onGacha={() => {}} />);

  fireEvent.click(screen.getByRole("button", { name: "초기화" }));
  expect(sendBatch).toHaveBeenCalledWith([{ kind: "equip", slot: "HEAD", cosmeticId: null }]);
  expect(screen.queryByRole("button", { name: "치장 뽑기" })).toBeNull();
  expect(screen.getByRole("tablist", { name: "치장 부위" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "머리" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("tab", { name: "무기" })).toBeTruthy();
  expect(screen.queryByRole("tab", { name: "하의" })).toBeNull();
  expect(screen.queryByText("치장 보관함")).toBeNull();
  expect(container.querySelectorAll(".costume-owned-blank")).toHaveLength(0);
});

it("resets every equipped data slot and disables reset when nothing is equipped", () => {
  const sendBatch = vi.fn();
  const weapon = { cosmeticId: "cosmetic-998", displayName: "테스트 무기", imageUrl: null, grade: "NORMAL" as const, slot: "WEAPON", setId: "cosmetic-set-99" };
  const multiCatalog: CosmeticCatalog = { ...catalog, cosmetics: [...catalog.cosmetics, weapon] };
  const multiCollection: CharacterCollection = {
    ...collection,
    states: [...collection.states, { ...collection.states[0], cosmeticId: weapon.cosmeticId, displayName: weapon.displayName, slot: weapon.slot }],
    color: null, equipment: { HEAD: "cosmetic-999", WEAPON: "cosmetic-998" },
  };
  const { rerender } = render(<CostumePanel collection={multiCollection} catalog={multiCatalog} pending={false} send={() => {}} sendBatch={sendBatch} onGacha={() => {}} />);

  fireEvent.click(screen.getByRole("button", { name: "초기화" }));
  expect(sendBatch).toHaveBeenCalledWith([
    { kind: "equip", slot: "HEAD", cosmeticId: null },
    { kind: "equip", slot: "WEAPON", cosmeticId: null },
  ]);

  rerender(<CostumePanel collection={{ ...multiCollection, color: null, equipment: {} }} catalog={multiCatalog} pending={false} send={() => {}} sendBatch={sendBatch} onGacha={() => {}} />);
  expect((screen.getByRole("button", { name: "초기화" }) as HTMLButtonElement).disabled).toBe(true);
});

it("shows the character nameplate and equips every owned member from the set summary", () => {
  const sendBatch = vi.fn();
  render(<CostumePanel
    collection={{ ...collection, color: null, equipment: {} }}
    catalog={catalog}
    pending={false}
    send={() => {}}
    sendBatch={sendBatch}
    onGacha={() => {}}
    nickname="한짝"
  />);

  expect(screen.getByLabelText("한짝").textContent).toBe("한짝");
  expect(screen.getByLabelText("1개 중 1개 보유")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "세트 착용" }));
  expect(sendBatch).toHaveBeenCalledWith([{ kind: "equip", slot: "HEAD", cosmeticId: "cosmetic-999" }]);
});

it("shows only the selected item name for a costume without a set", () => {
  const solo = { cosmeticId: "cosmetic-solo", displayName: "혼자 쓰는 모자", imageUrl: "/solo.png", grade: "RARE" as const, slot: "HEAD", setId: null };
  const soloCatalog: CosmeticCatalog = { ...catalog, cosmetics: [...catalog.cosmetics, solo] };
  const soloCollection: CharacterCollection = {
    ...collection,
    states: [...collection.states, { ...collection.states[0], cosmeticId: solo.cosmeticId, displayName: solo.displayName, imageUrl: solo.imageUrl, grade: solo.grade }],
  };
  render(<CostumePanel collection={soloCollection} catalog={soloCatalog} pending={false} send={() => {}} sendBatch={() => {}} onGacha={() => {}} />);

  fireEvent.click(screen.getByRole("button", { name: "혼자 쓰는 모자 입기" }));
  expect(screen.getAllByText("혼자 쓰는 모자").length).toBeGreaterThan(1);
  expect(screen.queryByRole("button", { name: "세트 착용" })).toBeNull();
  expect(screen.queryByLabelText(/개 중 \d+개 보유/)).toBeNull();
});

it("wears a costume on the first click and takes it off when it is clicked again", () => {
  const send = vi.fn();
  const secondCatalog: CosmeticCatalog = {
    ...catalog,
    cosmetics: [...catalog.cosmetics, { cosmeticId: "cosmetic-002", displayName: "둘째 모자", imageUrl: "/second.png", grade: "LEGENDARY", slot: "HEAD", setId: "cosmetic-set-99" }],
  };
  const secondCollection: CharacterCollection = {
    ...collection,
    states: [...collection.states, { cosmeticId: "cosmetic-002", displayName: "둘째 모자", imageUrl: "/second.png", grade: "LEGENDARY", slot: "HEAD", registeredQuantity: 1, unregisteredQuantity: 0, reservedQuantity: 0, availableUnregisteredQuantity: 0, cosmeticStar: 3, nextStarThreshold: 4, neededForNextStar: 3, canUpgrade: false, upgradeDisabledReason: "INSUFFICIENT_DUPLICATES" }],
  };
  render(<CostumePanel collection={secondCollection} catalog={secondCatalog} pending={false} send={send} sendBatch={() => {}} onGacha={() => {}} />);

  fireEvent.click(screen.getByRole("button", { name: "둘째 모자 입기" }));
  expect(send).toHaveBeenCalledWith({ kind: "equip", slot: "HEAD", cosmeticId: "cosmetic-002" });

  fireEvent.click(screen.getByRole("button", { name: "치장 #999 벗기" }));
  expect(send).toHaveBeenLastCalledWith({ kind: "equip", slot: "HEAD", cosmeticId: null });

  expect(screen.queryByRole("button", { name: "착용" })).toBeNull();
  expect(screen.queryByRole("button", { name: "취소" })).toBeNull();
  expect(screen.queryByRole("button", { name: "해제" })).toBeNull();
});

it("assembles the gallery into set, member, and set-effect regions", () => {
  render(<GalleryPanel collection={collection} catalog={catalog} pending={false} send={() => {}} />);

  expect(screen.getByRole("region", { name: "세트 목록" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "선택 세트 상세" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "세트 효과" })).toBeTruthy();
  expect(screen.getByRole("tablist", { name: "도감 세트 필터" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "선택 세트 효과" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "전체 세트 효과" })).toBeTruthy();
  expect(screen.queryByText("선택 세트 효과")).toBeNull();
  expect(screen.queryByText("보유 세트 합계")).toBeNull();
  expect(screen.getByRole("listitem", { name: "공격력 0.2%" })).toBeTruthy();
  expect(screen.getByRole("listitem", { name: "최대 HP 0%" })).toBeTruthy();
  expect(screen.getByRole("listitem", { name: "방어 관통 0%" })).toBeTruthy();

  fireEvent.click(screen.getByRole("tab", { name: "미보유" }));
  expect(screen.getByText("해당하는 세트가 없습니다.")).toBeTruthy();
});

it("orders gallery sets from normal through legendary without changing the catalog", () => {
  const shuffledSets: CosmeticCatalog["sets"] = [
    { setId: "legendary-set", displayName: "전설 세트", grade: "LEGENDARY", members: {}, effects: {} },
    { setId: "rare-set", displayName: "희귀 세트", grade: "RARE", members: {}, effects: {} },
    { setId: "normal-set", displayName: "노말 세트", grade: "NORMAL", members: {}, effects: {} },
    { setId: "epic-set", displayName: "영웅 세트", grade: "EPIC", members: {}, effects: {} },
  ];
  const shuffledCatalog = { ...catalog, sets: shuffledSets };
  const originalOrder = shuffledCatalog.sets.map(set => set.setId);

  const { container } = render(<GalleryPanel collection={collection} catalog={shuffledCatalog} pending={false} send={() => {}} />);

  const displayedNames = [...container.querySelectorAll<HTMLElement>(".gallery-set-list .gallery-set-copy > strong")]
    .map(element => element.textContent);
  expect(displayedNames).toEqual(["노말 세트노말", "희귀 세트희귀", "영웅 세트영웅", "전설 세트전설"]);
  expect(shuffledCatalog.sets.map(set => set.setId)).toEqual(originalOrder);
  expect(container.querySelector<HTMLButtonElement>(".gallery-set-list button[aria-pressed='true']")?.textContent).toContain("노말 세트");
});

it("shows creator tags only for attributed gallery sets", () => {
  const credits = [
    ["cosmetic-set-16", "쌀을찾아떠나는여정", "골판지크레용"],
    ["cosmetic-set-20", "뱀물수호자", "저게뭐시당"],
    ["cosmetic-set-21", "번개월계관", "저게뭐시당"],
    ["cosmetic-set-22", "숲의 정령", "🤘야르🤘"],
    ["cosmetic-set-23", "왕실기사", "🤘야르🤘"],
    ["cosmetic-set-25", "저승사자", "저게뭐시당"],
  ] as const;
  const attributedCatalog = (setId: string, displayName: string): CosmeticCatalog => ({
    ...catalog,
    sets: [{ ...catalog.sets[0], setId, displayName }],
  });
  const { rerender } = render(<GalleryPanel collection={collection} catalog={attributedCatalog(credits[0][0], credits[0][1])} pending={false} send={() => {}} />);

  credits.forEach(([setId, displayName, creator]) => {
    rerender(<GalleryPanel collection={collection} catalog={attributedCatalog(setId, displayName)} pending={false} send={() => {}} />);
    expect(screen.getByText(`made by ${creator}`)).toBeTruthy();
  });

  rerender(<GalleryPanel collection={collection} catalog={catalog} pending={false} send={() => {}} />);
  expect(screen.queryByText(/made by/)).toBeNull();
});

it("enables one bulk command only when at least one cosmetic can upgrade", () => {
  const send = vi.fn();
  const { rerender } = render(<GalleryPanel collection={collection} catalog={catalog} pending={false} send={send} />);
  const disabled = screen.getByRole("button", { name: /\uC77C괄 업그레이드/ });
  expect((disabled as HTMLButtonElement).disabled).toBe(true);

  const upgradeCollection: CharacterCollection = {
    ...collection,
    states: collection.states.map(state => ({ ...state, unregisteredQuantity: 2, availableUnregisteredQuantity: 2, canUpgrade: true, upgradeDisabledReason: null })),
  };
  rerender(<GalleryPanel collection={upgradeCollection} catalog={catalog} pending={false} send={send} />);
  const enabled = screen.getByRole("button", { name: /\uC77C괄 업그레이드/ });
  expect(enabled.textContent).toContain("1");
  fireEvent.click(enabled);
  expect(send).toHaveBeenCalledWith({ kind: "bulkRegister" });
});

it("keeps the member registration command in the redesigned gallery", () => {
  const send = vi.fn();
  const upgradeCollection: CharacterCollection = {
    ...collection,
    states: collection.states.map(state => ({ ...state, unregisteredQuantity: 2, availableUnregisteredQuantity: 2, canUpgrade: true, upgradeDisabledReason: null })),
  };
  render(<GalleryPanel collection={upgradeCollection} catalog={catalog} pending={false} send={send} />);

  // 버튼에는 "가진 여분 / 다음 성급에 드는 개수"만 적는다. 누적 수치는 버튼에 올리지 않는다.
  const upgrade = screen.getByRole("button", { name: /여분 2개를 넣으면 2성이 됩니다/ });
  expect(upgrade.textContent).toBe("2 / 2");
  fireEvent.click(upgrade);

  expect(send).toHaveBeenCalledWith({ kind: "register", cosmeticId: "cosmetic-999" });
});

it("shows spare copies against the next star cost instead of a running total", () => {
  const send = vi.fn();
  const shortCollection: CharacterCollection = {
    ...collection,
    states: collection.states.map(state => ({ ...state, unregisteredQuantity: 1, availableUnregisteredQuantity: 1, canUpgrade: false, upgradeDisabledReason: "INSUFFICIENT_DUPLICATES" })),
  };
  render(<GalleryPanel collection={shortCollection} catalog={catalog} pending={false} send={send} />);

  // 다음 성급까지 2개가 필요한데 여분이 1개이므로 1개가 모자란다.
  const upgrade = screen.getByRole("button", { name: /2개 더 필요한데 여분은 1개/ });
  expect(upgrade.textContent).toBe("1 / 2");
  expect((upgrade as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(upgrade);
  expect(send).not.toHaveBeenCalled();
});

it("names the star threshold and the current registered count so the remaining number reads as remaining", () => {
  // 버튼의 숫자는 기준치가 아니라 남은 개수라 같은 등급에서도 부위마다 다르게 보인다.
  // 기준치와 지금 등록 수가 설명에 없으면 부위마다 값이 다른 이유를 읽을 수 없다.
  // 문장에 나오는 네 수를 전부 다르게 잡는다. 표시 성급은 cosmeticStar + 1 이므로
  // cosmeticStar 1 이면 2 다. 기준치 7 · 등록 3 · 남은 4 로 어느 둘도 겹치지 않아야
  // 한 값을 다른 값으로 잘못 적는 실수가 이 단정에 걸린다.
  const spreadCollection: CharacterCollection = {
    ...collection,
    states: collection.states.map(state => ({ ...state, registeredQuantity: 3, cosmeticStar: 1, nextStarThreshold: 7, neededForNextStar: 4 })),
  };
  render(<GalleryPanel collection={spreadCollection} catalog={catalog} pending={false} send={vi.fn()} />);

  const upgrade = screen.getByRole("button", { name: /2성은 등록 7개부터입니다/ });

  expect(upgrade.getAttribute("title")).toBe("2성은 등록 7개부터입니다. 지금 등록은 3개입니다. 2성까지 4개 더 필요한데 여분은 0개입니다.");
});

it("keeps threshold details in the upgrade tooltip but removes the visible progress line", () => {
  const spreadCollection: CharacterCollection = {
    ...collection,
    states: collection.states.map(state => ({ ...state, registeredQuantity: 3, cosmeticStar: 1, nextStarThreshold: 7, neededForNextStar: 4 })),
  };
  const { container } = render(<GalleryPanel collection={spreadCollection} catalog={catalog} pending={false} send={vi.fn()} />);

  expect(container.querySelector(".gallery-member-progress")).toBeNull();
  expect(screen.getByRole("button", { name: /2성은 등록 7개부터입니다/ }).getAttribute("title")).toContain("지금 등록은 3개입니다.");
});

it("prints no card line when the cosmetic is at max star", () => {
  const maxedCollection: CharacterCollection = {
    ...collection,
    states: collection.states.map(state => ({ ...state, cosmeticStar: 5, nextStarThreshold: null, neededForNextStar: null, upgradeDisabledReason: "MAX_STAR" })),
  };
  const { container } = render(<GalleryPanel collection={maxedCollection} catalog={catalog} pending={false} send={vi.fn()} />);

  expect(container.querySelector(".gallery-member-progress")).toBeNull();
});

it("still names the star when the server sends no threshold", () => {
  // 기준치가 없으면 앞 문장은 빠지지만 무엇을 향해 모으는지는 남아야 한다.
  // 이 문구가 생기기 전 문장은 성급 번호를 늘 갖고 있었다.
  const noThresholdCollection: CharacterCollection = {
    ...collection,
    states: collection.states.map(state => ({ ...state, nextStarThreshold: null })),
  };
  render(<GalleryPanel collection={noThresholdCollection} catalog={catalog} pending={false} send={vi.fn()} />);

  const upgrade = screen.getByRole("button", { name: /2성까지 2개 더 필요한데 여분은 0개/ });

  expect(upgrade.getAttribute("title")).toBe("2성까지 2개 더 필요한데 여분은 0개입니다.");
});

it("keeps the max-star button free of any count sentence", () => {
  // 최대 성급은 기준치도 남은 개수도 없어 upgradeAction 이 앞에서 되돌아온다.
  // 이 단정은 이번 문구 변경이 그 갈림길을 건드리지 않았음을 지킨다.
  const maxedCollection: CharacterCollection = {
    ...collection,
    states: collection.states.map(state => ({ ...state, cosmeticStar: 5, nextStarThreshold: null, neededForNextStar: null, upgradeDisabledReason: "MAX_STAR" })),
  };
  render(<GalleryPanel collection={maxedCollection} catalog={catalog} pending={false} send={vi.fn()} />);

  const upgrade = screen.getByRole("button", { name: /더 올릴 성급이 없습니다/ });

  expect(upgrade.textContent).toBe("최대 성급");
  expect(upgrade.getAttribute("title")).toBe("더 올릴 성급이 없습니다.");
});
