package com.hanjjak.market.application

import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.events.application.NoopDomainEventPublisher
import com.hanjjak.inventory.application.*
import com.hanjjak.inventory.domain.*
import com.hanjjak.inventory.infrastructure.StaticItemCatalog
import com.hanjjak.mail.application.*
import com.hanjjak.mail.domain.MailMessage
import com.hanjjak.mail.application.MailService
import com.hanjjak.market.domain.*
import com.hanjjak.wallet.application.*
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals

class OrderBookServiceTest {
    private val now = Instant.parse("2026-09-11T00:00:00Z")
    private val buyer = UUID(0, 1)
    private val seller = UUID(0, 2)

    @Test
    fun `market catalog exposes only gem variants that the gem content can produce`() {
        val fixture = fixture()
        val gems = fixture.repository.instruments.values.filter { it.category == ItemCategory.GEM.name }
        val expected = buildSet {
            for (level in 1..5) {
                add("gem:$level:flat_attack")
                add("gem:$level:flat_hp")
            }
            addAll(listOf("gem:6:flat_attack", "gem:6:flat_hp", "gem:6:attack_percent", "gem:6:flat_penetration"))
            addAll(listOf("gem:7:flat_attack", "gem:7:flat_hp", "gem:7:attack_percent", "gem:7:flat_penetration", "gem:7:critical_chance", "gem:7:haste"))
        }

        assertEquals(20, gems.size)
        assertEquals(expected, gems.map { it.itemId }.toSet())
        assertEquals("attack_speed", gems.single { it.itemId == "gem:7:haste" }.attributes["option"])
    }

    @Test
    fun `resting orders expire 24 hours after creation and reprioritizing update`() {
        val fixture = fixture(clock = TickingClock(now))
        fixture.inventory.stacks[seller to "POTATO_M1"] = InventoryStack(seller, "POTATO_M1", 1, 0, 1)

        val created = fixture.service.create(seller, UUID.randomUUID(), CreateMarketOrderRequest(fixture.instrument.instrumentId, MarketOrderSide.SELL, 1, 100, MarketTimeInForce.GTC)).result
        assertEquals(created.priorityAt.plusSeconds(24 * 60 * 60), created.expiresAt)

        val updated = fixture.service.update(seller, created.orderId, UUID.randomUUID(), UpdateMarketOrderRequest(limitUnitPrice = 110)).result
        assertEquals(updated.priorityAt.plusSeconds(24 * 60 * 60), updated.expiresAt)
    }

    @Test
    fun `maker price and strict price time priority drive partial fill`() {
        val fixture = fixture()
        fixture.inventory.stacks[seller to "POTATO_M1"] = InventoryStack(seller, "POTATO_M1", 5, 0, 1)
        val sell = fixture.service.create(seller, UUID.randomUUID(), CreateMarketOrderRequest(fixture.instrument.instrumentId, MarketOrderSide.SELL, 5, 90, MarketTimeInForce.GTC)).result
        val buy = fixture.service.create(buyer, UUID.randomUUID(), CreateMarketOrderRequest(fixture.instrument.instrumentId, MarketOrderSide.BUY, 3, 100, MarketTimeInForce.IOC)).result
        assertEquals(90, buy.fills.single().unitPrice)
        assertEquals(3, buy.filledQuantity)
        assertEquals(2, fixture.repository.orders.getValue(sell.orderId).remainingQuantity)
        assertEquals(730, fixture.wallet.balances[buyer])
        assertEquals(3, fixture.inventory.stacks.getValue(buyer to "POTATO_M1").quantity)
    }

    @Test
    fun `resting buy reserves rice and creates delivery`() {
        val fixture = fixture()
        fixture.inventory.stacks[seller to "POTATO_M1"] = InventoryStack(seller, "POTATO_M1", 4, 0, 1)
        val buy = fixture.service.create(buyer, UUID.randomUUID(), CreateMarketOrderRequest(fixture.instrument.instrumentId, MarketOrderSide.BUY, 4, 100, MarketTimeInForce.GTC)).result
        assertEquals(600, fixture.wallet.balances[buyer])
        fixture.service.create(seller, UUID.randomUUID(), CreateMarketOrderRequest(fixture.instrument.instrumentId, MarketOrderSide.SELL, 2, 80, MarketTimeInForce.IOC))
        assertEquals(1, fixture.repository.deliveries.size)
        assertEquals(200, fixture.repository.orders.getValue(buy.orderId).reservedRice)
        assertEquals(600, fixture.wallet.balances[buyer])
    }

    @Test
    fun `buying skips own listings but fills another sellers listing`() {
        val fixture = fixture()
        fixture.inventory.stacks[buyer to "POTATO_M1"] = InventoryStack(buyer, "POTATO_M1", 2, 0, 1)
        fixture.inventory.stacks[seller to "POTATO_M1"] = InventoryStack(seller, "POTATO_M1", 1, 0, 1)
        val ownSell = fixture.service.create(buyer, UUID.randomUUID(), CreateMarketOrderRequest(fixture.instrument.instrumentId, MarketOrderSide.SELL, 2, 100, MarketTimeInForce.GTC)).result
        val otherSell = fixture.service.create(seller, UUID.randomUUID(), CreateMarketOrderRequest(fixture.instrument.instrumentId, MarketOrderSide.SELL, 1, 90, MarketTimeInForce.GTC)).result

        val quote = fixture.service.quote(buyer, fixture.instrument.instrumentId, MarketOrderSide.BUY, MarketTimeInForce.IOC, 2, 100)
        assertEquals(1, quote.expectedFilledQuantity)
        assertEquals(90, quote.totalPrice)

        val buy = fixture.service.create(buyer, UUID.randomUUID(), CreateMarketOrderRequest(fixture.instrument.instrumentId, MarketOrderSide.BUY, 2, 100, MarketTimeInForce.IOC)).result
        assertEquals(1, buy.filledQuantity)
        assertEquals(2, fixture.repository.orders.getValue(ownSell.orderId).remainingQuantity)
        assertEquals(0, fixture.repository.orders.getValue(otherSell.orderId).remainingQuantity)
    }

