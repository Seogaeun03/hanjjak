import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { AdminAccountDetail, AdminAccountSummary, AdminAuditEvent, AdminChatReport, AdminChatSettings, AdminDashboard, AdminIdentity, AdminKafkaOps, AdminOutboxEvent, AdminUserState, EconomyDailyMetric, createApiClient } from "@hanjjak/client-sdk";
import { adminAuthErrorFromHash, adminErrorMessage, defaultEconomyRange } from "./presentation";
import "./styles.css";
import { KafkaView } from "./KafkaView";
import { MarketView } from "./MarketView";
import { MessagingView } from "./MessagingView";
import { UserManagementControls, readableTextColor } from "./UserManagementControls";
import { QaReportView } from "./QaReportView";
import { EventLifecycleView } from "./EventLifecycleView";
import { CosmeticManagementView } from "./CosmeticManagementView";

const api = createApiClient().admin;
type View = "dashboard" | "lifecycle" | "accounts" | "cosmetics" | "messaging" | "market" | "outbox" | "kafka" | "economy" | "audit" | "chat" | "qa";
type LoadState<T> = { status: "loading" | "ready" | "error"; data: T | null; error: string | null };
const loading = <T,>(data: T | null = null): LoadState<T> => ({ status: "loading", data, error: null });

function App() {
  const [session, setSession] = useState<LoadState<AdminIdentity>>(loading());
  useEffect(() => {
    api.session()
      .then((state) => setSession(state.operator ? { status: "ready", data: state.operator, error: null } : { status: "error", data: null, error: null }))
      .catch(() => setSession({ status: "error", data: null, error: null }));
  }, []);
  if (session.status === "loading") return <Splash />;
  if (!session.data) return <Login onLogin={(operator) => setSession({ status: "ready", data: operator, error: null })} />;
  return <Console operator={session.data} onLogout={() => setSession({ status: "error", data: null, error: null })} />;
}

function Splash() {
  return <main className="splash" aria-live="polite"><Brand /><div className="loader" /><p>운영 세션을 확인하고 있습니다.</p></main>;
}

function Login({ onLogin }: { onLogin: (operator: AdminIdentity) => void }) {
  const [pending, setPending] = useState(false);
  const [localLoginEnabled, setLocalLoginEnabled] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(() => adminAuthErrorFromHash(window.location.hash) || null);
  useEffect(() => {
    api.localAvailability().then(({ enabled }) => setLocalLoginEnabled(enabled)).catch(() => setLocalLoginEnabled(false));
  }, []);
  async function beginGitlabLogin() {
    setPending(true); setError(null);
    try {
      const authorization = await api.beginGitlab();
      window.location.assign(authorization.authorizationUrl);
    } catch (failure) {
      setError(adminErrorMessage(failure));
      setPending(false);
    }
  }
  async function loginLocal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true); setError(null);
    try {
      const state = await api.loginLocal(username, password);
      if (!state.authenticated || !state.operator) {
        setError("운영 세션을 확인하지 못했습니다. 다시 로그인해 주세요.");
        setPending(false);
        return;
      }
      setPassword("");
      onLogin(state.operator);
    } catch (failure) {
      setError(adminErrorMessage(failure));
      setPending(false);
    }
  }
  return <main className="login-page">
    <section className="login-intro"><Brand /><div className="login-copy"><span className="eyebrow">SECURE OPERATIONS</span><h1>문제를 찾고,<br />안전하게 대응합니다.</h1><p>계정·전투·경제·이벤트 상태를 하나의 운영 경계에서 확인합니다.</p></div><div className="login-security"><span>●</span> 모든 접근과 조회가 감사 기록으로 남습니다.</div></section>
    <section className="login-panel" aria-labelledby="login-title"><div className="login-card"><span className="eyebrow">OPERATOR ACCESS</span><h2 id="login-title">운영자 로그인</h2><p>허용된 인증 방식으로 로그인하세요.</p>{error && <div className="alert error" role="alert">{error}</div>}
      {localLoginEnabled && <form className="local-login-form" onSubmit={(event) => void loginLocal(event)} aria-busy={pending}>
        <label htmlFor="local-username">운영자 ID<input id="local-username" name="username" type="text" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required disabled={pending} /></label>
        <label htmlFor="local-password">비밀번호<input id="local-password" name="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required disabled={pending} /></label>
        <button className="primary local-login-button" type="submit" disabled={pending}>{pending ? "로그인 중…" : "ID·비밀번호로 로그인"}</button>
      </form>}
      <button className="primary gitlab-login" type="button" disabled={pending} onClick={() => void beginGitlabLogin()}><span className="gitlab-mark" aria-hidden="true">◆</span>{pending ? "GitLab로 이동 중…" : "GitLab로 로그인"}</button>
    </div></section>
  </main>;
}


