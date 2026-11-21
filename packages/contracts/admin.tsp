using TypeSpec.Http;

namespace Hanjjak;

union AdminRole {
  VIEWER: "VIEWER",
  CS_OPERATOR: "CS_OPERATOR",
  GAME_OPERATOR: "GAME_OPERATOR",
  ENGINEER: "ENGINEER",
  ADMIN: "ADMIN",
}

model AdminIdentity {
  operatorId: Uuid;
  username: string;
  displayName: string;
  roles: AdminRole[];
  permissions: string[];
}

model AdminSessionState {
  authenticated: boolean;
  operator: AdminIdentity | null;
}

model AdminAuthorization {
  authorizationUrl: url;
}
model AdminGameSessionState { administrator: boolean; }


model AdminOAuthRedirect {
  @statusCode statusCode: 302;
  @header location: url;
}

model AdminServiceHealth {
  status: string;
  checkedAt: Instant;
}

model AdminDeploymentInfo {
  application: string;
  commitSha: string;
  contentVersion: string;
  contentAuthority: string;
}

model AdminDashboardCounts {
  totalAccounts: int64;
  activeAccountSessions: int64;
  activeGameSessions: int64;
  activeBattleSessions: int64;
  processingCommands: int64;
  pendingOutboxEvents: int64;
  failedOutboxEvents: int64;
  oldestPendingOutboxAt: Instant | null;
  activeMarketOrders: int64;
  unclaimedMails: int64;
}

model AdminDashboard {
  service: AdminServiceHealth;
  deployment: AdminDeploymentInfo;
  counts: AdminDashboardCounts;
}
union EventLifecyclePhase {
  DISABLED: "DISABLED",
  PRE_START: "PRE_START",
  RUNNING: "RUNNING",
  DAILY_RESTRICTED: "DAILY_RESTRICTED",
  ENDED_NOTICE: "ENDED_NOTICE",
  POST_NOTICE: "POST_NOTICE",
}
model EventLifecycleState {
  serviceId: string;
  enabled: boolean;
  phase: EventLifecyclePhase;
  startsAt: Instant | null;
  endsAt: Instant | null;
  noticeEndsAt: Instant | null;
  dailyRestrictionEnabled: boolean;
  dailyRestrictionStartsAt: string | null;
  dailyRestrictionEndsAt: string | null;
  dailyRestrictionTimeZone: string;
  dailyRestrictionEndsOnNextDay: boolean;
  nextDailyRestrictionTransitionAt: Instant | null;
  version: int64;
  serverTime: Instant;
  mainServerUrl: url;
  updatedAt: Instant | null;
  updatedByUsername: string | null;
}
model EventLifecycleUpdate {
  startsAt: Instant | null;
  endsAt: Instant | null;
  dailyRestrictionEnabled: boolean;
  dailyRestrictionStartsAt: string | null;
  dailyRestrictionEndsAt: string | null;
  expectedVersion: int64;
  reason: string;
}
model EventLifecycleUpdateResult {
  before: EventLifecycleState;
  after: EventLifecycleState;
  replayed: boolean;
}

model AdminAccountSummary {
  accountId: Uuid;
  characterId: Uuid;
  email: string | null;
  nickname: string;
  stateVersion: int64;
  createdAt: Instant;
  level: int32;
  experience: int64;
  rice: int64;
  primaryMaterialType: string | null;
  currentStageId: string | null;
  repeatStageId: string | null;
  highestClearedStageId: string | null;
  inventoryStackCount: int64;
  inventoryQuantity: int64;
  equipmentSlotCount: int64;
  skillCount: int64;
  gemCount: int64;
  cosmeticCount: int64;
  activeGameSession: boolean;
  activeBattleSession: boolean;
  activeMarketOrderCount: int64;
  unclaimedMailCount: int64;
}

