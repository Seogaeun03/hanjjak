package com.hanjjak.gameapi

import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.cosmetics.infrastructure.JsonCosmeticsContent
import com.hanjjak.inventory.domain.ItemCategory
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class CosmeticSelectorBoxItemsTest {
    @Test
    fun `current content supplies only mapped boxes with non null display names`() {
        val content = javaClass.getResourceAsStream("/cosmetics/cosmetics.json")!!.use {
            JsonCosmeticsContent(it, ObjectMapper()).content
        }
        val items = CosmeticSelectorBoxItems(content).items()
        assertEquals(content.sets.mapNotNull { it.boxItemId }.distinct(), items.map { it.itemId })
        assertEquals(1, items.size)
        assertEquals("치장 선택권 박스", items.single().displayName)
        assertEquals("열어서 전설 치장 하나를 직접 골라 받는 상자입니다.", items.single().description)
        assertEquals(listOf("치장 뽑기 마일스톤 수령"), items.single().acquisitionSources)
        assertEquals(ItemCategory.COSMETIC_BOX, items.single().category)
        assertFalse(items.single().tradeable)
        assertTrue(items.single().stackable)
    }
}