function Console({ operator, onLogout }: { operator: AdminIdentity; onLogout: () => void }) {
  const [view, setView] = useState<View>(() => new URLSearchParams(window.location.search).has("cosmetic") ? "cosmetics" : "dashboard");
  const [mobileNav, setMobileNav] = useState(false);
  const [galleryMounted, setGalleryMounted] = useState(() => new URLSearchParams(window.location.search).has("cosmetic"));
  const logout = async () => { try { await api.logout(); } finally { onLogout(); } };
  const navigate = (next: View) => { setView(next); setMobileNav(false); if (next === "cosmetics") setGalleryMounted(true); };
  const title = { dashboard: "운영 현황", lifecycle: "이벤트 일정", accounts: "계정 조사", cosmetics: "치장 관리", messaging: "메시지 발송", market: "거래소 관리", outbox: "Outbox 진단", kafka: "Kafka 모니터링", economy: "경제 지표", audit: "감사 로그", chat: "채팅 신고", qa: "QA 버그 신고" }[view];
  return <div className="console-shell"><aside className={mobileNav ? "sidebar open" : "sidebar"}><Brand /><nav aria-label="운영 메뉴"><NavButton active={view === "dashboard"} onClick={() => navigate("dashboard")} icon="⌁">운영 홈</NavButton><NavButton active={view === "lifecycle"} onClick={() => navigate("lifecycle")} icon="◷" disabled={!operator.permissions.includes("event-lifecycle:manage")}>이벤트 일정</NavButton><NavButton active={view === "accounts"} onClick={() => navigate("accounts")} icon="◎" disabled={!operator.permissions.includes("account:read")}>계정 조사</NavButton><NavButton active={view === "cosmetics"} onClick={() => navigate("cosmetics")} icon="✧" disabled={!operator.permissions.includes("cosmetic-showcase:manage")}>치장 관리</NavButton><NavButton active={view === "messaging"} onClick={() => navigate("messaging")} icon="✉" disabled={!operator.permissions.includes("message:send")}>메시지 발송</NavButton><NavButton active={view === "market"} onClick={() => navigate("market")} icon="⇄" disabled={!operator.permissions.includes("market:manage")}>거래소 관리</NavButton><NavButton active={view === "outbox"} onClick={() => navigate("outbox")} icon="↗" disabled={!operator.permissions.includes("outbox:read")}>Outbox 진단</NavButton><NavButton active={view === "kafka"} onClick={() => navigate("kafka")} icon="◈" disabled={!operator.permissions.includes("outbox:read")}>Kafka 모니터링</NavButton><NavButton active={view === "economy"} onClick={() => navigate("economy")} icon="◌" disabled={!operator.permissions.includes("economy:read")}>경제 지표</NavButton><NavButton active={view === "audit"} onClick={() => navigate("audit")} icon="⌘" disabled={!operator.permissions.includes("audit:read")}>감사 로그</NavButton><NavButton active={view === "chat"} onClick={() => navigate("chat")} icon="✦" disabled={!operator.permissions.includes("chat:moderate")}>채팅 신고</NavButton><NavButton active={view === "qa"} onClick={() => navigate("qa")} icon="⚑" disabled={!operator.permissions.includes("qa:read")}>QA 버그 신고</NavButton></nav><div className="sidebar-note"><span className="status-dot" />운영 시스템 정상<small>권한에 따라 메뉴가 제한됩니다.</small></div></aside><main className="workspace"><header className="topbar"><button className="menu-button" onClick={() => setMobileNav(!mobileNav)} aria-label="메뉴">☰</button><div><span className="eyebrow">HANJJAK OPERATIONS</span><h1>{title}</h1></div><div className="operator"><div><strong>{operator.displayName}</strong><span>{operator.roles.join(" · ")}</span></div><button onClick={() => void logout()}>로그아웃</button></div></header>{view === "dashboard" && <DashboardView />}{view === "lifecycle" && <EventLifecycleView />}{view === "accounts" && <AccountsView />}{galleryMounted && operator.permissions.includes("cosmetic-showcase:manage") && <div hidden={view !== "cosmetics"}><CosmeticManagementView /></div>}{view === "messaging" && <MessagingView api={api} />}{view === "market" && <MarketView api={api} />}{view === "outbox" && <OutboxView />}{view === "kafka" && <KafkaView />}{view === "economy" && <EconomyView />}{view === "audit" && <AuditView />}{view === "chat" && <ChatModerationView />}{view === "qa" && <QaReportView />}</main></div>;
}

