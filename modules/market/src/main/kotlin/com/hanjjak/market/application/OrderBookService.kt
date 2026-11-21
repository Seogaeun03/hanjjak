package com.hanjjak.market.application

import com.fasterxml.jackson.databind.JavaType
import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.events.application.DomainEventPublishRequest
import com.hanjjak.events.application.DomainEventPublisher
import com.hanjjak.inventory.application.ItemCatalog
import com.hanjjak.inventory.application.MarketInventoryService
import com.hanjjak.inventory.domain.ItemDefinition
import com.hanjjak.mail.application.MailService
import com.hanjjak.mail.application.SettlementMailRequest
import com.hanjjak.market.domain.*
import com.hanjjak.market.domain.MARKET_ORDER_DURATION_HOURS
import com.hanjjak.market.domain.MAX_ACTIVE_MARKET_ORDERS
import com.hanjjak.market.domain.MAX_MARKET_MUTATIONS_PER_MINUTE
import com.hanjjak.market.domain.MAX_ORDER_BOOK_UNIT_PRICE
import com.hanjjak.market.domain.MIN_MARKET_UNIT_PRICE
import com.hanjjak.wallet.application.WalletCreditEntry
import com.hanjjak.wallet.application.WalletDebitEntry
import com.hanjjak.wallet.application.WalletService
import org.springframework.transaction.annotation.Isolation
import org.springframework.transaction.annotation.Transactional
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Clock
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.Base64
import java.util.UUID

