package com.hanjjak.gameapi

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.market.application.OrderBookService
import com.hanjjak.market.application.OrderBookRepository
import com.hanjjak.market.domain.CreateMarketOrderRequest
import com.hanjjak.market.domain.MarketOrderSide
import com.hanjjak.market.domain.MarketTimeInForce
import jakarta.servlet.http.Cookie
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.junit.jupiter.api.BeforeEach
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.MediaType
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.sql.DataSource

@GameApiIntegrationTest
class CraftingMarketE2ETest {
    @Autowired lateinit var mvc: MockMvc
    @Autowired lateinit var mapper: ObjectMapper
    @Autowired lateinit var jdbc: JdbcClient
    @Autowired lateinit var orders: OrderBookService
    @Autowired lateinit var orderRepository: OrderBookRepository
    @Autowired lateinit var dataSource: DataSource
    @Autowired lateinit var transactionManager: PlatformTransactionManager

    @BeforeEach
    fun synchronizeMarketCatalog() {
        orders.synchronizeCatalog()
    }


    @Test
    fun `unified sell GTC and buy IOC settle at maker price`() {
        val seller = AccountSession().apply { signup("seller-${UUID.randomUUID()}@test.local", "seller"); grantItem("POTATO_M1", 5) }
        val buyer = AccountSession().apply { signup("buyer-${UUID.randomUUID()}@test.local", "buyer"); setWallet(1_000) }
        val instrumentId = instrumentId("POTATO_M1")
        val sell = seller.postJson("/api/v1/market/orders", mapOf("instrumentId" to instrumentId, "side" to "SELL", "quantity" to 5, "limitUnitPrice" to 90, "timeInForce" to "GTC"))
        assertEquals("ACTIVE", sell.at("/data/result/status").asText())
        val buy = buyer.postJson("/api/v1/market/orders", mapOf("instrumentId" to instrumentId, "side" to "BUY", "quantity" to 3, "limitUnitPrice" to 100, "timeInForce" to "IOC"))
        assertEquals(3, buy.at("/data/result/filledQuantity").asLong())
        assertEquals(90, buy.at("/data/result/fills/0/unitPrice").asLong())
        assertEquals(730, wallet(buyer.accountId))
        assertEquals(3, quantity(buyer.accountId, "POTATO_M1"))
        assertEquals(243, seller.postJson("/api/v1/mails/claim-all", emptyMap<String, String>()).at("/data/result/totalRiceAmount").asLong())
    }

    @Test
    fun `resting BUY GTC creates claimable delivery and unread sequence`() {
        val seller = AccountSession().apply { signup("reserve-seller-${UUID.randomUUID()}@test.local", "seller"); grantItem("POTATO_M2", 3) }
        val buyer = AccountSession().apply { signup("reserve-buyer-${UUID.randomUUID()}@test.local", "buyer"); setWallet(1_000) }
        val instrumentId = instrumentId("POTATO_M2")
        buyer.postJson("/api/v1/market/orders", mapOf("instrumentId" to instrumentId, "side" to "BUY", "quantity" to 3, "limitUnitPrice" to 100, "timeInForce" to "GTC"))
        assertEquals(700, wallet(buyer.accountId))
        seller.postJson("/api/v1/market/orders", mapOf("instrumentId" to instrumentId, "side" to "SELL", "quantity" to 3, "limitUnitPrice" to 80, "timeInForce" to "IOC"))
        val deliveries = buyer.getJson("/api/v1/market/deliveries/me?claimable=true")
        assertEquals(1, deliveries.at("/data/items").size())
        assertTrue(deliveries.at("/data/readThroughSequence").asLong() > 0)
        val deliveryId = deliveries.at("/data/items/0/deliveryId").asText()
        buyer.postJson("/api/v1/market/deliveries/$deliveryId/claim", emptyMap<String, String>())
        assertEquals(3, quantity(buyer.accountId, "POTATO_M2"))
        assertEquals(700, wallet(buyer.accountId))
    }

