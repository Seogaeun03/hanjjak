import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  AdminAccountSummary,
  AdminBannerEntry,
  AdminBannerTone,
  AdminMessageHistoryEntry,
  AdminMessageReward,
  AdminMessageRewardKind,
  AdminMessageTargetMode,
  createApiClient,
} from "@hanjjak/client-sdk";
import { adminErrorMessage } from "./presentation";
import "./UserManagementControls.css";
import "./MessagingView.css";

type AdminApi = ReturnType<typeof createApiClient>["admin"];
type AdminCatalog = Awaited<ReturnType<AdminApi["catalog"]>>;
type Tab = "notice" | "banner" | "mail" | "history";

const GEM_OPTIONS: [string, string][] = [
  ["FLAT_ATTACK", "공격력 증가"],
  ["FLAT_HP", "최대 HP 증가"],
  ["ATTACK_PERCENT", "공격력 비율"],
  ["FLAT_PENETRATION", "방어 관통"],
  ["CRITICAL_CHANCE", "치명타 확률"],
  ["HASTE", "행동 속도"],
];

/** `datetime-local` 은 현지 시각을 준다. 서버에는 시점으로 보내야 하므로 여기서 한 번만 옮긴다. */
function toInstant(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("노출 기간의 날짜 형식을 확인해 주세요.");
  return parsed.toISOString();
}

function formatMoment(value: string | null): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
}

export function rewardLabel(reward: AdminMessageReward): string {
  const name = reward.displayName
    ?? reward.itemId
    ?? reward.cosmeticId
    ?? (reward.gemLevel ? `${reward.gemLevel}단계 보석` : null)
    ?? (reward.kind === "COSMETIC_CHOICE" ? "싸피 후드집업 선택권" : null)
    ?? (reward.kind === "TICKET" ? "치장 뽑기권" : "보상");
  return `${name} ×${reward.quantity.toLocaleString()}`;
}

/** 운영자가 채워 넣는 보상 한 줄. 종류를 바꾸면 쓰지 않는 칸은 화면에서 사라진다. */
type RewardDraft = { key: string; kind: AdminMessageRewardKind; id: string; gemLevel: string; gemOption: string; quantity: string };

const emptyReward = (kind: AdminMessageRewardKind): RewardDraft =>
  ({ key: crypto.randomUUID(), kind, id: "", gemLevel: "1", gemOption: "FLAT_ATTACK", quantity: "1" });