function ChatModerationView() {
  const [state, setState] = useState<LoadState<AdminChatReport[]>>(loading());
  const load = useCallback(() => { setState((current) => loading(current.data)); api.chatReports(100).then((data) => setState({ status: "ready", data, error: null })).catch((error) => setState((current) => ({ status: "error", data: current.data, error: adminErrorMessage(error) }))); }, []);
  useEffect(load, [load]);
  async function remove(report: AdminChatReport) { try { if (report.targetType === "MESSAGE") await api.deleteChatMessage(report.targetId); else await api.deleteChatBoard(report.targetId); setState((current) => current.data ? { ...current, data: current.data.filter((item) => item.reportId !== report.reportId) } : current); } catch (error) { setState((current) => ({ ...current, error: adminErrorMessage(error) })); } }
  async function toggleBan(report: AdminChatReport) { if (!report.targetAccountId) return; try { await api.banChatAccount(report.targetAccountId, report.reason); setState((current) => ({ ...current, error: `${report.targetNickname ?? "사용자"} 채팅을 차단했습니다.` })); } catch (error) { setState((current) => ({ ...current, error: adminErrorMessage(error) })); } }
  if (!state.data && state.status === "loading") return <div className="content"><ChatSettingsPanel /><LoadingState label="채팅 신고를 불러오고 있습니다." /></div>;
  if (!state.data) return <div className="content"><ChatSettingsPanel /><ErrorState message={state.error ?? "채팅 신고를 불러오지 못했습니다."} retry={load} /></div>;
  return <div className="content"><ChatSettingsPanel /><section className="overview-head"><div><p>신고된 채팅과 거래 게시글을 확인하고 삭제합니다.</p><span>신고 사유와 원문을 확인한 뒤 삭제·채팅 차단을 처리합니다.</span></div><button className="secondary" onClick={load} disabled={state.status === "loading"}>↻ 신고 새로고침</button></section>{state.error && <div className="alert error" role="alert">{state.error} {!state.data && <button className="secondary" onClick={load} disabled={state.status === "loading"}>다시 시도</button>}</div>}<article className="panel table-panel">{state.status === "loading" && !state.data ? <EmptyState label="채팅 신고를 불러오고 있습니다." /> : !state.data ? <EmptyState label="신고를 불러올 수 없습니다." /> : state.data.length === 0 ? <EmptyState label="처리할 신고가 없습니다." /> : <div className="table-wrap"><table><thead><tr><th>접수 시각</th><th>유형</th><th>신고자</th><th>원문</th><th>사유</th><th>조치</th></tr></thead><tbody>{state.data.map((report) => <tr key={report.reportId}><td>{formatDate(report.createdAt)}</td><td>{report.targetType}</td><td className="mono">{report.targetNickname ?? report.targetAccountId ?? report.reporterAccountId}</td><td>{report.targetBody ?? "원문 없음"}</td><td>{report.reason}</td><td><button className="secondary" onClick={() => void toggleBan(report)} disabled={!report.targetAccountId}>채팅 차단</button><button className="secondary" onClick={() => void remove(report)}>삭제</button></td></tr>)}</tbody></table></div>}</article></div>;
}

