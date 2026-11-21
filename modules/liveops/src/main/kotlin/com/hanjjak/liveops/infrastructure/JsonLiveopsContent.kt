package com.hanjjak.liveops.infrastructure

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.liveops.domain.LiveopsAccrualPolicy
import com.hanjjak.liveops.domain.LiveopsContent
import com.hanjjak.liveops.domain.LiveopsOutcome
import com.hanjjak.liveops.domain.LiveopsOutcomeKind
import com.hanjjak.liveops.domain.LiveopsPrize
import java.io.InputStream
import java.time.OffsetDateTime

/**
 * 확률 합·쌀 칸·경품 참조 같은 관계는 [LiveopsContent] 의 불변 조건이 본다. 여기서는
 * JSON 모양만 맞춰 넘긴다. 검사를 두 벌 두면 한쪽만 고쳐질 때 조용히 갈라진다.
 */
class JsonLiveopsContent(input: InputStream, mapper: ObjectMapper) {
    val content: LiveopsContent

    init {
        val root = mapper.readTree(input)
        content = LiveopsContent(
            contentVersion = root.path("contentVersion").asText(),
            eventId = root.path("eventId").asText(),
            displayName = root.path("displayName").asText(),
            startsAt = OffsetDateTime.parse(root.path("startsAt").asText()).toInstant(),
            endsAt = OffsetDateTime.parse(root.path("endsAt").asText()).toInstant(),
            accrual = root.path("accrual").let {
                LiveopsAccrualPolicy(
                    it.path("secondsPerTicket").asLong(),
                    it.path("dailyCap").asLong(),
                    it.path("maxHeartbeatGapSeconds").asLong(),
                )
            },
            outcomes = root.path("outcomes").map { it.toOutcome() },
            prizes = root.path("prizes").map { it.toPrize() },
        )
    }

    private fun JsonNode.toOutcome() = LiveopsOutcome(
        kind = LiveopsOutcomeKind.valueOf(path("kind").asText()),
        millionths = path("millionths").asInt(),
        prizeId = optionalText("prizeId"),
        quantity = optionalLong("quantity"),
        minQuantity = optionalLong("minQuantity"),
        maxQuantity = optionalLong("maxQuantity"),
    )

    private fun JsonNode.toPrize() = LiveopsPrize(
        prizeId = path("prizeId").asText(),
        displayName = path("displayName").asText(),
        stock = path("stock").asLong(),
        perAccountLimit = path("perAccountLimit").asLong(),
    )

    private fun JsonNode.optionalText(field: String): String? = if (has(field) && !path(field).isNull) path(field).asText() else null
    private fun JsonNode.optionalLong(field: String): Long? = if (has(field) && !path(field).isNull) path(field).asLong() else null
}