    @Test
    fun `price pages retain global other liquidity and explicit terminal cursor`() {
        val mine = AccountSession().apply { signup("depth-mine-${UUID.randomUUID()}@test.local", "mine"); grantItem("POTATO_M3", 2) }
        val other = AccountSession().apply { signup("depth-other-${UUID.randomUUID()}@test.local", "other"); grantItem("POTATO_M3", 7) }
        val instrument = instrumentId("POTATO_M3")
        mine.postJson("/api/v1/market/orders", mapOf("instrumentId" to instrument, "side" to "SELL", "quantity" to 2, "limitUnitPrice" to 100, "timeInForce" to "GTC"))
        other.postJson("/api/v1/market/orders", mapOf("instrumentId" to instrument, "side" to "SELL", "quantity" to 3, "limitUnitPrice" to 110, "timeInForce" to "GTC"))
        other.postJson("/api/v1/market/orders", mapOf("instrumentId" to instrument, "side" to "SELL", "quantity" to 4, "limitUnitPrice" to 120, "timeInForce" to "GTC"))
        val path = "/api/v1/market/instruments/$instrument/price-levels?side=SELL&limit=2"
        val first = mine.getJson(path).path("data")
        assertEquals(listOf(100L, 110L), first.path("items").map { it.path("unitPrice").asLong() })
        assertEquals(listOf(0L, 3L), first.path("items").map { it.path("cumulativeOtherQuantity").asLong() })
        assertEquals(2L, first.at("/items/0/myQuantity").asLong())
        assertEquals(110L, first.path("nextUnitPrice").asLong())
        val last = mine.getJson("$path&afterUnitPrice=${first.path("nextUnitPrice").asLong()}").path("data")
        assertEquals(listOf(120L), last.path("items").map { it.path("unitPrice").asLong() })
        assertEquals(9L, last.at("/items/0/cumulativeQuantity").asLong())
        assertEquals(7L, last.at("/items/0/cumulativeOtherQuantity").asLong())
        assertEquals(first.path("marketRevision"), last.path("marketRevision"))
        assertTrue(last.path("nextUnitPrice").isNull)
    }

    @Test
    fun `order book reads do not wait for an instrument mutation lock`() {
        val account = AccountSession().apply { signup("read-lock-${UUID.randomUUID()}@test.local", "reader") }
        val instrument = UUID.fromString(instrumentId("CORN_M4"))

        dataSource.connection.use { lockingConnection ->
            lockingConnection.autoCommit = false
            lockingConnection.prepareStatement("select instrument_id from market_instrument where instrument_id=? for update").use { statement ->
                statement.setObject(1, instrument)
                statement.executeQuery().use { rows -> assertTrue(rows.next()) }
            }
            val executor = Executors.newSingleThreadExecutor()
            try {
                val read = executor.submit {
                    orders.orderBook(account.accountId, instrument, 5)
                    orders.priceLevels(account.accountId, instrument, MarketOrderSide.SELL, null, 5)
                    orders.quote(account.accountId, instrument, MarketOrderSide.BUY, MarketTimeInForce.IOC, 1, 100)
                }
                read.get(3, TimeUnit.SECONDS)
            } finally {
                lockingConnection.rollback()
                executor.shutdownNow()
            }
        }
    }