function ChatSettingsPanel() {
  const [settings, setSettings] = useState<AdminChatSettings | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoadingSettings(true);
    setError(null);
    try {
      const next = await api.chatSettings();
      setSettings(next);
      setEnabled(next.enabled);
    } catch (failure) {
      setSettings(null);
      setEnabled(null);
      setError(adminErrorMessage(failure));
    } finally {
      setLoadingSettings(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function save() {
    if (!settings || enabled === null || enabled === settings.enabled || reason.trim().length < 3 || saving) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.updateChatSettings(enabled, settings.version, reason.trim());
      setSettings(result.after);
      setEnabled(result.after.enabled);
      setMessage(result.replayed ? "이미 처리된 변경 요청입니다. 현재 상태를 다시 확인했습니다." : "전체 채팅 설정을 저장했습니다.");
      await refresh();
    } catch (failure) {
      if (failure instanceof Error && "code" in failure && failure.code === "CHAT_SETTINGS_VERSION_CONFLICT") {
        await refresh();
        setError("다른 운영자가 먼저 변경했습니다. 최신 설정을 확인하고 다시 선택해 주세요.");
      } else {
        setError(adminErrorMessage(failure));
      }
    } finally {
      setSaving(false);
    }
  }

  return <article className="panel chat-settings-panel"><header className="panel-title"><div><h2>전체 채팅 전송</h2><p>플레이어 채팅 메시지 전송을 전역으로 허용하거나 중지합니다.</p></div><button className="secondary" type="button" onClick={() => void refresh()} disabled={loadingSettings || saving}>↻ 새로고침</button></header><div className="chat-settings-body">{loadingSettings && !settings ? <p role="status">현재 채팅 설정을 불러오고 있습니다.</p> : !settings ? <div className="alert error" role="alert">{error ?? "채팅 설정을 불러오지 못했습니다."}<button className="secondary" type="button" onClick={() => void refresh()} disabled={loadingSettings}>다시 시도</button></div> : <><p>현재 상태 <span className={settings.enabled ? "badge success" : "badge danger"}>{settings.enabled ? "활성화" : "중지됨"}</span><small> · 버전 {settings.version} · {formatDate(settings.updatedAt)}</small>{loadingSettings && <small role="status"> · 설정 확인 중…</small>}</p><label>변경할 상태<select aria-label="변경할 채팅 상태" value={enabled === null ? "" : String(enabled)} onChange={(event) => setEnabled(event.target.value === "true")} disabled={loadingSettings || saving}><option value="true">활성화</option><option value="false">중지</option></select></label><label>운영 사유<textarea aria-label="운영 사유" value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={500} required disabled={saving || loadingSettings} placeholder="변경이 필요한 운영 사유를 입력하세요 (3~500자)" /></label><button className="primary" type="button" onClick={() => void save()} disabled={saving || loadingSettings || enabled === null || enabled === settings.enabled || reason.trim().length < 3}>{saving ? "저장 중…" : "설정 저장"}</button></>}{error && settings && <div className="alert error" role="alert">{error}</div>}{message && <div className="alert success" role="status">{message}</div>}</div></article>;
}

function DashboardView() {
  const [state, setState] = useState<LoadState<AdminDashboard>>(loading());
  const load = useCallback(() => { setState((current) => loading(current.data)); api.dashboard().then((data) => setState({ status: "ready", data, error: null })).catch((error) => setState({ status: "error", data: null, error: adminErrorMessage(error) })); }, []);
  useEffect(load, [load]);
  if (!state.data && state.status === "loading") return <LoadingState label="운영 지표를 집계하고 있습니다." />;
  if (!state.data) return <ErrorState message={state.error ?? "운영 현황을 불러오지 못했습니다."} retry={load} />;
  const { service, deployment, counts } = state.data; const attention = counts.failedOutboxEvents + counts.processingCommands;
  return <div className="content"><section className="overview-head"><div><p>서비스, 세션, 명령과 전달 상태를 실시간 DB 기준으로 확인합니다.</p><span>마지막 확인 {formatDate(service.checkedAt)}</span></div><button className="secondary" onClick={load} disabled={state.status === "loading"}>↻ 새로고침</button></section><section className="health-banner"><div className="health-icon">✓</div><div><span>GAME API</span><strong>서비스 정상</strong><small>{deployment.commitSha} · 콘텐츠 {deployment.contentVersion} ({deployment.contentAuthority})</small></div><b>{service.status}</b></section><section className="metric-grid"><Metric label="전체 계정" value={counts.totalAccounts} meta={`${number(counts.activeAccountSessions)}개 인증 세션 활성`} tone="blue" /><Metric label="게임 실행" value={counts.activeGameSessions} meta={`${number(counts.activeBattleSessions)}개 전투 세션`} tone="blue" /><Metric label="처리 중 명령" value={counts.processingCommands} meta="장기 지속 시 점검" tone={counts.processingCommands ? "warning" : "blue"} /><Metric label="Outbox 대기" value={counts.pendingOutboxEvents} meta={counts.oldestPendingOutboxAt ? `최장 ${formatDate(counts.oldestPendingOutboxAt)}` : "대기 없음"} tone={counts.pendingOutboxEvents ? "warning" : "blue"} /><Metric label="Outbox 실패" value={counts.failedOutboxEvents} meta="수동 재처리 필요" tone={counts.failedOutboxEvents ? "danger" : "blue"} /><Metric label="활성 주문" value={counts.activeMarketOrders} meta={`${number(counts.unclaimedMails)}개 미수령 정산`} tone="blue" /></section>{attention > 0 && <div className="attention-strip">운영 점검이 필요한 항목이 {number(attention)}건 있습니다.</div>}</div>;
}

function AccountsView() {
  const [query, setQuery] = useState("");
  const [accounts, setAccounts] = useState<AdminAccountSummary[]>([]);
  const [detail, setDetail] = useState<AdminAccountDetail | null>(null);
  const [management, setManagement] = useState<AdminUserState | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    setPending(true); setError(null);
    try { setAccounts(await api.searchAccounts()); }
    catch (failure) { setError(adminErrorMessage(failure)); }
    finally { setPending(false); }
  }, []);

  useEffect(() => { void loadAccounts(); }, [loadAccounts]);

  const filteredAccounts = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    if (!keyword) return accounts;
    return accounts.filter((account) => [account.nickname, account.email ?? "", account.accountId, account.characterId].some((value) => value.toLocaleLowerCase().includes(keyword)));
  }, [accounts, query]);

  async function open(accountId: string) {
    setPending(true); setError(null);
    try {
      const [nextDetail, nextManagement] = await Promise.all([api.accountDetail(accountId), api.userManagement(accountId)]);
      setDetail(nextDetail); setManagement(nextManagement);
    } catch (failure) { setError(adminErrorMessage(failure)); } finally { setPending(false); }
  }
  const close = () => { setDetail(null); setManagement(null); };
  return <div className="content"><section className="overview-head"><div><p>전체 사용자를 목록에서 선택하고, 키워드가 포함된 사용자만 즉시 필터링합니다.</p><span>모든 조정은 운영 사유·멱등 키와 전후 상태를 감사 로그에 남깁니다.</span></div><button className="secondary" type="button" onClick={() => void loadAccounts()} disabled={pending}>↻ 전체 새로고침</button></section><section className="account-search"><input aria-label="계정 목록 필터" placeholder="닉네임 · 이메일 · 계정 UUID · 캐릭터 UUID 포함 검색" value={query} onChange={(event) => setQuery(event.target.value)} /><span className="account-count">{pending ? "조회 중…" : `${number(filteredAccounts.length)} / ${number(accounts.length)}명`}</span></section>{error && <div className="alert error" role="alert">{error}</div>}{detail && management ? <AccountDetailView detail={detail} management={management} onManagement={setManagement} close={close} /> : <article className="panel result-panel">{accounts.length === 0 && !pending ? <EmptyState label="조회 가능한 계정이 없습니다." /> : filteredAccounts.length === 0 ? <EmptyState label="필터 조건에 맞는 계정이 없습니다." /> : filteredAccounts.map((account) => <button className="account-result" onClick={() => void open(account.accountId)} key={account.accountId} disabled={pending}><div><strong>{account.nickname}</strong><span>{account.email ?? "이메일 마스킹"}</span><small className="mono">{account.accountId}</small></div><div><strong>Lv. {account.level}</strong><span>{number(account.rice)} 쌀</span></div><i>›</i></button>)}</article>}</div>;
}