model AdminCommandSummary { commandId: Uuid; status: string; expiresAt: Instant; }
model AdminWalletLedgerSummary { ledgerId: Uuid; delta: int64; balanceAfter: int64; sourceType: string; sourceId: Uuid; createdAt: Instant; }
model AdminBattleSessionSummary { battleSessionId: Uuid; status: string; stageId: string; contentVersion: string; startedAt: Instant; closedAt: Instant | null; }
model AdminAccountDetail { account: AdminAccountSummary; commands: AdminCommandSummary[]; walletLedger: AdminWalletLedgerSummary[]; battles: AdminBattleSessionSummary[]; }

union AdminNumericMode { SET: "SET", ADD: "ADD" }
union AdminEquipmentSlot { WEAPON: "WEAPON", GLOVES: "GLOVES", ARMOR: "ARMOR", HELMET: "HELMET", CAPE: "CAPE", SHOES: "SHOES" }
union AdminEquipmentGrade { NORMAL: "NORMAL", RARE: "RARE", EPIC: "EPIC", LEGENDARY: "LEGENDARY", MYTHIC: "MYTHIC" }
union AdminGemOption { FLAT_ATTACK: "FLAT_ATTACK", FLAT_HP: "FLAT_HP", ATTACK_PERCENT: "ATTACK_PERCENT", FLAT_PENETRATION: "FLAT_PENETRATION", CRITICAL_CHANCE: "CRITICAL_CHANCE", HASTE: "HASTE" }

model AdminInventoryItemState { itemId: string; displayName: string; category: string; quantity: int64; reservedQuantity: int64; stackable: boolean; }
model AdminCosmeticState { cosmeticId: string; displayName: string | null; grade: string; slot: string; registeredQuantity: int32; unregisteredQuantity: int32; reservedQuantity: int32; star: int32; }
model AdminEquipmentState { slot: string; grade: string; enhancementLevel: int32; }
model AdminCatalogItem { itemId: string; displayName: string; category: string; stackable: boolean; tradeable: boolean; }
model AdminCatalogCosmetic { cosmeticId: string; displayName: string; grade: string; slot: string; }
model AdminCatalogStage { stageId: string; displayName: string; }
model AdminCatalog { items: AdminCatalogItem[]; cosmetics: AdminCatalogCosmetic[]; stages: AdminCatalogStage[]; }

model AdminUserState {
  accountId: Uuid;
  stateVersion: int64;
  level: int32;
  experience: int64;
  rice: int64;
  currentStageId: string | null;
  highestUnlockedStageId: string | null;
  items: AdminInventoryItemState[];
  cosmetics: AdminCosmeticState[];
  equipment: AdminEquipmentState[];
  gameMaster: boolean;
  chatTitle: string | null;
  chatTitleColor: string | null;
}
model AdminUserMutationResult { before: AdminUserState; after: AdminUserState; replayed: boolean; }
model AdminProgressionRequest { level?: int32; experience?: int64; reason: string; }
model AdminRiceRequest { mode: AdminNumericMode; amount: int64; reason: string; }
model AdminItemRequest { itemId: string; mode: AdminNumericMode; quantity: int64; reason: string; }
model AdminGemRequest { level: int32; option: AdminGemOption; delta: int32; reason: string; }
model AdminStageUnlockRequest { throughStageId: string; reason: string; }
model AdminCosmeticRequest { cosmeticId: string; registeredQuantity: int32; unregisteredQuantity: int32; reason: string; }
model AdminEquipmentRequest { slot: AdminEquipmentSlot; grade?: AdminEquipmentGrade; enhancementLevel?: int32; reason: string; }
model AdminGameMasterRequest { gameMaster: boolean; reason: string; }
model AdminChatTitleRequest { title: string | null; color: string | null; reason: string; }
model AdminCosmeticShowcaseOption { setId: string; displayName: string; imageUrl: string; }
model AdminCosmeticShowcaseConfig {
  options: AdminCosmeticShowcaseOption[];
  selectedSetIds: string[];
  version: int64;
  updatedAt: Instant;
}
model AdminCosmeticShowcaseUpdate {
  selectedSetIds: string[];
  expectedVersion: int64;
  reason: string;
}
model AdminCosmeticShowcaseUpdateResult {
  before: AdminCosmeticShowcaseConfig;
  after: AdminCosmeticShowcaseConfig;
  replayed: boolean;
}