    @Test
    fun `quote does not wait for a maker order lock`() {
        val seller = AccountSession().apply { signup("quote-lock-seller-${UUID.randomUUID()}@test.local", "seller"); grantItem("CORN_M5", 1) }
        val buyer = AccountSession().apply { signup("quote-lock-buyer-${UUID.randomUUID()}@test.local", "buyer"); setWallet(1_000) }
        val instrument = UUID.fromString(instrumentId("CORN_M5"))
        val orderId = UUID.fromString(seller.postJson("/api/v1/market/orders", mapOf("instrumentId" to instrument, "side" to "SELL", "quantity" to 1, "limitUnitPrice" to 100, "timeInForce" to "GTC")).at("/data/result/orderId").asText())

        dataSource.connection.use { lockingConnection ->
            lockingConnection.autoCommit = false
            lockingConnection.prepareStatement("select order_id from market_order where order_id=? for update").use { statement ->
                statement.setObject(1, orderId)
                statement.executeQuery().use { rows -> assertTrue(rows.next()) }
            }
            val executor = Executors.newSingleThreadExecutor()
            try {
                val quote = executor.submit<com.hanjjak.market.domain.MarketOrderQuote> { orders.quote(buyer.accountId, instrument, MarketOrderSide.BUY, MarketTimeInForce.IOC, 1, 100) }
                assertEquals(1, quote.get(3, TimeUnit.SECONDS).expectedFilledQuantity)
            } finally {
                lockingConnection.rollback()
                executor.shutdownNow()
            }
        }
    }

    @Test
    fun `order book read leaves expiry settlement to the worker transaction`() {
        val seller = AccountSession().apply { signup("expiry-worker-${UUID.randomUUID()}@test.local", "seller"); grantItem("SWEET_POTATO_M4", 2) }
        val instrument = UUID.fromString(instrumentId("SWEET_POTATO_M4"))
        val orderId = UUID.fromString(seller.postJson("/api/v1/market/orders", mapOf("instrumentId" to instrument, "side" to "SELL", "quantity" to 2, "limitUnitPrice" to 100, "timeInForce" to "GTC")).at("/data/result/orderId").asText())
        jdbc.sql("update market_order set expires_at=now()-interval '1 second' where order_id=:order").param("order", orderId).update()

        orders.orderBook(seller.accountId, instrument, 5)
        assertEquals("ACTIVE", jdbc.sql("select status from market_order where order_id=:order").param("order", orderId).query(String::class.java).single())

        orders.expireInstrumentOrders(instrument, java.time.Instant.now(), 100)
        assertEquals("EXPIRED", jdbc.sql("select status from market_order where order_id=:order").param("order", orderId).query(String::class.java).single())
        assertEquals(2L, jdbc.sql("select quantity from market_delivery where order_id=:order and source='SELL_EXPIRE_RETURN'").param("order", orderId).query(Long::class.java).single())
    }

    @Test
    fun `trade locks only the strict price-time prefix needed for requested quantity`() {
        val sellers = (1..3).map { index ->
            AccountSession().apply {
                signup("prefix-seller-$index-${UUID.randomUUID()}@test.local", "seller")
                grantItem("SWEET_POTATO_M5", 1)
            }
        }
        val buyer = AccountSession().apply { signup("prefix-buyer-${UUID.randomUUID()}@test.local", "buyer"); setWallet(1_000) }
        val instrument = UUID.fromString(instrumentId("SWEET_POTATO_M5"))
        val orderIds = sellers.mapIndexed { index, seller ->
            UUID.fromString(seller.postJson("/api/v1/market/orders", mapOf("instrumentId" to instrument, "side" to "SELL", "quantity" to 1, "limitUnitPrice" to 100 + index * 10, "timeInForce" to "GTC")).at("/data/result/orderId").asText())
        }
        val candidatesLocked = CountDownLatch(1)
        val releaseCandidates = CountDownLatch(1)
        val executor = Executors.newSingleThreadExecutor()
        try {
            val locked = executor.submit<List<UUID>> {
                TransactionTemplate(transactionManager).execute {
                    val candidates = orderRepository.matchCandidatesForUpdate(instrument, buyer.accountId, MarketOrderSide.BUY, 999_999, 2, java.time.Instant.now())
                    candidatesLocked.countDown()
                    assertTrue(releaseCandidates.await(5, TimeUnit.SECONDS))
                    candidates.map { it.orderId }
                } ?: emptyList()
            }
            assertTrue(candidatesLocked.await(3, TimeUnit.SECONDS))
            assertTrue(canLockNowait(orderIds[2]))
            assertTrue(!canLockNowait(orderIds[0]))
            releaseCandidates.countDown()
            assertEquals(orderIds.take(2), locked.get(3, TimeUnit.SECONDS))
        } finally {
            releaseCandidates.countDown()
            executor.shutdownNow()
        }
    }