    @Test
    fun `buy quote ignores own listing when it is the only available listing`() {
        val fixture = fixture()
        fixture.inventory.stacks[buyer to "POTATO_M1"] = InventoryStack(buyer, "POTATO_M1", 1, 0, 1)
        fixture.service.create(buyer, UUID.randomUUID(), CreateMarketOrderRequest(fixture.instrument.instrumentId, MarketOrderSide.SELL, 1, 100, MarketTimeInForce.GTC))

        val quote = fixture.service.quote(buyer, fixture.instrument.instrumentId, MarketOrderSide.BUY, MarketTimeInForce.IOC, 1, 100)
        assertEquals(0, quote.expectedFilledQuantity)
        assertEquals(0, quote.totalPrice)
    }

    @Test
    fun `sell IOC fills resting buy from escrow without a second debit`() {
        val fixture = fixture()
        fixture.inventory.stacks[seller to "POTATO_M1"] = InventoryStack(seller, "POTATO_M1", 3, 0, 1)
        fixture.service.create(buyer, UUID.randomUUID(), CreateMarketOrderRequest(fixture.instrument.instrumentId, MarketOrderSide.BUY, 3, 100, MarketTimeInForce.GTC))
        assertEquals(700, fixture.wallet.balances[buyer])

        fixture.service.create(seller, UUID.randomUUID(), CreateMarketOrderRequest(fixture.instrument.instrumentId, MarketOrderSide.SELL, 2, 90, MarketTimeInForce.IOC))

        assertEquals(700, fixture.wallet.balances[buyer])
        assertEquals(100, fixture.repository.orders.values.single { it.accountId == buyer }.reservedRice)
        assertEquals(1, fixture.repository.deliveries.size)
    }

    @Test
    fun `sell quote sums fee per maker fill`() {
        val fixture = fixture()
        val otherBuyer = UUID(0, 3)
        fixture.wallet.balances[otherBuyer] = 1_000
        fixture.service.create(buyer, UUID.randomUUID(), CreateMarketOrderRequest(fixture.instrument.instrumentId, MarketOrderSide.BUY, 1, 15, MarketTimeInForce.GTC))
        fixture.service.create(otherBuyer, UUID.randomUUID(), CreateMarketOrderRequest(fixture.instrument.instrumentId, MarketOrderSide.BUY, 1, 15, MarketTimeInForce.GTC))

        val quote = fixture.service.quote(seller, fixture.instrument.instrumentId, MarketOrderSide.SELL, MarketTimeInForce.IOC, 2, 10)

        assertEquals(2, quote.expectedFee)
        assertEquals(28, quote.expectedSettlementAmount)
    }

    @Test
    fun `price levels preserve global cumulative values across exclusive pages`() {
        val fixture = fixture()
        val otherSeller = UUID(0, 3)
        fixture.inventory.stacks[seller to "POTATO_M1"] = InventoryStack(seller, "POTATO_M1", 3, 0, 1)
        fixture.inventory.stacks[otherSeller to "POTATO_M1"] = InventoryStack(otherSeller, "POTATO_M1", 3, 0, 1)
        fixture.service.create(seller, UUID.randomUUID(), CreateMarketOrderRequest(fixture.instrument.instrumentId, MarketOrderSide.SELL, 1, 100, MarketTimeInForce.GTC))
        fixture.service.create(otherSeller, UUID.randomUUID(), CreateMarketOrderRequest(fixture.instrument.instrumentId, MarketOrderSide.SELL, 1, 110, MarketTimeInForce.GTC))
        fixture.service.create(otherSeller, UUID.randomUUID(), CreateMarketOrderRequest(fixture.instrument.instrumentId, MarketOrderSide.SELL, 1, 120, MarketTimeInForce.GTC))

        val first = fixture.service.priceLevels(seller, fixture.instrument.instrumentId, MarketOrderSide.SELL, null, 1)
        assertEquals(listOf(100L), first.items.map { it.unitPrice })
        assertEquals(1L, first.items.single().cumulativeQuantity)
        assertEquals(0L, first.items.single().cumulativeOtherQuantity)
        assertEquals(100L, first.nextUnitPrice)

        val second = fixture.service.priceLevels(seller, fixture.instrument.instrumentId, MarketOrderSide.SELL, first.nextUnitPrice, 2)
        assertEquals(listOf(110L, 120L), second.items.map { it.unitPrice })
        assertEquals(listOf(2L, 3L), second.items.map { it.cumulativeQuantity })
        assertEquals(listOf(1L, 2L), second.items.map { it.cumulativeOtherQuantity })
        assertEquals(null, second.nextUnitPrice)
    }

