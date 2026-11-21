import type { Milestone } from "./api";
import selectorBoxIcon from "./assets-cozy-pixel/cosmetic-selector-box-v1.png";

type Props = {
  milestone: Milestone;
  pending?: boolean;
  claimed?: boolean;
  onClaim?: () => void;
};

/** 200 을 채우는 뽑기는 아직 `200 / 200` 으로 보여 주고, 그 다음 한 번이 `1 / 200` 이 된다. */
export function milestoneGaugeValue(totalSuccessfulDraws: number): number {
  if (totalSuccessfulDraws <= 0) return 0;
  return ((totalSuccessfulDraws - 1) % 200) + 1;
}

export function CosmeticMilestoneProgress({ milestone, pending = false, claimed = false, onClaim }: Props) {
  // 받지 않고 더 뽑아도 초과분은 다음 칸으로 넘어간다. 상자는 쌓인 개수만큼 뱃지에 센다.
  const claimable = milestone.claimableBoxCount;
  const ready = claimable > 0;
  const progress = milestoneGaugeValue(milestone.totalSuccessfulDraws);
  // 받은 상자는 인벤토리에서 연다. 여기서는 받을 것이 있을 때만 누를 수 있다.
  const actionLabel = ready ? `선택 상자 ${claimable}개 받기` : `선택 상자까지 ${milestone.drawsUntilNextBox}회 남음`;

  return <div className={`cosmetic-milestone-progress${ready ? " is-ready" : ""}${claimed ? " is-claimed" : ""}`}>
    <div className="cosmetic-milestone-track">
      <div><strong>선택 상자</strong><span>{progress} / 200</span></div>
      <progress max={200} value={progress} aria-label={`선택 상자 진행도 ${progress} / 200`} />
    </div>
    <button type="button" disabled={pending || !ready} aria-label={actionLabel} onClick={ready ? onClaim : undefined}>
      <img src={selectorBoxIcon} alt="" aria-hidden="true" />
      {/* 받을 상자가 없으면 수량을 아예 적지 않는다. 남은 횟수는 게이지가 이미 말해 준다. */}
      {ready && <span>{claimable}개</span>}
    </button>
    {claimed && <strong className="cosmetic-milestone-received" role="status">선택 상자 획득!</strong>}
  </div>;
}
