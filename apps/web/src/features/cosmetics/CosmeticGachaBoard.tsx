import { useState } from "react";
import type { Banner, CosmeticShowcase } from "./api";
import riceIcon from "../equipment/assets-cozy-pixel/currency-rice-gold-v2.png";
import ticketIcon from "./assets-cozy-pixel/cosmetic-draw-ticket-v1.png";
import ticketHero from "./assets-cozy-pixel/cosmetic-ticket-hero-v1.png";
import showcaseFrame from "./assets-cozy-pixel/cosmetic-showcase-frame-walnut-v1.png";
import { CosmeticMilestoneProgress } from "./CosmeticMilestoneProgress";

type GachaCommand = { kind: "claim"; bannerId: string; count: number };

const formatRice = (value: number) => value.toLocaleString();
export function CosmeticWalletBalance({ banner }: { banner: Banner }) {
  return <div className="cosmetic-gacha-balance" aria-label="보유 재화">
    <span aria-label={`뽑기권 ${banner.ticketBalance}개`}><img src={ticketIcon} alt="" /><strong>{formatRice(banner.ticketBalance)}</strong></span>
    <span aria-label={`쌀 ${formatRice(banner.riceBalance)}`}><img src={riceIcon} alt="" /><strong>{formatRice(banner.riceBalance)}</strong></span>
  </div>;
}

type Props = {
  banners: Banner[];
  showcase?: CosmeticShowcase | null;
  pending?: boolean;
  claimedBannerId?: string | null;
  onDraw: (banner: Banner, count: 1 | 10) => void;
  onCommand?: (command: GachaCommand) => void;
};

export function CosmeticGachaBoard({ banners, showcase = null, pending = false, claimedBannerId = null, onDraw, onCommand }: Props) {
  const banner = banners[0];
  const [showcaseIndex] = useState(() => showcase?.sets.length ? Math.floor(Math.random() * showcase.sets.length) : 0);
  const [showcaseFailed, setShowcaseFailed] = useState(false);
  if (!banner) return null;
  const featuredSet = showcase?.sets[showcaseIndex % Math.max(showcase.sets.length, 1)];
  return <section className="cosmetic-banner-section" aria-label="치장 뽑기 배너">
    <div className="cosmetic-banner-grid">
      <article className="cosmetic-banner-card" key={banner.bannerId}>
        <h3 className="sr-only">치장 랜덤 뽑기</h3>
        <div className="cosmetic-feature-layout">
          {featuredSet && !showcaseFailed
            ? <figure className="cosmetic-showcase-frame">
              <img src={featuredSet.imageUrl} alt={`${featuredSet.displayName} 키 아트`} onError={() => setShowcaseFailed(true)} />
              <img className="cosmetic-showcase-frame-overlay" src={showcaseFrame} alt="" aria-hidden="true" />
              <figcaption>{featuredSet.displayName}</figcaption>
            </figure>
            : <div className="cosmetic-showcase-fallback" aria-label="치장 뽑기"><img src={ticketHero} alt="" /></div>}
          <div className="cosmetic-draw-panel">
            <div className="cosmetic-ticket-hero" aria-hidden="true"><img src={ticketHero} alt="" /></div>
            <div className="cosmetic-cost-buttons">{([1, 10] as const).map((count) => {
              const cost = count === 1 ? banner.oneDraw : banner.tenDraw;
              const ricePrice = banner.singleRiceCost * count;
              return <button key={count} type="button" disabled={pending || !cost.executable} onClick={() => onDraw(banner, count)}>
                <strong>{count}회 뽑기</strong>
                <span className="cosmetic-draw-cost" aria-hidden="true">
                  <span><img src={ticketIcon} alt="" /><b>{count}</b></span>
                  <i>/</i>
                  <span><img src={riceIcon} alt="" /><b>{formatRice(ricePrice)}</b></span>
                </span>
                <span className="sr-only">뽑기권 {count}개 또는 쌀 {formatRice(ricePrice)}</span>
              </button>;
            })}</div>
          </div>
        </div>
        <section className="cosmetic-milestone" aria-label={`${banner.bannerId} 마일스톤`}>
          <span className="sr-only">선택 치장</span>
          <CosmeticMilestoneProgress milestone={banner.milestone} pending={pending} claimed={claimedBannerId === banner.bannerId} onClaim={() => onCommand?.({ kind: "claim", bannerId: banner.bannerId, count: banner.milestone.claimableBoxCount })} />
        </section>
      </article>
    </div>
  </section>;
}