    @Test
    fun `candle periods expose the requested time window`() {
        val fixture = fixture()
        val expected = listOf(
            "12h" to now.minusSeconds(12 * 60 * 60),
            "1d" to now.minusSeconds(24 * 60 * 60),
            "2d" to now.minusSeconds(48 * 60 * 60),
        )

        expected.forEach { (bucket, from) ->
            val result = fixture.service.candles(buyer, fixture.instrument.instrumentId, MarketCandleInterval.FIVE_MINUTES, MarketCandlePeriod.parse(bucket))

            assertEquals("5m:$bucket", result.interval)
            assertEquals(from, result.from)
            assertEquals(now, result.to)
        }
    }

    @Test
    fun `change state exposes compact market and account versions`() {
        val fixture = fixture()
        fixture.repository.unread[buyer to MarketUnreadStream.FILLS] = 3

        val state = fixture.service.changeState(buyer)

        assertEquals(1L, state.accountStateVersion)
        assertEquals(
            fixture.repository.instruments.values.sortedBy { it.instrumentId }.map { MarketInstrumentRevision(it.instrumentId, it.marketRevision) },
            state.instruments,
        )
        assertEquals(3L, state.unread.single { it.stream == MarketUnreadStream.FILLS }.latestSequence)
        assertEquals(0L, state.unread.single { it.stream == MarketUnreadStream.DELIVERIES }.latestSequence)
    }


    @Test
    fun `one buy settles every same price maker through one batch per record kind`() {
        val fixture = fixture()
        val sellers = fixture.restSellOrders(count = 3, quantity = 1, unitPrice = 90)

        val buy = fixture.service.create(buyer, UUID.randomUUID(), CreateMarketOrderRequest(fixture.instrument.instrumentId, MarketOrderSide.BUY, 3, 100, MarketTimeInForce.IOC)).result

        assertEquals(3, buy.filledQuantity)
        assertEquals(3, buy.fills.size)
        assertEquals(270, buy.totalPrice)
        assertEquals(730, fixture.wallet.balances[buyer])
        assertEquals(3, fixture.inventory.stacks.getValue(buyer to "POTATO_M1").quantity)
        sellers.forEach { (_, orderId) -> assertEquals(0, fixture.repository.orders.getValue(orderId).remainingQuantity) }
        sellers.forEach { (_, orderId) -> assertEquals(MarketOrderStatus.FILLED, fixture.repository.orders.getValue(orderId).status) }

        assertEquals(1, fixture.repository.tradeBatches)
        assertEquals(0, fixture.repository.singleTradeInserts)
        assertEquals(1, fixture.repository.orderUpdateBatches)
        assertEquals(1, fixture.repository.unreadBatches)
        assertEquals(0, fixture.repository.singleUnreadAppends)
        assertEquals(1, fixture.mail.settlementBatches)
        assertEquals(1, fixture.wallet.balanceUpdates)
        assertEquals(0, fixture.repository.orderReads)
    }

    @Test
    fun `batched settlement keeps one trade record and one ledger row per maker fill`() {
        val fixture = fixture()
        val sellers = fixture.restSellOrders(count = 3, quantity = 1, unitPrice = 90)

        val buy = fixture.service.create(buyer, UUID.randomUUID(), CreateMarketOrderRequest(fixture.instrument.instrumentId, MarketOrderSide.BUY, 3, 100, MarketTimeInForce.IOC)).result

        assertEquals(3, fixture.repository.trades.size)
        assertEquals(buy.fills.map { it.tradeId }, fixture.repository.trades.map { it.tradeId })
        val ledger = fixture.wallet.ledger.filter { it.accountId == buyer }
        assertEquals(listOf(-90L, -90L, -90L), ledger.map { it.delta })
        assertEquals(buy.fills.map { it.tradeId }, ledger.map { it.sourceId })
        assertEquals(3, fixture.mail.settlements.size)
        assertEquals(listOf(81L, 81L, 81L), fixture.mail.settlements.map { it.riceAmount })
        assertEquals(sellers.map { it.first }.toSet(), fixture.mail.settlements.map { it.accountId }.toSet())
        assertEquals(3, fixture.repository.unread[buyer to MarketUnreadStream.FILLS])
        sellers.forEach { (account, _) ->
            assertEquals(1, fixture.repository.unread[account to MarketUnreadStream.FILLS])
            assertEquals(1, fixture.repository.unread[account to MarketUnreadStream.SETTLEMENTS])
        }
    }

    @Test
    fun `batched settlement follows strict price then time priority`() {
        val fixture = fixture(clock = TickingClock(now))
        val expensive = fixture.restSellOrders(count = 1, quantity = 1, unitPrice = 100, firstSellerIndex = 20).single()
        val earlyCheap = fixture.restSellOrders(count = 1, quantity = 1, unitPrice = 90, firstSellerIndex = 21).single()
        val lateCheap = fixture.restSellOrders(count = 1, quantity = 1, unitPrice = 90, firstSellerIndex = 22).single()

        val buy = fixture.service.create(buyer, UUID.randomUUID(), CreateMarketOrderRequest(fixture.instrument.instrumentId, MarketOrderSide.BUY, 3, 100, MarketTimeInForce.IOC)).result

        assertEquals(listOf(earlyCheap.second, lateCheap.second, expensive.second), buy.fills.map { it.makerOrderId })
        assertEquals(listOf(90L, 90L, 100L), buy.fills.map { it.unitPrice })
        assertEquals(280, buy.totalPrice)
        assertEquals(720, fixture.wallet.balances[buyer])
    }