    private fun canLockNowait(orderId: UUID): Boolean = dataSource.connection.use { connection ->
        connection.autoCommit = false
        try {
            connection.prepareStatement("select order_id from market_order where order_id=? for update nowait").use { statement ->
                statement.setObject(1, orderId)
                statement.executeQuery().use { rows -> rows.next() }
            }
        } catch (error: java.sql.SQLException) {
            if (error.sqlState != "55P03") throw error
            false
        } finally {
            connection.rollback()
        }
    }

    @Test
    fun `change state reports compact versions before clients reload market data`() {
        val account = AccountSession().apply { signup("change-state-${UUID.randomUUID()}@test.local", "watcher"); grantItem("POTATO_M1", 1) }
        val instrument = instrumentId("POTATO_M1")
        val before = account.getJson("/api/v1/market/change-state").path("data")
        assertEquals(4, before.path("unread").size())
        val beforeRevision = before.path("instruments").first { it.path("instrumentId").asText() == instrument }.path("marketRevision").asLong()

        account.postJson("/api/v1/market/orders", mapOf("instrumentId" to instrument, "side" to "SELL", "quantity" to 1, "limitUnitPrice" to 100, "timeInForce" to "GTC"))

        val after = account.getJson("/api/v1/market/change-state").path("data")
        val afterRevision = after.path("instruments").first { it.path("instrumentId").asText() == instrument }.path("marketRevision").asLong()
        assertTrue(after.path("accountStateVersion").asLong() > before.path("accountStateVersion").asLong())
        assertTrue(afterRevision > beforeRevision)
    }

    @Test
    fun `one buy IOC settles every maker and keeps money items and records consistent`() {
        val sellers = (1..4).map { index ->
            AccountSession().apply { signup("batch-seller-$index-${UUID.randomUUID()}@test.local", "seller"); grantItem("SWEET_POTATO_M1", 2) }
        }
        val buyer = AccountSession().apply { signup("batch-buyer-${UUID.randomUUID()}@test.local", "buyer"); setWallet(10_000) }
        val instrument = instrumentId("SWEET_POTATO_M1")
        val sellOrderIds = sellers.map { seller ->
            UUID.fromString(seller.postJson("/api/v1/market/orders", mapOf("instrumentId" to instrument, "side" to "SELL", "quantity" to 2, "limitUnitPrice" to 100, "timeInForce" to "GTC")).at("/data/result/orderId").asText())
        }

        val buy = buyer.postJson("/api/v1/market/orders", mapOf("instrumentId" to instrument, "side" to "BUY", "quantity" to 8, "limitUnitPrice" to 120, "timeInForce" to "IOC"))
        val buyOrderId = UUID.fromString(buy.at("/data/result/orderId").asText())

        assertEquals(8, buy.at("/data/result/filledQuantity").asLong())
        assertEquals(4, buy.at("/data/result/fills").size())
        assertEquals(800, buy.at("/data/result/totalPrice").asLong())
        assertEquals(9_200, wallet(buyer.accountId))
        assertEquals(8, quantity(buyer.accountId, "SWEET_POTATO_M1"))
        sellers.forEach { seller -> assertEquals(0, quantity(seller.accountId, "SWEET_POTATO_M1")) }
        sellOrderIds.forEach { orderId ->
            assertEquals("FILLED", jdbc.sql("select status from market_order where order_id=:order").param("order", orderId).query(String::class.java).single())
            assertEquals(0L, jdbc.sql("select remaining_quantity from market_order where order_id=:order").param("order", orderId).query(Long::class.java).single())
        }

        assertEquals(listOf(4L, 8L, 800L, 80L, 720L), jdbc.sql("select count(*),coalesce(sum(quantity),0),coalesce(sum(total_price),0),coalesce(sum(fee),0),coalesce(sum(settlement_amount),0) from market_trade where taker_order_id=:order")
            .param("order", buyOrderId).query { row, _ -> (1..5).map { row.getLong(it) } }.single())
        assertEquals(sellOrderIds.toSet(), jdbc.sql("select maker_order_id from market_trade where taker_order_id=:order").param("order", buyOrderId).query(UUID::class.java).list().toSet())
        // 매수 IOC는 수령함을 거치지 않고 바로 옮긴다.
        assertEquals(0L, jdbc.sql("select count(*) from market_delivery where order_id=:order").param("order", buyOrderId).query(Long::class.java).single())
        assertEquals(listOf(4L, -800L), jdbc.sql("select count(*),coalesce(sum(delta),0) from wallet_ledger where account_id=:account and source_type='MARKET_ORDER_FILL'")
            .param("account", buyer.accountId).query { row, _ -> listOf(row.getLong(1), row.getLong(2)) }.single())
        assertEquals(listOf(1L, 2L, 3L, 4L), unreadSequences(buyer.accountId, "FILLS"))
        assertEquals(4L, latestUnreadSequence(buyer.accountId, "FILLS"))
        sellers.forEach { seller ->
            assertEquals(listOf(1L), unreadSequences(seller.accountId, "FILLS"))
            assertEquals(listOf(1L), unreadSequences(seller.accountId, "SETTLEMENTS"))
            assertEquals(180L, jdbc.sql("select rice_amount from mail_message where account_id=:account and type='MARKET_SETTLEMENT'").param("account", seller.accountId).query(Long::class.java).single())
        }
        assertEquals(4L, jdbc.sql("select count(*) from outbox_event where event_type='MARKET_TRADE_COMPLETED' and payload->'payload'->>'takerOrderId'=:order").param("order", buyOrderId.toString()).query(Long::class.java).single())
    }

