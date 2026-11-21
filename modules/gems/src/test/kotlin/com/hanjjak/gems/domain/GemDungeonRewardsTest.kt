package com.hanjjak.gems.domain

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class GemDungeonRewardsTest {
    @Test
    fun `first clear reward follows the stepped schedule`() {
        assertEquals(10L, GemDungeonRewards.firstClear(1))
        assertEquals(19L, GemDungeonRewards.firstClear(10))
        assertEquals(22L, GemDungeonRewards.firstClear(11))
        assertEquals(43L, GemDungeonRewards.firstClear(18))
        assertEquals(49L, GemDungeonRewards.firstClear(19))
        assertEquals(85L, GemDungeonRewards.firstClear(25))
        assertEquals(115L, GemDungeonRewards.firstClear(30))
    }

    /** 1~10 구간은 승격 전 보상을 그대로 물려받는다. 기존 계정의 체감이 달라지면 안 된다. */
    @Test
    fun `first ten stages keep the pre expansion reward`() {
        (1..10).forEach { stage -> assertEquals(9L + stage, GemDungeonRewards.firstClear(stage)) }
    }

    @Test
    fun `first clear reward is strictly increasing across the ladder`() {
        (1 until GemDungeonRewards.MAX_STAGE).forEach { stage ->
            assertTrue(
                GemDungeonRewards.firstClear(stage) < GemDungeonRewards.firstClear(stage + 1),
                "stage $stage is not below stage ${stage + 1}",
            )
        }
    }

    @Test
    fun `sweep reward is strictly increasing and never exceeds the first clear`() {
        (1..GemDungeonRewards.MAX_STAGE).forEach { stage ->
            assertTrue(GemDungeonRewards.sweepPerTicket(stage) < GemDungeonRewards.firstClear(stage))
        }
        (1 until GemDungeonRewards.MAX_STAGE).forEach { stage ->
            assertTrue(GemDungeonRewards.sweepPerTicket(stage) <= GemDungeonRewards.sweepPerTicket(stage + 1))
        }
    }

    /**
     * 소탕 단가가 상한 빌드 도달 시간을 직접 결정하므로 최초 클리어 계단을 그대로 물리면
     * 보석 경제가 무너진다. 25단계 계단식(85)에 0.3 을 곱하면 25/장이 되어 세 프리셋 7레벨
     * 세트를 27일에 완성한다. 확정 전까지는 승격 전 선형 공식을 유지한다.
     */
    @Test
    fun `sweep reward is not derived from the stepped first clear schedule`() {
        assertEquals(10L, GemDungeonRewards.sweepPerTicket(25))
        assertEquals(GemDungeonRewards.firstClear(25) * 3L / 10L, 25L)
    }

    @Test
    fun `stage outside the ladder is rejected`() {
        listOf(0, -1, GemDungeonRewards.MAX_STAGE + 1).forEach { stage ->
            assertFailsWith<IllegalArgumentException> { GemDungeonRewards.firstClear(stage) }
            assertFailsWith<IllegalArgumentException> { GemDungeonRewards.sweepPerTicket(stage) }
        }
    }
}