    @Test
    fun `batched settlement fills only what the book offers`() {
        val fixture = fixture()
        fixture.restSellOrders(count = 2, quantity = 1, unitPrice = 90)

        val buy = fixture.service.create(buyer, UUID.randomUUID(), CreateMarketOrderRequest(fixture.instrument.instrumentId, MarketOrderSide.BUY, 5, 100, MarketTimeInForce.IOC)).result

        assertEquals(2, buy.filledQuantity)
        assertEquals(3, buy.remainingQuantity)
        assertEquals(MarketOrderStatus.PARTIALLY_FILLED_CLOSED, buy.status)
        assertEquals(0, fixture.repository.orders.getValue(buy.orderId).remainingQuantity)
        assertEquals(820, fixture.wallet.balances[buyer])
        assertEquals(2, fixture.inventory.stacks.getValue(buyer to "POTATO_M1").quantity)
    }

    @Test
    fun `one maker and many makers settle to the same totals`() {
        val single = fixture()
        single.restSellOrders(count = 1, quantity = 5, unitPrice = 90)
        val singleBuy = single.service.create(buyer, UUID.randomUUID(), CreateMarketOrderRequest(single.instrument.instrumentId, MarketOrderSide.BUY, 5, 100, MarketTimeInForce.IOC)).result

        val many = fixture()
        many.restSellOrders(count = 5, quantity = 1, unitPrice = 90)
        val manyBuy = many.service.create(buyer, UUID.randomUUID(), CreateMarketOrderRequest(many.instrument.instrumentId, MarketOrderSide.BUY, 5, 100, MarketTimeInForce.IOC)).result

        assertEquals(singleBuy.filledQuantity, manyBuy.filledQuantity)
        assertEquals(singleBuy.totalPrice, manyBuy.totalPrice)
        assertEquals(singleBuy.status, manyBuy.status)
        assertEquals(single.wallet.balances[buyer], many.wallet.balances[buyer])
        assertEquals(single.inventory.stacks.getValue(buyer to "POTATO_M1").quantity, many.inventory.stacks.getValue(buyer to "POTATO_M1").quantity)
        assertEquals(single.repository.trades.sumOf { it.quantity }, many.repository.trades.sumOf { it.quantity })
        assertEquals(single.repository.trades.sumOf { it.totalPrice }, many.repository.trades.sumOf { it.totalPrice })
        assertEquals(single.repository.trades.sumOf { it.fee }, many.repository.trades.sumOf { it.fee })
        assertEquals(single.mail.settlements.sumOf { it.riceAmount }, many.mail.settlements.sumOf { it.riceAmount })
        assertEquals(1, single.repository.trades.size)
        assertEquals(5, many.repository.trades.size)
    }

    @Test
    fun `buy GTC returns every price improvement through one balance update`() {
        val fixture = fixture()
        fixture.restSellOrders(count = 3, quantity = 1, unitPrice = 90)

        val buy = fixture.service.create(buyer, UUID.randomUUID(), CreateMarketOrderRequest(fixture.instrument.instrumentId, MarketOrderSide.BUY, 3, 100, MarketTimeInForce.GTC)).result

        assertEquals(3, buy.filledQuantity)
        assertEquals(MarketOrderStatus.FILLED, buy.status)
        assertEquals(0, buy.reservedRice)
        // 300을 예약해 두고 90에 체결됐으므로 30이 돌아온다.
        assertEquals(730, fixture.wallet.balances[buyer])
        assertEquals(2, fixture.wallet.balanceUpdates)
        val credits = fixture.wallet.ledger.filter { it.sourceType == "MARKET_ORDER_PRICE_IMPROVEMENT" }
        assertEquals(listOf(10L, 10L, 10L), credits.map { it.delta })
        assertEquals(buy.fills.map { it.tradeId }, credits.map { it.sourceId })
        assertEquals(1, fixture.repository.deliveryBatches)
        assertEquals(0, fixture.repository.singleDeliveryInserts)
        assertEquals(3, fixture.repository.deliveries.size)
        assertEquals(3, fixture.repository.unread[buyer to MarketUnreadStream.DELIVERIES])
    }

    @Test
    fun `sell IOC settles every resting buy maker in one batch`() {
        val fixture = fixture()
        val buyers = (0 until 3).map { index -> UUID(0, (30 + index).toLong()) }
        buyers.forEach { account ->
            fixture.wallet.balances[account] = 1_000
            fixture.service.create(account, UUID.randomUUID(), CreateMarketOrderRequest(fixture.instrument.instrumentId, MarketOrderSide.BUY, 1, 100, MarketTimeInForce.GTC))
        }
        fixture.inventory.stacks[seller to "POTATO_M1"] = InventoryStack(seller, "POTATO_M1", 3, 0, 1)

        val sell = fixture.service.create(seller, UUID.randomUUID(), CreateMarketOrderRequest(fixture.instrument.instrumentId, MarketOrderSide.SELL, 3, 90, MarketTimeInForce.IOC)).result

        assertEquals(3, sell.filledQuantity)
        assertEquals(listOf(100L, 100L, 100L), sell.fills.map { it.unitPrice })
        assertEquals(1, fixture.repository.tradeBatches)
        assertEquals(1, fixture.repository.deliveryBatches)
        assertEquals(3, fixture.repository.deliveries.size)
        assertEquals(1, fixture.repository.unreadBatches)
        assertEquals(3, fixture.mail.settlements.size)
        assertEquals(listOf(seller, seller, seller), fixture.mail.settlements.map { it.accountId })
        // 매수자는 주문할 때 이미 예약했으므로 체결로 다시 빠지지 않는다.
        buyers.forEach { account -> assertEquals(900, fixture.wallet.balances[account]) }
    }