    @Test
    fun `a failure in the middle of settlement rolls the whole order back`() {
        val sellers = (1..3).map { index ->
            AccountSession().apply { signup("rollback-seller-$index-${UUID.randomUUID()}@test.local", "seller"); grantItem("SWEET_POTATO_M2", 1) }
        }
        val buyer = AccountSession().apply { signup("rollback-buyer-${UUID.randomUUID()}@test.local", "buyer"); setWallet(10_000) }
        val instrument = UUID.fromString(instrumentId("SWEET_POTATO_M2"))
        val sellOrderIds = sellers.map { seller ->
            UUID.fromString(seller.postJson("/api/v1/market/orders", mapOf("instrumentId" to instrument, "side" to "SELL", "quantity" to 1, "limitUnitPrice" to 100, "timeInForce" to "GTC")).at("/data/result/orderId").asText())
        }
        val tradesBefore = jdbc.sql("select count(*) from market_trade where instrument_id=:instrument").param("instrument", instrument).query(Long::class.java).single()

        // 주문·거래·수령함까지 써 둔 뒤 정산 메일 단계에서 실패시킨다. 마지막 묶음이 깨지면 앞선 묶음도 남으면 안 된다.
        jdbc.sql("create function settlement_rollback_probe() returns trigger as $$ begin raise exception 'SETTLEMENT_ROLLBACK_PROBE'; end; $$ language plpgsql").update()
        jdbc.sql("create trigger settlement_rollback_probe before insert on mail_message for each row execute function settlement_rollback_probe()").update()
        try {
            val failure = assertThrows<Exception> {
                orders.create(buyer.accountId, UUID.randomUUID(), CreateMarketOrderRequest(instrument, MarketOrderSide.BUY, 3, 120, MarketTimeInForce.IOC))
            }
            assertTrue(generateSequence(failure as Throwable?) { it.cause }.any { it.message?.contains("SETTLEMENT_ROLLBACK_PROBE") == true })
        } finally {
            jdbc.sql("drop trigger settlement_rollback_probe on mail_message").update()
            jdbc.sql("drop function settlement_rollback_probe()").update()
        }

        assertEquals(10_000, wallet(buyer.accountId))
        assertEquals(0, quantity(buyer.accountId, "SWEET_POTATO_M2"))
        assertEquals(tradesBefore, jdbc.sql("select count(*) from market_trade where instrument_id=:instrument").param("instrument", instrument).query(Long::class.java).single())
        assertEquals(0L, jdbc.sql("select count(*) from market_order where instrument_id=:instrument and account_id=:account").params(mapOf("instrument" to instrument, "account" to buyer.accountId)).query(Long::class.java).single())
        assertEquals(0L, jdbc.sql("select count(*) from wallet_ledger where account_id=:account and source_type='MARKET_ORDER_FILL'").param("account", buyer.accountId).query(Long::class.java).single())
        assertEquals(0L, jdbc.sql("select count(*) from market_unread_event where account_id=:account").param("account", buyer.accountId).query(Long::class.java).single())
        sellOrderIds.forEach { orderId ->
            assertEquals(1L, jdbc.sql("select remaining_quantity from market_order where order_id=:order").param("order", orderId).query(Long::class.java).single())
            assertEquals("ACTIVE", jdbc.sql("select status from market_order where order_id=:order").param("order", orderId).query(String::class.java).single())
        }
    }

