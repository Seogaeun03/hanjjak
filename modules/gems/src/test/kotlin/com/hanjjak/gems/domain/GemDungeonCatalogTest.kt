package com.hanjjak.gems.domain

import com.fasterxml.jackson.databind.ObjectMapper
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class GemDungeonCatalogTest {
    private val mapper = ObjectMapper()

    private fun content(
        stagesByBoss: Map<GemPreset, List<Int>>,
        authority: String = "applied",
        extraStageFields: String = "",
    ): String {
        val bosses = stagesByBoss.entries.joinToString(",") { (boss, stages) ->
            val rows = stages.joinToString(",") { stage ->
                """{"stage":$stage,"bossHp":1,"bossAttack":0,"defense":0,"strikeDamage":1$extraStageFields}"""
            }
            """{"bossType":"${boss.name}","stages":[$rows]}"""
        }
        return """{"authority":"$authority","contentVersion":"test","durationTicks":150,"completionWindowSeconds":15,"bosses":[$bosses]}"""
    }

    private fun load(json: String) = GemDungeonCatalog.load(mapper, json.byteInputStream())

    private fun everyBoss(stageCount: Int) =
        GemRules.DUNGEON_BOSSES.associateWith { (1..stageCount).toList() }

    @Test
    fun `thirty stage content loads ninety definitions`() {
        val catalog = load(content(everyBoss(30)))
        assertEquals(30, catalog.maxStage)
        GemRules.DUNGEON_BOSSES.forEach { boss ->
            (1..30).forEach { stage -> catalog.require(boss, stage) }
        }
    }

    /**
     * 승격 전 콘텐츠는 재현·롤백 경로로 남는다. 단계 수를 상수로 고정하면 이 파일들이 로드되지
     * 않아 GemDungeonPolicy 가 약속한 롤백이 끊긴다.
     */
    @Test
    fun `legacy ten stage content still loads`() {
        val catalog = load(content(everyBoss(10)))
        assertEquals(10, catalog.maxStage)
        assertFailsWith<IllegalArgumentException> { catalog.require(GemPreset.SURVIVAL, 11) }
    }

    @Test
    fun `bosses with different stage counts are rejected`() {
        val uneven = mapOf(
            GemPreset.SURVIVAL to (1..30).toList(),
            GemPreset.BERSERK to (1..30).toList(),
            GemPreset.ARMORED to (1..29).toList(),
        )
        assertEquals(
            "INVALID_GEM_DUNGEON_CONTENT",
            assertFailsWith<IllegalArgumentException> { load(content(uneven)) }.message,
        )
    }

    @Test
    fun `non contiguous stages are rejected`() {
        val gap = GemRules.DUNGEON_BOSSES.associateWith { listOf(1, 3, 4) }
        assertEquals(
            "INVALID_GEM_DUNGEON_CONTENT",
            assertFailsWith<IllegalArgumentException> { load(content(gap)) }.message,
        )
    }

    @Test
    fun `missing boss is rejected`() {
        val partial = mapOf(GemPreset.SURVIVAL to listOf(1), GemPreset.BERSERK to listOf(1))
        assertEquals(
            "INVALID_GEM_DUNGEON_CONTENT",
            assertFailsWith<IllegalArgumentException> { load(content(partial)) }.message,
        )
    }

    @Test
    fun `strike interval and damage floor fall back to the simulator defaults`() {
        val definition = load(content(everyBoss(1))).require(GemPreset.ARMORED, 1)
        assertEquals(20, definition.strikeIntervalTicks)
        assertEquals(5_000, definition.damageFloorBasisPoints)
    }

    @Test
    fun `strike interval and damage floor are read from content`() {
        val json = content(everyBoss(1), extraStageFields = ""","strikeIntervalTicks":15,"damageFloorBasisPoints":2000""")
        val definition = load(json).require(GemPreset.ARMORED, 1)
        assertEquals(15, definition.strikeIntervalTicks)
        assertEquals(2_000, definition.damageFloorBasisPoints)
    }

    @Test
    fun `content that is not applied is rejected`() {
        assertEquals(
            "GEM_DUNGEON_CONTENT_NOT_APPLIED",
            assertFailsWith<IllegalArgumentException> { load(content(everyBoss(30), authority = "beta")) }.message,
        )
    }
}