    @Test
    fun `replaying one idempotency key does not settle twice`() {
        val fixture = fixture()
        fixture.restSellOrders(count = 3, quantity = 1, unitPrice = 90)
        val key = UUID.randomUUID()
        val request = CreateMarketOrderRequest(fixture.instrument.instrumentId, MarketOrderSide.BUY, 3, 100, MarketTimeInForce.IOC)

        val first = fixture.service.create(buyer, key, request)
        val replay = fixture.service.create(buyer, key, request)

        assertEquals(first.commandId, replay.commandId)
        assertEquals(first.result.fills.map { it.tradeId }, replay.result.fills.map { it.tradeId })
        assertEquals(3, fixture.repository.trades.size)
        assertEquals(3, fixture.mail.settlements.size)
        assertEquals(730, fixture.wallet.balances[buyer])
        assertEquals(3, fixture.inventory.stacks.getValue(buyer to "POTATO_M1").quantity)
        assertEquals(1, fixture.repository.tradeBatches)
    }

    @Test
    fun `trade events carry both sides without reading the matched orders again`() {
        val fixture = fixture()
        val sellers = fixture.restSellOrders(count = 3, quantity = 1, unitPrice = 90)
        fixture.events.published.clear()

        val buy = fixture.service.create(buyer, UUID.randomUUID(), CreateMarketOrderRequest(fixture.instrument.instrumentId, MarketOrderSide.BUY, 3, 100, MarketTimeInForce.IOC)).result

        assertEquals(0, fixture.repository.orderReads)
        val trades = fixture.events.published.filter { it.eventType == "MARKET_TRADE_COMPLETED" }
        assertEquals(3, trades.size)
        assertEquals(buy.fills.map { it.tradeId }, trades.map { it.aggregateId })
        assertEquals(listOf(buyer, buyer, buyer), trades.map { it.payload["buyerAccountId"] })
        assertEquals(sellers.map { it.first }.toSet(), trades.map { it.payload["sellerAccountId"] }.toSet())
        assertEquals(1, fixture.events.published.count { it.eventType == "MARKET_ORDER_CREATED" })
    }

    private fun fixture(itemId: String = "POTATO_M1", clock: Clock = Clock.fixed(now, ZoneOffset.UTC)): Fixture {
        val catalog = StaticItemCatalog()
        val inventory = MemoryInventory()
        val wallet = MemoryWallet(mutableMapOf(buyer to 1_000L, seller to 0L))
        val repository = MemoryOrderBook(now)
        val mapper = ObjectMapper().findAndRegisterModules()
        val inventoryService = com.hanjjak.inventory.application.MarketInventoryService(inventory, catalog)
        val walletService = WalletService(wallet)
        val mailRepository = MemoryMail()
        val mail = MailService(mailRepository, walletService, mapper, clock)
        val catalogSync = MarketInstrumentCatalog(repository, catalog, clock)
        val events = RecordingEvents()
        val service = OrderBookService(repository, inventoryService, walletService, mail, catalog, mapper, clock, events, catalogSync)
        catalogSync.synchronize()
        val instrument = repository.instruments.values.first { it.itemId == itemId }
        return Fixture(service, repository, inventory, wallet, mailRepository, events, instrument)
    }

    private data class Fixture(
        val service: OrderBookService,
        val repository: MemoryOrderBook,
        val inventory: MemoryInventory,
        val wallet: MemoryWallet,
        val mail: MemoryMail,
        val events: RecordingEvents,
        val instrument: MarketInstrument,
    ) {
        /** 같은 가격·수량의 판매 주문을 여러 계정으로 올린다. 먼저 올린 계정이 먼저 체결돼야 한다. */
        fun restSellOrders(count: Int, quantity: Long, unitPrice: Long, firstSellerIndex: Int = 10): List<Pair<UUID, UUID>> =
            (0 until count).map { index ->
                val account = UUID(0, (firstSellerIndex + index).toLong())
                inventory.stacks[account to instrument.itemId] = InventoryStack(account, instrument.itemId, quantity, 0, 1)
                val order = service.create(account, UUID.randomUUID(), CreateMarketOrderRequest(instrument.instrumentId, MarketOrderSide.SELL, quantity, unitPrice, MarketTimeInForce.GTC)).result
                account to order.orderId
            }
    }

    /** 주문마다 다른 우선순위 시각을 주려고 호출할 때마다 1밀리초씩 나아간다. */
    private class TickingClock(private val start: Instant) : Clock() {
        private var ticks = 0L
        override fun getZone(): java.time.ZoneId = ZoneOffset.UTC
        override fun withZone(zone: java.time.ZoneId?): Clock = this
        override fun instant(): Instant = start.plusMillis(ticks++)
    }

    private class RecordingEvents : com.hanjjak.events.application.DomainEventPublisher {
        val published = mutableListOf<com.hanjjak.events.application.DomainEventPublishRequest>()
        override fun publish(request: com.hanjjak.events.application.DomainEventPublishRequest): UUID {
            published += request
            return UUID.randomUUID()
        }
        override fun publishAll(requests: List<com.hanjjak.events.application.DomainEventPublishRequest>): List<UUID> = requests.map(::publish)
    }

