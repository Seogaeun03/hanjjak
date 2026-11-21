package com.hanjjak.admin.application

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class CosmeticShowcaseServiceTest {
    private val now = Instant.parse("2026-09-18T06:00:00Z")
    private val operatorId = UUID.randomUUID()
    private val store = FakeStore()
    private val service = CosmeticShowcaseService(
        store,
        ObjectMapper().registerKotlinModule().registerModule(JavaTimeModule()),
        Clock.fixed(now, ZoneOffset.UTC),
    )

    @Test
    fun `public view always contains every random showcase image`() {
        store.state = CosmeticShowcaseStore.State(listOf("white-fox-spirit", "sushi"), 4, now)

        val result = service.publicView()

        assertEquals(CosmeticShowcaseService.OPTIONS.map { it.setId }, result.sets.map { it.setId })
        assertEquals("구미호 세트", result.sets.single { it.setId == "white-fox-spirit" }.displayName)
        assertEquals(listOf("골판지 크레용 전사", "숲의정령", "뱀물수호자"), result.sets.takeLast(3).map { it.displayName })
        assertEquals(4, result.version)
    }

    @Test
    fun `update rejects an empty selection`() {
        val failure = assertFailsWith<IllegalArgumentException> {
            service.update(operatorId, UUID.randomUUID(), emptyList(), 1, "이벤트 교체")
        }
        assertEquals("COSMETIC_SHOWCASE_SELECTION_REQUIRED", failure.message)
    }

    @Test
    fun `update normalizes order advances version and replays the same key`() {
        val key = UUID.randomUUID()
        val first = service.update(operatorId, key, listOf("white-fox-spirit", "sushi", "sushi"), 1, "가을 이벤트 교체")
        val replay = service.update(operatorId, key, listOf("white-fox-spirit", "sushi"), 1, "가을 이벤트 교체")

        assertEquals(listOf("sushi", "white-fox-spirit"), first.after.selectedSetIds)
        assertEquals(2, first.after.version)
        assertTrue(replay.replayed)
        assertEquals(first.after, replay.after)
    }

    @Test
    fun `stale versions cannot overwrite a newer operator change`() {
        store.state = store.state.copy(version = 7)
        val failure = assertFailsWith<IllegalArgumentException> {
            service.update(operatorId, UUID.randomUUID(), listOf("mage"), 6, "대표 세트 변경")
        }
        assertEquals("COSMETIC_SHOWCASE_VERSION_CONFLICT", failure.message)
    }

    private class FakeStore : CosmeticShowcaseStore {
        var state = CosmeticShowcaseStore.State(CosmeticShowcaseService.OPTIONS.map { it.setId }, 1, Instant.EPOCH)
        private val commands = mutableMapOf<Pair<UUID, UUID>, CosmeticShowcaseStore.StoredCommand>()

        override fun load() = state

        override fun update(
            expectedVersion: Long,
            selectedSetIds: List<String>,
            operatorId: UUID,
            reason: String,
            updatedAt: Instant,
        ): Boolean {
            if (state.version != expectedVersion) return false
            state = CosmeticShowcaseStore.State(selectedSetIds, expectedVersion + 1, updatedAt)
            return true
        }

        override fun findCommand(operatorId: UUID, idempotencyKey: UUID) = commands[operatorId to idempotencyKey]

        override fun saveCommand(
            operatorId: UUID,
            idempotencyKey: UUID,
            fingerprint: String,
            resultJson: String,
            createdAt: Instant,
        ) {
            commands[operatorId to idempotencyKey] = CosmeticShowcaseStore.StoredCommand(fingerprint, resultJson)
        }
    }
}