function AccountDetailView({ detail, management, onManagement, close }: { detail: AdminAccountDetail; management: AdminUserState; onManagement: (state: AdminUserState) => void; close: () => void }) {
  const account = detail.account;
  return <div className="account-detail"><button className="secondary" onClick={close}>← 사용자 목록</button><section className="account-hero"><div><span className="eyebrow">ACCOUNT MANAGEMENT</span><h2>{account.nickname}</h2><p>{account.email ?? "이메일 열람 권한 없음"}</p><small className="mono">{account.accountId}</small></div><div className="account-badges">{management.gameMaster && <span className="badge success">GM</span>}{management.chatTitle && <span className="badge success" style={management.chatTitleColor ? { backgroundColor: management.chatTitleColor, color: readableTextColor(management.chatTitleColor) } : undefined}>{management.chatTitle}</span>}<span className={account.activeGameSession ? "badge success" : "badge"}>GAME {account.activeGameSession ? "ACTIVE" : "INACTIVE"}</span><span className={account.activeBattleSession ? "badge success" : "badge"}>BATTLE {account.activeBattleSession ? "ACTIVE" : "INACTIVE"}</span></div></section><section className="metric-grid compact"><Metric label="레벨" value={management.level} meta={`누적 EXP ${number(management.experience)}`} tone="blue" /><Metric label="쌀" value={management.rice} tone="amber" /><Metric label="해금 스테이지" value={Number(management.highestUnlockedStageId?.slice(-2) ?? 1)} meta={management.highestUnlockedStageId ?? "stage.01-01"} tone="mint" /><Metric label="상태 버전" value={management.stateVersion} tone="violet" /></section><UserManagementControls api={api} management={management} onManagement={onManagement} /><section className="management-grid"><ManagementTable title="아이템" rows={management.items.map((entry) => [entry.displayName, entry.itemId, `${number(entry.quantity)}개${entry.reservedQuantity ? ` · 예약 ${number(entry.reservedQuantity)}` : ""}`])} /><ManagementTable title="치장" rows={management.cosmetics.map((entry) => [entry.displayName ?? entry.cosmeticId, `${entry.grade} · ${entry.slot}`, `등록 ${entry.registeredQuantity} · 미등록 ${entry.unregisteredQuantity} · ${entry.star}성`])} /><ManagementTable title="장비" rows={management.equipment.map((entry) => [entry.slot, entry.grade, `+${entry.enhancementLevel}`])} /></section><section className="timeline-grid"><Timeline title="명령 이력" rows={detail.commands.map((command) => ({ id: command.commandId, title: command.status, meta: formatDate(command.expiresAt) }))} empty="명령 기록이 없습니다." /><Timeline title="지갑 원장" rows={detail.walletLedger.map((entry) => ({ id: entry.ledgerId, title: `${entry.delta > 0 ? "+" : ""}${number(entry.delta)} 쌀`, meta: `${entry.sourceType} · 잔액 ${number(entry.balanceAfter)}` }))} empty="지갑 원장이 없습니다." /><Timeline title="최근 전투" rows={detail.battles.map((battle) => ({ id: battle.battleSessionId, title: `${battle.stageId} · ${battle.status}`, meta: formatDate(battle.startedAt) }))} empty="전투 기록이 없습니다." /></section></div>;
}