open class OrderBookService(
    private val repository: OrderBookRepository,
    private val inventory: MarketInventoryService,
    private val wallet: WalletService,
    private val mail: MailService,
    private val catalog: ItemCatalog,
    private val mapper: ObjectMapper,
    private val clock: Clock,
    private val events: DomainEventPublisher,
    private val instruments: MarketInstrumentCatalog,
) {
    open fun stateVersion(accountId: UUID): Long = repository.stateVersion(accountId)

    @Transactional(readOnly = true)
    open fun changeState(accountId: UUID): MarketChangeState = MarketChangeState(
        accountStateVersion = repository.stateVersion(accountId),
        instruments = repository.instrumentRevisions(),
        unread = repository.peekUnreadStates(accountId),
    )

    @Transactional
    open fun synchronizeCatalog() = instruments.synchronize()

    @Transactional(readOnly = true)
    open fun instruments(accountId: UUID): List<MarketInstrumentSummary> = repository.instruments(accountId)

    @Transactional
    open fun migrateLegacyMarket() {
        repository.migrateLegacyMarket(clock.instant()).forEach { (accountId, reservedRice) ->
            if (reservedRice > 0) wallet.credit(accountId, reservedRice, "MARKET_LEGACY_BUY_ORDER_REFUND", UUID.randomUUID())
        }
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    open fun orderBook(accountId: UUID, instrumentId: UUID, levels: Int): MarketOrderBook {
        require(levels in 1..20) { "INVALID_LEVELS" }
        val instrument = repository.instrument(instrumentId) ?: throw IllegalArgumentException("MARKET_INSTRUMENT_NOT_FOUND")
        val bids = repository.depth(instrumentId, accountId, MarketOrderSide.BUY, levels, clock.instant())
        val asks = repository.depth(instrumentId, accountId, MarketOrderSide.SELL, levels, clock.instant())
        val bestBid = bids.firstOrNull()?.unitPrice
        val bestAsk = asks.firstOrNull()?.unitPrice
        return MarketOrderBook(instrumentId, instrument.marketRevision, bids, asks, bestBid, bestAsk, if (bestBid != null && bestAsk != null) bestAsk - bestBid else null, repository.recentTrades(instrumentId, 10))
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    open fun priceLevels(accountId: UUID, instrumentId: UUID, side: MarketOrderSide, afterUnitPrice: Long?, limit: Int): MarketPriceLevels {
        require(limit in 1..10) { "INVALID_LIMIT" }
        if (afterUnitPrice != null) require(afterUnitPrice in MIN_MARKET_UNIT_PRICE..MAX_ORDER_BOOK_UNIT_PRICE) { "INVALID_UNIT_PRICE" }
        val instrument = repository.instrument(instrumentId) ?: throw IllegalArgumentException("MARKET_INSTRUMENT_NOT_FOUND")
        val now = clock.instant()
        val rows = repository.priceLevels(instrumentId, accountId, side, afterUnitPrice, limit + 1, now)
        val items = rows.take(limit)
        return MarketPriceLevels(instrumentId, side, instrument.marketRevision, items, if (rows.size > limit) items.lastOrNull()?.unitPrice else null, repository.priceLevelCount(instrumentId, side, now))
    }

    @Transactional(readOnly = true)
    open fun candles(accountId: UUID, instrumentId: UUID, interval: MarketCandleInterval, period: MarketCandlePeriod): MarketCandles {
        val instrument = repository.instrument(instrumentId) ?: throw IllegalArgumentException("MARKET_INSTRUMENT_NOT_FOUND")
        val to = clock.instant()
        val from = to.minus(period.duration)
        return MarketCandles(instrumentId, "${interval.bucket}:${period.bucket}", from, to, instrument.marketRevision, repository.candles(instrumentId, interval, from, to))
    }


    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    open fun quote(accountId: UUID, instrumentId: UUID, side: MarketOrderSide, timeInForce: MarketTimeInForce, quantity: Long, limitUnitPrice: Long): MarketOrderQuote {
        validateOrder(quantity, limitUnitPrice)
        val instrument = repository.instrument(instrumentId) ?: throw IllegalArgumentException("MARKET_INSTRUMENT_NOT_FOUND")
        require(instrument.status == MarketInstrumentStatus.ACTIVE) { "MARKET_INSTRUMENT_INACTIVE" }
        val now = clock.instant()
        if (side == MarketOrderSide.SELL) {
            require(!repository.crossingOwnOrder(instrumentId, accountId, side, limitUnitPrice, now)) { "SELF_CROSS_NOT_ALLOWED" }
        }
        val candidates = repository.quoteCandidates(instrumentId, accountId, side, limitUnitPrice, quantity, now)
        var remaining = quantity
        var total = 0L
        var fee = 0L
        var minimum: Long? = null
        var maximum: Long? = null
        for (candidate in candidates) {
            if (remaining == 0L) break
            val fill = minOf(remaining, candidate.remainingQuantity)
            val fillTotal = Math.multiplyExact(fill, candidate.limitUnitPrice)
            total = Math.addExact(total, fillTotal)
            if (side == MarketOrderSide.SELL) fee = Math.addExact(fee, fillTotal / 10)
            minimum = minOf(minimum ?: candidate.limitUnitPrice, candidate.limitUnitPrice)
            maximum = maxOf(maximum ?: candidate.limitUnitPrice, candidate.limitUnitPrice)
            remaining -= fill
        }
        val filled = quantity - remaining
        return MarketOrderQuote(
            instrument.instrumentId, side, timeInForce, quantity, limitUnitPrice, filled, remaining, minimum, maximum,
            if (filled > 0) total.toDouble() / filled else null, total, fee, total - fee,
            wallet.balance(accountId), inventory.availableQuantity(accountId, instrument.itemId), instrument.marketRevision,
        )
    }


    @Transactional
    open fun create(accountId: UUID, idempotencyKey: UUID, request: CreateMarketOrderRequest): MarketCommand<MarketOrderResult> {
        validateOrder(request.quantity, request.limitUnitPrice)
        require(request.timeInForce == MarketTimeInForce.GTC || request.timeInForce == MarketTimeInForce.IOC) { "INVALID_TIME_IN_FORCE" }
        val fingerprint = fingerprint("market-order-create", request.instrumentId, request.side, request.quantity, request.limitUnitPrice, request.timeInForce, request.instanceIds.sorted())
        replay<MarketOrderResult>(accountId, idempotencyKey, fingerprint)?.let { return it }
        val now = clock.instant()
        val instrument = repository.lockInstrument(request.instrumentId) ?: throw IllegalArgumentException("MARKET_INSTRUMENT_NOT_FOUND")
        require(instrument.status == MarketInstrumentStatus.ACTIVE) { "MARKET_INSTRUMENT_INACTIVE" }
        val window = repository.lockAccountControl(accountId, now)
        require(window.mutationCount < MAX_MARKET_MUTATIONS_PER_MINUTE) { "MARKET_MUTATION_RATE_LIMITED" }
        require(request.timeInForce == MarketTimeInForce.IOC || window.activeOrderCount < MAX_ACTIVE_MARKET_ORDERS) { "MARKET_ACTIVE_ORDER_LIMIT" }
        if (request.side == MarketOrderSide.SELL) {
            require(!repository.crossingOwnOrder(request.instrumentId, accountId, request.side, request.limitUnitPrice, now)) { "SELF_CROSS_NOT_ALLOWED" }
        }

        val orderId = UUID.randomUUID()
        val commandId = UUID.randomUUID()
        var order = MarketOrder(
            orderId, accountId, request.instrumentId, request.side, request.timeInForce,
            request.quantity, 0, request.quantity, request.limitUnitPrice, 0,
            MarketOrderStatus.ACTIVE, now, now, now,
            if (request.timeInForce == MarketTimeInForce.GTC) now.plus(MARKET_ORDER_DURATION_HOURS, ChronoUnit.HOURS) else null,
            instrument.displayName, request.instanceIds,
        )
        reserveIncoming(order, instrument, request.instanceIds)
        if (request.side == MarketOrderSide.BUY && request.timeInForce == MarketTimeInForce.GTC) {
            order = order.copy(reservedRice = Math.multiplyExact(order.remainingQuantity, order.limitUnitPrice))
        }
        if (order.timeInForce == MarketTimeInForce.GTC) repository.createOrder(order)
        val outcome = match(order, instrument, now)
        order = outcome.order
        if (request.timeInForce == MarketTimeInForce.IOC) {
            require(order.filledQuantity > 0) { "MARKET_NO_FILL" }
            order = order.copy(status = if (order.remainingQuantity == 0L) MarketOrderStatus.FILLED else MarketOrderStatus.PARTIALLY_FILLED_CLOSED, remainingQuantity = 0, reservedRice = 0, updatedAt = now)
        }
        repository.updateOrder(order)
        repository.appendMutation(UUID.randomUUID(), accountId, instrument.instrumentId, orderId, request.side, "CREATE", commandId, now)
        val revision = repository.incrementRevision(instrument.instrumentId)
        val result = result(order, revision, outcome.fills)
        publishOrderAndFills("MARKET_ORDER_CREATED", commandId, instrument, order, outcome.fills, outcome.parties, revision, now)
        repository.saveCommand(commandId, accountId, idempotencyKey, fingerprint, mapper.writeValueAsString(result))
        return MarketCommand(commandId, idempotencyKey, result = result)
    }

    @Transactional
    open fun update(accountId: UUID, orderId: UUID, idempotencyKey: UUID, request: UpdateMarketOrderRequest): MarketCommand<MarketOrderResult> {
        require(request.quantity != null || request.limitUnitPrice != null) { "EMPTY_ORDER_UPDATE" }
        val fingerprint = fingerprint("market-order-update", orderId, request.quantity, request.limitUnitPrice)
        replay<MarketOrderResult>(accountId, idempotencyKey, fingerprint)?.let { return it }
        val now = clock.instant()
        var current = repository.order(orderId) ?: throw IllegalArgumentException("MARKET_ORDER_NOT_FOUND")
        val instrument = repository.lockInstrument(current.instrumentId) ?: throw IllegalArgumentException("MARKET_INSTRUMENT_NOT_FOUND")
        current = repository.lockOrder(orderId) ?: throw IllegalArgumentException("MARKET_ORDER_NOT_FOUND")
        require(current.accountId == accountId) { "MARKET_ORDER_NOT_FOUND" }
        require(current.timeInForce == MarketTimeInForce.GTC && current.status in setOf(MarketOrderStatus.ACTIVE, MarketOrderStatus.PARTIALLY_FILLED)) { "MARKET_ORDER_NOT_ACTIVE" }
        val newRemaining = request.quantity ?: current.remainingQuantity
        val newPrice = request.limitUnitPrice ?: current.limitUnitPrice
        validateOrder(newRemaining, newPrice)
        val window = repository.lockAccountControl(accountId, now)
        require(window.mutationCount < MAX_MARKET_MUTATIONS_PER_MINUTE) { "MARKET_MUTATION_RATE_LIMITED" }
        if (current.side == MarketOrderSide.SELL) {
            require(!repository.crossingOwnOrder(current.instrumentId, accountId, current.side, newPrice, now)) { "SELF_CROSS_NOT_ALLOWED" }
        }
        adjustReservation(current, newRemaining, newPrice, instrument)
        val losesPriority = newPrice != current.limitUnitPrice || newRemaining > current.remainingQuantity
        var updated = current.copy(
            initialQuantity = Math.addExact(current.filledQuantity, newRemaining), remainingQuantity = newRemaining,
            limitUnitPrice = newPrice, reservedRice = if (current.side == MarketOrderSide.BUY) Math.multiplyExact(newRemaining, newPrice) else 0,
            priorityAt = if (losesPriority) now else current.priorityAt, updatedAt = now,
            expiresAt = if (losesPriority) now.plus(MARKET_ORDER_DURATION_HOURS, ChronoUnit.HOURS) else current.expiresAt,
            instanceIds = if (current.side == MarketOrderSide.SELL && newRemaining < current.remainingQuantity) current.instanceIds.dropLast((current.remainingQuantity - newRemaining).toInt()) else current.instanceIds,
        )
        repository.updateOrder(updated)
        val outcome = match(updated, instrument, now)
        updated = outcome.order
        repository.updateOrder(updated)
        val commandId = UUID.randomUUID()
        repository.appendMutation(UUID.randomUUID(), accountId, instrument.instrumentId, orderId, current.side, "UPDATE", commandId, now)
        val revision = repository.incrementRevision(instrument.instrumentId)
        val result = result(updated, revision, outcome.fills)
        publishOrderAndFills("MARKET_ORDER_UPDATED", commandId, instrument, updated, outcome.fills, outcome.parties, revision, now)
        repository.saveCommand(commandId, accountId, idempotencyKey, fingerprint, mapper.writeValueAsString(result))
        return MarketCommand(commandId, idempotencyKey, result = result)
    }

    @Transactional
    open fun cancel(accountId: UUID, orderId: UUID, idempotencyKey: UUID): MarketCommand<MarketOrderCancelled> {
        val fingerprint = fingerprint("market-order-cancel", orderId)
        replay<MarketOrderCancelled>(accountId, idempotencyKey, fingerprint)?.let { return it }
        val now = clock.instant()
        var order = repository.order(orderId) ?: throw IllegalArgumentException("MARKET_ORDER_NOT_FOUND")
        val instrument = repository.lockInstrument(order.instrumentId) ?: throw IllegalArgumentException("MARKET_INSTRUMENT_NOT_FOUND")
        order = repository.lockOrder(orderId) ?: throw IllegalArgumentException("MARKET_ORDER_NOT_FOUND")
        require(order.accountId == accountId) { "MARKET_ORDER_NOT_FOUND" }
        require(order.status in setOf(MarketOrderStatus.ACTIVE, MarketOrderStatus.PARTIALLY_FILLED)) { "MARKET_ORDER_NOT_ACTIVE" }
        val window = repository.lockAccountControl(accountId, now)
        require(window.mutationCount < MAX_MARKET_MUTATIONS_PER_MINUTE) { "MARKET_MUTATION_RATE_LIMITED" }
        val delivery = releaseOrder(order, instrument, MarketOrderStatus.CANCELLED, MarketDeliverySource.SELL_CANCEL_RETURN, now)
        val commandId = UUID.randomUUID()
        repository.appendMutation(UUID.randomUUID(), accountId, instrument.instrumentId, orderId, order.side, "CANCEL", commandId, now)
        val revision = repository.incrementRevision(instrument.instrumentId)
        events.publish(
            eventType = "MARKET_ORDER_CANCELLED",
            aggregateId = orderId,
            occurredAt = now,
            accountId = accountId,
            itemId = instrument.itemId,
            quantity = order.remainingQuantity,
            unitPrice = order.limitUnitPrice,
            commandId = commandId,
            payload = mapOf("orderId" to orderId, "instrumentId" to instrument.instrumentId, "side" to order.side.name, "timeInForce" to order.timeInForce.name, "marketRevision" to revision),
        )
        val result = MarketOrderCancelled(orderId, order.instrumentId, order.side, MarketOrderStatus.CANCELLED, if (order.side == MarketOrderSide.BUY) order.reservedRice else 0, delivery?.deliveryId, order.remainingQuantity, revision)
        repository.saveCommand(commandId, accountId, idempotencyKey, fingerprint, mapper.writeValueAsString(result))
        return MarketCommand(commandId, idempotencyKey, result = result)
    }

    open fun orders(accountId: UUID, scope: MarketOrderScope, side: MarketOrderSide?, instrumentId: UUID?, cursor: String?): MarketPage<MarketOrderSummary> {
        val decoded = decodeOrderCursor(cursor)
        val rows = repository.listOrders(accountId, scope, side, instrumentId, decoded, 31)
        val visible = rows.take(30)
        return MarketPage(visible, if (rows.size > 30) visible.lastOrNull()?.let { encodeOrderCursor(it.createdAt, it.orderId) } else null, repository.countOrders(accountId, scope, side, instrumentId))
    }

    open fun trades(accountId: UUID?, instrumentIds: List<UUID>, cursor: String?): MarketPage<MarketTradeView> {
        val rows = repository.listTrades(accountId, instrumentIds, decodeTradeCursor(cursor), 31)
        val visible = rows.take(30)
        val readThrough = if (accountId == null) 0 else repository.unreadStates(accountId).firstOrNull { it.stream == MarketUnreadStream.FILLS }?.latestSequence ?: 0
        if (accountId != null) repository.issueReadThrough(accountId, MarketUnreadStream.FILLS, readThrough)
        return MarketPage(visible, if (rows.size > 30) visible.lastOrNull()?.let { encodeTradeCursor(it.filledAt, it.tradeId) } else null, repository.countTrades(accountId, instrumentIds), readThrough)
    }

    @Transactional
    open fun expireInstrumentOrders(instrumentId: UUID, now: Instant, limit: Int) {
        val instrument = repository.lockInstrument(instrumentId) ?: return
        val expired = repository.lockExpiredOrders(instrumentId, now, limit)
        if (expired.isEmpty()) return
        expired.forEach { order -> releaseOrder(order, instrument, MarketOrderStatus.EXPIRED, MarketDeliverySource.SELL_EXPIRE_RETURN, now) }
        repository.incrementRevision(instrumentId)
    }



    private data class MatchOutcome(val order: MarketOrder, val fills: List<MarketOrderFill>, val parties: List<FillParties>)

    /** 체결 한 건의 매수·매도 계정이다. 이벤트를 만들 때 주문을 다시 읽지 않으려고 체결하면서 들고 있는다. */
    private data class FillParties(val tradeId: UUID, val buyerAccountId: UUID, val sellerAccountId: UUID)

    /** 체결 결과를 확정하기 전까지 모아 두는 쓰기 묶음이다. 한 주문 요청 안에서만 쓰고 요청 사이에 공유하지 않는다. */
    private class SettlementBatch {
        val fills = mutableListOf<MarketOrderFill>()
        val parties = mutableListOf<FillParties>()
        val trades = mutableListOf<OrderBookRepository.TradeInsert>()
        val makerUpdates = mutableListOf<MarketOrder>()
        val deliveries = mutableListOf<MarketDelivery>()
        val settlementMails = mutableListOf<SettlementMailRequest>()
        val unreads = mutableListOf<OrderBookRepository.UnreadAppend>()
        val buyerDebits = mutableListOf<WalletDebitEntry>()
        val buyerCredits = mutableListOf<WalletCreditEntry>()
        val stackTransfers = mutableListOf<MarketInventoryService.ReservedTransfer>()
        val instanceTransfers = mutableListOf<InstanceTransfer>()
        val escrowSellers = linkedSetOf<UUID>()
    }

    private data class InstanceTransfer(val sellerAccountId: UUID, val buyerAccountId: UUID, val instanceIds: List<UUID>)

    /**
     * 가격·시간 우선순위대로 상대 주문을 훑어 체결을 확정한다.
     *
     * 체결 결과는 주문별로 그대로 계산하고, 그 결과를 쓰는 일만 뒤로 모은다. 예전에는 체결 1건마다
     * 지갑·거래·수령함·정산 메일·알림·주문 갱신을 따로 보내 같은 품목 잠금을 쥔 채 왕복이 체결 수만큼 늘었다.
     * 이제는 같은 transaction 안에서 외래키 순서대로 묶어 보낸다. 쓰는 값과 실패 시 되돌아가는 범위는 그대로다.
     */
    private fun match(incoming: MarketOrder, instrument: MarketInstrument, now: Instant): MatchOutcome {
        var taker = incoming
        val batch = SettlementBatch()
        val definition = catalog.require(instrument.itemId)
        val candidates = repository.matchCandidatesForUpdate(instrument.instrumentId, incoming.accountId, incoming.side, incoming.limitUnitPrice, incoming.remainingQuantity, now)
        for (candidate in candidates) {
            if (taker.remainingQuantity == 0L) break
            var maker = candidate
            val quantity = minOf(taker.remainingQuantity, maker.remainingQuantity)
            val unitPrice = maker.limitUnitPrice
            val totalPrice = Math.multiplyExact(quantity, unitPrice)
            val sellerOrder = if (incoming.side == MarketOrderSide.SELL) taker else maker
            val buyerOrder = if (incoming.side == MarketOrderSide.BUY) taker else maker
            val buyerId = buyerOrder.accountId
            val sellerId = sellerOrder.accountId
            val fee = totalPrice / 10
            val settlement = totalPrice - fee
            val tradeId = UUID.randomUUID()
            val legacyListing = sellerOrder.legacyListingId
            if (incoming.side == MarketOrderSide.BUY) {
                if (incoming.timeInForce == MarketTimeInForce.IOC) {
                    batch.buyerDebits += WalletDebitEntry(totalPrice, "MARKET_ORDER_FILL", tradeId)
                } else {
                    val release = Math.subtractExact(Math.multiplyExact(quantity, incoming.limitUnitPrice), totalPrice)
                    if (release > 0) batch.buyerCredits += WalletCreditEntry(release, "MARKET_ORDER_PRICE_IMPROVEMENT", tradeId)
                }
            }
            batch.trades += OrderBookRepository.TradeInsert(tradeId, legacyListing, maker.orderId, taker.orderId, instrument.instrumentId, buyerId, sellerId, instrument.itemId, instrument.displayName, quantity, unitPrice, totalPrice, fee, settlement, now)
            planBuyDelivery(batch, buyerOrder, sellerOrder, instrument, definition, quantity, tradeId, now)
            batch.settlementMails += SettlementMailRequest(sellerId, tradeId, settlement)
            batch.unreads += OrderBookRepository.UnreadAppend(sellerId, MarketUnreadStream.SETTLEMENTS, tradeId, now)
            val makerRemaining = maker.remainingQuantity - quantity
            maker = maker.copy(
                filledQuantity = maker.filledQuantity + quantity, remainingQuantity = makerRemaining,
                reservedRice = if (maker.side == MarketOrderSide.BUY) Math.multiplyExact(makerRemaining, maker.limitUnitPrice) else 0,
                status = status(maker.filledQuantity + quantity, makerRemaining), updatedAt = now,
                instanceIds = if (maker.side == MarketOrderSide.SELL) maker.instanceIds.drop(quantity.toInt()) else maker.instanceIds,
            )
            batch.makerUpdates += maker
            val takerRemaining = taker.remainingQuantity - quantity
            taker = taker.copy(
                filledQuantity = taker.filledQuantity + quantity, remainingQuantity = takerRemaining,
                reservedRice = if (taker.side == MarketOrderSide.BUY && taker.timeInForce == MarketTimeInForce.GTC) Math.multiplyExact(takerRemaining, taker.limitUnitPrice) else 0,
                status = status(taker.filledQuantity + quantity, takerRemaining), updatedAt = now,
                instanceIds = if (taker.side == MarketOrderSide.SELL) taker.instanceIds.drop(quantity.toInt()) else taker.instanceIds,
            )
            batch.fills += MarketOrderFill(tradeId, maker.orderId, taker.orderId, quantity, unitPrice, totalPrice, fee, settlement)
            batch.parties += FillParties(tradeId, buyerId, sellerId)
            batch.unreads += OrderBookRepository.UnreadAppend(buyerId, MarketUnreadStream.FILLS, tradeId, now)
            batch.unreads += OrderBookRepository.UnreadAppend(sellerId, MarketUnreadStream.FILLS, tradeId, now)
        }
        settle(batch, incoming, taker, instrument)
        if (incoming.timeInForce == MarketTimeInForce.IOC && taker.remainingQuantity > 0) releaseIocRemainder(taker, instrument, now)
        return MatchOutcome(taker, batch.fills, batch.parties)
    }

    /**
     * 모아 둔 결과를 외래키가 요구하는 순서로 확정한다.
     *
     * 주문 → 거래 → 수령함·정산 메일 순서를 지켜야 참조가 끊기지 않는다. 지갑은 먼저 확정해
     * 잔액이 모자라면 나머지를 쓰기 전에 같은 오류로 멈춘다. 어디서 실패하든 transaction 하나가 통째로 되돌아간다.
     */
    private fun settle(batch: SettlementBatch, incoming: MarketOrder, taker: MarketOrder, instrument: MarketInstrument) {
        if (batch.fills.isEmpty()) return
        if (incoming.timeInForce == MarketTimeInForce.IOC) {
            // 체결이 생긴 뒤에만 닫힌 IOC를 남긴다. 뒤따르는 거래 기록이 이 주문을 참조한다.
            repository.createOrder(taker.copy(
                remainingQuantity = 0, reservedRice = 0,
                status = if (taker.remainingQuantity == 0L) MarketOrderStatus.FILLED else MarketOrderStatus.PARTIALLY_FILLED_CLOSED,
            ))
        }
        if (batch.buyerDebits.isNotEmpty()) wallet.debitBatched(incoming.accountId, batch.buyerDebits)
        if (batch.buyerCredits.isNotEmpty()) wallet.creditBatched(incoming.accountId, batch.buyerCredits)
        repository.createTrades(batch.trades)
        repository.updateOrders(batch.makerUpdates)
        if (batch.stackTransfers.isNotEmpty()) inventory.transferReserveds(batch.stackTransfers)
        batch.instanceTransfers.forEach { inventory.transferReservedInstances(it.sellerAccountId, it.buyerAccountId, it.instanceIds) }
        inventory.consumeExternalReservations(batch.escrowSellers, instrument.itemId)
        repository.createDeliveries(batch.deliveries)
        mail.createSettlementMails(batch.settlementMails)
        repository.appendUnreads(batch.unreads)
    }

    private fun planBuyDelivery(batch: SettlementBatch, buyerOrder: MarketOrder, sellerOrder: MarketOrder, instrument: MarketInstrument, definition: ItemDefinition, quantity: Long, tradeId: UUID, now: Instant) {
        val instances = if (definition.stackable) emptyList() else sellerOrder.instanceIds.take(quantity.toInt())
        if (buyerOrder.timeInForce == MarketTimeInForce.IOC) {
            if (definition.stackable) batch.stackTransfers += MarketInventoryService.ReservedTransfer(sellerOrder.accountId, buyerOrder.accountId, instrument.itemId, quantity)
            else batch.instanceTransfers += InstanceTransfer(sellerOrder.accountId, buyerOrder.accountId, instances)
            return
        }
        if (definition.stackable) batch.escrowSellers += sellerOrder.accountId
        val delivery = MarketDelivery(
            UUID.randomUUID(), buyerOrder.accountId, instrument.instrumentId, buyerOrder.orderId, tradeId,
            MarketDeliverySource.BUY_FILL, instrument.itemId, instances, quantity, instrument.displayName, now, null,
            sourceAccountId = if (definition.stackable) null else sellerOrder.accountId,
        )
        batch.deliveries += delivery
        batch.unreads += OrderBookRepository.UnreadAppend(buyerOrder.accountId, MarketUnreadStream.DELIVERIES, delivery.deliveryId, now)
    }

    private fun reserveIncoming(order: MarketOrder, instrument: MarketInstrument, instanceIds: List<UUID>) {
        if (order.side == MarketOrderSide.BUY) {
            if (order.timeInForce == MarketTimeInForce.GTC) wallet.debit(order.accountId, Math.multiplyExact(order.remainingQuantity, order.limitUnitPrice), "MARKET_ORDER_RESERVE", order.orderId)
        } else {
            val definition = catalog.require(instrument.itemId)
            if (definition.stackable) inventory.reserveForSale(order.accountId, instrument.itemId, order.remainingQuantity)
            else {
                require(instanceIds.size.toLong() == order.remainingQuantity) { "INSTANCE_QUANTITY_MISMATCH" }
                inventory.reserveInstancesForSale(order.accountId, instrument.itemId, instanceIds)
            }
        }
    }

    private fun adjustReservation(current: MarketOrder, newRemaining: Long, newPrice: Long, instrument: MarketInstrument) {
        if (current.side == MarketOrderSide.BUY) {
            val previous = current.reservedRice
            val next = Math.multiplyExact(newRemaining, newPrice)
            if (next > previous) wallet.debit(current.accountId, next - previous, "MARKET_ORDER_RESERVE_INCREASE", current.orderId)
            if (next < previous) wallet.credit(current.accountId, previous - next, "MARKET_ORDER_RESERVE_RELEASE", current.orderId)
        } else {
            val delta = newRemaining - current.remainingQuantity
            val definition = catalog.require(instrument.itemId)
            if (delta > 0) {
                require(definition.stackable) { "INSTANCE_IDS_REQUIRED" }
                inventory.reserveForSale(current.accountId, instrument.itemId, delta)
            }
            if (delta < 0) createReturnDelivery(current.copy(instanceIds = current.instanceIds.takeLast((-delta).toInt())), instrument, -delta, MarketDeliverySource.SELL_CANCEL_RETURN, clock.instant())
        }
    }

    private fun releaseIocRemainder(order: MarketOrder, instrument: MarketInstrument, now: Instant) {
        if (order.side == MarketOrderSide.SELL && order.remainingQuantity > 0) {
            if (catalog.require(instrument.itemId).stackable) inventory.releaseReservation(order.accountId, instrument.itemId, order.remainingQuantity)
            else inventory.deliverInstances(order.accountId, order.instanceIds.take(order.remainingQuantity.toInt()))
        }
    }

    private fun releaseOrder(order: MarketOrder, instrument: MarketInstrument, status: MarketOrderStatus, source: MarketDeliverySource, now: Instant): MarketDelivery? {
        val delivery = if (order.side == MarketOrderSide.BUY) {
            if (order.reservedRice > 0) wallet.credit(order.accountId, order.reservedRice, "MARKET_ORDER_${status.name}", order.orderId)
            null
        } else createReturnDelivery(order, instrument, order.remainingQuantity, source, now)
        repository.updateOrder(order.copy(remainingQuantity = 0, status = status, reservedRice = 0, updatedAt = now))
        if (status == MarketOrderStatus.EXPIRED) repository.appendUnread(order.accountId, MarketUnreadStream.EXPIRATIONS, order.orderId, now)
        return delivery
    }

    private fun createReturnDelivery(order: MarketOrder, instrument: MarketInstrument, quantity: Long, source: MarketDeliverySource, now: Instant): MarketDelivery {
        val instances = if (catalog.require(instrument.itemId).stackable) emptyList() else order.instanceIds.take(quantity.toInt())
        val delivery = MarketDelivery(
            UUID.randomUUID(), order.accountId, instrument.instrumentId, order.orderId, null, source,
            instrument.itemId, instances, quantity, instrument.displayName, now, null, order.accountId,
        )
        repository.createDelivery(delivery)
        repository.appendUnread(order.accountId, MarketUnreadStream.DELIVERIES, delivery.deliveryId, now)
        return delivery
    }

    private fun result(order: MarketOrder, revision: Long, fills: List<MarketOrderFill>): MarketOrderResult {
        val total = fills.sumOf { it.totalPrice }
        val unfilled = order.initialQuantity - order.filledQuantity
        return MarketOrderResult(order.orderId, order.instrumentId, order.side, order.timeInForce, order.initialQuantity, order.filledQuantity, unfilled, order.limitUnitPrice, order.reservedRice, order.status, order.priorityAt, order.expiresAt, total, fills.minOfOrNull { it.unitPrice }, fills.maxOfOrNull { it.unitPrice }, if (fills.sumOf { it.quantity } > 0) total.toDouble() / fills.sumOf { it.quantity } else null, revision, fills)
    }

    /**
     * 주문 이벤트와 체결 이벤트를 한 번에 내보낸다.
     *
     * 매수·매도 계정은 체결하면서 이미 알고 있으므로 주문을 다시 읽지 않는다.
     * 예전에는 체결마다 maker·taker 주문을 select 해 같은 값을 다시 꺼냈다.
     */
    private fun publishOrderAndFills(eventType: String, commandId: UUID, instrument: MarketInstrument, order: MarketOrder, fills: List<MarketOrderFill>, parties: List<FillParties>, revision: Long, now: Instant) {
        val partiesByTrade = parties.associateBy { it.tradeId }
        val requests = mutableListOf(DomainEventPublishRequest(eventType, order.orderId, now, order.accountId, itemId = instrument.itemId, quantity = order.initialQuantity, unitPrice = order.limitUnitPrice, commandId = commandId, payload = mapOf("orderId" to order.orderId, "instrumentId" to instrument.instrumentId, "side" to order.side.name, "timeInForce" to order.timeInForce.name, "marketRevision" to revision)))
        requests += fills.map { fill ->
            val fillParties = partiesByTrade[fill.tradeId] ?: error("MARKET_TRADE_PARTIES_MISSING")
            val buyerId = fillParties.buyerAccountId
            val sellerId = fillParties.sellerAccountId
            DomainEventPublishRequest("MARKET_TRADE_COMPLETED", fill.tradeId, now, buyerId, itemId = instrument.itemId, quantity = fill.quantity, unitPrice = fill.unitPrice, totalPrice = fill.totalPrice, commandId = commandId, payload = mapOf("tradeId" to fill.tradeId, "makerOrderId" to fill.makerOrderId, "takerOrderId" to fill.takerOrderId, "instrumentId" to instrument.instrumentId, "buyerAccountId" to buyerId, "sellerAccountId" to sellerId, "fee" to fill.fee, "settlementAmount" to fill.settlementAmount, "marketRevision" to revision))
        }
        events.publishAll(requests)
    }

    private fun activeInstrument(id: UUID): MarketInstrument = (repository.instrument(id) ?: throw IllegalArgumentException("MARKET_INSTRUMENT_NOT_FOUND")).also { require(it.status == MarketInstrumentStatus.ACTIVE) { "MARKET_INSTRUMENT_INACTIVE" } }
    private fun status(filled: Long, remaining: Long) = if (remaining == 0L) MarketOrderStatus.FILLED else if (filled > 0) MarketOrderStatus.PARTIALLY_FILLED else MarketOrderStatus.ACTIVE
    private fun validateOrder(quantity: Long, unitPrice: Long) { require(quantity > 0) { "INVALID_QUANTITY" }; require(unitPrice in MIN_MARKET_UNIT_PRICE..MAX_ORDER_BOOK_UNIT_PRICE) { "INVALID_UNIT_PRICE" }; Math.multiplyExact(quantity, unitPrice) }

    private inline fun <reified T> replay(accountId: UUID, key: UUID, fingerprint: String): MarketCommand<T>? {
        val stored = repository.command(accountId, key) ?: return null
        require(stored.fingerprint == fingerprint) { "IDEMPOTENCY_KEY_REUSED" }
        return MarketCommand(stored.commandId, key, result = mapper.readValue(stored.resultJson, T::class.java))
    }
    private fun fingerprint(vararg values: Any?): String = MessageDigest.getInstance("SHA-256").digest(values.joinToString("\u0000").toByteArray(StandardCharsets.UTF_8)).joinToString("") { "%02x".format(it) }
    private fun encodeOrderCursor(at: Instant, id: UUID) = Base64.getUrlEncoder().withoutPadding().encodeToString("$at|$id".toByteArray())
    private fun decodeOrderCursor(value: String?): OrderBookRepository.OrderCursor? = decodeCursor(value)?.let { OrderBookRepository.OrderCursor(it.first, it.second) }
    private fun encodeTradeCursor(at: Instant, id: UUID) = encodeOrderCursor(at, id)
    private fun decodeTradeCursor(value: String?): OrderBookRepository.TradeCursor? = decodeCursor(value)?.let { OrderBookRepository.TradeCursor(it.first, it.second) }
    private fun decodeCursor(value: String?): Pair<Instant, UUID>? {
        if (value == null) return null
        return runCatching { String(Base64.getUrlDecoder().decode(value)).split("|").let { Instant.parse(it[0]) to UUID.fromString(it[1]) } }.getOrElse { throw IllegalArgumentException("INVALID_CURSOR") }
    }
}