    @Test
    fun `replaying one idempotency key settles a multi maker buy only once`() {
        val sellers = (1..3).map { index ->
            AccountSession().apply { signup("replay-seller-$index-${UUID.randomUUID()}@test.local", "seller"); grantItem("CORN_M1", 1) }
        }
        val buyer = AccountSession().apply { signup("replay-buyer-${UUID.randomUUID()}@test.local", "buyer"); setWallet(10_000) }
        val instrument = UUID.fromString(instrumentId("CORN_M1"))
        sellers.forEach { seller ->
            seller.postJson("/api/v1/market/orders", mapOf("instrumentId" to instrument, "side" to "SELL", "quantity" to 1, "limitUnitPrice" to 100, "timeInForce" to "GTC"))
        }
        val key = UUID.randomUUID()
        val request = CreateMarketOrderRequest(instrument, MarketOrderSide.BUY, 3, 120, MarketTimeInForce.IOC)

        val first = orders.create(buyer.accountId, key, request)
        val replay = orders.create(buyer.accountId, key, request)

        assertEquals(first.commandId, replay.commandId)
        assertEquals(first.result.fills.map { it.tradeId }, replay.result.fills.map { it.tradeId })
        assertEquals(9_700, wallet(buyer.accountId))
        assertEquals(3, quantity(buyer.accountId, "CORN_M1"))
        assertEquals(3L, jdbc.sql("select count(*) from market_trade where taker_order_id=:order").param("order", first.result.orderId).query(Long::class.java).single())
        assertEquals(3L, jdbc.sql("select count(*) from wallet_ledger where account_id=:account and source_type='MARKET_ORDER_FILL'").param("account", buyer.accountId).query(Long::class.java).single())
        sellers.forEach { seller ->
            assertEquals(1L, jdbc.sql("select count(*) from mail_message where account_id=:account and type='MARKET_SETTLEMENT'").param("account", seller.accountId).query(Long::class.java).single())
        }
    }