export function MessagingView({ api }: { api: AdminApi }) {
  const [tab, setTab] = useState<Tab>("notice");
  const [catalog, setCatalog] = useState<AdminCatalog | null>(null);
  const [accounts, setAccounts] = useState<AdminAccountSummary[]>([]);
  const [history, setHistory] = useState<AdminMessageHistoryEntry[]>([]);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [reason, setReason] = useState("");
  const [publishedAt, setPublishedAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [targetMode, setTargetMode] = useState<AdminMessageTargetMode>("ALL");
  const [targetAccountIds, setTargetAccountIds] = useState<string[]>([]);
  const [accountQuery, setAccountQuery] = useState("");
  const [riceAmount, setRiceAmount] = useState("0");
  const [rewards, setRewards] = useState<RewardDraft[]>([]);
  const [bannerMessage, setBannerMessage] = useState("");
  const [bannerTone, setBannerTone] = useState<AdminBannerTone>("INFO");
  const [banners, setBanners] = useState<AdminBannerEntry[]>([]);

  const loadBanners = useCallback(() => {
    api.banners().then(setBanners).catch((failure) => setError(adminErrorMessage(failure)));
  }, [api]);

  const loadHistory = useCallback(() => {
    api.messageHistory().then(setHistory).catch((failure) => setError(adminErrorMessage(failure)));
  }, [api]);

  useEffect(() => {
    api.catalog().then(setCatalog).catch((failure) => setError(adminErrorMessage(failure)));
    api.searchAccounts().then(setAccounts).catch(() => setAccounts([]));
    loadHistory();
    loadBanners();
  }, [api, loadBanners, loadHistory]);

  const stackItems = useMemo(() => (catalog?.items ?? []).filter((item) => item.stackable), [catalog]);
  const hasCosmeticChoice = rewards.some((reward) => reward.kind === "COSMETIC_CHOICE");
  const filteredAccounts = useMemo(() => {
    const keyword = accountQuery.trim().toLocaleLowerCase();
    if (!keyword) return accounts.slice(0, 50);
    return accounts
      .filter((account) => [account.nickname, account.email ?? "", account.accountId].some((value) => value.toLocaleLowerCase().includes(keyword)))
      .slice(0, 50);
  }, [accounts, accountQuery]);

  const clearMessages = () => { setFeedback(null); setError(null); };
  const resetForm = () => {
    setTitle(""); setBody(""); setReason(""); setPublishedAt(""); setExpiresAt("");
    setTargetAccountIds([]); setAccountQuery(""); setRiceAmount("0"); setRewards([]); setBannerMessage(""); clearMessages();
  };

  function buildRewards(): AdminMessageReward[] {
    return rewards.map((draft) => {
      const quantity = Number(draft.quantity);
      if (!Number.isInteger(quantity) || quantity < 1) throw new Error("보상 수량은 1 이상의 정수여야 합니다.");
      if (draft.kind === "GEM") return { kind: "GEM", quantity, gemLevel: Number(draft.gemLevel), gemOption: draft.gemOption };
      if (draft.kind === "COSMETIC_CHOICE") return { kind: "COSMETIC_CHOICE", quantity: 1, cosmeticIds: ["cosmetic-188", "cosmetic-189", "cosmetic-190"] };
      /* 뽑기권은 고를 항목이 없다. 수량만 보낸다. */
      if (draft.kind === "TICKET") return { kind: "TICKET", quantity };
      if (!draft.id) throw new Error("보상으로 보낼 항목을 선택해 주세요.");
      return draft.kind === "ITEM" ? { kind: "ITEM", quantity, itemId: draft.id } : { kind: "COSMETIC", quantity, cosmeticId: draft.id };
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearMessages();
    if (reason.trim().length < 3) { setError("운영 사유를 3자 이상 입력해 주세요."); return; }
    try {
      setPending(true);
      if (tab === "notice") {
        const result = await api.sendNotice({
          title, body, publishedAt: toInstant(publishedAt), expiresAt: toInstant(expiresAt), reason: reason.trim(),
        });
        setFeedback(result.replayed ? "같은 요청이 이미 처리되어 다시 보내지 않았습니다." : `공지 "${result.title}"를 올렸습니다.`);
      } else if (tab === "banner") {
        const expires = toInstant(expiresAt);
        if (!expires) throw new Error("배너를 내릴 시각을 입력해 주세요. 끝이 없는 배너는 올릴 수 없습니다.");
        const result = await api.raiseBanner({
          message: bannerMessage, tone: bannerTone, publishedAt: toInstant(publishedAt), expiresAt: expires, reason: reason.trim(),
        });
        setFeedback(result.replayed
          ? "같은 요청이 이미 처리되어 다시 올리지 않았습니다."
          : `배너를 ${formatMoment(result.expiresAt)}까지 올렸습니다.`);
        loadBanners();
      } else {
        if (targetMode === "ACCOUNTS" && targetAccountIds.length === 0) throw new Error("받을 사용자를 한 명 이상 선택해 주세요.");
        const rice = Number(riceAmount);
        if (!Number.isInteger(rice) || rice < 0) throw new Error("쌀은 0 이상의 정수여야 합니다.");
        const result = await api.sendMail({
          targetMode,
          targetAccountId: null,
          targetAccountIds: targetMode === "ACCOUNTS" ? targetAccountIds : [],
          title, body, riceAmount: rice, rewards: buildRewards(), publishedAt: toInstant(publishedAt), expiresAt: toInstant(expiresAt), reason: reason.trim(),
        });
        setFeedback(result.replayed
          ? "같은 요청이 이미 처리되어 다시 보내지 않았습니다."
          : `메시지 "${result.title}"를 ${result.recipientCount.toLocaleString()}명에게 보냈습니다.`);
      }
      resetForm();
      loadHistory();
    } catch (failure) {
      setError(failure instanceof Error && !("code" in failure) ? failure.message : adminErrorMessage(failure));
    } finally {
      setPending(false);
    }
  }

  /* 잘못 올린 배너를 기간이 끝나기 전에 내린다. 배너는 모든 화면 위에 붙으므로 되돌릴 길이 있어야 한다. */
  async function revoke(banner: AdminBannerEntry) {
    clearMessages();
    try {
      setPending(true);
      await api.revokeBanner(banner.bannerId, reason.trim() || "배너 조기 종료");
      setFeedback("배너를 내렸습니다. 다음 조회부터 사용자 화면에서 사라집니다.");
      loadBanners();
    } catch (failure) {
      setError(adminErrorMessage(failure));
    } finally {
      setPending(false);
    }
  }

  return <div className="content">
    <section className="overview-head">
      <div>
        <p>사용자에게 공지·배너와 보상 메시지를 보냅니다.</p>
        <span>공지는 알림 탭에, 배너는 모든 화면 맨 위에, 메시지는 메시지 탭에 도착합니다. 전체 발송은 되돌릴 수 없으며 모든 발송이 감사 로그에 남습니다.</span>
      </div>
      <button className="secondary" type="button" onClick={loadHistory}>↻ 발송 이력 새로고침</button>
    </section>

    <section className="user-management" aria-labelledby="messaging-title">
      <header className="user-management-heading">
        <div>
          <span className="eyebrow">PLAYER MESSAGING</span>
          <h2 id="messaging-title">메시지 발송</h2>
          <p>공지는 알림 탭에 쌓이고, 배너는 노출 기간 동안 모든 화면 맨 위에 걸리며, 메시지는 게시 시작 뒤 대상 사용자에게 한 통씩 만들어집니다.</p>
        </div>
      </header>

      {feedback && <div className="management-feedback" role="status">{feedback}</div>}
      {error && <div className="alert error" role="alert">{error}</div>}

      <div className="management-tabs" role="tablist" aria-label="발송 유형">
        {([["notice", "공지 (알림)"], ["banner", "상단 배너"], ["mail", "메시지·보상"], ["history", "발송 이력"]] as [Tab, string][]).map(([value, label]) =>
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={tab === value ? "management-tab active" : "management-tab"}
            onClick={() => { setTab(value); clearMessages(); }}
          >{label}</button>)}
      </div>

      {tab === "history"
        ? <HistoryTable entries={history} />
        : <form onSubmit={submit} className="management-form">
          {tab === "mail" && <fieldset>
            <legend>받는 사람</legend>
            <div className="segmented" role="group" aria-label="발송 대상">
              <button type="button" className={targetMode === "ALL" ? "selected positive" : ""} onClick={() => setTargetMode("ALL")}>모든 사용자</button>
              <button type="button" className={targetMode === "ACCOUNTS" ? "selected" : ""} onClick={() => setTargetMode("ACCOUNTS")}>특정 사용자</button>
            </div>
            {targetMode === "ACCOUNTS" && <>
              <label>사용자 검색<input value={accountQuery} onChange={(event) => setAccountQuery(event.target.value)} placeholder="닉네임 · 이메일 · 계정 UUID" /></label>
              <div className="recipient-picker" aria-label="받는 사용자 선택">
                <div className="recipient-results">
                  {filteredAccounts.map((account) => {
                    const selected = targetAccountIds.includes(account.accountId);
                    return <button key={account.accountId} type="button" className={selected ? "selected" : ""} disabled={selected} onClick={() => setTargetAccountIds((current) => [...current, account.accountId])}>{account.nickname} · Lv.{account.level} · {account.accountId.slice(0, 8)}{selected ? " · 선택됨" : " · 추가"}</button>;
                  })}
                </div>
                <div className="recipient-selected" aria-live="polite">
                  <strong>선택한 사용자 {targetAccountIds.length.toLocaleString()}명</strong>
                  {targetAccountIds.length === 0 ? <span>검색 결과에서 사용자를 추가해 주세요.</span> : targetAccountIds.map((accountId) => {
                    const account = accounts.find((candidate) => candidate.accountId === accountId);
                    return <span key={accountId}>{account?.nickname ?? accountId}<button type="button" aria-label={`${account?.nickname ?? accountId} 받는 사람에서 제거`} onClick={() => setTargetAccountIds((current) => current.filter((value) => value !== accountId))}>×</button></span>;
                  })}
                </div>
              </div>
              <p className="management-help">선택 수 제한은 없습니다. 같은 계정은 한 번만 추가되며, 발송 전에 선택 인원을 확인해 주세요.</p>
            </>}
            {targetMode === "ALL" && <p className="management-help">게시 시작 뒤 가입한 사용자도 같은 메시지와 보상을 받습니다.</p>}
          </fieldset>}

          {tab !== "banner" && <fieldset>
            <legend>{tab === "notice" ? "공지 내용" : "메시지 내용"}</legend>
            <label>제목<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="예: 9월 15일 점검 안내" required /></label>
            <label>본문<textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={2000} rows={6} placeholder="사용자가 읽을 내용을 적습니다." required /></label>
          </fieldset>}

          {tab === "banner" && <fieldset>
            <legend>배너 문구</legend>
            <label>문구<input value={bannerMessage} onChange={(event) => setBannerMessage(event.target.value)} maxLength={200} placeholder="예: 오늘 22시부터 30분간 점검합니다." required /><small>한 줄로 보입니다. 칸을 넘치면 화면에서 흘러갑니다.</small></label>
            <label>색
              <select value={bannerTone} onChange={(event) => setBannerTone(event.target.value as AdminBannerTone)}>
                <option value="INFO">안내 (청록)</option>
                <option value="EVENT">이벤트 (분홍)</option>
                <option value="WARNING">주의 (주황)</option>
              </select>
            </label>
            <div className="management-fields two">
              <label>노출 시작<input type="datetime-local" value={publishedAt} onChange={(event) => setPublishedAt(event.target.value)} /><small>비우면 지금 바로 올립니다.</small></label>
              <label>내릴 시각<input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} required /><small>반드시 넣습니다. 최대 7일까지.</small></label>
            </div>
            <p className="management-help">배너는 알림 탭에 쌓이지 않습니다. 기간 안에 접속한 사용자의 모든 화면 맨 위에 떠 있다가, 사용자가 닫거나 기간이 끝나면 사라집니다.</p>
          </fieldset>}

          {tab === "notice" && <fieldset>
            <legend>노출 기간</legend>
            <div className="management-fields two">
              <label>노출 시작<input type="datetime-local" value={publishedAt} onChange={(event) => setPublishedAt(event.target.value)} /><small>비우면 지금 바로 올립니다.</small></label>
              <label>노출 종료<input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /><small>비우면 내릴 때까지 계속 보입니다.</small></label>
            </div>
            <p className="management-help">기간이 열려 있는 동안에는 나중에 가입한 사용자에게도 보입니다. 기간이 끝나면 목록에서 사라집니다.</p>
          </fieldset>}

          {tab === "mail" && <fieldset>
            <legend>노출 기간</legend>
            <div className="management-fields two">
              <label>노출 시작<input type="datetime-local" value={publishedAt} onChange={(event) => setPublishedAt(event.target.value)} /><small>비우면 지금 바로 게시합니다.</small></label>
              <label>노출 종료<input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /><small>비우면 계속 보이고 받을 수 있습니다.</small></label>
            </div>
            <p className="management-help">기간 안에는 나중에 가입한 사용자도 받습니다. 종료 뒤에는 메시지가 사라지고 미수령 보상도 받을 수 없습니다.</p>
          </fieldset>}

          {tab === "mail" && <fieldset>
            <legend>첨부 보상</legend>
            <label>쌀<input type="number" inputMode="numeric" min={0} step={1} value={riceAmount} onChange={(event) => setRiceAmount(event.target.value)} required /><small>0이면 쌀은 붙이지 않습니다.</small></label>
            <div className="reward-rows">
              {rewards.map((draft, index) => <div className="reward-row" key={draft.key}>
                <select
                  aria-label={`${index + 1}번째 보상 종류`}
                  value={draft.kind}
                  onChange={(event) => {
                    const kind = event.target.value as AdminMessageRewardKind;
                    setRewards((current) => {
                      const changed = { ...draft, kind, id: "" };
                      return kind === "COSMETIC_CHOICE" ? [changed] : current.map((row) => row.key === draft.key ? changed : row);
                    });
                  }}
                >
                  <option value="ITEM">아이템</option>
                  <option value="GEM">보석</option>
                  <option value="COSMETIC">치장</option>
                  <option value="COSMETIC_CHOICE">싸피 후드 선택권</option>
                  <option value="TICKET">치장 뽑기권</option>
                </select>
                {draft.kind === "TICKET" && <span className="reward-fixed">캐릭터 뽑기권 잔액에 바로 들어갑니다.</span>}
                {draft.kind === "COSMETIC_CHOICE" && <span className="reward-fixed">검정·파랑·하양 중 사용자가 하나를 고릅니다.</span>}
                {draft.kind === "ITEM" && <select aria-label={`${index + 1}번째 아이템`} value={draft.id} onChange={(event) => setRewards((current) => current.map((row) => row.key === draft.key ? { ...row, id: event.target.value } : row))} required>
                  <option value="">아이템 선택</option>
                  {stackItems.map((item) => <option key={item.itemId} value={item.itemId}>{item.displayName}</option>)}
                </select>}
                {draft.kind === "COSMETIC" && <select aria-label={`${index + 1}번째 치장`} value={draft.id} onChange={(event) => setRewards((current) => current.map((row) => row.key === draft.key ? { ...row, id: event.target.value } : row))} required>
                  <option value="">치장 선택</option>
                  {(catalog?.cosmetics ?? []).map((cosmetic) => <option key={cosmetic.cosmeticId} value={cosmetic.cosmeticId}>{cosmetic.displayName} · {cosmetic.slot}</option>)}
                </select>}
                {draft.kind === "GEM" && <>
                  <select aria-label={`${index + 1}번째 보석 단계`} value={draft.gemLevel} onChange={(event) => setRewards((current) => current.map((row) => row.key === draft.key ? { ...row, gemLevel: event.target.value } : row))}>
                    {Array.from({ length: 7 }, (_, level) => <option key={level + 1} value={level + 1}>{level + 1}단계</option>)}
                  </select>
                  <select aria-label={`${index + 1}번째 보석 옵션`} value={draft.gemOption} onChange={(event) => setRewards((current) => current.map((row) => row.key === draft.key ? { ...row, gemOption: event.target.value } : row))}>
                    {GEM_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </>}
                {draft.kind !== "COSMETIC_CHOICE" && <input
                  aria-label={`${index + 1}번째 보상 수량`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={draft.quantity}
                  onChange={(event) => setRewards((current) => current.map((row) => row.key === draft.key ? { ...row, quantity: event.target.value } : row))}
                  required
                />}
                <button type="button" className="secondary" onClick={() => setRewards((current) => current.filter((row) => row.key !== draft.key))}>줄 삭제</button>
              </div>)}
            </div>
            {!hasCosmeticChoice && <div className="reward-add">
              <button type="button" className="secondary" onClick={() => setRewards((current) => [...current, emptyReward("ITEM")])}>+ 아이템</button>
              <button type="button" className="secondary" onClick={() => setRewards((current) => [...current, emptyReward("GEM")])}>+ 보석</button>
              <button type="button" className="secondary" onClick={() => setRewards((current) => [...current, emptyReward("COSMETIC")])}>+ 치장</button>
              <button type="button" className="secondary" onClick={() => setRewards([emptyReward("COSMETIC_CHOICE")])}>+ 싸피 후드 선택권</button>
              <button type="button" className="secondary" onClick={() => setRewards((current) => [...current, emptyReward("TICKET")])}>+ 치장 뽑기권</button>
            </div>}
            <p className="management-help">보상을 하나도 붙이지 않으면 읽기만 하는 안내 메시지가 됩니다. 아이템과 보석은 받는 사람의 가방에 자리가 있어야 받을 수 있고, 치장과 뽑기권은 가방 칸을 쓰지 않습니다.</p>
          </fieldset>}

          <fieldset className="reason-field">
            <legend>운영 사유</legend>
            <label>사유<input value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={500} placeholder="예: 9월 점검 보상 지급" required /></label>
            <div className="reason-presets" aria-label="사유 예시">
              <button type="button" onClick={() => setReason("점검 보상 지급")}>점검 보상 지급</button>
              <button type="button" onClick={() => setReason("고객 지원 보상 지급")}>고객 지원</button>
              <button type="button" onClick={() => setReason("업데이트 공지")}>업데이트 공지</button>
            </div>
          </fieldset>

          <div className="management-actions">
            <button className="secondary" type="button" disabled={pending} onClick={resetForm}>입력 초기화</button>
            <button className="primary" type="submit" disabled={pending}>{pending ? "보내는 중…" : tab === "notice" ? "공지 올리기" : tab === "banner" ? "배너 올리기" : "메시지 보내기"}</button>
          </div>
        </form>}

      {tab === "banner" && <BannerTable entries={banners} pending={pending} onRevoke={revoke} />}
    </section>
  </div>;
}

function HistoryTable({ entries }: { entries: AdminMessageHistoryEntry[] }) {
  if (entries.length === 0) return <p className="management-note" role="status">아직 보낸 공지나 메시지가 없습니다.</p>;
  return <div className="table-wrap">
    <table>
      <thead><tr><th>보낸 시각</th><th>종류</th><th>제목</th><th>대상</th><th>첨부</th><th>노출 기간</th><th>사유</th></tr></thead>
      <tbody>{entries.map((entry) => <tr key={entry.id}>
        <td>{formatMoment(entry.createdAt)}</td>
        <td>{entry.kind === "NOTICE" ? "공지" : "메시지"}</td>
        <td>{entry.title}</td>
        <td>{entry.kind === "NOTICE" ? "전체" : entry.targetMode === "ALL" ? `전체 (등록 시 ${entry.recipientCount.toLocaleString()}명 + 이후 가입자)` : `지정 ${entry.recipientCount.toLocaleString()}명`}</td>
        <td>{entry.kind === "NOTICE"
          ? "-"
          : [entry.riceAmount > 0 ? `쌀 ×${entry.riceAmount.toLocaleString()}` : null, ...entry.rewards.map(rewardLabel)].filter(Boolean).join(", ") || "없음"}</td>
        <td>{`${formatMoment(entry.publishedAt)} ~ ${entry.expiresAt ? formatMoment(entry.expiresAt) : "무기한"}`}</td>
        <td>{entry.reason}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

/** 올린 배너의 현재 상태. 지금 떠 있는 것만 내릴 수 있으므로 그 줄에만 단추가 붙는다. */
function BannerTable({ entries, pending, onRevoke }: { entries: AdminBannerEntry[]; pending: boolean; onRevoke: (banner: AdminBannerEntry) => void }) {
  if (entries.length === 0) return <p className="management-note" role="status">아직 올린 배너가 없습니다.</p>;
  const toneLabel: Record<AdminBannerTone, string> = { INFO: "안내", EVENT: "이벤트", WARNING: "주의" };
  return <div className="table-wrap">
    <table>
      <thead><tr><th>상태</th><th>문구</th><th>색</th><th>노출 기간</th><th>사유</th><th>조치</th></tr></thead>
      <tbody>{entries.map((entry) => <tr key={entry.bannerId}>
        <td>{entry.live ? "표시 중" : entry.revokedAt ? "내림" : "종료"}</td>
        <td>{entry.message}</td>
        <td>{toneLabel[entry.tone]}</td>
        <td>{formatMoment(entry.publishedAt)} ~ {formatMoment(entry.expiresAt)}</td>
        <td>{entry.reason}</td>
        <td>{entry.live
          ? <button type="button" className="secondary" disabled={pending} onClick={() => onRevoke(entry)}>지금 내리기</button>
          : "-"}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}
