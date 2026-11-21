package com.hanjjak.liveops.domain

import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class LiveopsContentTest {
    private val prize = LiveopsPrize("prize.gifticon.cyburger", "싸이버거 기프티콘", stock = 5, perAccountLimit = 1)
    private val outcomes = listOf(
        LiveopsOutcome(LiveopsOutcomeKind.PRIZE, 100, prizeId = "prize.gifticon.cyburger"),
        LiveopsOutcome(LiveopsOutcomeKind.COSMETIC_TICKET, 50_000, quantity = 1),
        LiveopsOutcome(LiveopsOutcomeKind.RICE, 949_900, minQuantity = 10, maxQuantity = 100),
    )

    private fun content(
        outcomes: List<LiveopsOutcome> = this.outcomes,
        prizes: List<LiveopsPrize> = listOf(prize),
        accrual: LiveopsAccrualPolicy = LiveopsAccrualPolicy(180, 40, 60),
        startsAt: Instant = Instant.parse("2026-10-01T00:00:00Z"),
        endsAt: Instant = Instant.parse("2026-10-15T00:00:00Z"),
    ) = LiveopsContent("hunt-ticket-gacha-v1", "hunt-ticket-gacha-2026-09", "사냥 이벤트 뽑기", startsAt, endsAt, accrual, outcomes, prizes)

    @Test
    fun `확률 합이 백만이 아니면 거부한다`() {
        val short = outcomes.map { if (it.kind == LiveopsOutcomeKind.RICE) it.copy(millionths = 949_899) else it }
        assertEquals("OUTCOME_MILLIONTHS_MUST_SUM_TO_ONE_MILLION", assertFailsWith<IllegalArgumentException> { content(outcomes = short) }.message)
    }

    @Test
    fun `쌀 결과가 없으면 거부한다`() {
        // 경품 대체가 항상 갈 곳이 있어야 한다. 쌀이 없으면 대체 규칙이 성립하지 않는다.
        val noRice = listOf(
            LiveopsOutcome(LiveopsOutcomeKind.PRIZE, 100, prizeId = "prize.gifticon.cyburger"),
            LiveopsOutcome(LiveopsOutcomeKind.COSMETIC_TICKET, 999_900, quantity = 1),
        )
        assertEquals("EXACTLY_ONE_RICE_OUTCOME_REQUIRED", assertFailsWith<IllegalArgumentException> { content(outcomes = noRice) }.message)
    }

    @Test
    fun `쌀 범위가 뒤집히면 거부한다`() {
        val flipped = outcomes.map { if (it.kind == LiveopsOutcomeKind.RICE) it.copy(minQuantity = 100, maxQuantity = 10) else it }
        assertEquals("INVALID_RICE_RANGE", assertFailsWith<IllegalArgumentException> { content(outcomes = flipped) }.message)
    }

    @Test
    fun `경품 칸이 둘 이상이면 거부한다`() {
        // 굴림이 고른 칸과 검사에 쓰는 칸이 어긋나지 않도록 PRIZE 칸은 하나만 허용한다.
        val twoPrizes = listOf(
            LiveopsOutcome(LiveopsOutcomeKind.PRIZE, 100, prizeId = "prize.gifticon.cyburger"),
            LiveopsOutcome(LiveopsOutcomeKind.PRIZE, 100, prizeId = "prize.gifticon.cyburger"),
            LiveopsOutcome(LiveopsOutcomeKind.RICE, 999_800, minQuantity = 10, maxQuantity = 100),
        )
        assertEquals("AT_MOST_ONE_PRIZE_OUTCOME_ALLOWED", assertFailsWith<IllegalArgumentException> { content(outcomes = twoPrizes) }.message)
    }

    @Test
    fun `정의되지 않은 경품을 가리키면 거부한다`() {
        assertEquals("UNKNOWN_PRIZE_REFERENCE", assertFailsWith<IllegalArgumentException> { content(prizes = emptyList()) }.message)
    }

    @Test
    fun `기간이 뒤집히면 거부한다`() {
        assertEquals(
            "INVALID_EVENT_WINDOW",
            assertFailsWith<IllegalArgumentException> {
                content(startsAt = Instant.parse("2026-10-15T00:00:00Z"), endsAt = Instant.parse("2026-10-01T00:00:00Z"))
            }.message,
        )
    }

    @Test
    fun `적립 정책이 영 이하면 거부한다`() {
        assertEquals("INVALID_ACCRUAL_POLICY", assertFailsWith<IllegalArgumentException> { content(accrual = LiveopsAccrualPolicy(0, 40, 60)) }.message)
        assertEquals("INVALID_ACCRUAL_POLICY", assertFailsWith<IllegalArgumentException> { content(accrual = LiveopsAccrualPolicy(180, 0, 60)) }.message)
        assertEquals("INVALID_ACCRUAL_POLICY", assertFailsWith<IllegalArgumentException> { content(accrual = LiveopsAccrualPolicy(180, 40, 0)) }.message)
    }

    @Test
    fun `쌀 결과와 경품 정의를 찾아 준다`() {
        val subject = content()
        assertEquals(10, subject.riceOutcome.minQuantity)
        assertEquals(100, subject.riceOutcome.maxQuantity)
        assertEquals("싸이버거 기프티콘", subject.prizeOf("prize.gifticon.cyburger").displayName)
        assertEquals("UNKNOWN_PRIZE_REFERENCE", assertFailsWith<IllegalArgumentException> { subject.prizeOf("prize.none") }.message)
    }

    @Test
    fun `기간 경계는 시작 포함 종료 제외다`() {
        val subject = content()
        assertFalse(subject.isOpenAt(Instant.parse("2026-09-30T23:59:59Z")))
        assertTrue(subject.isOpenAt(Instant.parse("2026-10-01T00:00:00Z")))
        assertTrue(subject.isOpenAt(Instant.parse("2026-10-14T23:59:59Z")))
        assertFalse(subject.isOpenAt(Instant.parse("2026-10-15T00:00:00Z")))
    }
}
