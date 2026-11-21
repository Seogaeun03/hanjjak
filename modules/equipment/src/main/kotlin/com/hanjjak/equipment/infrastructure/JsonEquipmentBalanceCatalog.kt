package com.hanjjak.equipment.infrastructure

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.equipment.application.EquipmentBalanceCatalog
import com.hanjjak.equipment.domain.EquipmentBalanceContent
import com.hanjjak.equipment.domain.EquipmentGrade
import com.hanjjak.equipment.domain.EquipmentPromotionContent
import java.io.InputStream

class JsonEquipmentBalanceCatalog(input: InputStream, mapper: ObjectMapper) {
    val content: EquipmentBalanceContent

    init {
        val root = mapper.readTree(input)
        val materials = EquipmentGrade.entries.associateWith { grade ->
            val gradeNode = root.path("enhancementMaterials").path(grade.name)
            if (gradeNode.isMissingNode) emptyMap() else gradeNode.fields().asSequence().associate { (key, values) ->
                key.removePrefix("M").toInt() to values.map(JsonNode::asLong)
            }
        }
        /* 등급 enum 이 콘텐츠보다 먼저 배포될 수 있다(예: 신화). 콘텐츠에 없는 등급은
           map 에서 아예 비워 둔다 - EquipmentBalanceContent 의 검증은 등급이 없는 것과
           빈 값을 이미 구분한다. */
        val rice = EquipmentGrade.entries.mapNotNull { grade ->
            val node = root.path("enhancementRice").path(grade.name)
            if (node.isMissingNode) null else grade to node.map(JsonNode::asLong)
        }.toMap()
        val promotions = EquipmentGrade.entries.mapNotNull { grade ->
            val node = root.path("promotion").path(grade.name)
            if (node.isMissingNode) null else grade to EquipmentPromotionContent(
                requiredStageId = node.path("requiredStageId").asText(),
                materials = node.path("materials").fields().asSequence().associate { (key, value) -> key.removePrefix("M").toInt() to value.asLong() },
                rice = node.path("rice").asLong(),
                resultGrade = EquipmentGrade.valueOf(node.path("resultGrade").asText()),
            )
        }.toMap()
        content = EquipmentBalanceContent(
            authority = root.path("authority").asText(),
            contentVersion = root.path("contentVersion").asText(),
            compatibilityOnly = root.path("compatibilityOnly").asBoolean(false),
            enhancementMaterials = materials,
            enhancementRice = rice,
            promotion = promotions,
        )
    }

    companion object {
        fun fromResources(mapper: ObjectMapper): EquipmentBalanceCatalog = EquipmentBalanceCatalog(
            mapOf(
                "v1" to JsonEquipmentBalanceCatalog(resource("/v1/equipment/equipment.json"), mapper).content,
                "progression-rebalance-v1" to JsonEquipmentBalanceCatalog(resource("/progression-rebalance-v1/equipment/equipment.json"), mapper).content,
            ),
        )

        private fun resource(path: String) = requireNotNull(JsonEquipmentBalanceCatalog::class.java.getResourceAsStream(path)) {
            "equipment content missing: $path"
        }
    }
}