function ManagementTable({ title, rows }: { title: string; rows: string[][] }) {
  return <article className="panel management-table"><PanelTitle title={title} subtitle={`${rows.length}개 상태`} />{rows.length ? rows.map((row, index) => <div className="management-row" key={`${row[1]}-${index}`}><strong>{row[0]}</strong><small>{row[1]}</small><span>{row[2]}</span></div>) : <EmptyState label={`${title} 상태가 없습니다.`} />}</article>;
}

function OutboxView() {
  const [status, setStatus] = useState("");
  const [state, setState] = useState<LoadState<AdminOutboxEvent[]>>(loading());
  const load = useCallback(() => { setState((current) => loading(current.data)); api.outbox(status || undefined, 100).then((data) => setState({ status: "ready", data, error: null })).catch((error) => setState({ status: "error", data: null, error: adminErrorMessage(error) })); }, [status]);
  useEffect(() => { load(); }, [status]);
  const retry = async (eventId: string) => { try { await api.retryOutbox(eventId); load(); } catch (failure) { setState((current) => ({ ...current, error: adminErrorMessage(failure) })); } };
  return <div className="content"><section className="overview-head"><div><p>전달 상태와 재시도 횟수를 조회합니다. 실패 이벤트는 권한이 있는 운영자만 재처리할 수 있습니다.</p><span>FAILED 이벤트를 PENDING으로 돌려 Kafka publisher가 다시 처리합니다.</span></div><div className="outbox-filter"><select aria-label="Outbox 상태" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">전체</option><option value="FAILED">실패</option><option value="PENDING">대기</option><option value="SENT">전달 완료</option></select><button className="secondary" onClick={load}>↻ 새로고침</button></div></section>{state.error && <div className="alert error" role="alert">{state.error}</div>}<article className="panel table-panel">{!state.data?.length ? <EmptyState label={state.status === "loading" ? "Outbox 이벤트를 불러오는 중입니다." : "선택한 상태의 이벤트가 없습니다."} /> : <div className="table-wrap"><table><thead><tr><th>상태</th><th>이벤트</th><th>시도</th><th>생성 시각</th><th>조치</th></tr></thead><tbody>{state.data.map((event) => <tr key={event.eventId}><td><span className={`badge ${event.status === "FAILED" ? "danger" : event.status === "PENDING" ? "pending" : "success"}`}>{event.status}</span></td><td><strong>{event.eventType}</strong><small className="mono">{event.eventId}</small></td><td>{number(event.attemptCount)}</td><td>{formatDate(event.createdAt)}</td><td>{event.status === "FAILED" ? <button className="secondary" onClick={() => void retry(event.eventId)}>재처리</button> : "—"}</td></tr>)}</tbody></table></div>}</article></div>;
}

