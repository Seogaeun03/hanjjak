package com.hanjjak.cosmetics.infrastructure

import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.cosmetics.domain.CosmeticGrade
import com.hanjjak.cosmetics.domain.CosmeticSlot
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class JsonCosmeticsContentTest {
    private fun load() = File(System.getProperty("user.dir")).parentFile.parentFile
        .resolve("packages/game-content/versions/v1/cosmetics/cosmetics.json")

    @Test
    fun `loads the applied catalog with operator-facing names`() {
        val content = JsonCosmeticsContent(load().inputStream(), ObjectMapper()).content
        assertEquals("cosmetics-v10-expanded-catalog", content.version)
        assertEquals(5_000, content.singleRiceCost)
        // 아트가 스무 벌 다 들어와 쉬는 세트가 없다. 열다섯 세트가 90종, 세트 없는 치장이 여덟 종이다.
        assertEquals(190, content.cosmetics.size)
        assertEquals(28, content.sets.size)
        assertEquals((1..28).map { "cosmetic-set-%02d".format(it) }, content.sets.map { it.id })
        assertEquals(listOf(1, 4, 16, 80, 400), content.starThresholdsByGrade[CosmeticGrade.NORMAL])
        assertEquals(listOf(1, 3, 12, 60, 300), content.starThresholdsByGrade[CosmeticGrade.RARE])
        assertEquals(listOf(1, 2, 8, 40, 200), content.starThresholdsByGrade[CosmeticGrade.EPIC])
        assertEquals(listOf(1, 2, 3, 5, 10), content.starThresholdsByGrade[CosmeticGrade.LEGENDARY])
        assertEquals("가죽경갑 모자", content.cosmetics.first().displayName)
        assertEquals("긱시크안경", content.cosmetics.first { it.id == "cosmetic-177" }.displayName)
        assertEquals("싸피 후드집업 하양", content.cosmetics.first { it.id == "cosmetic-190" }.displayName)
        assertEquals(null, content.cosmetics.first().imageUrl)
        assertEquals(
            mapOf("cosmetic-set-15" to "cosmetic-banner-01"),
            content.sets.filter { it.grade == CosmeticGrade.LEGENDARY && it.bannerId != null }.associate { it.id to it.bannerId },
        )
        assertEquals(listOf("cosmetic-selector-box-01"), content.sets.mapNotNull { it.boxItemId })
    }

    @Test
    fun `keeps the cosmetics that belong to no set`() {
        // 여섯 부위를 다 채우지 못한 치장은 세트가 없다. 도감에 뜨지 않고 뽑기로만 만난다.
        // 세트 멤버로만 추리던 시절에는 이런 치장이 통째로 사라졌다.
        val content = JsonCosmeticsContent(load().inputStream(), ObjectMapper()).content
        val loose = content.cosmetics.filter { it.setId == null }
        assertEquals(22, loose.size)
        assertEquals(setOf(CosmeticGrade.NORMAL, CosmeticGrade.RARE, CosmeticGrade.EPIC), loose.map { it.grade }.toSet())
        // 전설은 간판 세트에서만 뽑히므로 세트 없는 전설은 얻을 길이 없다.
        assertTrue(loose.none { it.grade == CosmeticGrade.LEGENDARY })
        // 얼굴 자리는 세트가 쓰지 않는다. 세트 밖 치장만 이 자리를 쓴다.
        assertTrue(content.sets.none { CosmeticSlot.FACE in it.members })
        assertEquals(14, content.cosmetics.count { it.slot == CosmeticSlot.FACE })
        assertEquals(listOf("cosmetic-188", "cosmetic-189", "cosmetic-190"), loose.filterNot { it.gachaEligible }.map { it.id })
    }

    @Test
    fun `keeps every numbered entry in the file so saved ownership still points at the same cosmetic`() {
        val raw = ObjectMapper().readTree(load())
        assertEquals(190, raw.path("cosmetics").size())
        assertEquals(28, raw.path("sets").size())
        // 쉬는 세트는 하나도 없다. 아트가 다 들어와 있어서 전부 게임에 선다.
        assertTrue(raw.path("sets").none { !it.path("active").asBoolean(true) })
    }

    @Test
    fun `loads an appended cosmetic without changing existing numbered entries`() {
        val mapper = ObjectMapper()
        val raw = mapper.readTree(load()) as com.fasterxml.jackson.databind.node.ObjectNode
        val appended = mapper.createObjectNode().apply {
            put("cosmeticId", "cosmetic-191")
            putNull("displayName")
            putNull("imageUrl")
            put("grade", "NORMAL")
            put("slot", "FACE")
            putNull("setId")
        }
        (raw.path("cosmetics") as com.fasterxml.jackson.databind.node.ArrayNode).add(appended)

        val content = JsonCosmeticsContent(raw.toString().byteInputStream(), mapper).content

        assertEquals(191, content.cosmetics.size)
        assertEquals("cosmetic-191", content.cosmetics.last().id)
    }

    @Test
    fun `allows legendary sets to share the one general gacha without their own banner`() {
        val mapper = ObjectMapper()
        val raw = mapper.readTree(load())

        val content = JsonCosmeticsContent(raw.toString().byteInputStream(), mapper).content

        assertEquals(9, content.sets.count { it.grade == CosmeticGrade.LEGENDARY })
        assertEquals(1, content.sets.count { it.bannerId != null })
    }

    @Test
    fun `rejects thresholds that ask more of a rarer grade`() {
        // 노말과 희귀를 되돌려 놓으면 희귀가 노말보다 더 많은 등록을 요구한다.
        // 도감에서 거꾸로 읽히던 2026-09-18 이전 배치가 이 모양이었다.
        val mapper = ObjectMapper()
        val raw = mapper.readTree(load()) as com.fasterxml.jackson.databind.node.ObjectNode
        val thresholds = raw.path("starThresholdsByGrade") as com.fasterxml.jackson.databind.node.ObjectNode
        val normal = thresholds.get("NORMAL").deepCopy<com.fasterxml.jackson.databind.JsonNode>()
        thresholds.set<com.fasterxml.jackson.databind.node.ObjectNode>("NORMAL", thresholds.get("RARE").deepCopy())
        thresholds.set<com.fasterxml.jackson.databind.node.ObjectNode>("RARE", normal)

        assertFailsWith<IllegalArgumentException> {
            JsonCosmeticsContent(raw.toString().byteInputStream(), mapper)
        }
    }

    @Test
    fun `rejects a second gacha banner`() {
        val mapper = ObjectMapper()
        val raw = mapper.readTree(load())
        val extra = raw.path("sets").path(11) as com.fasterxml.jackson.databind.node.ObjectNode
        extra.put("bannerId", "cosmetic-banner-02")
        extra.put("boxItemId", "cosmetic-selector-box-01")

        assertFailsWith<IllegalArgumentException> {
            JsonCosmeticsContent(raw.toString().byteInputStream(), mapper)
        }
    }
}
