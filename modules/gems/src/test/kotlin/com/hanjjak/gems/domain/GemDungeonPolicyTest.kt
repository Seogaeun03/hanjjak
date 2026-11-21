package com.hanjjak.gems.domain

import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotEquals

class GemDungeonPolicyTest {
    private val kst = ZoneId.of("Asia/Seoul")
    private val applied = GemDungeonPolicy()
    private val legacy = GemDungeonPolicy(rotationPeriodSeconds = 86_400, ticketRegenSeconds = 28_800, ticketMaxStock = 3, contentResource = "classpath:gem-dungeons/gem-dungeons.json")

    @Test
    fun `applied defaults use the accelerated v2 loop`() {
        assertEquals(3_600, applied.rotationPeriodSeconds)
        assertEquals(3_600, applied.ticketRegenSeconds)
        assertEquals(3, applied.ticketMaxStock)
        assertEquals(3, applied.ticketInitialGrant)
        assertEquals("classpath:gem-dungeons/gem-dungeons-v2.json", applied.contentResource)
        assertEquals("applied", applied.contentAuthority)
    }

    @Test
    fun `daily rotation reproduces the KST epoch day cycle it replaced`() {
        var now = Instant.parse("2026-09-01T00:00:00Z")
        repeat(200) {
            assertEquals(
                GemRules.todayBoss(LocalDate.ofInstant(now, kst).toEpochDay()),
                GemRules.bossForSlot(legacy.slotIndex(now)),
            )
            now = now.plus(Duration.ofHours(5))
        }
    }

    @Test
    fun `daily slots start at KST midnight`() {
        val now = Instant.parse("2026-09-12T04:37:11Z")
        assertEquals(LocalDate.ofInstant(now, kst).atStartOfDay(kst).toInstant(), legacy.slotStartedAt(now))
    }

    @Test
    fun `hourly rotation opens a new boss every hour and repeats every three`() {
        var now = Instant.parse("2026-09-12T04:37:11Z")
        repeat(48) {
            assertNotEquals(
                GemRules.bossForSlot(applied.slotIndex(now)),
                GemRules.bossForSlot(applied.slotIndex(now.plus(Duration.ofHours(1)))),
            )
            assertEquals(
                GemRules.bossForSlot(applied.slotIndex(now)),
                GemRules.bossForSlot(applied.slotIndex(now.plus(Duration.ofHours(3)))),
            )
            now = now.plus(Duration.ofHours(1))
        }
    }

    @Test
    fun `hourly slots start on the hour and report the remaining time`() {
        val now = Instant.parse("2026-09-12T04:37:11Z")
        assertEquals(Instant.parse("2026-09-12T04:00:00Z"), applied.slotStartedAt(now))
        assertEquals(3_600 - (37 * 60 + 11).toLong(), applied.secondsUntilNextSlot(now))
        assertEquals(Instant.parse("2026-09-12T04:00:00Z"), applied.ticketSlotStartedAt(now))
        assertEquals(applied.secondsUntilNextSlot(now), applied.secondsUntilNextTicketSlot(now))
    }

    @Test
    fun `rotation is stable before the KST epoch`() {
        val beforeEpoch = Instant.parse("1969-12-31T10:00:00Z")
        assertEquals(
            GemRules.todayBoss(LocalDate.ofInstant(beforeEpoch, kst).toEpochDay()),
            GemRules.bossForSlot(legacy.slotIndex(beforeEpoch)),
        )
    }

    /**
     * 조회는 행을 건드리지 않고 이 계산만 부른다. 그래서 여기서 지키는 값이 곧 화면 값이다.
     */
    @Test
    fun `an account without a stored row sees the initial grant`() {
        val now = Instant.parse("2026-09-12T04:37:11Z")
        val balance = applied.ticketBalance(null, now)
        assertEquals(applied.ticketInitialGrant, balance.tickets)
        assertEquals(now, balance.rechargeAnchor)
        assertEquals(0L, balance.secondsUntilNextTicket)
    }

    @Test
    fun `tickets accrue on the hour and stop at three`() {
        val chargedAt = Instant.parse("2026-09-12T04:00:00Z")
        val stored = StoredGemTickets(0, chargedAt)

        assertEquals(0, applied.ticketBalance(stored, Instant.parse("2026-09-12T04:59:59Z")).tickets)
        assertEquals(1, applied.ticketBalance(stored, Instant.parse("2026-09-12T05:00:00Z")).tickets)
        assertEquals(2, applied.ticketBalance(stored, Instant.parse("2026-09-12T06:42:00Z")).tickets)
        assertEquals(3, applied.ticketBalance(stored, Instant.parse("2026-09-12T07:00:00Z")).tickets)
        assertEquals(3, applied.ticketBalance(stored, Instant.parse("2026-09-13T21:13:00Z")).tickets)
    }