    private class MemoryInventory : InventoryRepository {
        val stacks = mutableMapOf<Pair<UUID, String>, InventoryStack>()
        override fun lockAccount(accountId: UUID) = Unit
        override fun stateVersion(accountId: UUID) = 1L
        override fun incrementStateVersion(accountId: UUID) = 2L
        override fun stacks(accountId: UUID) = stacks.values.filter { it.accountId == accountId }
        override fun instances(accountId: UUID) = emptyList<InventoryInstance>()
        override fun saveStack(stack: InventoryStack) { stacks[stack.accountId to stack.itemId] = stack }
        override fun addInstance(instance: InventoryInstance) = Unit
        override fun removeInstances(accountId: UUID, instanceIds: List<UUID>) = Unit
        override fun setInstancesReserved(accountId: UUID, instanceIds: List<UUID>, reserved: Boolean) = Unit
        override fun transferInstances(fromAccountId: UUID, toAccountId: UUID, instanceIds: List<UUID>, reserved: Boolean) = Unit
        override fun hasCapacityReservation(accountId: UUID, itemId: String) = false
        override fun lockStack(accountId: UUID, itemId: String) = stacks[accountId to itemId]
        override fun usedSlotCount(accountId: UUID) = stacks(accountId).count { it.quantity > 0 }
        override fun nextAcquiredSequence(accountId: UUID) = 1L
        override fun rewardCommand(accountId: UUID, idempotencyKey: UUID) = null
        override fun saveRewardCommand(accountId: UUID, idempotencyKey: UUID, fingerprint: String, resultJson: String) = Unit
    }

    private class MemoryWallet(val balances: MutableMap<UUID, Long>) : WalletRepository {
        data class LedgerRow(val accountId: UUID, val delta: Long, val sourceType: String, val sourceId: UUID)

        val ledger = mutableListOf<LedgerRow>()
        var balanceUpdates = 0
        override fun lockBalance(accountId: UUID) = balances[accountId] ?: 0
        override fun applyDelta(accountId: UUID, delta: Long, sourceType: String, sourceId: UUID, bumpStateVersion: Boolean): Long {
            val next = Math.addExact(lockBalance(accountId), delta)
            require(next >= 0) { "INSUFFICIENT_RICE" }
            balances[accountId] = next
            balanceUpdates++
            ledger += LedgerRow(accountId, delta, sourceType, sourceId)
            return next
        }
        override fun applyBatchedDebit(accountId: UUID, entries: List<WalletDebitEntry>, bumpStateVersion: Boolean): Long {
            val next = Math.addExact(lockBalance(accountId), -entries.sumOf { it.amount })
            require(next >= 0) { "INSUFFICIENT_RICE" }
            balances[accountId] = next
            balanceUpdates++
            entries.forEach { ledger += LedgerRow(accountId, -it.amount, it.sourceType, it.sourceId) }
            return next
        }
        override fun applyBatchedCredit(accountId: UUID, entries: List<WalletCreditEntry>, bumpStateVersion: Boolean): Long {
            val next = Math.addExact(lockBalance(accountId), entries.sumOf { it.amount })
            balances[accountId] = next
            balanceUpdates++
            entries.forEach { ledger += LedgerRow(accountId, it.amount, it.sourceType, it.sourceId) }
            return next
        }
    }

    private class MemoryMail : MailRepository {
        val settlements = mutableListOf<SettlementMailRequest>()
        var settlementBatches = 0
        override fun stateVersion(accountId: UUID) = 1L
        override fun command(accountId: UUID, idempotencyKey: UUID) = null
        override fun saveCommand(commandId: UUID, accountId: UUID, idempotencyKey: UUID, fingerprint: String, resultJson: String) = Unit
        override fun createSettlementMail(accountId: UUID, tradeId: UUID, riceAmount: Long): UUID {
            settlements += SettlementMailRequest(accountId, tradeId, riceAmount)
            return UUID.randomUUID()
        }
        override fun createSettlementMails(requests: List<SettlementMailRequest>): List<UUID> {
            if (requests.isEmpty()) return emptyList()
            settlementBatches++
            settlements += requests
            return requests.map { UUID.randomUUID() }
        }
        override fun list(accountId: UUID, claimable: Boolean?, cursor: Instant?, type: String?, limit: Int) = emptyList<MailMessage>()
        override fun lockClaimable(accountId: UUID, mailId: UUID) = null
        override fun lockClaimableAll(accountId: UUID, type: String?) = emptyList<MailMessage>()
        override fun markClaimed(mailIds: List<UUID>, claimedAt: Instant) = Unit
        override fun lockOwned(accountId: UUID, mailId: UUID) = null
        override fun markRead(mailId: UUID, readAt: Instant) = Unit
        override fun markDeleted(mailId: UUID, deletedAt: Instant) = Unit
    }