    @Test
    fun `batched settlement follows price then time priority across sellers`() {
        val expensive = AccountSession().apply { signup("priority-high-${UUID.randomUUID()}@test.local", "seller"); grantItem("CORN_M2", 1) }
        val earlyCheap = AccountSession().apply { signup("priority-early-${UUID.randomUUID()}@test.local", "seller"); grantItem("CORN_M2", 1) }
        val lateCheap = AccountSession().apply { signup("priority-late-${UUID.randomUUID()}@test.local", "seller"); grantItem("CORN_M2", 1) }
        val buyer = AccountSession().apply { signup("priority-buyer-${UUID.randomUUID()}@test.local", "buyer"); setWallet(10_000) }
        val instrument = UUID.fromString(instrumentId("CORN_M2"))
        val expensiveOrder = sellOrder(expensive, instrument, 1, 120)
        val earlyOrder = sellOrder(earlyCheap, instrument, 1, 100)
        val lateOrder = sellOrder(lateCheap, instrument, 1, 100)
        jdbc.sql("update market_order set priority_at=case order_id when :early then cast(:earlyAt as timestamptz) else cast(:lateAt as timestamptz) end where order_id in (:early,:late)")
            .params(mapOf(
                "early" to earlyOrder,
                "late" to lateOrder,
                "earlyAt" to java.sql.Timestamp.from(java.time.Instant.parse("2026-09-22T00:00:00Z")),
                "lateAt" to java.sql.Timestamp.from(java.time.Instant.parse("2026-09-22T00:00:01Z")),
            )).update()

        val buy = orders.create(buyer.accountId, UUID.randomUUID(), CreateMarketOrderRequest(instrument, MarketOrderSide.BUY, 3, 150, MarketTimeInForce.IOC)).result

        assertEquals(listOf(earlyOrder, lateOrder, expensiveOrder), buy.fills.map { it.makerOrderId })
        assertEquals(listOf(100L, 100L, 120L), buy.fills.map { it.unitPrice })
        assertEquals(320, buy.totalPrice)
        assertEquals(9_680, wallet(buyer.accountId))
    }

    @Test
    fun `concurrent buys on one instrument never oversell or overdraw`() {
        val seller = AccountSession().apply { signup("oversell-seller-${UUID.randomUUID()}@test.local", "seller"); grantItem("SWEET_POTATO_M3", 12) }
        val instrument = UUID.fromString(instrumentId("SWEET_POTATO_M3"))
        (1..12).forEach { _ -> sellOrder(seller, instrument, 1, 100) }
        val buyers = (1..6).map { index ->
            AccountSession().apply { signup("oversell-buyer-$index-${UUID.randomUUID()}@test.local", "buyer"); setWallet(400) }
        }
        val start = CountDownLatch(1)
        val executor = Executors.newFixedThreadPool(buyers.size)
        try {
            val results = buyers.map { buyer ->
                executor.submit {
                    start.await(5, TimeUnit.SECONDS)
                    runCatching { orders.create(buyer.accountId, UUID.randomUUID(), CreateMarketOrderRequest(instrument, MarketOrderSide.BUY, 4, 120, MarketTimeInForce.IOC)) }
                }
            }
            start.countDown()
            results.forEach { it.get(30, TimeUnit.SECONDS) }
        } finally {
            executor.shutdownNow()
        }

        val soldQuantity = jdbc.sql("select coalesce(sum(quantity),0) from market_trade where instrument_id=:instrument").param("instrument", instrument).query(Long::class.java).single()
        val boughtQuantity = buyers.sumOf { quantity(it.accountId, "SWEET_POTATO_M3") }
        assertEquals(soldQuantity, boughtQuantity)
        assertTrue(soldQuantity <= 12)
        assertEquals(0L, jdbc.sql("select count(*) from market_order where instrument_id=:instrument and remaining_quantity<0").param("instrument", instrument).query(Long::class.java).single())
        assertEquals(0L, jdbc.sql("select count(*) from wallet_balance where balance<0").query(Long::class.java).single())
        assertEquals(0L, jdbc.sql("select count(*) from inventory_stack where quantity<0").query(Long::class.java).single())
        buyers.forEach { buyer ->
            val spent = jdbc.sql("select coalesce(-sum(delta),0) from wallet_ledger where account_id=:account and source_type='MARKET_ORDER_FILL'").param("account", buyer.accountId).query(Long::class.java).single()
            assertEquals(400 - spent, wallet(buyer.accountId))
            assertEquals(spent, quantity(buyer.accountId, "SWEET_POTATO_M3") * 100)
        }
        assertEquals(12L - soldQuantity, jdbc.sql("select coalesce(sum(remaining_quantity),0) from market_order where instrument_id=:instrument and side='SELL' and status in ('ACTIVE','PARTIALLY_FILLED')").param("instrument", instrument).query(Long::class.java).single())
    }