function EconomyView() {
  const range = defaultEconomyRange(new Date()); const [from, setFrom] = useState(range.from); const [to, setTo] = useState(range.to); const [state, setState] = useState<LoadState<EconomyDailyMetric[]>>(loading());
  const load = useCallback(() => { setState((current) => loading(current.data)); api.economyDaily(from, to).then((data) => setState({ status: "ready", data, error: null })).catch((error) => setState({ status: "error", data: null, error: adminErrorMessage(error) })); }, [from, to]);
  useEffect(() => { load(); }, []);
  const totals = (state.data ?? []).reduce((sum, item) => ({ tradeAmount: sum.tradeAmount + item.tradeAmount, traded: sum.traded + item.tradedQuantity, generated: sum.generated + item.riceGenerated, consumed: sum.consumed + item.riceConsumed }), { tradeAmount: 0, traded: 0, generated: 0, consumed: 0 });
  return <div className="content"><section className="overview-head"><div><p>일별 파생 지표입니다. 서버 권한 원본 상태가 아니며 마지막 집계 결과를 표시합니다.</p></div><form className="date-filter" onSubmit={(event) => { event.preventDefault(); load(); }}><label>시작<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>종료<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><button className="secondary">조회</button></form></section>{state.error && <div className="alert error" role="alert">{state.error}</div>}<section className="metric-grid compact"><Metric label="거래 금액" value={totals.tradeAmount} suffix=" 쌀" tone="blue" /><Metric label="체결 수량" value={totals.traded} tone="mint" /><Metric label="쌀 생성" value={totals.generated} tone="amber" /><Metric label="쌀 소각" value={totals.consumed} tone="violet" /></section><article className="panel table-panel"><PanelTitle title="아이템별 일별 지표" subtitle={`${from} — ${to}`} />{!state.data?.length ? <EmptyState label={state.status === "loading" ? "경제 지표를 불러오는 중입니다." : "선택한 기간에 집계된 지표가 없습니다."} /> : <div className="table-wrap"><table><thead><tr><th>일자</th><th>아이템</th><th>세대</th><th>등록</th><th>체결</th><th>거래 금액</th><th>공급</th><th>소비</th></tr></thead><tbody>{state.data.map((row) => <tr key={`${row.metricDate}-${row.itemId}`}><td>{row.metricDate}</td><td><strong>{row.itemId}</strong><small>{row.itemFamily}</small></td><td>{row.generation ? `M${row.generation}` : "—"}</td><td>{number(row.listedQuantity)}</td><td>{number(row.tradedQuantity)}</td><td>{number(row.tradeAmount)}</td><td>{number(row.droppedQuantity)}</td><td>{number(row.consumedQuantity)}</td></tr>)}</tbody></table></div>}</article></div>;
}