model AdminChatSettings { enabled: boolean; version: int64; updatedAt: Instant; }
model AdminChatSettingsUpdate { enabled: boolean; expectedVersion: int64; reason: string; }
model AdminChatSettingsUpdateResult { before: AdminChatSettings; after: AdminChatSettings; replayed: boolean; }

model AdminOutboxEventSummary {
  eventId: Uuid;
  eventType: string;
  aggregateId: Uuid;
  status: string;
  attemptCount: int32;
  nextRetryAt: Instant | null;
  createdAt: Instant;
  ageSeconds: int64;
}

model AdminAuditEvent {
  auditId: Uuid;
  occurredAt: Instant;
  operatorId: Uuid | null;
  username: string;
  action: string;
  targetType: string;
  targetId: string | null;
  outcome: string;
  requestId: Uuid;
  remoteAddress: string;
  mutation: boolean;
  reason: string | null;
  beforeSummary: string | null;
  afterSummary: string | null;
  idempotencyKey: Uuid | null;
}

model AdminMarketOrderSummary {
  orderId: Uuid;
  accountId: Uuid;
  instrumentId: Uuid;
  itemId: string;
  displayName: string;
  side: "BUY" | "SELL";
  initialQuantity: int64;
  remainingQuantity: int64;
  limitUnitPrice: int64;
  status: string;
  createdAt: Instant;
  updatedAt: Instant;
  expiresAt: Instant | null;
  systemOrder: boolean;
}

model AdminMarketOrderPage { items: AdminMarketOrderSummary[]; nextCursor: string | null; }
model AdminMarketCancelRequest { reason: string; }
model AdminMarketCancelResult { orderId: Uuid; itemId: string; cancelledQuantity: int64; status: string; marketRevision: int64; }
model AdminMarketPurchaseRequest { quantity?: int64; reason: string; }
model AdminMarketPurchaseResult { tradeId: Uuid; orderId: Uuid; itemId: string; quantity: int64; unitPrice: int64; totalPrice: int64; fee: int64; settlementAmount: int64; remainingOrderQuantity: int64; orderStatus: string; marketRevision: int64; }
model AdminMarketSellRequest { itemId: string; quantity: int64; unitPrice: int64; reason: string; }
model AdminMarketSellResult { itemId: string; totalQuantity: int64; unitPrice: int64; orderIds: Uuid[]; marketRevision: int64; }

@route("/api/admin/v1/auth")
interface AdminAuthentication {
  @post @route("/gitlab/begin") beginGitlab(): SuccessEnvelope<AdminAuthorization> | ErrorEnvelope;
  @get @route("/gitlab/callback") gitlabCallback(@query code?: string, @query state?: string, @query error?: string): AdminOAuthRedirect;
  @post @route("/game/gitlab/begin") beginGameGitlab(): SuccessEnvelope<AdminAuthorization> | ErrorEnvelope;
  @get @route("/game/gitlab/callback") gameGitlabCallback(@query code?: string, @query state?: string, @query error?: string): AdminOAuthRedirect;
  @get @route("/game/session") gameSession(): SuccessEnvelope<AdminGameSessionState> | ErrorEnvelope;
  @get @route("/session") session(): SuccessEnvelope<AdminSessionState> | ErrorEnvelope;
  @post @route("/logout") logout(): SuccessEnvelope<AdminSessionState> | ErrorEnvelope;
}

