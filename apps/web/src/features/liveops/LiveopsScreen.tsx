import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import closeIcon from "../../shared/assets/cozy-hud-v9/close-button-v9.png";
import machineImage from "./assets-cozy-pixel/event-capsule-machine-v1.png";
import cosmeticTicketBadge from "./assets-cozy-pixel/odds-cosmetic-ticket-v1.png";
import gemBoxBadge from "./assets-cozy-pixel/odds-gem-box-v1.png";
import prizeBadge from "./assets-cozy-pixel/odds-prize-burger-v1.png";
import riceBadge from "./assets-cozy-pixel/odds-rice-v1.png";
import prizeIcon from "./assets-cozy-pixel/prize-burger-gifticon-v1.png";
import rewardStarBadge from "./assets-cozy-pixel/reward-star-badge-v1.png";
import cosmeticTicket from "../cosmetics/assets-cozy-pixel/cosmetic-draw-ticket-v1.png";
import riceIcon from "../equipment/assets-cozy-pixel/currency-rice-gold-v2.png";
import gemBoxIcon from "../inventory/assets-gem-box-chest.png";
import { liveopsApi, type LiveopsDrawLine, type LiveopsDrawResult, type LiveopsState } from "./api";
import { liveopsErrorMessage } from "./presentation";
import { useLiveopsScale } from "./useLiveopsScale";
import "./liveops.css";

const KIND_LABELS: Record<string, string> = { PRIZE: "경품 교환권", COSMETIC_TICKET: "치장 뽑기권", GEM_BOX: "보석함", RICE: "쌀" };

/* 확률표의 네 줄은 색만 다른 동그라미였다. 색각 이상이 있으면 같은 그림 네 개가 된다.
   안에 실제 물건을 그려 모양으로도 구분되게 한다. */
const ODDS_BADGES: Record<string, string> = { PRIZE: prizeBadge, COSMETIC_TICKET: cosmeticTicketBadge, GEM_BOX: gemBoxBadge, RICE: riceBadge };

export type LiveopsDataSource = Pick<typeof liveopsApi, "state" | "draw">;

function ResultIcon({ line }: { line: LiveopsDrawLine }) {
  if (line.kind === "COSMETIC_TICKET") return <img src={cosmeticTicket} alt="" />;
  if (line.kind === "GEM_BOX") return <img src={gemBoxIcon} alt="" />;
  if (line.kind === "RICE") return <img src={riceIcon} alt="" />;
  return <img src={prizeIcon} alt="" />;
}

function ResultStage({ result, onClose }: { result: LiveopsDrawResult; onClose: () => void }) {
  return (
    <div className="liveops-result-backdrop">
      <section className="liveops-result-stage" role="dialog" aria-modal="true" aria-label="뽑기 결과">
        <div className="liveops-result-sparkles" aria-hidden="true"><i /><i /><i /><i /></div>
        <header><span>CAPSULE OPEN!</span><h3>두근두근 뽑기 결과</h3><p>{result.ticketCost}장의 티켓으로 아래 보상을 받았어요.</p></header>
        <ul className="liveops-result-list">
          {result.lines.map((line, index) => (
            <li key={`${line.kind}-${index}`} className={`kind-${line.kind.toLowerCase()}`} style={{ animationDelay: `${index * 45}ms` }}>
              <i className="liveops-result-capsule" aria-hidden="true" />
              <span className="liveops-result-icon"><ResultIcon line={line} /></span>
              <strong>{line.prizeDisplayName ?? KIND_LABELS[line.kind]}</strong>
              <small>{line.kind === "PRIZE" ? "축하해요! 경품에 당첨됐어요" : `${line.quantity}개 획득`}</small>
            </li>
          ))}
        </ul>
        <button className="liveops-result-confirm" onClick={onClose}>확인</button>
      </section>
    </div>
  );
}

/**
 * 전투 화면 위에 뜨는 창. 장비·스킬 창과 같은 자리를 쓴다.
 *
 * 바깥을 누르면 닫히지만 `onMouseDown` 의 대상이 껍데기 자신일 때만이다. 창 안에서 눌러
 * 밖에서 뗀 드래그까지 닫기로 세면, 확률표를 긁어 읽던 사람의 창이 사라진다.
 */
function LiveopsShell({ onClose, children }: { onClose?: () => void; children: ReactNode }) {
  return (
    <div
      className="liveops-backdrop"
      onMouseDown={(event) => { if (onClose && event.currentTarget === event.target) onClose(); }}
    >
      {children}
    </div>
  );
}

