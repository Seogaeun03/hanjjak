package com.hanjjak.cosmetics.infrastructure

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.cosmetics.domain.CosmeticDefinition
import com.hanjjak.cosmetics.domain.CosmeticGrade
import com.hanjjak.cosmetics.domain.CosmeticSlot
import com.hanjjak.cosmetics.domain.CosmeticsContent
import com.hanjjak.cosmetics.domain.EffectUnit
import com.hanjjak.cosmetics.domain.SetDefinition
import com.hanjjak.cosmetics.domain.StatEffect
import java.io.InputStream

class JsonCosmeticsContent(input: InputStream, mapper: ObjectMapper) {
    val content: CosmeticsContent

    init {
        val root = mapper.readTree(input)
        require(root.path("authority").asText() == "applied") { "cosmetics content is not applied" }
        val cosmetics = root.path("cosmetics").map { node ->
            requireFields(node, "cosmeticId", "displayName", "imageUrl", "grade", "slot", "setId")
            CosmeticDefinition(
                node.path("cosmeticId").asText(), node.nullableText("displayName"), node.nullableText("imageUrl"),
                CosmeticGrade.valueOf(node.path("grade").asText()), CosmeticSlot.valueOf(node.path("slot").asText()), node.nullableText("setId"),
                !node.has("gachaEligible") || node.path("gachaEligible").asBoolean(),
            )
        }
        val inactiveSetIds = root.path("sets").filter { it.has("active") && !it.path("active").asBoolean() }.map { it.path("setId").asText() }.toSet()
        val sets = root.path("sets").map { node ->
            requireFields(node, "setId", "displayName", "grade", "bannerId", "boxItemId", "members", "effects")
            // 세트는 여섯 자리만 채운다. 얼굴은 세트 밖 치장이 쓰는 자리라 members에 없고,
            // 없는 자리까지 훑으면 빈 문자열이 멤버로 들어가 뒤의 검사가 걸린다.
            val members = CosmeticSlot.entries.filter { node.path("members").has(it.name) }.associateWith { slot -> node.path("members").path(slot.name).asText() }
            val effects = node.path("effects").associate { row -> row.path("star").asInt() to row.path("effects").map { it.toEffect() } }
            SetDefinition(
                node.path("setId").asText(), node.nullableText("displayName"), CosmeticGrade.valueOf(node.path("grade").asText()),
                node.nullableText("bannerId"), node.nullableText("boxItemId"), members, effects,
                node.path("colors").takeUnless { it.isNull }?.map { it.asText() } ?: emptyList(),
            )
        }
        val probabilities = root.path("gradeProbabilityMillionths").let { node -> CosmeticGrade.entries.associateWith { node.path(it.name).asInt() } }
        require(probabilities.values.sum() == 1_000_000)
        val thresholds = root.path("starThresholdsByGrade").let { node -> CosmeticGrade.entries.associateWith { grade -> node.path(grade.name).map { it.asInt() } } }
        require(thresholds.values.all { it.size == 5 && it == it.sorted().distinct() && it.first() == 1 })
        // 요구량은 등급이 희소해질수록 줄어든다. 더 귀한 등급이 더 많은 등록을 요구하면 도감에서 거꾸로 읽힌다.
        // CosmeticGrade.entries 는 흔한 등급부터이므로 이웃한 두 등급을 성급 자리마다 견준다.
        require(CosmeticGrade.entries.map(thresholds::getValue).zipWithNext().all { (common, rarer) -> common.zip(rarer).all { (a, b) -> a >= b } }) {
            "성급 요구량은 등급이 희소할수록 줄어야 한다"
        }
        require(cosmetics.map { it.id } == (1..cosmetics.size).map { "cosmetic-%03d".format(it) }) { "cosmetic ids must be unique and contiguous from cosmetic-001" }
        require(sets.map { it.id } == (1..sets.size).map { "cosmetic-set-%02d".format(it) }) { "cosmetic set ids must be unique and contiguous from cosmetic-set-01" }
        for (set in sets) for ((slot, id) in set.members) require(cosmetics.singleOrNull { it.id == id && it.slot == slot && it.grade == set.grade && it.setId == set.id } != null)
        // 세트에 속한 치장과 세트가 부르는 치장이 정확히 같아야 한다. 나머지는 세트 없는 치장이고,
        // 그쪽은 setId가 비어 있어야 도감이 빈 세트를 그리지 않는다.
        require(sets.flatMap { it.members.values }.sorted() == cosmetics.filter { it.setId != null }.map { it.id }.sorted())
        // 전설은 간판 세트에서만 뽑히므로(CosmeticGachaService.draw), 세트 없는 전설은 얻을 길이 없다.
        require(cosmetics.none { it.setId == null && it.grade == CosmeticGrade.LEGENDARY }) { "세트 없는 전설 치장은 뽑을 수 없다" }
        // 색은 아트 폴더 꼬리표가 된다. 한 가지뿐이면 고를 것이 없으니 아예 두지 않는다.
        require(sets.all { it.colors.isEmpty() || (it.colors.size >= 2 && it.colors.distinct() == it.colors) }) { "색 목록이 잘못되었다" }
        require(inactiveSetIds.none { id -> sets.single { it.id == id }.bannerId != null || sets.single { it.id == id }.boxItemId != null }) { "inactive set cannot own a banner or selector box" }
        val activeSets = sets.filterNot { it.id in inactiveSetIds }
        val bannerSets = activeSets.filter { it.bannerId != null || it.boxItemId != null }
        require(bannerSets.size == 1 && bannerSets.single().grade == CosmeticGrade.LEGENDARY) { "exactly one active legendary set must own the shared gacha banner" }
        require(bannerSets.all { it.bannerId != null && it.boxItemId != null }) { "banner and selector box must be configured together" }
        val activeMemberIds = activeSets.flatMap { it.members.values }.toSet()
        // 세트 없는 치장은 어느 세트의 멤버도 아니다. 멤버로만 거르면 통째로 사라진다.
        val activeCosmetics = cosmetics.filter { it.setId == null || it.id in activeMemberIds }
        content = CosmeticsContent(root.path("contentVersion").asText(), root.path("singleRiceCost").asLong(), probabilities, thresholds, activeCosmetics, activeSets)
    }

    private fun requireFields(node: JsonNode, vararg names: String) = names.forEach { require(node.has(it)) { "missing cosmetics field: $it" } }
    private fun JsonNode.nullableText(name: String) = path(name).takeUnless(JsonNode::isNull)?.asText()
    private fun JsonNode.toEffect() = StatEffect(path("statId").asText(), path("value").asInt(), EffectUnit.valueOf(path("unit").asText()))
}
