package com.hanjjak.admin.application

import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Clock
import java.time.Instant
import java.util.UUID

interface CosmeticShowcaseStore {
    data class State(
        val selectedSetIds: List<String>,
        val version: Long,
        val updatedAt: Instant,
    )

    data class StoredCommand(val fingerprint: String, val resultJson: String)

    fun load(): State
    fun update(expectedVersion: Long, selectedSetIds: List<String>, operatorId: UUID, reason: String, updatedAt: Instant): Boolean
    fun findCommand(operatorId: UUID, idempotencyKey: UUID): StoredCommand?
    fun saveCommand(operatorId: UUID, idempotencyKey: UUID, fingerprint: String, resultJson: String, createdAt: Instant)
}

@Service
class CosmeticShowcaseService(
    private val store: CosmeticShowcaseStore,
    private val mapper: ObjectMapper,
    private val clock: Clock,
) {
    data class Option(val setId: String, val displayName: String, val imageUrl: String)
    data class PublicView(val sets: List<Option>, val version: Long)
    data class AdminConfig(
        val options: List<Option>,
        val selectedSetIds: List<String>,
        val version: Long,
        val updatedAt: Instant,
    )
    data class UpdateResult(val before: AdminConfig, val after: AdminConfig, val replayed: Boolean = false)

    fun publicView(): PublicView {
        val state = store.load()
        return PublicView(OPTIONS, state.version)
    }

    fun adminConfig(): AdminConfig = store.load().toConfig()

    @Transactional
    fun update(
        operatorId: UUID,
        idempotencyKey: UUID,
        selectedSetIds: List<String>,
        expectedVersion: Long,
        reason: String,
    ): UpdateResult {
        val normalized = normalize(selectedSetIds)
        val cleanReason = reason.trim().also { require(it.length in 3..500) { "ADMIN_USER_REASON_REQUIRED" } }
        val fingerprint = fingerprint(expectedVersion.toString(), normalized.joinToString(","), cleanReason)
        store.findCommand(operatorId, idempotencyKey)?.let { stored ->
            require(stored.fingerprint == fingerprint) { "IDEMPOTENCY_KEY_REUSED" }
            return mapper.readValue(stored.resultJson, UpdateResult::class.java).copy(replayed = true)
        }

        val before = store.load().toConfig()
        require(before.version == expectedVersion) { "COSMETIC_SHOWCASE_VERSION_CONFLICT" }
        require(before.selectedSetIds != normalized) { "ADMIN_USER_CHANGE_REQUIRED" }
        val now = clock.instant()
        require(store.update(expectedVersion, normalized, operatorId, cleanReason, now)) { "COSMETIC_SHOWCASE_VERSION_CONFLICT" }
        val after = CosmeticShowcaseStore.State(normalized, expectedVersion + 1, now).toConfig()
        return UpdateResult(before, after).also {
            store.saveCommand(operatorId, idempotencyKey, fingerprint, mapper.writeValueAsString(it), now)
        }
    }

    private fun normalize(values: List<String>): List<String> {
        require(values.isNotEmpty()) { "COSMETIC_SHOWCASE_SELECTION_REQUIRED" }
        val requested = values.map(String::trim).filter(String::isNotEmpty).toSet()
        require(requested.isNotEmpty()) { "COSMETIC_SHOWCASE_SELECTION_REQUIRED" }
        require(requested.all(OPTION_BY_ID::containsKey)) { "COSMETIC_SHOWCASE_SET_UNKNOWN" }
        return OPTIONS.map(Option::setId).filter(requested::contains)
    }

    private fun CosmeticShowcaseStore.State.toConfig() = AdminConfig(OPTIONS, selectedSetIds, version, updatedAt)

    private fun fingerprint(vararg parts: String): String = MessageDigest.getInstance("SHA-256")
        .digest(parts.joinToString(Char(0).toString()).toByteArray(StandardCharsets.UTF_8))
        .joinToString("") { "%02x".format(it) }

    companion object {
        val OPTIONS = listOf(
            Option("sushi", "스시야 세트", "/assets/cosmetics/showcase/legendary-sushi-final.jpg"),
            Option("mage", "마법사 세트", "/assets/cosmetics/showcase/legendary-mage-final.jpg"),
            Option("cotton-painter", "목화화공 세트", "/assets/cosmetics/showcase/legendary-cotton-painter-final.jpg"),
            Option("moon-rabbit", "달토끼 세트", "/assets/cosmetics/showcase/legendary-moon-rabbit-final.jpg"),
            Option("white-fox-spirit", "구미호 세트", "/assets/cosmetics/showcase/legendary-white-fox-spirit-final-v5.jpg"),
            Option("magical-girl", "마법소녀 세트", "/assets/cosmetics/showcase/legendary-magical-girl-final.jpg"),
            Option("cardboard-crayon-warrior", "골판지 크레용 전사", "/assets/cosmetics/showcase/%EA%B3%A8%ED%8C%90%EC%A7%80%20%ED%81%AC%EB%A0%88%EC%9A%A9%20%EC%A0%84%EC%82%AC.webp"),
            Option("forest-spirit", "숲의정령", "/assets/cosmetics/showcase/%EC%88%B2%EC%9D%98%EC%A0%95%EB%A0%B9.webp"),
            Option("snake-water-guardian", "뱀물수호자", "/assets/cosmetics/showcase/%EB%B1%80%EB%AC%BC%EC%88%98%ED%98%B8%EC%9E%90.webp"),
        )
        private val OPTION_BY_ID = OPTIONS.associateBy(Option::setId)
    }
}