export function LiveopsScreen({ onClose, dataSource = liveopsApi }: { onClose?: () => void; dataSource?: LiveopsDataSource } = {}) {
  useLiveopsScale();
  const queryClient = useQueryClient();
  const [state, setState] = useState<LiveopsState | null>(null);
  const [result, setResult] = useState<LiveopsDrawResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    setError(null);
    dataSource.state().then((next) => {
      setState(next);
      queryClient.setQueryData(["liveops-state"], next);
    }).catch((cause: Error) => setError(cause.message));
  }, [dataSource, queryClient]);

  useEffect(refresh, [refresh]);

  const roll = async (count: 1 | 10) => {
    if (!state) return;
    setBusy(true);
    setError(null);
    try {
      const drawn = await dataSource.draw(count);
      const next = { ...state, ticketBalance: drawn.ticketBalance };
      setState(next);
      queryClient.setQueryData(["liveops-state"], next);
      setResult(drawn);
      refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!state) {
    return <LiveopsShell onClose={onClose}><section className="liveops-screen liveops-message-screen"><div className="liveops-paper-message"><b aria-hidden="true">🎟️</b>{error ? <><h2>이벤트를 불러오지 못했어요</h2><p role="alert">{liveopsErrorMessage(error)}</p><button onClick={refresh}>다시 시도</button></> : <h2>이벤트를 준비하고 있어요…</h2>}</div></section></LiveopsShell>;
  }

  const usable = state.open || state.ticketBalance > 0;
  if (!usable) {
    return <LiveopsShell onClose={onClose}><section className="liveops-screen liveops-message-screen"><div className="liveops-paper-message"><b aria-hidden="true">🎪</b><h2>진행 중인 이벤트가 없습니다.</h2>{onClose && <button onClick={onClose}>닫기</button>}</div></section></LiveopsShell>;
  }

  const locked = busy || state.halted;
  const progress = Math.min(100, Math.round((state.grantedToday / state.dailyCap) * 100));
  return (
    <LiveopsShell onClose={onClose}>
    <section className={`liveops-screen${busy ? " is-drawing" : ""}`} role="dialog" aria-modal="true" aria-label="이벤트 뽑기">
      <header className="liveops-heading">
        <h2>{state.displayName}</h2>
        {onClose && <button type="button" className="paper-close" onClick={onClose} aria-label="이벤트 닫기"><img src={closeIcon} alt="" aria-hidden="true" /></button>}
      </header>

      <div className="liveops-layout">
        <aside className="liveops-paper-panel liveops-ticket-panel" aria-label="이벤트 티켓 적립 현황">
          <header className="liveops-ticket-head"><i className="liveops-ticket-stub" aria-hidden="true"><span>EVENT</span><b>티켓</b></i><h3>내 이벤트 티켓</h3></header>
          <p className="liveops-ticket-balance"><strong>{state.ticketBalance}</strong></p>
          <div className="liveops-accrual"><div><strong>오늘 모은 티켓</strong><span>{state.grantedToday} / {state.dailyCap}</span></div><progress value={state.grantedToday} max={state.dailyCap} aria-label="오늘 티켓 적립량" /><p><i>⚔</i> 사냥 {Math.round(state.secondsPerTicket / 60)}분마다 티켓 1장 자동 적립</p></div>
          <div className="liveops-howto"><h3>이벤트 참여 방법</h3><ol><li><b>1</b>사냥하기</li><li><b>2</b>티켓 받기</li><li><b>3</b>캡슐 뽑기</li></ol></div>
          <span className="sr-only">오늘 적립 진행률 {progress}%</span>
          <div className="liveops-actions">
            <button aria-label="1회 뽑기" onClick={() => roll(1)} disabled={locked || state.ticketBalance < 1}><strong>1회 뽑기</strong><small>티켓 1장</small></button>
            <button aria-label="10회 뽑기" onClick={() => roll(10)} disabled={locked || state.ticketBalance < 10}><strong>10회 뽑기</strong><small>티켓 10장</small></button>
          </div>
        </aside>

        <main className="liveops-machine-stage">
          {state.halted && <p className="liveops-status-note" role="status">점검을 위해 뽑기가 잠시 멈췄어요.</p>}
          {!state.open && <p className="liveops-status-note" role="status">이벤트 기간은 끝났지만 남은 티켓은 계속 사용할 수 있어요.</p>}
          <div className="liveops-machine-wrap"><img src={machineImage} alt="알록달록 캡슐이 든 이벤트 공뽑기 기계" /><i className="liveops-machine-glint" aria-hidden="true" /><i className="liveops-machine-capsule" aria-hidden="true" /></div>
          {error && <p className="liveops-error" role="alert">{liveopsErrorMessage(error)}</p>}
        </main>

        <aside className="liveops-paper-panel liveops-reward-panel">
          <header><img src={rewardStarBadge} alt="" /><h3>캡슐 속 보상</h3></header>
          <table className="liveops-odds"><caption className="sr-only">보상 확률</caption><tbody>{state.outcomes.map((outcome) => <tr key={`${outcome.kind}-${outcome.prizeId ?? "default"}`} className={`kind-${outcome.kind.toLowerCase()}`}><td><img className="liveops-odds-icon" src={ODDS_BADGES[outcome.kind]} alt="" /></td><th scope="row"><strong>{outcome.displayName ?? KIND_LABELS[outcome.kind]}</strong><small>{outcome.kind === "RICE" ? `${outcome.minQuantity}~${outcome.maxQuantity}개` : `${outcome.quantity ?? 1}개`}</small></th><td>{outcome.probabilityDisplay}</td></tr>)}</tbody></table>
          <div className="liveops-prize-stock"><h3><span aria-hidden="true">🎁</span> 한정 경품 재고</h3><table className="liveops-prizes"><caption className="sr-only">경품 재고</caption><tbody>{state.prizes.map((prize) => <tr key={prize.prizeId}><th scope="row">{prize.displayName}</th><td><span className="sr-only">{prize.remaining} / {prize.total}</span><strong aria-hidden="true">{prize.remaining}</strong><small aria-hidden="true">/ {prize.total}개</small>{prize.alreadyWon && <span>당첨 완료</span>}</td></tr>)}</tbody></table><p>재고가 모두 소진되면 경품 캡슐은 나오지 않아요.</p></div>
          <p className="liveops-odds-note">표시 확률은 각 캡슐 1회 기준입니다.</p>
        </aside>
      </div>
      {result && <ResultStage result={result} onClose={() => setResult(null)} />}
    </section>
    </LiveopsShell>
  );
}
