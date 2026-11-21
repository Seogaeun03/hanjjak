package com.hanjjak.market.application

import com.hanjjak.market.domain.*
import java.time.Instant
import java.util.UUID

interface OrderBookRepository {
    data class StoredCommand(val commandId: UUID, val fingerprint: String, val resultJson: String)
    data class OrderCursor(val createdAt: Instant, val orderId: UUID)
    data class TradeCursor(val filledAt: Instant, val tradeId: UUID)
    data class MutationWindow(val mutationCount: Int, val activeOrderCount: Int)
    data class TradeInsert(
        val tradeId: UUID,
        val legacyListingId: UUID?,
        val makerOrderId: UUID,
        val takerOrderId: UUID,
        val instrumentId: UUID,
        val buyerAccountId: UUID,
        val sellerAccountId: UUID,
        val itemId: String,
        val displayName: String,
        val quantity: Long,
        val unitPrice: Long,
        val totalPrice: Long,
        val fee: Long,
        val settlementAmount: Long,
        val filledAt: Instant,
    )

    /** 한 주문이 만든 미확인 알림 한 건이다. 묶어서 넣을 때 입력 순서가 곧 stream별 sequence 순서다. */
    data class UnreadAppend(
        val accountId: UUID,
        val stream: MarketUnreadStream,
        val sourceId: UUID,
        val createdAt: Instant,
    )

    fun stateVersion(accountId: UUID): Long
    fun command(accountId: UUID, idempotencyKey: UUID): StoredCommand?
    fun saveCommand(commandId: UUID, accountId: UUID, idempotencyKey: UUID, fingerprint: String, resultJson: String)

    fun synchronizeInstruments(instruments: List<MarketInstrument>, now: Instant)
    fun instruments(accountId: UUID): List<MarketInstrumentSummary>
    fun instrumentRevisions(): List<MarketInstrumentRevision>
    fun instrument(instrumentId: UUID): MarketInstrument?
    fun lockInstrument(instrumentId: UUID): MarketInstrument?
    fun incrementRevision(instrumentId: UUID): Long

    fun lockAccountControl(accountId: UUID, now: Instant): MutationWindow
    fun appendMutation(mutationId: UUID, accountId: UUID, instrumentId: UUID, orderId: UUID, side: MarketOrderSide, type: String, commandId: UUID, createdAt: Instant)

    fun order(orderId: UUID): MarketOrder?
    fun lockOrder(orderId: UUID): MarketOrder?
    fun createOrder(order: MarketOrder)
    fun updateOrder(order: MarketOrder)

    /**
     * 여러 주문을 한 번에 갱신한다. 각 행에 쓰는 값은 한 건씩 갱신할 때와 같다.
     * 기본 구현은 한 건씩 갱신한다. 왕복을 줄이려는 구현만 재정의한다.
     */
    fun updateOrders(orders: List<MarketOrder>) = orders.forEach(::updateOrder)
    fun matchCandidatesForUpdate(instrumentId: UUID, accountId: UUID, incomingSide: MarketOrderSide, limitUnitPrice: Long, quantity: Long, now: Instant): List<MarketOrder>
    fun quoteCandidates(instrumentId: UUID, accountId: UUID, incomingSide: MarketOrderSide, limitUnitPrice: Long, quantity: Long, now: Instant): List<MarketOrder>
    fun crossingOwnOrder(instrumentId: UUID, accountId: UUID, incomingSide: MarketOrderSide, limitUnitPrice: Long, now: Instant): Boolean
    fun depth(instrumentId: UUID, accountId: UUID, side: MarketOrderSide, levels: Int, now: Instant): List<MarketDepthLevel>
    fun priceLevels(instrumentId: UUID, accountId: UUID, side: MarketOrderSide, afterUnitPrice: Long?, limit: Int, now: Instant): List<MarketPriceLevel>
    fun recentTrades(instrumentId: UUID, limit: Int): List<MarketRecentTrade>
    fun priceLevelCount(instrumentId: UUID, side: MarketOrderSide, now: Instant): Long
    fun candles(instrumentId: UUID, interval: MarketCandleInterval, from: Instant, to: Instant): List<MarketCandle>
    fun listOrders(accountId: UUID, scope: MarketOrderScope, side: MarketOrderSide?, instrumentId: UUID?, cursor: OrderCursor?, limit: Int): List<MarketOrderSummary>
    fun countOrders(accountId: UUID, scope: MarketOrderScope, side: MarketOrderSide?, instrumentId: UUID?): Long
    fun expiredInstrumentIds(now: Instant, limit: Int): List<UUID>
    fun lockExpiredOrders(instrumentId: UUID, now: Instant, limit: Int): List<MarketOrder>
    fun listAdminOrders(orderId: UUID?, instrumentId: UUID?, cursor: OrderCursor?, limit: Int): List<AdminMarketOrderSummary>
    fun ensureSystemMarketAccount(now: Instant): UUID
    fun isSystemMarketAccount(accountId: UUID): Boolean

    fun createTrade(trade: TradeInsert)

    /** 한 주문이 만든 체결을 한 번에 기록한다. 기본 구현은 한 건씩 넣는다. */
    fun createTrades(trades: List<TradeInsert>) = trades.forEach(::createTrade)
    fun listTrades(accountId: UUID?, instrumentIds: List<UUID>, cursor: TradeCursor?, limit: Int): List<MarketTradeView>
    fun countTrades(accountId: UUID?, instrumentIds: List<UUID>): Long

    fun createDelivery(delivery: MarketDelivery)

    /** 한 주문이 만든 수령함 항목을 한 번에 만든다. 기본 구현은 한 건씩 넣는다. */
    fun createDeliveries(deliveries: List<MarketDelivery>) = deliveries.forEach(::createDelivery)
    fun listDeliveries(accountId: UUID, claimable: Boolean?, cursor: OrderCursor?, limit: Int): List<MarketDelivery>
    fun countDeliveries(accountId: UUID, claimable: Boolean?): Long
    fun lockDelivery(accountId: UUID, deliveryId: UUID): MarketDelivery?
    fun lockClaimableDeliveries(accountId: UUID): List<MarketDelivery>
    fun markDeliveriesClaimed(deliveryIds: List<UUID>, claimedAt: Instant)

    fun appendUnread(accountId: UUID, stream: MarketUnreadStream, sourceId: UUID, createdAt: Instant): Long

    /**
     * 미확인 알림 여러 건을 한 번에 넣는다. 반환 sequence는 입력 순서와 짝이 맞고,
     * 같은 (계정, stream)에는 한 건씩 넣을 때와 같은 연속 번호가 매겨진다.
     */
    fun appendUnreads(entries: List<UnreadAppend>): List<Long> =
        entries.map { appendUnread(it.accountId, it.stream, it.sourceId, it.createdAt) }
    fun unreadStates(accountId: UUID): List<MarketUnreadState>
    fun peekUnreadStates(accountId: UUID): List<MarketUnreadState> = unreadStates(accountId)
    fun issueReadThrough(accountId: UUID, stream: MarketUnreadStream, sequence: Long)
    fun advanceReadCursor(accountId: UUID, stream: MarketUnreadStream, sequence: Long): Long

    fun migrateLegacyMarket(now: Instant): List<Pair<UUID, Long>>
}
