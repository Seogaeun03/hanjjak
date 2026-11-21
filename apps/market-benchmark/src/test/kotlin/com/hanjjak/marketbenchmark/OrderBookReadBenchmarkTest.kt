package com.hanjjak.marketbenchmark

import kotlin.test.Test
import kotlin.test.assertEquals

class OrderBookReadBenchmarkTest {
    @Test
    fun `defaults describe a read-heavy hot instrument`() {
        val config = ReadConfig.from(emptyArray())

        assertEquals(600, config.totalRequests)
        assertEquals(20, config.concurrency)
        assertEquals(5, config.levels)
        // 조회만 재면 등록이 느려지는 것을 놓치므로 혼합 구간이 기본으로 켜져 있어야 한다.
        assertEquals(60, config.mutationRequests)
    }

    @Test
    fun `parses read load shape`() {
        val config = ReadConfig.from(
            arrayOf(
                "--concurrency", "50",
                "--total-requests", "1000",
                "--readers", "40",
                "--price-levels", "300",
                "--levels", "20",
                "--mutation-concurrency", "8",
            ),
        )

        assertEquals(50, config.concurrency)
        assertEquals(1000, config.totalRequests)
        assertEquals(40, config.readers)
        assertEquals(300, config.priceLevels)
        assertEquals(20, config.levels)
        assertEquals(8, config.mutationConcurrency)
    }

    @Test
    fun `separates the four queries one order book read makes`() {
        assertEquals("instrument", categorizeOrderBookQuery("select * from market_instrument where instrument_id=\$1"))
        assertEquals(
            "depth",
            categorizeOrderBookQuery(
                "select limit_unit_price,sum(remaining_quantity) total_quantity from market_order where instrument_id=\$1 group by limit_unit_price order by limit_unit_price limit \$2",
            ),
        )
        assertEquals(
            "recentTrades",
            categorizeOrderBookQuery("select trade_id,quantity from market_trade where instrument_id=\$1 order by filled_at desc,trade_id desc limit \$2"),
        )
        assertEquals("stateVersion", categorizeOrderBookQuery("select state_version from account where id=\$1"))
    }

    @Test
    fun `does not count revision bumps as order book reads`() {
        // 등록·체결로 revision을 올리는 update는 조회 비용이 아니다. 조회 호출 수에 섞이면 안 된다.
        assertEquals(
            "other",
            categorizeOrderBookQuery("update market_instrument set revision=revision+1,updated_at=now() where instrument_id=\$1 returning revision"),
        )
        assertEquals("other", categorizeOrderBookQuery("select material_type from material_preference where account_id=\$1"))
    }
}
