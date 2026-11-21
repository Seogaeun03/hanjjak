package com.hanjjak.liveops.domain

import java.time.Instant
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class LiveopsDrawTableTest {
    private val content = LiveopsContent(
        "hunt-ticket-gacha-v1", "hunt-ticket-gacha-2026-09", "사냥 이벤트 뽑기",
        Instant.parse("2026-10-01T00:00:00Z"), Instant.parse("2026-10-15T00:00:00Z"),
        LiveopsAccrualPolicy(180, 40, 60),
        listOf(
            LiveopsOutcome(LiveopsOutcomeKind.PRIZE, 100, prizeId = "prize.gifticon.cyburger"),
            LiveopsOutcome(LiveopsOutcomeKind.COSMETIC_TICKET, 50_000, quantity = 1),
            LiveopsOutcome(LiveopsOutcomeKind.RICE, 949_900, minQuantity = 10, maxQuantity = 100),
        ),
        listOf(LiveopsPrize("prize.gifticon.cyburger", "싸이버거 기프티콘", 5, 1)),
    )
    private val table = LiveopsDrawTable(content)

    private fun counts(prizeGrantable: Boolean, rolls: Int, seed: Long = 20260918L): Map<String, Int> {
        val random = Random(seed)
        val tally = mutableMapOf("PRIZE" to 0, "COSMETIC_TICKET" to 0, "GEM_BOX" to 0, "RICE" to 0)
        repeat(rolls) {
            val key = when (table.roll(random, prizeGrantable)) {
                is LiveopsDrawResult.Prize -> "PRIZE"
                is LiveopsDrawResult.CosmeticTicket -> "COSMETIC_TICKET"
                is LiveopsDrawResult.GemBox -> "GEM_BOX"
                is LiveopsDrawResult.Rice -> "RICE"
            }
            tally[key] = tally.getValue(key) + 1
        }
        return tally
    }

    @Test
    fun `보석함 칸은 선언한 개수를 그대로 돌려준다`() {
        val withGemBox = LiveopsDrawTable(
            content.copy(
                outcomes = listOf(
                    LiveopsOutcome(LiveopsOutcomeKind.GEM_BOX, 999_999, quantity = 3),
                    LiveopsOutcome(LiveopsOutcomeKind.RICE, 1, minQuantity = 10, maxQuantity = 100),
                ),
            ),
        )
        val drawn = withGemBox.roll(Random(20260921L), prizeGrantable = false)
        assertEquals(LiveopsDrawResult.GemBox(3), drawn)
    }

    @Test
    fun `백만 회 분포가 확률표에 수렴한다`() {
        val tally = counts(prizeGrantable = true, rolls = 1_000_000)
        // 허용 오차는 기대값의 ±3%. 경품은 기대 100건이라 절대 오차 40건으로 잡는다.
        assertTrue(tally.getValue("COSMETIC_TICKET") in 48_500..51_500, "치장권 ${tally["COSMETIC_TICKET"]}")
        assertTrue(tally.getValue("RICE") in 921_400..978_400, "쌀 ${tally["RICE"]}")
        assertTrue(tally.getValue("PRIZE") in 60..140, "경품 ${tally["PRIZE"]}")
    }

    @Test
    fun `경품을 줄 수 없으면 경품 몫이 쌀로 흡수되고 치장권은 그대로다`() {
        val allowed = counts(prizeGrantable = true, rolls = 1_000_000)
        val blocked = counts(prizeGrantable = false, rolls = 1_000_000)
        assertEquals(0, blocked.getValue("PRIZE"))
        // 같은 seed·같은 소비 순서이므로 경품으로 갔던 건이 전부 쌀로 옮겨 간다.
        assertEquals(allowed.getValue("COSMETIC_TICKET"), blocked.getValue("COSMETIC_TICKET"))
        assertEquals(allowed.getValue("RICE") + allowed.getValue("PRIZE"), blocked.getValue("RICE"))
    }

    @Test
    fun `같은 seed 는 같은 결과를 낸다`() {
        val first = (1..50).map { table.roll(Random(7L), true) }
        val second = (1..50).map { table.roll(Random(7L), true) }
        assertEquals(first, second)
    }

    @Test
    fun `쌀 수량은 선언한 범위 안에서만 나오고 양끝을 모두 낸다`() {
        val random = Random(11L)
        val amounts = (1..200_000).map { table.roll(random, false) }.filterIsInstance<LiveopsDrawResult.Rice>().map { it.quantity }
        assertTrue(amounts.all { it in 10..100 }, "범위 밖 수량 ${amounts.filterNot { it in 10..100 }.take(5)}")
        assertTrue(amounts.contains(10) && amounts.contains(100), "양끝이 나오지 않았다")
    }

    @Test
    fun `치장권 수량은 콘텐츠가 선언한 값이다`() {
        val random = Random(3L)
        val tickets = (1..100_000).map { table.roll(random, false) }.filterIsInstance<LiveopsDrawResult.CosmeticTicket>()
        assertTrue(tickets.isNotEmpty())
        assertTrue(tickets.all { it.quantity == 1L })
    }
}
