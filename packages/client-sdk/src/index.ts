export type ApiClientOptions = { baseUrl?: string; fetch?: typeof globalThis.fetch };

type Envelope<T> = { requestId: string; serverTime: string; stateVersion: number; data: T };
type ErrorEnvelope = { code?: string; messageKey?: string; retryable?: boolean; details?: unknown };

export type AdminIdentity = {
  operatorId: string;
  username: string;
  displayName: string;
  roles: string[];
  permissions: string[];
};

export type AdminSessionState = { authenticated: boolean; operator: AdminIdentity | null };
export type AdminDashboard = {
  service: { status: string; checkedAt: string };
  deployment: { application: string; commitSha: string; contentVersion: string; contentAuthority: string };
  counts: {
    totalAccounts: number;
    activeAccountSessions: number;
    activeGameSessions: number;
    activeBattleSessions: number;
    processingCommands: number;
    pendingOutboxEvents: number;
    failedOutboxEvents: number;
    oldestPendingOutboxAt: string | null;
    activeMarketOrders: number;
    unclaimedMails: number;
  };
};
export type EventLifecyclePhase = "DISABLED" | "PRE_START" | "RUNNING" | "DAILY_RESTRICTED" | "ENDED_NOTICE" | "POST_NOTICE";
export type EventLifecycleState = {
  serviceId: string; enabled: boolean; phase: EventLifecyclePhase;
  startsAt: string | null; endsAt: string | null; noticeEndsAt: string | null;
  dailyRestrictionEnabled: boolean; dailyRestrictionStartsAt: string | null; dailyRestrictionEndsAt: string | null;
  dailyRestrictionTimeZone: string; dailyRestrictionEndsOnNextDay: boolean; nextDailyRestrictionTransitionAt: string | null;
  version: number; serverTime: string; mainServerUrl: string;
  updatedAt: string | null; updatedByUsername: string | null;
};
export type EventLifecycleUpdateResult = { before: EventLifecycleState; after: EventLifecycleState; replayed: boolean };

export type AdminAccountSummary = {
  accountId: string;
  characterId: string;
  email: string | null;
  nickname: string;
  stateVersion: number;
  createdAt: string;
  level: number;
  experience: number;
  rice: number;
  primaryMaterialType: string | null;
  currentStageId: string | null;
  repeatStageId: string | null;
  highestClearedStageId: string | null;
  inventoryStackCount: number;
  inventoryQuantity: number;
  equipmentSlotCount: number;
  skillCount: number;
  gemCount: number;
  cosmeticCount: number;
  activeGameSession: boolean;
  activeBattleSession: boolean;
  activeMarketOrderCount: number;
  unclaimedMailCount: number;
};
export type AdminCatalog = {
  items: { itemId: string; displayName: string; category: string; stackable: boolean; tradeable: boolean }[];
  cosmetics: { cosmeticId: string; displayName: string; grade: string; slot: string }[];
  stages: { stageId: string; displayName: string }[];
};

export type AdminAccountDetail = {
  account: AdminAccountSummary;
  commands: { commandId: string; status: string; expiresAt: string }[];
  walletLedger: { ledgerId: string; delta: number; balanceAfter: number; sourceType: string; sourceId: string; createdAt: string }[];
  battles: { battleSessionId: string; status: string; stageId: string; contentVersion: string; startedAt: string; closedAt: string | null }[];
};

export type AdminInventoryItemState = { itemId: string; displayName: string; category: string; quantity: number; reservedQuantity: number; stackable: boolean };
export type AdminCosmeticState = { cosmeticId: string; displayName: string | null; grade: string; slot: string; registeredQuantity: number; unregisteredQuantity: number; reservedQuantity: number; star: number };
export type AdminEquipmentState = { slot: string; grade: string; enhancementLevel: number };
export type AdminUserState = {
  accountId: string;
  stateVersion: number;
  level: number;
  experience: number;
  rice: number;
  currentStageId: string | null;
  highestUnlockedStageId: string | null;
  items: AdminInventoryItemState[];
  cosmetics: AdminCosmeticState[];
  equipment: AdminEquipmentState[];
  gameMaster: boolean;
  chatTitle: string | null;
  chatTitleColor: string | null;
};
export type AdminUserMutationResult = { before: AdminUserState; after: AdminUserState; replayed: boolean };

