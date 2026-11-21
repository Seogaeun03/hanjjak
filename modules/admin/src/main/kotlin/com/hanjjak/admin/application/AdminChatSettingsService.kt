package com.hanjjak.admin.application

import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.admin.infrastructure.AdminAuditRepository
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.sql.Timestamp
import java.time.Clock
import java.time.Instant
import java.util.UUID

@Service
class AdminChatSettingsService(
    private val jdbc: JdbcClient,
    private val mapper: ObjectMapper,
    private val audit: AdminAuditRepository,
    private val clock: Clock,
) {
    data class Settings(val enabled: Boolean, val version: Long, val updatedAt: Instant)
    data class UpdateResult(val before: Settings, val after: Settings, val replayed: Boolean = false)
    private data class StoredCommand(val fingerprint: String, val resultJson: String)

    @Transactional(readOnly = true)
    fun settings(): Settings = load()

    @Transactional
    fun update(
        operatorId: UUID,
        username: String,
        idempotencyKey: UUID,
        enabled: Boolean,
        expectedVersion: Long,
        reason: String,
        requestId: UUID,
        remoteAddress: String,
    ): UpdateResult {
        val cleanReason = reason.trim().also { require(it.length in 3..500) { "ADMIN_USER_REASON_REQUIRED" } }
        val fingerprint = sha256(listOf(expectedVersion.toString(), enabled.toString(), cleanReason).joinToString("\u0000"))
        val before = loadForUpdate()
        val stored = command(operatorId, idempotencyKey)
        val result = if (stored != null) {
            require(stored.fingerprint == fingerprint) { "IDEMPOTENCY_KEY_REUSED" }
            mapper.readValue(stored.resultJson, UpdateResult::class.java).copy(replayed = true)
        } else {
            require(before.version == expectedVersion) { "CHAT_SETTINGS_VERSION_CONFLICT" }
            val now = clock.instant()
            val changed = jdbc.sql(
                """update chat_send_settings set enabled=:enabled,version=version+1,updated_at=:updatedAt,updated_by=:operator,updated_by_username=:username,reason=:reason where config_id=1 and version=:expectedVersion""",
            ).params(
                mapOf(
                    "enabled" to enabled,
                    "updatedAt" to Timestamp.from(now),
                    "operator" to operatorId,
                    "username" to username,
                    "reason" to cleanReason,
                    "expectedVersion" to expectedVersion,
                ),
            ).update()
            require(changed == 1) { "CHAT_SETTINGS_VERSION_CONFLICT" }
            val after = Settings(enabled, expectedVersion + 1, now)
            UpdateResult(before, after).also { updateResult ->
                jdbc.sql("insert into admin_chat_settings_command(operator_id,idempotency_key,fingerprint,result_json,created_at) values (:operator,:key,:fingerprint,:result,:createdAt)")
                    .params(
                        mapOf(
                            "operator" to operatorId,
                            "key" to idempotencyKey,
                            "fingerprint" to fingerprint,
                            "result" to mapper.writeValueAsString(updateResult),
                            "createdAt" to Timestamp.from(now),
                        ),
                    ).update()
            }
        }
        audit.record(
            AdminAuditRepository.Record(
                clock.instant(), operatorId, username, "UPDATE_CHAT_SETTINGS", "CHAT_SETTINGS", "global", "SUCCEEDED",
                requestId, remoteAddress.ifBlank { "unknown" }, mutation = true, reason = cleanReason,
                beforeSummary = mapper.writeValueAsString(result.before),
                afterSummary = mapper.writeValueAsString(result.after),
                idempotencyKey = idempotencyKey,
            ),
        )
        return result
    }

    private fun load(): Settings = jdbc.sql("select enabled,version,updated_at from chat_send_settings where config_id=1")
        .query { row, _ -> Settings(row.getBoolean("enabled"), row.getLong("version"), row.getTimestamp("updated_at").toInstant()) }
        .single()

    private fun loadForUpdate(): Settings = jdbc.sql("select enabled,version,updated_at from chat_send_settings where config_id=1 for update")
        .query { row, _ -> Settings(row.getBoolean("enabled"), row.getLong("version"), row.getTimestamp("updated_at").toInstant()) }
        .single()
    private fun command(operatorId: UUID, key: UUID): StoredCommand? = jdbc.sql(
        "select fingerprint,result_json from admin_chat_settings_command where operator_id=:operator and idempotency_key=:key",
    ).params(mapOf("operator" to operatorId, "key" to key))
        .query { row, _ -> StoredCommand(row.getString("fingerprint"), row.getString("result_json")) }
        .optional().orElse(null)

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(StandardCharsets.UTF_8)).joinToString("") { "%02x".format(it) }
}