@route("/api/admin/v1")
interface AdminOperations {
  @get @route("/dashboard") dashboard(): SuccessEnvelope<AdminDashboard> | ErrorEnvelope;
  @get @route("/catalog") catalog(): SuccessEnvelope<AdminCatalog> | ErrorEnvelope;
  @get @route("/accounts") searchAccounts(@query query?: string): SuccessEnvelope<AdminAccountSummary[]> | ErrorEnvelope;
  @get @route("/accounts/{accountId}") accountDetail(@path accountId: Uuid): SuccessEnvelope<AdminAccountDetail> | ErrorEnvelope;
  @get @route("/outbox") outbox(@query status: string, @query limit: int32): SuccessEnvelope<AdminOutboxEventSummary[]> | ErrorEnvelope;
  @get @route("/metrics/economy/daily") economyDaily(@query from: string, @query to: string): SuccessEnvelope<EconomyDailyMetric[]> | ErrorEnvelope;
  @get @route("/audit") audit(@query limit: int32, @query operatorId?: Uuid, @query action?: string, @query mutationsOnly?: boolean): SuccessEnvelope<AdminAuditEvent[]> | ErrorEnvelope;
  @get @route("/market/orders") marketOrders(@query query?: string, @query cursor?: string): SuccessEnvelope<AdminMarketOrderPage> | ErrorEnvelope;
  @post @route("/market/orders/{orderId}/cancel") cancelMarketOrder(@path orderId: Uuid, @header idempotencyKey: Uuid, @body request: AdminMarketCancelRequest): SuccessEnvelope<AdminMarketCancelResult> | ErrorEnvelope;
  @post @route("/market/orders/{orderId}/purchase") purchaseMarketOrder(@path orderId: Uuid, @header idempotencyKey: Uuid, @body request: AdminMarketPurchaseRequest): SuccessEnvelope<AdminMarketPurchaseResult> | ErrorEnvelope;
  @post @route("/market/system-orders") createSystemMarketOrder(@header idempotencyKey: Uuid, @body request: AdminMarketSellRequest): SuccessEnvelope<AdminMarketSellResult> | ErrorEnvelope;
  @get @route("/cosmetics/showcase") cosmeticShowcase(): SuccessEnvelope<AdminCosmeticShowcaseConfig> | ErrorEnvelope;
  @post @route("/cosmetics/showcase") updateCosmeticShowcase(@header("Idempotency-Key") key: Uuid, @body request: AdminCosmeticShowcaseUpdate): SuccessEnvelope<AdminCosmeticShowcaseUpdateResult> | ErrorEnvelope;
  @get @route("/chat/settings") chatSettings(): SuccessEnvelope<AdminChatSettings> | ErrorEnvelope;
  @put @route("/chat/settings") updateChatSettings(@header("Idempotency-Key") key: Uuid, @body request: AdminChatSettingsUpdate): SuccessEnvelope<AdminChatSettingsUpdateResult> | ErrorEnvelope;
  @get @route("/event-lifecycle") eventLifecycle(): SuccessEnvelope<EventLifecycleState> | ErrorEnvelope;
  @put @route("/event-lifecycle") updateEventLifecycle(@header("Idempotency-Key") key: Uuid, @body request: EventLifecycleUpdate): SuccessEnvelope<EventLifecycleUpdateResult> | ErrorEnvelope;
}

