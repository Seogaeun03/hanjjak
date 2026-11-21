package com.hanjjak.balancelab

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class LiveopsBalanceTest {
    private val content = loadLiveopsContent()

    @Test
    fun `상한을 매일 채우면 기간 곱하기 상한만큼 모인다`() {
        val projection = projectLiveops(content, accounts = 100, days = 14, hoursPerDay = 2.0, seed = 42L)
        // 180초당 1장이면 2시간은 정확히 40장이고 이것이 일일 상한이다.
        assertEquals(40, projection.ticketsPerAccountPerDay)
        assertEquals(560, projection.ticketsPerAccount)
    }

    @Test
    fun `상한이 하루 두 시간을 넘는 플레이를 잘라 낸다`() {
        val long = projectLiveops(content, accounts = 100, days = 14, hoursPerDay = 24.0, seed = 42L)
        val normal = projectLiveops(content, accounts = 100, days = 14, hoursPerDay = 2.0, seed = 42L)
        assertEquals(normal.ticketsPerAccount, long.ticketsPerAccount, "24시간 접속이 더 벌지 못한다")
    }

    @Test
    fun `유출량이 확률표에 수렴한다`() {
        val projection = projectLiveops(content, accounts = 100, days = 14, hoursPerDay = 2.0, seed = 42L)
        val draws = projection.totalDraws.toDouble()
        assertTrue(projection.cosmeticTicketsGranted / draws in 0.095..0.105, "치장권 비율 ${projection.cosmeticTicketsGranted / draws}")
        assertTrue(projection.gemBoxesGranted / draws in 0.095..0.105, "보석함 비율 ${projection.gemBoxesGranted / draws}")
        /* 쌀 기대값은 회차당 0.7998 * 55 = 약 44.0 이다. 경품 칸(0.02%)이 재고·한도에 막히면
           쌀로 대체되므로 실측은 이 값보다 아주 조금 높게 나온다. */
        assertTrue(projection.riceGranted / draws in 41.0..47.0, "쌀 평균 ${projection.riceGranted / draws}")
    }

    @Test
    fun `경품은 재고를 넘지 않는다`() {
        val projection = projectLiveops(content, accounts = 100, days = 14, hoursPerDay = 2.0, seed = 42L)
        assertTrue(projection.prizesAwarded <= content.prizes.single().stock, "당첨 ${projection.prizesAwarded}")

        /* 계정 100개, 14일짜리 표본은 경품 확률이 낮아 어차피 한 계정이 두 번 당첨될 일이 거의 없으므로
           `<= perAccountLimit` 이 우연히 통과해 버린다. 계정당 한도가 실제로 작동하는지 보려면 한
           계정에 재고를 다 쓸어 담고도 남을 만큼 기회를 몰아줘야 한다: 계정 1개에 draws 를
           기대 당첨 12회(=stock 의 2배 이상)만큼 몰아주면, 한도가 없을 때 그 계정 혼자 재고
           5개를 다 가져가고, 한도가 있으면 정확히 perAccountLimit 에서 멈춘다. */
        val concentrated = projectLiveops(content, accounts = 1, days = 3_000, hoursPerDay = 2.0, seed = 7L)
        assertTrue(
            concentrated.maxPrizesPerAccount <= content.prizes.single().perAccountLimit,
            "계정당 한도(${content.prizes.single().perAccountLimit})를 넘겼다: 최대 ${concentrated.maxPrizesPerAccount}",
        )
    }
}
