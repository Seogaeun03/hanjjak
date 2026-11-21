import "@typespec/http";
import "@typespec/openapi3";
import "./cosmetics.tsp";
import "./game-session.tsp";
import "./runtime.tsp";
import "./battle-session.tsp";
import "./character.tsp";
import "./inventory.tsp";
import "./equipment.tsp";
import "./skills.tsp";
import "./gems.tsp";
import "./material-preference.tsp";
import "./events.tsp";
import "./metrics.tsp";
import "./admin.tsp";
import "./ranking.tsp";
import "./first-clear-rewards.tsp";
import "./offline-rewards.tsp";
import "./raid-content.tsp";
import "./raid.tsp";

using TypeSpec.Http;
using TypeSpec.OpenAPI;

@service(#{ title: "Hanjjak Game API" })
@server("/", "Current host")
namespace Hanjjak;

scalar Uuid extends string;
scalar Instant extends utcDateTime;

model SuccessEnvelope<T> {
  requestId: Uuid;
  serverTime: Instant;
  stateVersion: int64;
  data: T;
}

model ErrorDetail { field?: string; code: string; messageKey: string; value?: unknown; }
@error model ErrorEnvelope { requestId: Uuid; serverTime: Instant; code: string; messageKey: string; retryable: boolean; details: ErrorDetail[] | null; }
model CommandResult<T> {
  commandId: Uuid;
  idempotencyKey: Uuid;
  status: string;
  result: T;
}

enum SsafyRegion {
  SEOUL,
  SEOUL_MEISTER,
  DAEJEON,
  GWANGJU,
  GUMI,
  BUSAN_ULSAN_GYEONGNAM,
  UNDETERMINED,
}
enum SsafyAffiliationRegionReason {
  SINGLE_REGION,
  MULTIPLE_REGIONS,
  NO_REGION_GROUP,
  NO_SUPPORTED_GROUP,
}
enum SsafyAffiliationVerificationStatus {
  VERIFIED,
  NO_SUPPORTED_GROUP,
  STALE,
  UNVERIFIED,
}
model SsafyAffiliation {
  currentCohort: int32 | null;
  cohortHistory: int32[];
  multipleCohorts: boolean;
  region: SsafyRegion | null;
  regionReason: SsafyAffiliationRegionReason | null;
  verificationStatus: SsafyAffiliationVerificationStatus;
  lastAttemptedAt: Instant;
  lastVerifiedAt: Instant | null;
}
model AccountIdentity {
  accountId: Uuid;
  characterId: Uuid;
  @format("email") @maxLength(320) email: string;
  @minLength(1) @maxLength(20) nickname: string;
  level: int32;
  experience: int64;
  rice: int64;
  nicknameChangeCost: int64;
  ssafyAffiliation: SsafyAffiliation | null;
}
model Credentials { @format("email") @maxLength(320) email: string; @minLength(8) password: string; }
model SignupCredentials { @format("email") @maxLength(320) email: string; @minLength(8) password: string; @minLength(1) @maxLength(20) nickname: string; }
model NicknameUpdate { @minLength(1) @maxLength(20) nickname: string; }
model NicknameAvailability { available: boolean; }
model PasswordChange {
  @minLength(1) currentPassword: string;
  @minLength(8) newPassword: string;
  @minLength(1) newPasswordConfirmation: string;
}
model SessionState { authenticated: boolean; account: AccountIdentity | null; administrator: boolean; }
model AuthenticationMethods { emailEnabled: boolean; }
model PasswordResetRequest { @format("email") @maxLength(320) email: string; }
model PasswordResetConfirmation { @minLength(1) @maxLength(128) token: string; @minLength(8) password: string; }
model PasswordResetAcknowledgement { accepted: boolean; }
model SocialProviderStatus { id: string; displayName: string; enabled: boolean; }
model SocialAuthorization { authorizationUrl: url; }
model PendingSocialSignup { token: string; provider: string; email: string | null; suggestedNickname: string | null; }
model SocialSignupRequest { token: string; @minLength(1) @maxLength(20) nickname: string; }
model SocialConnection { provider: string; displayName: string; email: string | null; }
model SocialConnections { passwordEnabled: boolean; providers: SocialConnection[]; }

@route("/api/v1/event-lifecycle")
interface EventLifecyclePublic {
  @get state(): SuccessEnvelope<EventLifecycleState> | ErrorEnvelope;
}

@route("/api/v1/auth")
interface Authentication {
  @get @route("/methods") methods(): SuccessEnvelope<AuthenticationMethods> | ErrorEnvelope;
  @post @route("/signup") signup(@header("Idempotency-Key") idempotencyKey: Uuid, @body credentials: SignupCredentials): SuccessEnvelope<AccountIdentity> | ErrorEnvelope;
  @post @route("/login") login(@header("Idempotency-Key") idempotencyKey: Uuid, @body credentials: Credentials): SuccessEnvelope<AccountIdentity> | ErrorEnvelope;
  @post @route("/password-reset/request") requestPasswordReset(@body request: PasswordResetRequest): SuccessEnvelope<PasswordResetAcknowledgement> | ErrorEnvelope;
  @post @route("/password-reset/confirm") confirmPasswordReset(@body request: PasswordResetConfirmation): SuccessEnvelope<PasswordResetAcknowledgement> | ErrorEnvelope;
  @get @route("/session") session(): SuccessEnvelope<SessionState> | ErrorEnvelope;
  @get @route("/nickname-availability") nicknameAvailability(@query nickname: string): SuccessEnvelope<NicknameAvailability> | ErrorEnvelope;
  @post @route("/profile/nickname") updateNickname(@header("Idempotency-Key") idempotencyKey: Uuid, @body request: NicknameUpdate): SuccessEnvelope<AccountIdentity> | ErrorEnvelope;
  @post @route("/profile/password") changePassword(@header("Idempotency-Key") idempotencyKey: Uuid, @body request: PasswordChange): SuccessEnvelope<SessionState> | ErrorEnvelope;
  @post @route("/logout") logout(@header("Idempotency-Key") idempotencyKey: Uuid): SuccessEnvelope<SessionState> | ErrorEnvelope;
}

@route("/api/v1/auth/social")
interface SocialAuthentication {
  @get @route("/providers") providers(): SuccessEnvelope<SocialProviderStatus[]> | ErrorEnvelope;
  @post @route("/{provider}/begin") begin(@path provider: string, @header("Idempotency-Key") idempotencyKey: Uuid): SuccessEnvelope<SocialAuthorization> | ErrorEnvelope;
  @post @route("/{provider}/link/begin") beginLink(@path provider: string, @header("Idempotency-Key") idempotencyKey: Uuid): SuccessEnvelope<SocialAuthorization> | ErrorEnvelope;
  @get @route("/pending") pending(): SuccessEnvelope<PendingSocialSignup> | ErrorEnvelope;
  @post @route("/signup") finishSignup(@header("Idempotency-Key") idempotencyKey: Uuid, @body request: SocialSignupRequest): SuccessEnvelope<AccountIdentity> | ErrorEnvelope;
  @get @route("/connections") connections(): SuccessEnvelope<SocialConnections> | ErrorEnvelope;
  @delete @route("/connections/{provider}") unlink(@path provider: string, @header("Idempotency-Key") idempotencyKey: Uuid): SuccessEnvelope<SocialConnections> | ErrorEnvelope;
}

model StageSummary {
  stageId: string;
  unlocked: boolean;
  clearCount: int64;
  contentVersion: string;
  isCurrent: boolean;
  isRepeatTarget: boolean;
  repeatEligible: boolean;
  bossOnly: boolean;
}
model BattleStartRequest { stageId: string; }
model BattleCycleResult { success: boolean; failureCode: string | null; remainingHp: int32; defeatedNormals: int32; elapsedTicks: int32; }
model RewardLine { itemId: string; requestedQuantity: int64; grantedQuantity: int64; discardedQuantity: int64; skippedQuantity: int64; }
model RewardResult { rewards: RewardLine[]; usedSlots: int32; maxSlots: int32; isFull: boolean; }
model ProgressionRewardResult {
  experienceGained: int64;
  riceGained: int64;
  levelBefore: int32;
  levelAfter: int32;
  experienceBefore: int64;
  experienceAfter: int64;
  experienceToNextLevel: int64;
  riceBalance: int64;
}
model ChapterProgressionSummary {
  experienceGained: int64;
  riceGained: int64;
  levelBefore: int32;
  levelAfter: int32;
  experienceAfter: int64;
  experienceToNextLevel: int64;
  riceBalance: int64;
}
model BattleCycleResponse { battle: BattleCycleResult; reward: RewardResult; progression: ProgressionRewardResult; firstClearReward: FirstClearRewardResult | null; }
model StageRunResponse { stageId: string; battle: BattleCycleResult; reward: RewardResult; progression: ProgressionRewardResult; firstClearReward: FirstClearRewardResult | null; }
model BattleInventorySnapshot { usedSlots: int32; maxSlots: int32; isFull: boolean; }
model ChapterAutoRunResponse {
  chapter: int32;
  runs: StageRunResponse[];
  stoppedReason: string;
  stoppedStageId: string | null;
  rewards: RewardLine[];
  progression: ChapterProgressionSummary | null;
  finalInventory: BattleInventorySnapshot | null;
}

@route("/api/v1/stages")
interface Stages {
  @get list(): SuccessEnvelope<StageSummary[]> | ErrorEnvelope;
}

@route("/api/v1/battles")
interface Battles {
  @post @route("/cycles")
  runCycle(@header("Idempotency-Key") idempotencyKey: Uuid, @header("X-Game-Session-Id") gameSessionId: Uuid, @body request: BattleStartRequest): SuccessEnvelope<BattleCycleResponse> | ErrorEnvelope;

  @post @route("/chapters/{chapter}/auto-run")
  runChapter(@path chapter: int32, @header("Idempotency-Key") idempotencyKey: Uuid, @header("X-Game-Session-Id") gameSessionId: Uuid): SuccessEnvelope<ChapterAutoRunResponse> | ErrorEnvelope;
}

@friendlyName("RepeatStageRequest")
model BattleRepeatStageRequest { stageId: string | null; }
model BattleModeUpdateResult {
  idleMode: "AUTO_PROGRESS" | "REPEAT_STAGE";
  repeatStageId: string | null;
  appliesAfterCurrentCycle: boolean;
  stateVersion: int64;
}

@route("/api/v1/battle")
interface BattleMode {
  @patch @route("/repeat-stage") updateRepeatStage(
    @header("Idempotency-Key") idempotencyKey: Uuid,
    @header("X-Game-Session-Id") gameSessionId: Uuid,
    @body request: BattleRepeatStageRequest
  ): SuccessEnvelope<BattleModeUpdateResult> | ErrorEnvelope;
}

model ArenaOpponent { accountId: Uuid; nickname: string; rating: int32; level: int32; }
model ArenaEvent { eventId: string; logicalTick: int32; type: string; actorId: string | null; targetId: string | null; skillId: string | null; damage: int32 | null; critical: boolean; hpBefore: int32 | null; hpAfter: int32 | null; }
model ArenaResult { winnerId: string | null; loserId: string | null; draw: boolean; elapsedTicks: int32; attackerRemainingHp: int32; defenderRemainingHp: int32; }
model ArenaBattle { battleId: Uuid; opponent: ArenaOpponent; result: ArenaResult; events: ArenaEvent[]; hpMultiplier: int32; }
model ArenaBattleRequest { opponentId: Uuid; }

@route("/api/v1/arena")
interface Arena {
  @get @route("/opponents") opponents(): SuccessEnvelope<ArenaOpponent[]> | ErrorEnvelope;
  @post @route("/battles") battle(@header("Idempotency-Key") idempotencyKey: Uuid, @body request: ArenaBattleRequest): SuccessEnvelope<ArenaBattle> | ErrorEnvelope;
}

model EmptyRequest {}
model CursorPage<T> { items: T[]; nextCursor: string | null; totalItems: int64; }


model ChatMessage {
  messageId: Uuid;
  accountId: Uuid;
  nickname: string;
  primaryMaterialType: "POTATO" | "SWEET_POTATO" | "CORN" | null;
  body: string;
  createdAt: Instant;
  eventId: Uuid;
  gameMaster: boolean;
  chatTitle: string | null;
  chatTitleColor: string | null;
}
model ChatPage { items: ChatMessage[]; nextCursor: string | null; unreadCount: int32; }
model ChatSendRequest { @minLength(1) @maxLength(240) body: string; }
model ChatSendResult { message: ChatMessage; filterStatus: string; }
model ChatReportRequest { reason: string; }
model ChatReportResult { reportId: Uuid; status: string; }
model ChatBlockResult { accountId: Uuid; blocked: boolean; }
model ChatBoardPost {
  postId: Uuid;
  accountId: Uuid;
  nickname: string;
  intent: "SELL" | "BUY";
  itemId: string;
  quantity: int64;
  unitPrice: int64 | null;
  body: string;
  status: string;
  createdAt: Instant;
  expiresAt: Instant;
}
model ChatBoardPage { items: ChatBoardPost[]; nextCursor: string | null; }
model ChatBoardPostRequest { intent: "SELL" | "BUY"; itemId: string; quantity: int64; unitPrice: int64 | null; @maxLength(240) body: string; }
model ChatBoardPostResult { post: ChatBoardPost; filterStatus: string; }
model ChatBoardCloseResult { postId: Uuid; status: string; }

@route("/api/v1/chat")
interface Chat {
  @get @route("/messages") messages(@query cursor?: string): SuccessEnvelope<ChatPage> | ErrorEnvelope;
  @post @route("/messages") sendMessage(@header("Idempotency-Key") idempotencyKey: Uuid, @body request: ChatSendRequest): SuccessEnvelope<CommandResult<ChatSendResult>> | ErrorEnvelope;
  @post @route("/messages/{messageId}/reports") reportMessage(@path messageId: Uuid, @header("Idempotency-Key") idempotencyKey: Uuid, @body request: ChatReportRequest): SuccessEnvelope<CommandResult<ChatReportResult>> | ErrorEnvelope;
  @post @route("/blocks/{accountId}") block(@path accountId: Uuid, @header("Idempotency-Key") idempotencyKey: Uuid, @body request: EmptyRequest): SuccessEnvelope<CommandResult<ChatBlockResult>> | ErrorEnvelope;
  @delete @route("/blocks/{accountId}") unblock(@path accountId: Uuid, @header("Idempotency-Key") idempotencyKey: Uuid): SuccessEnvelope<CommandResult<ChatBlockResult>> | ErrorEnvelope;
  @get @route("/board") board(@query cursor?: string): SuccessEnvelope<ChatBoardPage> | ErrorEnvelope;
  @post @route("/board") createPost(@header("Idempotency-Key") idempotencyKey: Uuid, @body request: ChatBoardPostRequest): SuccessEnvelope<CommandResult<ChatBoardPostResult>> | ErrorEnvelope;
  @post @route("/board/{postId}/close") closePost(@path postId: Uuid, @header("Idempotency-Key") idempotencyKey: Uuid, @body request: EmptyRequest): SuccessEnvelope<CommandResult<ChatBoardCloseResult>> | ErrorEnvelope;
  @post @route("/board/{postId}/reports") reportPost(@path postId: Uuid, @header("Idempotency-Key") idempotencyKey: Uuid, @body request: ChatReportRequest): SuccessEnvelope<CommandResult<ChatReportResult>> | ErrorEnvelope;
}

enum MarketInstrumentStatus { ACTIVE, CANCELLING, INACTIVE }
enum MarketOrderSide { BUY, SELL }
enum MarketTimeInForce { GTC, IOC }
enum MarketOrderStatus { ACTIVE, PARTIALLY_FILLED, PARTIALLY_FILLED_CLOSED, FILLED, CANCELLED, EXPIRED, RECOVERY_REVIEW }
enum MarketOrderScope { ACTIVE, CLOSED, RECOVERY_REVIEW }
enum MarketDeliverySource { BUY_FILL, SELL_CANCEL_RETURN, SELL_EXPIRE_RETURN }
enum MarketUnreadStream { FILLS, DELIVERIES, SETTLEMENTS, EXPIRATIONS }

model MarketInstrumentSummary {
  instrumentId: Uuid;
  canonicalKey: string;
  itemId: string;
  displayName: string;
  category: string;
  attributes: Record<string>;
  status: MarketInstrumentStatus;
  bestBidUnitPrice: int64 | null;
  bestAskUnitPrice: int64 | null;
  lastTradeUnitPrice: int64 | null;
  marketRevision: int64;
}
model MarketDepthLevel { unitPrice: int64; totalQuantity: int64; cumulativeQuantity: int64; myQuantity: int64; }
model MarketPriceLevel { unitPrice: int64; totalQuantity: int64; cumulativeQuantity: int64; myQuantity: int64; cumulativeOtherQuantity: int64; }
model MarketPriceLevels { instrumentId: Uuid; side: MarketOrderSide; marketRevision: int64; items: MarketPriceLevel[]; nextUnitPrice: int64 | null; totalLevels: int64; }
model MarketRecentTrade { tradeId: Uuid; quantity: int64; unitPrice: int64; totalPrice: int64; filledAt: Instant; }
enum MarketCandleInterval { FIVE_MINUTES, FIFTEEN_MINUTES, THIRTY_MINUTES }
model MarketCandle { openedAt: Instant; open: int64; high: int64; low: int64; close: int64; quantity: int64; totalPrice: int64; }
model MarketCandles { instrumentId: Uuid; interval: string; from: Instant; to: Instant; marketRevision: int64; items: MarketCandle[]; }
model MarketOrderBook { instrumentId: Uuid; marketRevision: int64; bids: MarketDepthLevel[]; asks: MarketDepthLevel[]; bestBidUnitPrice: int64 | null; bestAskUnitPrice: int64 | null; spread: int64 | null; recentTrades: MarketRecentTrade[]; }
model MarketOrderQuote {
  instrumentId: Uuid; side: MarketOrderSide; timeInForce: MarketTimeInForce; requestedQuantity: int64; limitUnitPrice: int64;
  expectedFilledQuantity: int64; expectedRemainingQuantity: int64; lowestFilledUnitPrice: int64 | null; highestFilledUnitPrice: int64 | null;
  weightedAverageUnitPrice: float64 | null; totalPrice: int64; expectedFee: int64; expectedSettlementAmount: int64;
  availableRice: int64; availableQuantity: int64; marketRevision: int64;
}
model CreateMarketOrderRequest { instrumentId: Uuid; side: MarketOrderSide; @minValue(1) quantity: int64; @minValue(10) @maxValue(999999) limitUnitPrice: int64; timeInForce: MarketTimeInForce; instanceIds?: Uuid[]; }
model UpdateMarketOrderRequest { @minValue(1) quantity?: int64; @minValue(10) @maxValue(999999) limitUnitPrice?: int64; }
model MarketOrderFill { tradeId: Uuid; makerOrderId: Uuid; takerOrderId: Uuid; quantity: int64; unitPrice: int64; totalPrice: int64; fee: int64; settlementAmount: int64; }
model MarketOrderResult {
  orderId: Uuid; instrumentId: Uuid; side: MarketOrderSide; timeInForce: MarketTimeInForce; initialQuantity: int64; filledQuantity: int64;
  remainingQuantity: int64; limitUnitPrice: int64; reservedRice: int64; status: MarketOrderStatus; priorityAt: Instant; expiresAt: Instant | null;
  totalPrice: int64; lowestFilledUnitPrice: int64 | null; highestFilledUnitPrice: int64 | null; weightedAverageUnitPrice: float64 | null;
  marketRevision: int64; fills: MarketOrderFill[];
}
model MarketOrderSummary {
  orderId: Uuid; instrumentId: Uuid; itemId: string; displayName: string; side: MarketOrderSide; timeInForce: MarketTimeInForce;
  initialQuantity: int64; filledQuantity: int64; remainingQuantity: int64; limitUnitPrice: int64; reservedRice: int64;
  status: MarketOrderStatus; priorityAt: Instant; createdAt: Instant; updatedAt: Instant; expiresAt: Instant | null;
}
model MarketOrderCancelled { orderId: Uuid; instrumentId: Uuid; side: MarketOrderSide; status: MarketOrderStatus; refundedRice: int64; deliveryId: Uuid | null; releasedQuantity: int64; marketRevision: int64; }
model MarketDelivery { deliveryId: Uuid; instrumentId: Uuid; orderId: Uuid; tradeId: Uuid | null; source: MarketDeliverySource; itemId: string; instanceIds: Uuid[]; quantity: int64; displayName: string; createdAt: Instant; claimedAt: Instant | null; sourceAccountId: Uuid | null; }
model MarketDeliveryClaimed { deliveryId: Uuid; itemId: string; quantity: int64; claimedAt: Instant; }
model MarketDeliveryClaimAllResult { claimed: MarketDeliveryClaimed[]; remaining: MarketDelivery[]; usedSlots: int32; maxSlots: int32; }
model MarketUnreadState { stream: MarketUnreadStream; latestSequence: int64; readSequence: int64; unreadCount: int64; }
model MarketSummary { activeOrders: int64; closedOrders: int64; recoveryReviewOrders: int64; claimableDeliveries: int64; claimableSettlements: int64; unread: MarketUnreadState[]; }
model MarketInstrumentRevision { instrumentId: Uuid; marketRevision: int64; }
model MarketChangeState { accountStateVersion: int64; instruments: MarketInstrumentRevision[]; unread: MarketUnreadState[]; }
model AdvanceMarketReadCursorRequest { @minValue(0) readThroughSequence: int64; }
model MarketReadCursorResult { stream: MarketUnreadStream; readSequence: int64; }
model MarketTradeView { tradeId: Uuid; instrumentId: Uuid; itemId: string; displayName: string; side: MarketOrderSide | null; quantity: int64; unitPrice: int64; totalPrice: int64; fee: int64 | null; settlementAmount: int64 | null; filledAt: Instant; }
model MarketPage<T> { items: T[]; nextCursor: string | null; totalItems: int64; readThroughSequence: int64; }

model MailPage {
  items: MailSummary[];
  nextCursor: string | null;
  totalItems: int64;
}

enum MailRewardKind { ITEM, GEM, COSMETIC, COSMETIC_CHOICE, TICKET }

/** NONE 은 받을 것이 없는 안내 우편, PENDING 은 아직 안 받은 보상, CLAIMED 는 받아 간 보상. */
enum MailRewardStatus { NONE, PENDING, CLAIMED }

model MailReward {
  kind: MailRewardKind;
  quantity: int64;
  itemId: string | null;
  cosmeticId: string | null;
  cosmeticIds: string[] | null;
  gemLevel: int32 | null;
  gemOption: string | null;
  displayName: string | null;
  autoRegister: boolean;
}

model MailClaimRequest { cosmeticId: string | null; }

model MailSummary {
  mailId: Uuid;
  type: string;
  riceAmount: int64;
  rewardStatus: MailRewardStatus;
  createdAt: Instant;
  claimedAt: Instant | null;
  title: string | null;
  body: string | null;
  senderName: string | null;
  readAt: Instant | null;
  rewards: MailReward[];
}

model MailClaimResult { mailId: Uuid; riceAmount: int64; claimedAt: Instant; walletBalance: int64; rewards: MailReward[]; }
model MailClaimAllResult { claimedMailIds: Uuid[]; totalRiceAmount: int64; walletBalance: int64; rewards: MailReward[]; }
model MailReadResult { mailId: Uuid; readAt: Instant; }
model MailDeleteResult { mailId: Uuid; deletedAt: Instant; }

model Notice {
  noticeId: Uuid;
  title: string;
  body: string;
  senderName: string;
  publishedAt: Instant;
  expiresAt: Instant | null;
  readAt: Instant | null;
}

model NoticePage { items: Notice[]; unreadCount: int32; }
model NoticeReadResult { noticeId: Uuid; readAt: Instant; }
model NoticeDeleteResult { noticeId: Uuid; deletedAt: Instant; }

/** 화면 맨 위에 한 줄로 걸리는 운영 알림. 공지와 달리 알림 탭에 쌓이지 않는다. */
enum BannerTone { INFO, EVENT, WARNING }

model Banner {
  bannerId: Uuid;
  message: string;
  tone: BannerTone;
  expiresAt: Instant;
}

model BannerPage { items: Banner[]; }
model BannerDismissResult { bannerId: Uuid; dismissedAt: Instant; }

@route("/api/v1/market")
interface Market {
  @get @route("/change-state")
  getChangeState(): SuccessEnvelope<MarketChangeState> | ErrorEnvelope;

  @get @route("/instruments")
  listInstruments(): SuccessEnvelope<MarketInstrumentSummary[]> | ErrorEnvelope;


  @get @route("/instruments/{instrumentId}/price-levels")
  getPriceLevels(@path instrumentId: Uuid, @query side: MarketOrderSide, @query afterUnitPrice?: int64, @query limit?: int32): SuccessEnvelope<MarketPriceLevels> | ErrorEnvelope;
  @get @route("/order-books/{instrumentId}")
  getOrderBook(@path instrumentId: Uuid, @query levels?: int32): SuccessEnvelope<MarketOrderBook> | ErrorEnvelope;
  @get @route("/instruments/{instrumentId}/candles")
  getCandles(@path instrumentId: Uuid, @query interval?: string, @query period?: string): SuccessEnvelope<MarketCandles> | ErrorEnvelope;

  @get @route("/instruments/{instrumentId}/order-quote")
  quoteOrder(@path instrumentId: Uuid, @query side: MarketOrderSide, @query timeInForce: MarketTimeInForce, @query quantity: int64, @query limitUnitPrice: int64): SuccessEnvelope<MarketOrderQuote> | ErrorEnvelope;

  @post @route("/orders")
  createOrder(@header("Idempotency-Key") idempotencyKey: Uuid, @body request: CreateMarketOrderRequest): SuccessEnvelope<CommandResult<MarketOrderResult>> | ErrorEnvelope;

  @get @route("/orders/me")
  listMyOrders(@query scope?: MarketOrderScope, @query side?: MarketOrderSide, @query instrumentId?: Uuid, @query cursor?: string): SuccessEnvelope<MarketPage<MarketOrderSummary>> | ErrorEnvelope;

  @patch @route("/orders/{orderId}")
  updateOrder(@path orderId: Uuid, @header("Idempotency-Key") idempotencyKey: Uuid, @body request: UpdateMarketOrderRequest): SuccessEnvelope<CommandResult<MarketOrderResult>> | ErrorEnvelope;

  @post @route("/orders/{orderId}/cancel")
  cancelOrder(@path orderId: Uuid, @header("Idempotency-Key") idempotencyKey: Uuid, @body request: EmptyRequest): SuccessEnvelope<CommandResult<MarketOrderCancelled>> | ErrorEnvelope;

  @get @route("/deliveries/me")
  listDeliveries(@query claimable?: boolean, @query cursor?: string): SuccessEnvelope<MarketPage<MarketDelivery>> | ErrorEnvelope;

  @post @route("/deliveries/{deliveryId}/claim")
  claimDelivery(@path deliveryId: Uuid, @header("Idempotency-Key") idempotencyKey: Uuid, @body request: EmptyRequest): SuccessEnvelope<CommandResult<MarketDeliveryClaimed>> | ErrorEnvelope;

  @post @route("/deliveries/claim-all")
  claimAllDeliveries(@header("Idempotency-Key") idempotencyKey: Uuid, @body request: EmptyRequest): SuccessEnvelope<CommandResult<MarketDeliveryClaimAllResult>> | ErrorEnvelope;

  @get @route("/summary/me")
  summary(): SuccessEnvelope<MarketSummary> | ErrorEnvelope;

  @post @route("/unread-cursors/{stream}")
  markRead(@path stream: MarketUnreadStream, @header("Idempotency-Key") idempotencyKey: Uuid, @body request: AdvanceMarketReadCursorRequest): SuccessEnvelope<MarketReadCursorResult> | ErrorEnvelope;

  @get @route("/trades/me")
  listMyTrades(@query instrumentId?: Uuid[], @query cursor?: string): SuccessEnvelope<MarketPage<MarketTradeView>> | ErrorEnvelope;

  @get @route("/trades")
  listPublicTrades(@query instrumentId?: Uuid[], @query cursor?: string): SuccessEnvelope<MarketPage<MarketTradeView>> | ErrorEnvelope;
}

@route("/api/v1/mails")
interface Mails {
  @get list(@query claimable?: boolean, @query cursor?: string, @query type?: string): SuccessEnvelope<MailPage> | ErrorEnvelope;
  @post @route("/{mailId}/claim") claim(@path mailId: Uuid, @header("Idempotency-Key") idempotencyKey: Uuid, @body request: MailClaimRequest): SuccessEnvelope<CommandResult<MailClaimResult>> | ErrorEnvelope;
  @post @route("/claim-all") claimAll(@header("Idempotency-Key") idempotencyKey: Uuid, @query type?: string, @body request: EmptyRequest): SuccessEnvelope<CommandResult<MailClaimAllResult>> | ErrorEnvelope;
  @post @route("/{mailId}/read") read(@path mailId: Uuid): SuccessEnvelope<MailReadResult> | ErrorEnvelope;
  @post @route("/{mailId}/delete") remove(@path mailId: Uuid): SuccessEnvelope<MailDeleteResult> | ErrorEnvelope;
}

/**
 * 공지는 계정마다 복제하지 않는다. 노출 기간이 열려 있는 원본을 그대로 보여 주고,
 * 읽음과 삭제만 사람별로 남는다.
 */
@route("/api/v1/notices")
interface Notices {
  @get list(): SuccessEnvelope<NoticePage> | ErrorEnvelope;
  @post @route("/{noticeId}/read") read(@path noticeId: Uuid): SuccessEnvelope<NoticeReadResult> | ErrorEnvelope;
  @post @route("/{noticeId}/delete") remove(@path noticeId: Uuid): SuccessEnvelope<NoticeDeleteResult> | ErrorEnvelope;
}

/**
 * 배너도 계정마다 복제하지 않는다. 노출 기간이 열려 있는 원본을 그대로 보여 주고,
 * 닫음만 사람별로 남는다. 읽음은 세지 않는다 — 배너는 열려 있는 동안 계속 보이는 것이 목적이다.
 */
@route("/api/v1/banners")
interface Banners {
  @get list(): SuccessEnvelope<BannerPage> | ErrorEnvelope;
  @post @route("/{bannerId}/dismiss") dismiss(@path bannerId: Uuid): SuccessEnvelope<BannerDismissResult> | ErrorEnvelope;
}
