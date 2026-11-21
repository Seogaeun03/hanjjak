package com.hanjjak.liveops.infrastructure

import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.liveops.application.LiveopsCatalog
import com.hanjjak.liveops.domain.LiveopsOutcomeKind
import java.io.ByteArrayInputStream
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class JsonLiveopsContentTest {
    private val mapper = ObjectMapper()

    private val json = """
        {
          "authority": "working",
          "contentVersion": "hunt-ticket-gacha-v1",
          "eventId": "hunt-ticket-gacha-2026-09",
          "displayName": "사냥 이벤트 뽑기",
          "startsAt": "2026-09-21T00:00:00+09:00",
          "endsAt": "2026-09-28T00:00:00+09:00",
          "accrual": { "secondsPerTicket": 180, "dailyCap": 100, "maxHeartbeatGapSeconds": 60 },
          "outcomes": [
            { "kind": "PRIZE", "prizeId": "prize.gifticon.cyburger", "millionths": 200 },
            { "kind": "COSMETIC_TICKET", "quantity": 1, "millionths": 50000 },
            { "kind": "RICE", "minQuantity": 10, "maxQuantity": 100, "millionths": 949800 }
          ],
          "prizes": [
            { "prizeId": "prize.gifticon.cyburger", "displayName": "싸이버거 기프티콘", "stock": 5, "perAccountLimit": 1 }
          ]
        }
    """.trimIndent()

    private fun load(text: String) = JsonLiveopsContent(ByteArrayInputStream(text.toByteArray()), mapper).content

    @Test
    fun `콘텐츠를 읽어 들인다`() {
        val content = load(json)
        assertEquals("hunt-ticket-gacha-v1", content.contentVersion)
        assertEquals("hunt-ticket-gacha-2026-09", content.eventId)
        assertEquals(180, content.accrual.secondsPerTicket)
        assertEquals(100, content.accrual.dailyCap)
        assertEquals(60, content.accrual.maxHeartbeatGapSeconds)
        assertEquals(3, content.outcomes.size)
        assertEquals(200, content.outcomes.first { it.kind == LiveopsOutcomeKind.PRIZE }.millionths)
        assertEquals(50_000, content.outcomes.first { it.kind == LiveopsOutcomeKind.COSMETIC_TICKET }.millionths)
        assertEquals(949_800, content.riceOutcome.millionths)
        assertEquals(5, content.prizeOf("prize.gifticon.cyburger").stock)
    }

    @Test
    fun `KST 표기를 그대로 읽어 시각으로 바꾼다`() {
        val content = load(json)
        assertEquals(Instant.parse("2026-09-20T15:00:00Z"), content.startsAt)
        assertEquals(Instant.parse("2026-09-27T15:00:00Z"), content.endsAt)
    }

    @Test
    fun `확률 합이 깨진 파일을 거부한다`() {
        val broken = json.replace("949800", "949799")
        assertEquals(
            "OUTCOME_MILLIONTHS_MUST_SUM_TO_ONE_MILLION",
            assertFailsWith<IllegalArgumentException> { load(broken) }.message,
        )
    }

    @Test
    fun `카탈로그는 선언한 이벤트만 내어 준다`() {
        val catalog = LiveopsCatalog(load(json))
        assertEquals("hunt-ticket-gacha-2026-09", catalog.current().eventId)
        assertEquals("hunt-ticket-gacha-2026-09", catalog.require("hunt-ticket-gacha-2026-09").eventId)
        assertEquals("LIVEOPS_EVENT_NOT_FOUND", assertFailsWith<IllegalArgumentException> { catalog.require("other") }.message)
    }
}