export type AdminOutboxEvent = {
  eventId: string;
  eventType: string;
  aggregateId: string;
  status: "PENDING" | "SENT" | "FAILED";
  attemptCount: number;
  nextRetryAt: string | null;
  createdAt: string;
  ageSeconds: number;
};
export type AdminKafkaOps = {
  outboxClaimed: number;
  outboxSent: number;
  outboxRetry: number;
  outboxFailed: number;
  consumers: { name: string; events: number; duplicates: number; failures: number; batches: number; averageBatchSize: number; processingSeconds: number }[];
};
export type AdminMarketAnomaly = { alertId: string; itemId: string; tradeId: string; alertType: string; unitPrice: number; referencePrice: number; deviationRatio: number; occurredAt: string; createdAt: string };

export type EconomyDailyMetric = {
  metricDate: string;
  itemFamily: string;
  generation: number | null;
  itemId: string;
  listedQuantity: number;
  cancelledQuantity: number;
  tradeCount: number;
  tradedQuantity: number;
  tradeAmount: number;
  feeAmount: number;
  settlementAmount: number;
  droppedQuantity: number;
  consumedQuantity: number;
  riceGenerated: number;
  riceConsumed: number;
};
export type OfflineRewardPending = {
  jobId: string;
  status: "CLAIMABLE";
  stageId: string;
  startedAt: string;
  lastHeartbeatAt: string;
  accrualEndedAt: string | null;
  eligibleSeconds: number;
  offlineSeconds?: number;
  experienceGained: number;
  riceGained: number;
  rewards: { itemId: string; quantity: number }[];
};
export type OfflineRewardClaimed = {
  jobId: string;
  status: "CLAIMED";
  stageId: string;
  eligibleSeconds: number;
  offlineSeconds?: number;
  experienceGained: number;
  riceGained: number;
  rewards: { rewards: { itemId: string; requestedQuantity: number; grantedQuantity: number; discardedQuantity: number; skippedQuantity: number }[]; usedSlots: number; maxSlots: number; isFull: boolean };
  claimedAt: string;
};

export type AdminAuditEvent = {
  auditId: string;
  occurredAt: string;
  operatorId: string | null;
  username: string;
  action: string;
  targetType: string;
  targetId: string | null;
  outcome: "SUCCEEDED" | "FAILED";
  requestId: string;
  remoteAddress: string;
  mutation: boolean;
  reason: string | null;
  beforeSummary: string | null;
  afterSummary: string | null;
  idempotencyKey: string | null;
};
export type AdminQaReport = { reportId: string; reporterAccountId: string; reporterNickname: string | null; description: string; pageUrl: string; userAgent: string; viewportWidth: number; viewportHeight: number; hasImage: boolean; createdAt: string };
export type AdminChatReport = { reportId: string; reporterAccountId: string; targetType: "MESSAGE" | "BOARD_POST"; targetId: string; reason: string; createdAt: string; targetBody: string | null; targetAccountId: string | null; targetNickname: string | null };
export type AdminChatSettings = { enabled: boolean; version: number; updatedAt: string };
export type AdminChatSettingsUpdateResult = { before: AdminChatSettings; after: AdminChatSettings; replayed: boolean };
export type AdminMarketOrder = { orderId: string; accountId: string; instrumentId: string; itemId: string; displayName: string; side: "BUY" | "SELL"; initialQuantity: number; remainingQuantity: number; limitUnitPrice: number; status: string; createdAt: string; updatedAt: string; expiresAt: string | null; systemOrder: boolean };
export type AdminMarketOrderPage = { items: AdminMarketOrder[]; nextCursor: string | null };
export type AdminMarketCancelResult = { orderId: string; itemId: string; cancelledQuantity: number; status: string; marketRevision: number };
export type AdminMarketPurchaseResult = { tradeId: string; orderId: string; itemId: string; quantity: number; unitPrice: number; totalPrice: number; fee: number; settlementAmount: number; remainingOrderQuantity: number; orderStatus: string; marketRevision: number };
export type AdminMarketSellResult = { itemId: string; totalQuantity: number; unitPrice: number; orderIds: string[]; marketRevision: number };
export type AdminMessageRewardKind = "ITEM" | "GEM" | "COSMETIC" | "COSMETIC_CHOICE" | "TICKET";
export type AdminMessageReward = {
  kind: AdminMessageRewardKind;
  quantity: number;
  itemId?: string | null;
  cosmeticId?: string | null;
  cosmeticIds?: string[] | null;
  gemLevel?: number | null;
  gemOption?: string | null;
  displayName?: string | null;
};
export type AdminMessageTargetMode = "ALL" | "ACCOUNT" | "ACCOUNTS";
export type AdminMessageSendResult = { sendId: string; kind: "NOTICE" | "MAIL"; title: string; recipientCount: number; replayed: boolean };
export type AdminMessageHistoryEntry = {
  id: string;
  kind: "NOTICE" | "MAIL";
  title: string;
  body: string | null;
  targetMode: AdminMessageTargetMode;
  targetAccountId: string | null;
  recipientCount: number;
  riceAmount: number;
  rewards: AdminMessageReward[];
  publishedAt: string | null;
  expiresAt: string | null;
  reason: string;
  createdAt: string;
};
export type AdminNoticeDraft = { title: string; body: string; publishedAt?: string | null; expiresAt?: string | null; reason: string };
export type AdminBannerTone = "INFO" | "EVENT" | "WARNING";
export type AdminBannerRaiseResult = { bannerId: string; message: string; tone: AdminBannerTone; publishedAt: string; expiresAt: string; replayed: boolean };
export type AdminBannerRevokeResult = { bannerId: string; revokedAt: string };
export type AdminBannerEntry = {
  bannerId: string;
  message: string;
  tone: AdminBannerTone;
  publishedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  reason: string;
  createdAt: string;
  /** 지금 실제로 사용자 화면에 떠 있는지. 서버가 판단해 내려 준다. */
  live: boolean;
};
export type AdminBannerDraft = { message: string; tone: AdminBannerTone; publishedAt?: string | null; expiresAt: string; reason: string };
export type AdminCosmeticShowcaseOption = { setId: string; displayName: string; imageUrl: string };
export type AdminCosmeticShowcaseConfig = {
  options: AdminCosmeticShowcaseOption[];
  selectedSetIds: string[];
  version: number;
  updatedAt: string;
};
export type AdminCosmeticShowcaseUpdateResult = {
  before: AdminCosmeticShowcaseConfig;
  after: AdminCosmeticShowcaseConfig;
  replayed: boolean;
};

