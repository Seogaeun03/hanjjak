package com.hanjjak.admin.application

import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.sql.Timestamp
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.UUID

/**
 * 운영자가 올리는 상단 배너.
 *
 * 공지와 나란히 서지만 같은 표를 쓰지 않는다. 공지는 우편함에 쌓여 나중에 읽는 글이고,
 * 배너는 지금 화면을 보고 있는 사람에게 한 줄로 끼어드는 알림이다. 배너에는 노출 종료가
 * 반드시 있어야 한다 — 끝이 없으면 모든 화면 위에 영원히 붙는다.
 */
@Service
class AdminBannerService(
    private val jdbc: JdbcClient,
    private val mapper: ObjectMapper,
    private val clock: Clock,
) {
    enum class Tone { INFO, EVENT, WARNING }

    data class RaiseResult(
        val bannerId: UUID,
        val message: String,
        val tone: Tone,
        val publishedAt: Instant,
        val expiresAt: Instant,
        val replayed: Boolean = false,
    )

    data class RevokeResult(val bannerId: UUID, val revokedAt: Instant)

    data class BannerEntry(
        val bannerId: UUID,
        val message: String,
        val tone: Tone,
        val publishedAt: Instant,
        val expiresAt: Instant,
        val revokedAt: Instant?,
        val reason: String,
        val createdAt: Instant,
        /** 지금 실제로 화면에 떠 있는지. 시각 계산을 운영 화면마다 다시 하지 않도록 서버가 정한다. */
        val live: Boolean,
    )

    private data class StoredCommand(val fingerprint: String, val resultJson: String)

    @Transactional
    fun raise(
        operatorId: UUID,
        idempotencyKey: UUID,
        message: String,
        tone: Tone,
        publishedAt: Instant?,
        expiresAt: Instant,
        reason: String,
    ): RaiseResult {
        val cleanMessage = requireMessage(message)
        val cleanReason = requireReason(reason)
        val now = clock.instant()
        val start = publishedAt ?: now
        require(expiresAt.isAfter(start)) { "ADMIN_BANNER_WINDOW_INVALID" }
        // 배너는 화면을 가리고 있는 동안 끌 방법이 사용자 쪽 닫기 하나뿐이다. 실수로 몇 달짜리
        // 기간을 넣으면 그 뒤로 접속하는 모든 사람이 한 번씩 그 실수를 본다.
        require(Duration.between(start, expiresAt) <= MAX_WINDOW) { "ADMIN_BANNER_WINDOW_TOO_LONG" }
        // 지문은 운영자가 **보낸** 것만으로 만든다. 시작 시각을 비우고 보냈을 때 서버가 채운
        // `now` 를 여기 섞으면, 똑같은 요청을 다시 보내도 지문이 매번 달라져 재시도가 키 재사용으로
        // 거절된다. 멱등 키가 막으려던 바로 그 상황(두 번 눌림)에서 못 쓰게 되는 셈이다.
        val fingerprint = fingerprint("banner", cleanMessage, tone.name, publishedAt?.toString() ?: "NOW", expiresAt.toString(), cleanReason)
        replay(operatorId, idempotencyKey, fingerprint)?.let { return it }

        val bannerId = UUID.randomUUID()
        jdbc.sql("insert into admin_banner(banner_id,message,tone,operator_id,published_at,expires_at,reason,created_at) values (:banner,:message,:tone,:operator,:published,:expires,:reason,:now)")
            .params(
                mapOf(
                    "banner" to bannerId, "message" to cleanMessage, "tone" to tone.name, "operator" to operatorId,
                    "published" to Timestamp.from(start), "expires" to Timestamp.from(expiresAt),
                    "reason" to cleanReason, "now" to Timestamp.from(now),
                ),
            ).update()
        return RaiseResult(bannerId, cleanMessage, tone, start, expiresAt)
            .also { save(operatorId, idempotencyKey, fingerprint, it, now) }
    }

    /** 이미 내린 배너를 다시 내려도 처음 내린 시각이 답이다. 두 번 눌러도 이력이 흔들리지 않는다. */
    @Transactional
    fun revoke(bannerId: UUID): RevokeResult {
        val now = clock.instant()
        val updated = jdbc.sql("update admin_banner set revoked_at=:now where banner_id=:banner and revoked_at is null")
            .params(mapOf("banner" to bannerId, "now" to Timestamp.from(now)))
            .update()
        if (updated > 0) return RevokeResult(bannerId, now)
        return jdbc.sql("select revoked_at from admin_banner where banner_id=:banner")
            .param("banner", bannerId)
            .query { row, _ -> RevokeResult(bannerId, row.getTimestamp("revoked_at").toInstant()) }
            .optional()
            .orElseThrow { IllegalArgumentException("ADMIN_BANNER_NOT_FOUND") }
    }

    @Transactional(readOnly = true)
    fun history(limit: Int = 50): List<BannerEntry> {
        val now = clock.instant()
        return jdbc.sql("select banner_id,message,tone,published_at,expires_at,revoked_at,reason,created_at from admin_banner order by created_at desc limit :limit")
            .param("limit", limit.coerceIn(1, 200))
            .query { row, _ ->
                val published = row.getTimestamp("published_at").toInstant()
                val expires = row.getTimestamp("expires_at").toInstant()
                val revoked = row.getTimestamp("revoked_at")?.toInstant()
                BannerEntry(
                    row.getObject("banner_id", UUID::class.java), row.getString("message"),
                    Tone.valueOf(row.getString("tone")), published, expires, revoked,
                    row.getString("reason"), row.getTimestamp("created_at").toInstant(),
                    live = revoked == null && !published.isAfter(now) && expires.isAfter(now),
                )
            }.list()
    }

    private fun requireMessage(value: String): String = value.trim()
        .also { require(it.length in 1..200) { "ADMIN_BANNER_MESSAGE_REQUIRED" } }

    private fun requireReason(value: String): String = value.trim()
        .also { require(it.length in 3..500) { "ADMIN_USER_REASON_REQUIRED" } }

    private fun replay(operatorId: UUID, idempotencyKey: UUID, fingerprint: String): RaiseResult? {
        val stored = jdbc.sql("select fingerprint,result_json from admin_message_command where operator_id=:operator and idempotency_key=:key")
            .params(mapOf("operator" to operatorId, "key" to idempotencyKey))
            .query { row, _ -> StoredCommand(row.getString("fingerprint"), row.getString("result_json")) }
            .optional().orElse(null) ?: return null
        require(stored.fingerprint == fingerprint) { "IDEMPOTENCY_KEY_REUSED" }
        return mapper.readValue(stored.resultJson, RaiseResult::class.java).copy(replayed = true)
    }

    private fun save(operatorId: UUID, idempotencyKey: UUID, fingerprint: String, result: RaiseResult, now: Instant) {
        jdbc.sql("insert into admin_message_command(operator_id,idempotency_key,fingerprint,result_json,created_at) values (:operator,:key,:fingerprint,:result,:now)")
            .params(
                mapOf(
                    "operator" to operatorId, "key" to idempotencyKey, "fingerprint" to fingerprint,
                    "result" to mapper.writeValueAsString(result), "now" to Timestamp.from(now),
                ),
            ).update()
    }

    /** 문장이 다음 칸으로 흘러 넘쳐 같은 지문이 나오지 않도록, 글에 쓰이지 않는 문자로 칸을 나눈다. */
    private fun fingerprint(vararg parts: String): String = MessageDigest.getInstance("SHA-256")
        .digest(parts.joinToString(SEPARATOR).toByteArray(StandardCharsets.UTF_8))
        .joinToString("") { "%02x".format(it) }

    private companion object {
        val MAX_WINDOW: Duration = Duration.ofDays(7)
        val SEPARATOR = Char(0).toString()
    }
}