    private class MemoryOrderBook(private val now: Instant) : OrderBookRepository {
        val instruments = mutableMapOf<UUID, MarketInstrument>()
        val orders = mutableMapOf<UUID, MarketOrder>()
        val deliveries = mutableMapOf<UUID, MarketDelivery>()
        val trades = mutableListOf<OrderBookRepository.TradeInsert>()
        val unread = mutableMapOf<Pair<UUID, MarketUnreadStream>, Long>()
        val mutations = mutableMapOf<UUID, Int>()
        val commands = mutableMapOf<Pair<UUID, UUID>, OrderBookRepository.StoredCommand>()
        val unreadEvents = mutableListOf<OrderBookRepository.UnreadAppend>()
        var orderReads = 0
        var singleTradeInserts = 0
        var tradeBatches = 0
        var singleOrderUpdates = 0
        var orderUpdateBatches = 0
        var singleUnreadAppends = 0
        var unreadBatches = 0
        var singleDeliveryInserts = 0
        var deliveryBatches = 0
        override fun stateVersion(accountId: UUID) = 1L
        override fun command(accountId: UUID, idempotencyKey: UUID) = commands[accountId to idempotencyKey]
        override fun saveCommand(commandId: UUID, accountId: UUID, idempotencyKey: UUID, fingerprint: String, resultJson: String) {
            commands[accountId to idempotencyKey] = OrderBookRepository.StoredCommand(commandId, fingerprint, resultJson)
        }
        override fun synchronizeInstruments(instruments: List<MarketInstrument>, now: Instant) { instruments.forEach { this.instruments[it.instrumentId] = it } }
        override fun instruments(accountId: UUID) = instruments.values.map { MarketInstrumentSummary(it.instrumentId, it.canonicalKey, it.itemId, it.displayName, it.category, it.attributes, it.status, null, null, null, it.marketRevision) }
        override fun instrumentRevisions() = instruments.values.sortedBy { it.instrumentId }.map { MarketInstrumentRevision(it.instrumentId, it.marketRevision) }
        override fun instrument(instrumentId: UUID) = instruments[instrumentId]
        override fun lockInstrument(instrumentId: UUID) = instruments[instrumentId]
        override fun incrementRevision(instrumentId: UUID): Long { val current = instruments.getValue(instrumentId); val next = current.marketRevision + 1; instruments[instrumentId] = current.copy(marketRevision = next); return next }
        override fun lockAccountControl(accountId: UUID, now: Instant) = OrderBookRepository.MutationWindow(mutations[accountId] ?: 0, orders.values.count { it.accountId == accountId && it.status in setOf(MarketOrderStatus.ACTIVE, MarketOrderStatus.PARTIALLY_FILLED) })
        override fun appendMutation(mutationId: UUID, accountId: UUID, instrumentId: UUID, orderId: UUID, side: MarketOrderSide, type: String, commandId: UUID, createdAt: Instant) { mutations[accountId] = (mutations[accountId] ?: 0) + 1 }
        override fun order(orderId: UUID) = orders[orderId].also { orderReads++ }
        override fun lockOrder(orderId: UUID) = orders[orderId]
        override fun createOrder(order: MarketOrder) { orders[order.orderId] = order }
        override fun updateOrder(order: MarketOrder) { singleOrderUpdates++; orders[order.orderId] = order }
        override fun updateOrders(orders: List<MarketOrder>) {
            if (orders.isEmpty()) return
            orderUpdateBatches++
            orders.forEach { this.orders[it.orderId] = it }
        }
        override fun matchCandidatesForUpdate(instrumentId: UUID, accountId: UUID, incomingSide: MarketOrderSide, limitUnitPrice: Long, quantity: Long, now: Instant) = candidates(instrumentId, accountId, incomingSide, limitUnitPrice, quantity)
        override fun quoteCandidates(instrumentId: UUID, accountId: UUID, incomingSide: MarketOrderSide, limitUnitPrice: Long, quantity: Long, now: Instant) = candidates(instrumentId, accountId, incomingSide, limitUnitPrice, quantity)
        private fun candidates(instrumentId: UUID, accountId: UUID, incomingSide: MarketOrderSide, limitUnitPrice: Long, quantity: Long): List<MarketOrder> {
            val ordered = orders.values.filter { it.instrumentId == instrumentId && it.accountId != accountId && it.side != incomingSide && it.status in setOf(MarketOrderStatus.ACTIVE, MarketOrderStatus.PARTIALLY_FILLED) && if (incomingSide == MarketOrderSide.BUY) it.limitUnitPrice <= limitUnitPrice else it.limitUnitPrice >= limitUnitPrice }.sortedWith(if (incomingSide == MarketOrderSide.BUY) compareBy<MarketOrder> { it.limitUnitPrice }.thenBy { it.priorityAt }.thenBy { it.orderId } else compareByDescending<MarketOrder> { it.limitUnitPrice }.thenBy { it.priorityAt }.thenBy { it.orderId })
            var remaining = quantity
            return ordered.takeWhile { candidate -> (remaining > 0).also { remaining -= candidate.remainingQuantity } }
        }
        override fun crossingOwnOrder(instrumentId: UUID, accountId: UUID, incomingSide: MarketOrderSide, limitUnitPrice: Long, now: Instant) = orders.values.any { it.instrumentId == instrumentId && it.accountId == accountId && it.side != incomingSide && it.status in setOf(MarketOrderStatus.ACTIVE, MarketOrderStatus.PARTIALLY_FILLED) && if (incomingSide == MarketOrderSide.BUY) it.limitUnitPrice <= limitUnitPrice else it.limitUnitPrice >= limitUnitPrice }
        override fun depth(instrumentId: UUID, accountId: UUID, side: MarketOrderSide, levels: Int, now: Instant) = emptyList<MarketDepthLevel>()
        override fun priceLevels(instrumentId: UUID, accountId: UUID, side: MarketOrderSide, afterUnitPrice: Long?, limit: Int, now: Instant): List<MarketPriceLevel> {
            val prices = orders.values.asSequence().filter { it.instrumentId == instrumentId && it.side == side && it.status in setOf(MarketOrderStatus.ACTIVE, MarketOrderStatus.PARTIALLY_FILLED) }.groupBy { it.limitUnitPrice }
            val ordered = if (side == MarketOrderSide.BUY) prices.entries.sortedByDescending { it.key } else prices.entries.sortedBy { it.key }
            var cumulative = 0L
            var cumulativeOther = 0L
            val levels = ordered.map { (price, levelOrders) ->
                val total = levelOrders.sumOf { it.remainingQuantity }
                val mine = levelOrders.filter { it.accountId == accountId }.sumOf { it.remainingQuantity }
                cumulative = Math.addExact(cumulative, total)
                cumulativeOther = Math.addExact(cumulativeOther, total - mine)
                MarketPriceLevel(price, total, cumulative, mine, cumulativeOther)
            }
            return levels.filter { afterUnitPrice == null || if (side == MarketOrderSide.BUY) it.unitPrice < afterUnitPrice else it.unitPrice > afterUnitPrice }.take(limit)
        }
        override fun priceLevelCount(instrumentId: UUID, side: MarketOrderSide, now: Instant) = orders.values.count { it.instrumentId == instrumentId && it.side == side && it.status in setOf(MarketOrderStatus.ACTIVE, MarketOrderStatus.PARTIALLY_FILLED) }.toLong()
        override fun recentTrades(instrumentId: UUID, limit: Int) = trades.filter { it.instrumentId == instrumentId }.sortedWith(compareByDescending<OrderBookRepository.TradeInsert> { it.filledAt }.thenByDescending { it.tradeId }).take(limit).map { MarketRecentTrade(it.tradeId, it.quantity, it.unitPrice, it.totalPrice, it.filledAt) }
        override fun candles(instrumentId: UUID, interval: MarketCandleInterval, from: Instant, to: Instant) = emptyList<MarketCandle>()
        override fun listOrders(accountId: UUID, scope: MarketOrderScope, side: MarketOrderSide?, instrumentId: UUID?, cursor: OrderBookRepository.OrderCursor?, limit: Int) = emptyList<MarketOrderSummary>()
        override fun countOrders(accountId: UUID, scope: MarketOrderScope, side: MarketOrderSide?, instrumentId: UUID?) = 0L
        override fun expiredInstrumentIds(now: Instant, limit: Int) = emptyList<UUID>()
        override fun lockExpiredOrders(instrumentId: UUID, now: Instant, limit: Int) = emptyList<MarketOrder>()
        override fun listAdminOrders(orderId: UUID?, instrumentId: UUID?, cursor: OrderBookRepository.OrderCursor?, limit: Int) = emptyList<AdminMarketOrderSummary>()
        override fun ensureSystemMarketAccount(now: Instant) = UUID(0, 99)
        override fun isSystemMarketAccount(accountId: UUID) = accountId == UUID(0, 99)
        override fun createTrade(trade: OrderBookRepository.TradeInsert) { singleTradeInserts++; trades += trade }
        override fun createTrades(trades: List<OrderBookRepository.TradeInsert>) {
            if (trades.isEmpty()) return
            tradeBatches++
            this.trades += trades
        }
        override fun listTrades(accountId: UUID?, instrumentIds: List<UUID>, cursor: OrderBookRepository.TradeCursor?, limit: Int) = emptyList<MarketTradeView>()
        override fun countTrades(accountId: UUID?, instrumentIds: List<UUID>) = 0L
        override fun createDelivery(delivery: MarketDelivery) { singleDeliveryInserts++; deliveries[delivery.deliveryId] = delivery }
        override fun createDeliveries(deliveries: List<MarketDelivery>) {
            if (deliveries.isEmpty()) return
            deliveryBatches++
            deliveries.forEach { this.deliveries[it.deliveryId] = it }
        }
        override fun listDeliveries(accountId: UUID, claimable: Boolean?, cursor: OrderBookRepository.OrderCursor?, limit: Int) = deliveries.values.toList()
        override fun countDeliveries(accountId: UUID, claimable: Boolean?) = deliveries.size.toLong()
        override fun lockDelivery(accountId: UUID, deliveryId: UUID) = deliveries[deliveryId]
        override fun lockClaimableDeliveries(accountId: UUID) = deliveries.values.filter { it.claimedAt == null }
        override fun markDeliveriesClaimed(deliveryIds: List<UUID>, claimedAt: Instant) = Unit
        override fun appendUnread(accountId: UUID, stream: MarketUnreadStream, sourceId: UUID, createdAt: Instant): Long {
            singleUnreadAppends++
            return recordUnread(OrderBookRepository.UnreadAppend(accountId, stream, sourceId, createdAt))
        }
        override fun appendUnreads(entries: List<OrderBookRepository.UnreadAppend>): List<Long> {
            if (entries.isEmpty()) return emptyList()
            unreadBatches++
            return entries.map(::recordUnread)
        }
        private fun recordUnread(entry: OrderBookRepository.UnreadAppend): Long {
            val key = entry.accountId to entry.stream
            val next = (unread[key] ?: 0) + 1
            unread[key] = next
            unreadEvents += entry
            return next
        }
        override fun unreadStates(accountId: UUID) = MarketUnreadStream.entries.map { MarketUnreadState(it, unread[accountId to it] ?: 0, 0, unread[accountId to it] ?: 0) }
        override fun issueReadThrough(accountId: UUID, stream: MarketUnreadStream, sequence: Long) = Unit
        override fun advanceReadCursor(accountId: UUID, stream: MarketUnreadStream, sequence: Long) = sequence
        override fun migrateLegacyMarket(now: Instant) = emptyList<Pair<UUID, Long>>()
    }
}