@route("/api/admin/v1/accounts/{accountId}/management")
interface AdminUserManagement {
  @get state(@path accountId: Uuid): SuccessEnvelope<AdminUserState> | ErrorEnvelope;
  @post @route("/progression") progression(@path accountId: Uuid, @header("Idempotency-Key") key: Uuid, @body request: AdminProgressionRequest): SuccessEnvelope<AdminUserMutationResult> | ErrorEnvelope;
  @post @route("/rice") rice(@path accountId: Uuid, @header("Idempotency-Key") key: Uuid, @body request: AdminRiceRequest): SuccessEnvelope<AdminUserMutationResult> | ErrorEnvelope;
  @post @route("/items") item(@path accountId: Uuid, @header("Idempotency-Key") key: Uuid, @body request: AdminItemRequest): SuccessEnvelope<AdminUserMutationResult> | ErrorEnvelope;
  @post @route("/gems") gem(@path accountId: Uuid, @header("Idempotency-Key") key: Uuid, @body request: AdminGemRequest): SuccessEnvelope<AdminUserMutationResult> | ErrorEnvelope;
  @post @route("/stages") stage(@path accountId: Uuid, @header("Idempotency-Key") key: Uuid, @body request: AdminStageUnlockRequest): SuccessEnvelope<AdminUserMutationResult> | ErrorEnvelope;
  @post @route("/cosmetics") cosmetic(@path accountId: Uuid, @header("Idempotency-Key") key: Uuid, @body request: AdminCosmeticRequest): SuccessEnvelope<AdminUserMutationResult> | ErrorEnvelope;
  @post @route("/equipment") equipment(@path accountId: Uuid, @header("Idempotency-Key") key: Uuid, @body request: AdminEquipmentRequest): SuccessEnvelope<AdminUserMutationResult> | ErrorEnvelope;
  @post @route("/game-master") gameMaster(@path accountId: Uuid, @header("Idempotency-Key") key: Uuid, @body request: AdminGameMasterRequest): SuccessEnvelope<AdminUserMutationResult> | ErrorEnvelope;
  @post @route("/chat-title") chatTitle(@path accountId: Uuid, @header("Idempotency-Key") key: Uuid, @body request: AdminChatTitleRequest): SuccessEnvelope<AdminUserMutationResult> | ErrorEnvelope;
}

union AdminCosmeticDraftStatus { queued: "queued", running: "running", cancelling: "cancelling", cancelled: "cancelled", completed: "completed", failed: "failed" }
union AdminCosmeticFrameReview { pending: "pending", approved: "approved", rejected: "rejected" }
model AdminCosmeticDraftFrame {
  id: string; slot: string; motion: string; frame: int32; url: string;
  review: AdminCosmeticFrameReview; revision: int32; width: int32; height: int32;
}
model AdminCosmeticDraftSet {
  id: Uuid; name: string; conceptUrl: string; status: AdminCosmeticDraftStatus;
  completedFrames: int32; totalFrames: int32; currentSlot: string | null;
  currentMotion: string | null; error: string | null; frames: AdminCosmeticDraftFrame[];
}
model AdminCosmeticDraftUpload { name: HttpPart<string>; concept: HttpPart<bytes>; }
model AdminCosmeticImage { @header contentType: string; @body image: bytes; }
@route("/api/admin/v1/cosmetics/studio/sets")
interface AdminCosmeticStudio {
  @get list(): SuccessEnvelope<AdminCosmeticDraftSet[]> | ErrorEnvelope;
  @post create(@multipartBody upload: AdminCosmeticDraftUpload): SuccessEnvelope<AdminCosmeticDraftSet> | ErrorEnvelope;
  @get @route("/{id}") detail(@path id: Uuid): SuccessEnvelope<AdminCosmeticDraftSet> | ErrorEnvelope;
  @post @route("/{id}/cancel") cancel(@path id: Uuid): SuccessEnvelope<AdminCosmeticDraftSet> | ErrorEnvelope;
  @get @route("/{id}/concept") concept(@path id: Uuid): AdminCosmeticImage | ErrorEnvelope;
  @get @route("/{id}/frames/{frameId}/image") frameImage(@path id: Uuid, @path frameId: string): AdminCosmeticImage | ErrorEnvelope;
  @post @route("/{id}/frames/{frameId}/review") review(@path id: Uuid, @path frameId: string, @body request: { review: AdminCosmeticFrameReview }): SuccessEnvelope<AdminCosmeticDraftSet> | ErrorEnvelope;
  @post @route("/{id}/frames/{frameId}/regenerate") regenerate(@path id: Uuid, @path frameId: string): SuccessEnvelope<AdminCosmeticDraftSet> | ErrorEnvelope;
}
