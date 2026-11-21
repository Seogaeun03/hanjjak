import { useEffect, useRef, useState } from "react";
import type { Catalog, Collection } from "../cosmetics/api";
import { loadCosmeticImage } from "../cosmetics/cosmeticImageCache";
import {
  COSMETIC_FRAME_HEIGHT, COSMETIC_FRAME_WIDTH,
  composeCosmeticHeroMotion, preloadCosmeticHeroMotion,
} from "../cosmetics/cosmetic-art";
import { heroMotionFrame, type HeroMotion } from "../battle/battleVisuals";
import { SkillVfxSprite, type SkillVfx } from "./skillVfx";

export function fitCosmeticLayerToFrame(sourceWidth: number, sourceHeight: number) {
  const width = COSMETIC_FRAME_WIDTH;
  const height = sourceHeight * (width / sourceWidth);
  return { x: 0, y: COSMETIC_FRAME_HEIGHT - height, width, height };
}
export function equippedCosmeticIds(appearance?: Pick<Collection, "equipment">): string[] {
  return Object.values(appearance?.equipment ?? {}).filter((id): id is string => Boolean(id)).sort();
}

/**
 * 전투 중인 한짝.
 *
 * 치장을 걸쳤든 아니든 길은 하나다. 아무것도 안 걸치면 조합기가 맨몸과 팔만 돌려주므로
 * 기본 캐릭터도 같은 그림·같은 좌표계로 선다. 예전에는 기본 캐릭터가 통짜 스프라이트,
 * 치장 캐릭터가 낱장 조합이라 둘이 서로 다른 몸이었고 그 차이가 자꾸 어긋남을 만들었다.
 */
export function PlayerBattleCharacter({ appearance, catalog, motion, actionEventId, hit = false, skillVfx, color }: {
  appearance?: Pick<Collection, "equipment">;
  catalog?: Pick<Catalog, "cosmetics" | "sets">;
  motion: HeroMotion;
  actionEventId?: string;
  hit?: boolean;
  skillVfx: SkillVfx[];
  color?: string | null;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [frame, setFrame] = useState(0);
  const equipment = appearance?.equipment;

  useEffect(() => {
    /*
     * 화면에 실제로 들어온 동작만 전 프레임을 받는다. 대기 중에 공격·쓰러짐까지 모두 받으면
     * 치장 부위별 요청이 한꺼번에 몰려 API와 현재 전투 렌더링을 방해한다.
     */
    preloadCosmeticHeroMotion(equipment, catalog, motion, color);
  }, [equipment, catalog, motion, color]);

  useEffect(() => {
    const startedAt = performance.now();
    setFrame(0);
    let requestId = 0;
    const animate = (now: number) => {
      /* 프레임이 바뀔 때만 다시 그린다. 초당 예순 번 상태를 바꾸면 헛일만 한다. */
      const next = heroMotionFrame(motion, now - startedAt);
      setFrame(current => (current === next ? current : next));
      requestId = requestAnimationFrame(animate);
    };
    requestId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(requestId);
  }, [motion, actionEventId]);

  const layers = composeCosmeticHeroMotion(equipment, catalog, motion, frame, color);
  const layerKey = layers.join("|");
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let cancelled = false;
    // 한 벌이 다 준비된 뒤에만 지우고 그린다. 반쯤 받은 채로 그리면 부위가 깜빡인다.
    // 한 장을 못 받아도 나머지는 그린다. allSettled가 아니면 아직 안 들어온 아트 한 장에
    // 캐릭터가 통째로 사라진다.
    void Promise.allSettled(layerKey.split("|").map(loadCosmeticImage)).then(results => {
      if (cancelled) return;
      const context = element.getContext("2d");
      if (!context) return;
      context.clearRect(0, 0, COSMETIC_FRAME_WIDTH, COSMETIC_FRAME_HEIGHT);
      for (const result of results) {
        if (result.status !== "fulfilled") continue;
        const image = result.value;
        const fitted = fitCosmeticLayerToFrame(image.naturalWidth, image.naturalHeight);
        context.drawImage(image, fitted.x, fitted.y, fitted.width, fitted.height);
      }
    });
    return () => { cancelled = true; };
  }, [layerKey]);

  const crownVfx = skillVfx.filter(effect => effect.kind === "haste-caster" || effect.kind === "basic-amp-caster");
  return <div className={`dungeon-current-character ${hit ? "is-hit" : ""}`} data-motion={motion} data-frame={frame + 1} data-action={actionEventId}>
    {crownVfx.length > 0 && <div className="hero-crown-vfx" aria-hidden="true">
      {crownVfx.map(effect => <SkillVfxSprite key={effect.kind} effect={effect} />)}
    </div>}
    {/* 프레임마다 <img src>를 바꾸면 부위마다 파일을 다시 받는다. 받아 둔 그림을 캔버스에 그린다. */}
    <canvas ref={canvas} className="cosmetic-hero-canvas" width={COSMETIC_FRAME_WIDTH} height={COSMETIC_FRAME_HEIGHT} role="img" aria-label="한짝 캐릭터" />
  </div>;
}

/** 치장 없는 기본 한짝. 조합기에 빈 착용을 주면 맨몸과 팔만 나온다. */
export function MasterHero({ motion, actionEventId, skillVfx }: { motion: HeroMotion; actionEventId?: string; skillVfx: SkillVfx[] }) {
  return <PlayerBattleCharacter motion={motion} actionEventId={actionEventId} skillVfx={skillVfx} catalog={{ cosmetics: [], sets: [] }} />;
}