export type AdminMailDraft = {
  targetMode: AdminMessageTargetMode;
  targetAccountId?: string | null;
  targetAccountIds?: string[];
  title: string;
  body: string;
  riceAmount: number;
  rewards: AdminMessageReward[];
  publishedAt?: string | null;
  expiresAt?: string | null;
  reason: string;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(status: number, code: string, retryable: boolean, details?: unknown) {
    super(code);
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

export function createApiClient(options: ApiClientOptions = {}) {
  const request = options.fetch ?? globalThis.fetch;
  const base = (options.baseUrl ?? "").replace(/\/$/, "");

  async function json<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await request(`${base}${path}`, {
      credentials: "include",
      headers: { Accept: "application/json", ...init?.headers },
      ...init,
    });
    const body = await response.json().catch(() => ({})) as Envelope<T> & ErrorEnvelope;
    if (!response.ok) throw new ApiError(response.status, body.code ?? `HTTP_${response.status}`, body.retryable ?? false, body.details);
    return body.data;
  }

  function adminMutation(body: unknown): RequestInit {
    return {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify(body),
    };
  }

  const admin = {
    session: () => json<AdminSessionState>("/api/admin/v1/auth/session"),
    localAvailability: () => json<{ enabled: boolean }>("/api/admin/v1/auth/local/availability"),
    loginLocal: (username: string, password: string) => json<AdminSessionState>("/api/admin/v1/auth/local/login", {
      method: "POST",
      mode: "same-origin",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    }),
    beginGitlab: () => json<{ authorizationUrl: string }>("/api/admin/v1/auth/gitlab/begin", { method: "POST" }),
    beginGameGitlab: () => json<{ authorizationUrl: string }>("/api/admin/v1/auth/game/gitlab/begin", { method: "POST" }),
    gameSession: () => json<{ administrator: boolean }>("/api/admin/v1/auth/game/session"),
    logout: () => json<AdminSessionState>("/api/admin/v1/auth/logout", { method: "POST" }),
    dashboard: () => json<AdminDashboard>("/api/admin/v1/dashboard"),
    catalog: () => json<AdminCatalog>("/api/admin/v1/catalog"),
    searchAccounts: (query?: string) => {
      const normalized = query?.trim();
      return json<AdminAccountSummary[]>(normalized ? `/api/admin/v1/accounts?query=${encodeURIComponent(normalized)}` : "/api/admin/v1/accounts");
    },
    accountDetail: (accountId: string) => json<AdminAccountDetail>(`/api/admin/v1/accounts/${encodeURIComponent(accountId)}`),
    outbox: (status?: string, limit = 50) => {
      const query = new URLSearchParams({ limit: String(Math.max(1, Math.min(100, limit))) });
      if (status) query.set("status", status);
      return json<AdminOutboxEvent[]>(`/api/admin/v1/outbox?${query}`);
    },
    retryOutbox: (eventId: string) => json<void>(`/api/admin/v1/outbox/${encodeURIComponent(eventId)}/retry`, { method: "POST" }),
    kafkaOps: () => json<AdminKafkaOps>("/api/admin/v1/kafka/ops"),
    marketAnomalies: (limit = 50) => json<AdminMarketAnomaly[]>(`/api/admin/v1/market/anomalies?limit=${Math.max(1, Math.min(100, limit))}`),
    economyDaily: (from: string, to: string) => json<EconomyDailyMetric[]>(`/api/admin/v1/metrics/economy/daily?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
    audit: (limit = 100, filters: { operatorId?: string; action?: string; mutationsOnly?: boolean } = {}) => {
      const query = new URLSearchParams({ limit: String(Math.max(1, Math.min(200, limit))) });
      if (filters.operatorId) query.set("operatorId", filters.operatorId);
      if (filters.action) query.set("action", filters.action);
      if (filters.mutationsOnly) query.set("mutationsOnly", "true");
      return json<AdminAuditEvent[]>(`/api/admin/v1/audit?${query}`);
    },
    userManagement: (accountId: string) => json<AdminUserState>(`/api/admin/v1/accounts/${encodeURIComponent(accountId)}/management`),
    adjustUserProgression: (accountId: string, level: number | null, experience: number | null, reason: string) => json<AdminUserMutationResult>(`/api/admin/v1/accounts/${encodeURIComponent(accountId)}/management/progression`, adminMutation({ level, experience, reason })),
    adjustUserRice: (accountId: string, mode: "SET" | "ADD", amount: number, reason: string) => json<AdminUserMutationResult>(`/api/admin/v1/accounts/${encodeURIComponent(accountId)}/management/rice`, adminMutation({ mode, amount, reason })),
    adjustUserItem: (accountId: string, itemId: string, mode: "SET" | "ADD", quantity: number, reason: string) => json<AdminUserMutationResult>(`/api/admin/v1/accounts/${encodeURIComponent(accountId)}/management/items`, adminMutation({ itemId, mode, quantity, reason })),
    adjustUserGem: (accountId: string, level: number, option: string, delta: number, reason: string) => json<AdminUserMutationResult>(`/api/admin/v1/accounts/${encodeURIComponent(accountId)}/management/gems`, adminMutation({ level, option, delta, reason })),
    unlockUserStages: (accountId: string, throughStageId: string, reason: string) => json<AdminUserMutationResult>(`/api/admin/v1/accounts/${encodeURIComponent(accountId)}/management/stages`, adminMutation({ throughStageId, reason })),
    adjustUserCosmetic: (accountId: string, cosmeticId: string, registeredQuantity: number, unregisteredQuantity: number, reason: string) => json<AdminUserMutationResult>(`/api/admin/v1/accounts/${encodeURIComponent(accountId)}/management/cosmetics`, adminMutation({ cosmeticId, registeredQuantity, unregisteredQuantity, reason })),
    adjustUserEquipment: (accountId: string, slot: string, grade: string | null, enhancementLevel: number | null, reason: string) => json<AdminUserMutationResult>(`/api/admin/v1/accounts/${encodeURIComponent(accountId)}/management/equipment`, adminMutation({ slot, grade, enhancementLevel, reason })),
    setUserGameMaster: (accountId: string, gameMaster: boolean, reason: string) => json<AdminUserMutationResult>(`/api/admin/v1/accounts/${encodeURIComponent(accountId)}/management/game-master`, adminMutation({ gameMaster, reason })),
    setUserChatTitle: (accountId: string, title: string | null, color: string | null, reason: string) => json<AdminUserMutationResult>(`/api/admin/v1/accounts/${encodeURIComponent(accountId)}/management/chat-title`, adminMutation({ title, color, reason })),
    messageHistory: (limit = 50) => json<AdminMessageHistoryEntry[]>(`/api/admin/v1/messaging/history?limit=${Math.max(1, Math.min(200, limit))}`),
    sendNotice: (draft: AdminNoticeDraft) => json<AdminMessageSendResult>("/api/admin/v1/messaging/notices", adminMutation(draft)),
    sendMail: (draft: AdminMailDraft) => json<AdminMessageSendResult>("/api/admin/v1/messaging/mails", adminMutation(draft)),
    banners: (limit = 50) => json<AdminBannerEntry[]>(`/api/admin/v1/messaging/banners?limit=${Math.max(1, Math.min(200, limit))}`),
    raiseBanner: (draft: AdminBannerDraft) => json<AdminBannerRaiseResult>("/api/admin/v1/messaging/banners", adminMutation(draft)),
    revokeBanner: (bannerId: string, reason: string) => json<AdminBannerRevokeResult>(`/api/admin/v1/messaging/banners/${encodeURIComponent(bannerId)}/revoke`, adminMutation({ reason })),
    cosmeticShowcase: () => json<AdminCosmeticShowcaseConfig>("/api/admin/v1/cosmetics/showcase"),
    updateCosmeticShowcase: (selectedSetIds: string[], expectedVersion: number, reason: string) =>
      json<AdminCosmeticShowcaseUpdateResult>("/api/admin/v1/cosmetics/showcase", adminMutation({ selectedSetIds, expectedVersion, reason })),
    eventLifecycle: () => json<EventLifecycleState>("/api/admin/v1/event-lifecycle"),
    updateEventLifecycle: (startsAt: string | null, endsAt: string | null, dailyRestrictionEnabled: boolean, dailyRestrictionStartsAt: string | null, dailyRestrictionEndsAt: string | null, expectedVersion: number, reason: string) =>
      json<EventLifecycleUpdateResult>("/api/admin/v1/event-lifecycle", { ...adminMutation({ startsAt, endsAt, dailyRestrictionEnabled, dailyRestrictionStartsAt, dailyRestrictionEndsAt, expectedVersion, reason }), method: "PUT" }),
    qaReports: (limit = 50) => json<AdminQaReport[]>(`/api/admin/v1/qa/reports?limit=${Math.max(1, Math.min(200, limit))}`),
    /* 사진은 화면이 <img src> 로 바로 걸 수 있게 주소만 만들어 준다. */
    qaReportImageUrl: (reportId: string) => `/api/admin/v1/qa/reports/${encodeURIComponent(reportId)}/image`,
    chatSettings: () => json<AdminChatSettings>("/api/admin/v1/chat/settings"),
    updateChatSettings: (enabled: boolean, expectedVersion: number, reason: string) =>
      json<AdminChatSettingsUpdateResult>("/api/admin/v1/chat/settings", { ...adminMutation({ enabled, expectedVersion, reason }), method: "PUT" }),
    chatReports: (limit = 50) => json<AdminChatReport[]>(`/api/admin/v1/chat/reports?limit=${Math.max(1, Math.min(100, limit))}`),
    marketOrders: (query?: string, cursor?: string) => {
      const params = new URLSearchParams();
      if (query) params.set("query", query);
      if (cursor) params.set("cursor", cursor);
      const suffix = params.size ? `?${params}` : "";
      return json<AdminMarketOrderPage>(`/api/admin/v1/market/orders${suffix}`);
    },
    cancelMarketOrder: (orderId: string, reason: string) => json<AdminMarketCancelResult>(`/api/admin/v1/market/orders/${encodeURIComponent(orderId)}/cancel`, adminMutation({ reason })),
    purchaseMarketOrder: (orderId: string, quantity: number | null, reason: string) => json<AdminMarketPurchaseResult>(`/api/admin/v1/market/orders/${encodeURIComponent(orderId)}/purchase`, adminMutation({ quantity, reason })),
    createSystemMarketOrder: (itemId: string, quantity: number, unitPrice: number, reason: string) => json<AdminMarketSellResult>("/api/admin/v1/market/system-orders", adminMutation({ itemId, quantity, unitPrice, reason })),
    deleteChatMessage: (messageId: string) => json<{ targetId: string; status: string }>(`/api/admin/v1/chat/messages/${messageId}/delete`, { method: "POST" }),
    deleteChatBoard: (postId: string) => json<{ targetId: string; status: string }>(`/api/admin/v1/chat/board/${postId}/delete`, { method: "POST" }),
    banChatAccount: (accountId: string, reason?: string) => json<{ targetId: string; status: string }>(`/api/admin/v1/chat/accounts/${accountId}/ban${reason ? `?reason=${encodeURIComponent(reason)}` : ""}`, { method: "POST" }),
    unbanChatAccount: (accountId: string) => json<{ targetId: string; status: string }>(`/api/admin/v1/chat/accounts/${accountId}/ban`, { method: "DELETE" }),
  };

  return {
    session: () => request(`${base}/api/v1/auth/session`, { credentials: "include" }),
    admin,
  };
}