    @Test
    fun `an accruing balance reports the time left in the current hour`() {
        val now = Instant.parse("2026-09-12T04:37:11Z")
        val balance = applied.ticketBalance(StoredGemTickets(0, Instant.parse("2026-09-12T04:00:00Z")), now)
        assertEquals(0, balance.tickets)
        assertEquals(Instant.parse("2026-09-12T04:00:00Z"), balance.rechargeAnchor)
        assertEquals(3_600 - (37 * 60 + 11).toLong(), balance.secondsUntilNextTicket)
    }

    /** 가득 찬 동안에는 시계가 멈춘다. 다 찬 뒤로 몇 시간이 지나도 네 장이 되지 않는다. */
    @Test
    fun `a full stock does not overflow and reports no countdown`() {
        val balance = applied.ticketBalance(StoredGemTickets(3, Instant.parse("2026-09-12T01:00:00Z")), Instant.parse("2026-09-12T09:30:00Z"))
        assertEquals(3, balance.tickets)
        assertEquals(0L, balance.secondsUntilNextTicket)
    }

    /** 최대치를 넘겨 저장된 행이 있어도 화면과 차감은 최대치까지만 본다. */
    @Test
    fun `a stored row above the cap is read down to the cap`() {
        assertEquals(3, applied.ticketBalance(StoredGemTickets(9, Instant.parse("2026-09-12T01:00:00Z")), Instant.parse("2026-09-12T04:00:00Z")).tickets)
    }

    @Test
    fun `consuming from a full stock anchors the recharge to the current hour`() {
        val now = Instant.parse("2026-09-12T04:37:11Z")
        val balance = applied.ticketBalance(StoredGemTickets(3, Instant.parse("2026-09-12T02:00:00Z")), now)
        val settled = applied.afterConsuming(balance, 1, now)
        assertEquals(2, settled.tickets)
        assertEquals(Instant.parse("2026-09-12T04:00:00Z"), settled.rechargeAnchor)
        assertEquals(3_600 - (37 * 60 + 11).toLong(), settled.secondsUntilNextTicket)
    }

    @Test
    fun `consuming below the cap leaves the recharge boundary alone`() {
        val now = Instant.parse("2026-09-12T04:37:11Z")
        val chargedAt = Instant.parse("2026-09-12T04:00:00Z")
        val settled = applied.afterConsuming(applied.ticketBalance(StoredGemTickets(2, chargedAt), now), 1, now)
        assertEquals(1, settled.tickets)
        assertEquals(chargedAt, settled.rechargeAnchor)
    }

    /** 입장 확인은 한 장도 쓰지 않는다. 그래서 기준 시각도 움직이지 않는다. */
    @Test
    fun `consuming nothing changes nothing`() {
        val now = Instant.parse("2026-09-12T04:37:11Z")
        val balance = applied.ticketBalance(StoredGemTickets(3, Instant.parse("2026-09-12T02:00:00Z")), now)
        assertEquals(balance, applied.afterConsuming(balance, 0, now))
    }

    @Test
    fun `spending more than the balance is rejected`() {
        val now = Instant.parse("2026-09-12T04:37:11Z")
        val balance = applied.ticketBalance(StoredGemTickets(1, Instant.parse("2026-09-12T04:00:00Z")), now)
        assertEquals("GEM_TICKET_EMPTY", assertFailsWith<IllegalArgumentException> { applied.afterConsuming(balance, 2, now) }.message)
        assertEquals("INVALID_GEM_TICKET_CONSUMPTION", assertFailsWith<IllegalArgumentException> { applied.afterConsuming(balance, -1, now) }.message)
    }

    @Test
    fun `invalid policies are rejected at startup`() {
        assertFailsWith<IllegalArgumentException> { GemDungeonPolicy(rotationPeriodSeconds = 0) }
        assertFailsWith<IllegalArgumentException> { GemDungeonPolicy(ticketRegenSeconds = 0) }
        assertFailsWith<IllegalArgumentException> { GemDungeonPolicy(ticketMaxStock = 0) }
        assertFailsWith<IllegalArgumentException> { GemDungeonPolicy(ticketMaxStock = 3, ticketInitialGrant = 4) }
    }
}