    private fun sellOrder(seller: AccountSession, instrument: UUID, quantity: Long, unitPrice: Long): UUID =
        UUID.fromString(seller.postJson("/api/v1/market/orders", mapOf("instrumentId" to instrument, "side" to "SELL", "quantity" to quantity, "limitUnitPrice" to unitPrice, "timeInForce" to "GTC")).at("/data/result/orderId").asText())

    private fun unreadSequences(accountId: UUID, stream: String): List<Long> = jdbc.sql("select sequence from market_unread_event where account_id=:account and stream=:stream order by sequence")
        .params(mapOf("account" to accountId, "stream" to stream)).query(Long::class.java).list()

    private fun latestUnreadSequence(accountId: UUID, stream: String): Long = jdbc.sql("select latest_sequence from market_unread_cursor where account_id=:account and stream=:stream")
        .params(mapOf("account" to accountId, "stream" to stream)).query(Long::class.java).single()

    private fun instrumentId(itemId: String): String = jdbc.sql("select instrument_id from market_instrument where item_id=:item and status='ACTIVE'").param("item", itemId).query(UUID::class.java).single().toString()
    private fun wallet(accountId: UUID) = jdbc.sql("select balance from wallet_balance where account_id=:account").param("account", accountId).query(Long::class.java).single()
    private fun quantity(accountId: UUID, itemId: String) = jdbc.sql("select quantity from inventory_stack where account_id=:account and item_id=:item").params(mapOf("account" to accountId, "item" to itemId)).query(Long::class.java).optional().orElse(0)

    private inner class AccountSession {
        lateinit var accountId: UUID
        private val cookies = mutableListOf<Cookie>()
        /**
         * 여러 시험이 `seller`·`buyer` 같은 이름을 나눠 쓴다. 닉네임이 계정마다 하나뿐이
         * 되면서 두 번째 가입이 막히므로, 읽을 수 있는 이름 뒤에 구분값을 붙인다.
         */
        fun signup(email: String, nickname: String) {
            val unique = "$nickname-${UUID.randomUUID().toString().take(6)}".take(20)
            accountId = UUID.fromString(postJson("/api/v1/auth/signup", mapOf("email" to email, "password" to "password123", "nickname" to unique), false).at("/data/accountId").asText())
            postJson("/api/v1/material-preference", mapOf("materialType" to "POTATO"))
        }
        fun setWallet(balance: Long) { jdbc.sql("update wallet_balance set balance=:balance where account_id=:account").params(mapOf("balance" to balance, "account" to accountId)).update() }
        fun grantItem(itemId: String, quantity: Long) { jdbc.sql("insert into inventory_stack(account_id,item_id,quantity,reserved_quantity,acquired_sequence) values (:account,:item,:quantity,0,1) on conflict(account_id,item_id) do update set quantity=inventory_stack.quantity+excluded.quantity").params(mapOf("account" to accountId, "item" to itemId, "quantity" to quantity)).update() }
        fun postJson(path: String, body: Any, authenticated: Boolean = true): JsonNode {
            val request = post(path).header("Idempotency-Key", UUID.randomUUID().toString()).header("Origin", "http://localhost:5173").contentType(MediaType.APPLICATION_JSON).accept(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(body))
            if (cookies.isNotEmpty()) request.cookie(*cookies.toTypedArray())
            if (authenticated) request.sessionAttr("accountId", accountId)
            val result = mvc.perform(request).andExpect(status().isOk).andReturn()
            captureCookies(result)
            return mapper.readTree(result.response.contentAsString)
        }
        fun getJson(path: String): JsonNode { val request = get(path).sessionAttr("accountId", accountId).accept(MediaType.APPLICATION_JSON); if (cookies.isNotEmpty()) request.cookie(*cookies.toTypedArray()); return mapper.readTree(mvc.perform(request).andExpect(status().isOk).andReturn().response.contentAsString) }
        private fun captureCookies(result: MvcResult) { result.response.cookies.forEach { cookie -> cookies.removeIf { it.name == cookie.name }; cookies += cookie } }
    }

}