function AuditView() {
  const [state, setState] = useState<LoadState<AdminAuditEvent[]>>(loading());
  const [mutationsOnly, setMutationsOnly] = useState(true);
  const [operatorId, setOperatorId] = useState("");
  const [action, setAction] = useState("");
  const load = useCallback(() => { setState((current) => loading(current.data)); api.audit(200, { operatorId: operatorId.trim() || undefined, action: action.trim() || undefined, mutationsOnly }).then((data) => setState({ status: "ready", data, error: null })).catch((error) => setState({ status: "error", data: null, error: adminErrorMessage(error) })); }, [operatorId, action, mutationsOnly]);
  useEffect(() => { void load(); }, [mutationsOnly]);
  if (!state.data && state.status === "loading") return <LoadingState label="감사 기록을 불러오고 있습니다." />;
  if (!state.data) return <ErrorState message={state.error ?? "감사 기록을 불러오지 못했습니다."} retry={load} />;
  return <div className="content"><section className="overview-head"><div><p>관리자별 조회·변경·거절 결과와 변경 전후 상태를 append-only 기록에서 확인합니다.</p><span>최근 {state.data.length}건</span></div><form className="audit-filter" onSubmit={(event) => { event.preventDefault(); void load(); }}><input aria-label="관리자 ID" placeholder="관리자 UUID" value={operatorId} onChange={(event) => setOperatorId(event.target.value)} /><input aria-label="행동 필터" placeholder="ADJUST_USER_RICE" value={action} onChange={(event) => setAction(event.target.value)} /><label><input type="checkbox" checked={mutationsOnly} onChange={(event) => setMutationsOnly(event.target.checked)} />조작만</label><button className="secondary">조회</button></form></section><article className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>시각</th><th>운영자</th><th>행동</th><th>대상</th><th>사유</th><th>전후 상태</th><th>결과</th><th>Request ID</th></tr></thead><tbody>{state.data.map((event) => <tr key={event.auditId}><td>{formatDate(event.occurredAt)}</td><td><strong>{event.username}</strong><small className="mono">{event.operatorId ?? "anonymous"}</small></td><td>{event.action}<small>{event.mutation ? "MUTATION" : "READ"}</small></td><td>{event.targetType}<small>{event.targetId ?? "—"}</small></td><td>{event.reason ?? "—"}</td><td className="audit-summary"><details><summary>상세</summary><strong>BEFORE</strong><code>{event.beforeSummary ?? "—"}</code><strong>AFTER</strong><code>{event.afterSummary ?? "—"}</code></details></td><td><span className={`badge ${event.outcome === "SUCCEEDED" ? "success" : "danger"}`}>{event.outcome}</span><small>{event.idempotencyKey ?? "—"}</small></td><td className="mono">{event.requestId}</td></tr>)}</tbody></table></div></article></div>;
}

function Brand() { return <div className="brand"><span className="brand-mark">한</span><div><strong>한짝 운영</strong><small>ADMIN CONSOLE</small></div></div>; }
function NavButton({ active, icon, disabled, onClick, children }: { active: boolean; icon: string; disabled?: boolean; onClick: () => void; children: string }) { return <button className={active ? "nav-item active" : "nav-item"} disabled={disabled} onClick={onClick}><span>{icon}</span>{children}</button>; }
function Metric({ label, value, meta, suffix = "", tone }: { label: string; value: number; meta?: string; suffix?: string; tone: string }) { return <article className={`metric ${tone}`}><span>{label}</span><strong>{number(value)}{suffix}</strong>{meta && <small>{meta}</small>}</article>; }
function PanelTitle({ title, subtitle }: { title: string; subtitle: string }) { return <header className="panel-title"><div><h2>{title}</h2><p>{subtitle}</p></div></header>; }
function Queue({ label, value, critical = false }: { label: string; value: number; critical?: boolean }) { return <div><span className={critical && value ? "queue-dot critical" : "queue-dot"} /><strong>{label}</strong><b>{number(value)}</b></div>; }
function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) { return <div><dt>{label}</dt><dd className={mono ? "mono" : undefined}>{value}</dd></div>; }
function Timeline({ title, rows, empty }: { title: string; rows: { id: string; title: string; meta: string }[]; empty: string }) { return <article className="panel timeline"><PanelTitle title={title} subtitle={`최근 ${rows.length}건`} />{rows.length ? rows.map((row) => <div className="timeline-row" key={row.id}><span /><div><strong>{row.title}</strong><small>{row.meta}</small><code>{row.id}</code></div></div>) : <EmptyState label={empty} />}</article>; }
function LoadingState({ label }: { label: string }) { return <section className="state"><div className="loader" /><p>{label}</p></section>; }
function ErrorState({ message, retry }: { message: string; retry: () => void }) { return <section className="state error"><strong>조회 실패</strong><p>{message}</p><button className="secondary" onClick={retry}>다시 시도</button></section>; }
function EmptyState({ label }: { label: string }) { return <div className="empty"><span>⌁</span><p>{label}</p></div>; }
function number(value: number) { return value.toLocaleString("ko-KR"); }
function formatDate(value: string) { return new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value)); }

createRoot(document.getElementById("root")!).render(<App />);
