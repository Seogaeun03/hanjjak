import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Catalog, Collection } from "../cosmetics/api";
import { PlayerBattleCharacter } from "./PlayerBattleCharacter";
import { composeCosmeticHeroMotion } from "../cosmetics/cosmetic-art";

const SLOTS = ["HEAD", "TOP", "BOTTOM", "GLOVES", "SHOES", "CAPE"] as const;
const IDS = ["c-1", "c-2", "c-3", "c-4", "c-5", "c-6"];

/** 한 세트의 여섯 부위를 담은 카탈로그. 조합은 setId와 slot만 보고 그림을 고른다. */
const setCatalog = (setId: string): Pick<Catalog, "cosmetics" | "sets"> => ({
  cosmetics: IDS.map((cosmeticId, index) => ({ cosmeticId, displayName: null, imageUrl: null, grade: "RARE", slot: SLOTS[index], setId })),
  sets: [{ setId, displayName: null, grade: "RARE", members: {}, effects: {} }],
});
const wearing = (ids: Array<string | null>): Pick<Collection, "equipment"> => ({
  equipment: Object.fromEntries(SLOTS.map((slot, index) => [slot, ids[index]])),
}) as Pick<Collection, "equipment">;

describe("치장 조합", () => {
  it("치장 응답을 기다리는 동안에도 기본 나무검을 그린다", () => {
    expect(composeCosmeticHeroMotion(undefined, undefined, "rest", 0)).toEqual([
      "/cosmetics/motion/body/rest_01.png",
      "/cosmetics/motion/weapon-default/rest_01.png",
      "/cosmetics/motion/arms/rest_01.png",
    ]);
  });

  it("아무것도 걸치지 않으면 맨몸과 팔만 그린다", () => {
    // 기본 캐릭터도 같은 조합기를 쓴다. 통짜 스프라이트를 따로 두면 치장을 낀 몸과
    // 안 낀 몸이 서로 다른 그림이 되어 자리가 어긋난다.
    expect(composeCosmeticHeroMotion({}, setCatalog("cosmetic-set-01"), "rest", 0)).toEqual([
      "/cosmetics/motion/body/rest_01.png",
      // 무기 자리가 비면 기본 나무검을 쥐여 준다.
      "/cosmetics/motion/weapon-default/rest_01.png",
      "/cosmetics/motion/arms/rest_01.png",
    ]);
  });

  it("아트가 정한 차례대로 쌓는다", () => {
    const layers = composeCosmeticHeroMotion(wearing(IDS).equipment, setCatalog("cosmetic-set-01"), "rest", 0);
    expect(layers).toEqual([
      "/cosmetics/motion/leather-guard/rest_01-back.png",
      "/cosmetics/motion/body/rest_01.png",
      "/cosmetics/motion/leather-guard/rest_01-shoes.png",
      "/cosmetics/motion/leather-guard/rest_01-body.png",
      "/cosmetics/motion/leather-guard/rest_01-hat.png",
      "/cosmetics/motion/leather-guard/rest_01-weapon.png",
      "/cosmetics/motion/arms/rest_01.png",
      "/cosmetics/motion/leather-guard/rest_01-gloves.png",
    ]);
  });

  it("소매가 따로 있는 세트는 팔 위에 소매를 덧그린다", () => {
    // 팔이 옷 위로 올라오므로, 소매가 팔 아래면 옷에 소매가 사라진다.
    const layers = composeCosmeticHeroMotion(wearing(IDS).equipment, setCatalog("cosmetic-set-12"), "rest", 0);
    expect(layers.indexOf("/cosmetics/motion/sushi/rest_01-sleeves.png"))
      .toBeGreaterThan(layers.indexOf("/cosmetics/motion/arms/rest_01.png"));
  });

  it("프레임이 넘어가면 모든 부위가 함께 넘어간다", () => {
    const frames = [0, 1, 2, 3].map(frame => composeCosmeticHeroMotion(wearing(IDS).equipment, setCatalog("cosmetic-set-01"), "strike1", frame));
    expect(frames[0]).toContain("/cosmetics/motion/leather-guard/strike1_01-hat.png");
    expect(frames[3]).toContain("/cosmetics/motion/leather-guard/strike1_04-hat.png");
    // 맨몸도 같은 프레임을 따라간다. 옷만 움직이면 몸이 따로 논다.
    expect(frames[2]).toContain("/cosmetics/motion/body/strike1_03.png");
    expect(new Set(frames.map(layers => layers.join("|"))).size).toBe(4);
  });

  it("전투가 쓰는 옛 동작 이름을 새 아트 폴더로 옮긴다", () => {
    // 아트가 오면서 이름이 바뀌었다. 전투 판정이 쓰던 이름까지 따라 바꿀 이유는 없다.
    expect(composeCosmeticHeroMotion({}, setCatalog("cosmetic-set-01"), "run2", 1)[0]).toBe("/cosmetics/motion/body/run_02.png");
    expect(composeCosmeticHeroMotion({}, setCatalog("cosmetic-set-01"), "thrust1", 2)[0]).toBe("/cosmetics/motion/body/strike2_03.png");
    expect(composeCosmeticHeroMotion({}, setCatalog("cosmetic-set-01"), "thrust1", 2)).toContain("/cosmetics/motion/weapon-default/strike2_03.png");
    // 쓰러지는 동작은 한 장뿐이라 넘치는 프레임은 그 한 장으로 눌러 둔다.
    expect(composeCosmeticHeroMotion({}, setCatalog("cosmetic-set-01"), "death1", 3)[0]).toBe("/cosmetics/motion/body/death_01.png");
  });

  it("세 세트를 섞어 입어도 자리가 맞는다", () => {
    const mixed: Pick<Catalog, "cosmetics" | "sets"> = {
      cosmetics: [
        { cosmeticId: "a-head", displayName: null, imageUrl: null, grade: "RARE", slot: "HEAD", setId: "cosmetic-set-05" },
        { cosmeticId: "a-top", displayName: null, imageUrl: null, grade: "RARE", slot: "TOP", setId: "cosmetic-set-05" },
        { cosmeticId: "y-weapon", displayName: null, imageUrl: null, grade: "EPIC", slot: "BOTTOM", setId: "cosmetic-set-10" },
        { cosmeticId: "c-shoes", displayName: null, imageUrl: null, grade: "EPIC", slot: "SHOES", setId: "cosmetic-set-09" },
      ],
      sets: ["cosmetic-set-05", "cosmetic-set-09", "cosmetic-set-10"].map(setId => ({ setId, displayName: null, grade: "RARE", members: {}, effects: {} })),
    };
    const layers = composeCosmeticHeroMotion({ HEAD: "a-head", TOP: "a-top", BOTTOM: "y-weapon", SHOES: "c-shoes" }, mixed, "strike1", 2);
    expect(layers).toContain("/cosmetics/motion/angel/strike1_03-hat.png");
    expect(layers).toContain("/cosmetics/motion/yakgwa/strike1_03-weapon.png");
    expect(layers).toContain("/cosmetics/motion/chef/strike1_03-shoes.png");
    // 팔은 어느 세트 것도 아니다. 한 벌만 있고 옷 위에 올라간다.
    expect(layers.indexOf("/cosmetics/motion/arms/strike1_03.png"))
      .toBeGreaterThan(layers.indexOf("/cosmetics/motion/angel/strike1_03-body.png"));
  });

  it("세트에 속하지 않는 치장은 번호로 그림을 찾는다", () => {
    // 세트가 없어 세트 이름으로는 폴더를 알 수 없다. 얼굴 자리는 이런 치장만 쓴다.
    const loose: Pick<Catalog, "cosmetics" | "sets"> = {
      cosmetics: [{ cosmeticId: "cosmetic-022", displayName: null, imageUrl: null, grade: "NORMAL", slot: "FACE", setId: null }],
      sets: [],
    };
    expect(composeCosmeticHeroMotion({ FACE: "cosmetic-022" }, loose, "rest", 0))
      .toContain("/cosmetics/motion/blusher/rest_01-face.png");
  });

  it("색을 고를 수 있는 세트는 고른 색 폴더에서 가져온다", () => {
    const climbing = setCatalog("cosmetic-set-11");
    expect(composeCosmeticHeroMotion(wearing(IDS).equipment, climbing, "rest", 0, "blue"))
      .toContain("/cosmetics/motion/climbing-blue/rest_01-body.png");
    // 고른 색이 없으면 첫 번째 색으로 선다.
    expect(composeCosmeticHeroMotion(wearing(IDS).equipment, climbing, "rest", 0))
      .toContain("/cosmetics/motion/climbing-red/rest_01-body.png");
  });
});

describe("PlayerBattleCharacter", () => {
  it("치장 여부와 상관없이 한 가지 캔버스로 그린다", () => {
    const worn = renderToStaticMarkup(<PlayerBattleCharacter appearance={wearing(IDS)} catalog={setCatalog("cosmetic-set-01")} motion="rest" hit={false} skillVfx={[]} />);
    const bare = renderToStaticMarkup(<PlayerBattleCharacter motion="rest" hit={false} skillVfx={[]} />);
    for (const html of [worn, bare]) {
      expect(html).toContain("cosmetic-hero-canvas");
      expect(html).toContain('width="737"');
      expect(html).toContain('height="620"');
    }
  });
});
