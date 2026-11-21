package com.hanjjak.admin.application

import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.account.application.OfflineRewardLifecycle
import org.springframework.beans.factory.annotation.Value
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Service
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.transaction.annotation.Transactional
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.sql.Timestamp
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.UUID


@Service
class EventLifecycleService(
    private val jdbc: JdbcClient,
    private val mapper: ObjectMapper,
    private val clock: Clock,
    private val offlineRewards: OfflineRewardLifecycle,
    @param:Value("\${hanjjak.service.id:game-1}") val serviceId: String,
    @param:Value("\${hanjjak.event-lifecycle.enabled:false}") val enabled: Boolean,
    @param:Value("\${hanjjak.event-lifecycle.main-server-url:https://hanjjak.verte.kr}") val mainServerUrl: String,
) {
    enum class Phase { DISABLED, PRE_START, RUNNING, DAILY_RESTRICTED, ENDED_NOTICE, POST_NOTICE }
    data class Snapshot(
        val serviceId: String,
        val enabled: Boolean,
        val phase: Phase,
        val startsAt: Instant?,
        val endsAt: Instant?,
        val noticeEndsAt: Instant?,
        val dailyRestrictionEnabled: Boolean,
        val dailyRestrictionStartsAt: LocalTime?,
        val dailyRestrictionEndsAt: LocalTime?,
        val dailyRestrictionTimeZone: String,
        val dailyRestrictionEndsOnNextDay: Boolean,
        val nextDailyRestrictionTransitionAt: Instant?,
        val version: Long,
        val serverTime: Instant,
        val mainServerUrl: String,
        val updatedAt: Instant?,
        val updatedByUsername: String?,
    )
    data class UpdateResult(val before: Snapshot, val after: Snapshot, val replayed: Boolean = false)
    private data class StoredCommand(val fingerprint: String, val resultJson: String)
    private data class Row(
        val startsAt: Instant?, val endsAt: Instant?, val dailyRestrictionEnabled: Boolean,
        val dailyRestrictionStartsAt: LocalTime?, val dailyRestrictionEndsAt: LocalTime?,
        val dailyRestrictionReconciledFor: LocalDate?, val dailyRestrictionAppliedAt: Instant?, val version: Long,
        val updatedAt: Instant?, val updatedByUsername: String?, val reconciledVersion: Long,
    )

    @Transactional(readOnly = true)
    fun snapshot(now: Instant = clock.instant()): Snapshot = if (!enabled) disabled(now) else load().toSnapshot(now)

    @Transactional
    fun update(
        operatorId: UUID,
        username: String,
        key: UUID,
        expectedVersion: Long,
        startsAt: Instant?,
        endsAt: Instant?,
        dailyRestrictionEnabled: Boolean,
        dailyRestrictionStartsAt: LocalTime?,
        dailyRestrictionEndsAt: LocalTime?,
        reason: String,
    ): UpdateResult {
        require(enabled) { "EVENT_LIFECYCLE_DISABLED" }
        require(startsAt == null || endsAt == null || endsAt.isAfter(startsAt)) { "EVENT_LIFECYCLE_INVALID_RANGE" }
        require(!dailyRestrictionEnabled || dailyRestrictionStartsAt != null && dailyRestrictionEndsAt != null && dailyRestrictionStartsAt != dailyRestrictionEndsAt) { "EVENT_DAILY_RESTRICTION_INVALID_RANGE" }
        require(dailyRestrictionEnabled || dailyRestrictionStartsAt == null && dailyRestrictionEndsAt == null) { "EVENT_DAILY_RESTRICTION_DISABLED_WITH_WINDOW" }
        val cleanReason = reason.trim().also { require(it.length in 3..500) { "ADMIN_USER_REASON_REQUIRED" } }
        val fingerprint = sha256(listOf(expectedVersion.toString(), startsAt?.toString().orEmpty(), endsAt?.toString().orEmpty(), dailyRestrictionEnabled.toString(), dailyRestrictionStartsAt?.toString().orEmpty(), dailyRestrictionEndsAt?.toString().orEmpty(), cleanReason).joinToString("\u0000"))
        replay(operatorId, key)?.let {
            require(it.fingerprint == fingerprint) { "IDEMPOTENCY_KEY_REUSED" }
            val json = it.resultJson.takeIf { value -> !value.startsWith('"') }
                ?: mapper.readValue(it.resultJson, String::class.java)
            return mapper.readValue(json, UpdateResult::class.java).copy(replayed = true)
        }
        val beforeRow = loadForUpdate()
        require(beforeRow.version == expectedVersion) { "EVENT_LIFECYCLE_VERSION_CONFLICT" }
        require(
            beforeRow.startsAt != startsAt || beforeRow.endsAt != endsAt ||
                beforeRow.dailyRestrictionEnabled != dailyRestrictionEnabled ||
                beforeRow.dailyRestrictionStartsAt != dailyRestrictionStartsAt ||
                beforeRow.dailyRestrictionEndsAt != dailyRestrictionEndsAt,
        ) { "ADMIN_USER_CHANGE_REQUIRED" }
        val now = clock.instant()
        val changed = jdbc.sql(
            """update event_lifecycle_config set starts_at=:startsAt,ends_at=:endsAt,
               daily_restriction_enabled=:dailyRestrictionEnabled,daily_restriction_starts_at=:dailyRestrictionStartsAt,
               daily_restriction_ends_at=:dailyRestrictionEndsAt,daily_restriction_reconciled_for=null,daily_restriction_applied_at=null,
               version=version+1,reconciled_version=-1,
               updated_at=:updatedAt,updated_by=:operator,updated_by_username=:username,reason=:reason
               where config_id=1 and version=:expectedVersion""",
        ).params(
            mapOf(
                "startsAt" to startsAt?.let { OffsetDateTime.ofInstant(it, ZoneOffset.UTC) },
                "endsAt" to endsAt?.let { OffsetDateTime.ofInstant(it, ZoneOffset.UTC) },
                "dailyRestrictionEnabled" to dailyRestrictionEnabled,
                "dailyRestrictionStartsAt" to dailyRestrictionStartsAt,
                "dailyRestrictionEndsAt" to dailyRestrictionEndsAt,
                "updatedAt" to OffsetDateTime.ofInstant(now, ZoneOffset.UTC),
                "operator" to operatorId, "username" to username, "reason" to cleanReason,
                "expectedVersion" to expectedVersion,
            ),
        ).update()
        require(changed == 1) { "EVENT_LIFECYCLE_VERSION_CONFLICT" }
        val afterRow = load()
        reconcile(afterRow, now)
        val result = UpdateResult(beforeRow.toSnapshot(now), afterRow.toSnapshot(now))
        jdbc.sql("insert into event_lifecycle_command(operator_id,idempotency_key,fingerprint,result_json,created_at) values (:operator,:key,:fingerprint,cast(:result as jsonb),:now)")
            .params(mapOf("operator" to operatorId, "key" to key, "fingerprint" to fingerprint, "result" to mapper.writeValueAsString(result), "now" to Timestamp.from(now))).update()
        return result
    }

    @Scheduled(fixedDelay = 5_000)
    @Transactional
    fun reconcileScheduled() { reconcileInactiveSessions(clock.instant()) }

    @Transactional
    fun reconcileInactiveSessions(now: Instant = clock.instant()): Boolean {
        if (!enabled) return false
        return reconcile(loadForUpdate(), now)
    }

    private fun reconcile(row: Row, now: Instant): Boolean = when (row.toSnapshot(now).phase) {
        Phase.DAILY_RESTRICTED -> reconcileDailyRestriction(row, now)
        Phase.PRE_START, Phase.ENDED_NOTICE, Phase.POST_NOTICE -> reconcileEndedLifecycle(row, now)
        else -> false
    }

    private fun reconcileDailyRestriction(row: Row, now: Instant): Boolean {
        val restrictionDate = row.dailyRestrictionDate(now) ?: return false
        if (row.dailyRestrictionReconciledFor == restrictionDate) return false
        val restrictedAt = row.dailyRestrictionAppliedAt?.takeIf { row.dailyRestrictionDate(it) == restrictionDate }
            ?: row.dailyRestrictionStartedAt(restrictionDate)
                ?.let { start -> row.updatedAt?.takeIf { it.isAfter(start) } ?: start }
            ?: now
        val adminAccountIds = adminGameAccountIds()
        offlineRewards.freezeAllExcept(restrictedAt, "DAILY_RESTRICTION", adminAccountIds)
        closeGameAndBattleSessions(now)
        jdbc.sql("update event_lifecycle_config set daily_restriction_reconciled_for=:date,daily_restriction_applied_at=:appliedAt where config_id=1")
            .params(mapOf("date" to restrictionDate, "appliedAt" to Timestamp.from(restrictedAt))).update()
        return true
    }

    private fun reconcileEndedLifecycle(row: Row, now: Instant): Boolean {
        if (row.reconciledVersion >= row.version) return false
        closeGameAndBattleSessions(now)
        jdbc.sql("delete from spring_session where session_id not in (select active.session_id from account_active_session active join admin_game_account admin on admin.account_id = active.account_id)").update()
        jdbc.sql("delete from account_active_session where account_id not in (select account_id from admin_game_account)").update()
        jdbc.sql("update event_lifecycle_config set reconciled_version=:version where config_id=1")
            .param("version", row.version).update()
        return true
    }

    private fun adminGameAccountIds(): Set<UUID> = jdbc.sql("select account_id from admin_game_account")
        .query(UUID::class.java).list().toSet()

    private fun closeGameAndBattleSessions(now: Instant) {
        jdbc.sql("update battle_session set status='ABORTED',closed_at=:now where status='ACTIVE' and account_id not in (select account_id from admin_game_account)")
            .param("now", Timestamp.from(now)).update()
        jdbc.sql("update game_session set status='CLOSED',closed_at=:now where status='ACTIVE' and account_id not in (select account_id from admin_game_account)")
            .param("now", Timestamp.from(now)).update()
    }

    private fun disabled(now: Instant) = Snapshot(
        serviceId, false, Phase.DISABLED, null, null, null,
        false, null, null, DAILY_RESTRICTION_ZONE.id, false, null,
        0, now, mainServerUrl, null, null,
    )
    private fun Row.toSnapshot(now: Instant): Snapshot {
        val noticeEnd = endsAt?.plus(NOTICE_DURATION)
        val lifecyclePhase = when {
            startsAt == null || now.isBefore(startsAt) -> Phase.PRE_START
            endsAt != null && !now.isBefore(endsAt) -> if (noticeEnd != null && now.isBefore(noticeEnd)) Phase.ENDED_NOTICE else Phase.POST_NOTICE
            else -> Phase.RUNNING
        }
        val restricted = lifecyclePhase == Phase.RUNNING && dailyRestrictionEnabled && isDailyRestricted(now)
        return Snapshot(
            serviceId, true, if (restricted) Phase.DAILY_RESTRICTED else lifecyclePhase,
            startsAt, endsAt, noticeEnd,
            dailyRestrictionEnabled, dailyRestrictionStartsAt, dailyRestrictionEndsAt, DAILY_RESTRICTION_ZONE.id,
            dailyRestrictionEnabled && dailyRestrictionStartsAt != null && dailyRestrictionEndsAt != null && dailyRestrictionStartsAt > dailyRestrictionEndsAt,
            if (lifecyclePhase == Phase.RUNNING && dailyRestrictionEnabled) nextDailyTransition(now) else null,
            version, now, mainServerUrl, updatedAt, updatedByUsername,
        )
    }
    private fun Row.isDailyRestricted(now: Instant): Boolean {
        val start = dailyRestrictionStartsAt ?: return false
        val end = dailyRestrictionEndsAt ?: return false
        val localTime = now.atZone(DAILY_RESTRICTION_ZONE).toLocalTime()
        return if (start < end) !localTime.isBefore(start) && localTime.isBefore(end) else !localTime.isBefore(start) || localTime.isBefore(end)
    }
    private fun Row.dailyRestrictionDate(now: Instant): LocalDate? {
        val start = dailyRestrictionStartsAt ?: return null
        val end = dailyRestrictionEndsAt ?: return null
        val local = now.atZone(DAILY_RESTRICTION_ZONE)
        return if (start > end && local.toLocalTime().isBefore(end)) local.toLocalDate().minusDays(1) else local.toLocalDate()
    }
    private fun Row.dailyRestrictionStartedAt(date: LocalDate): Instant? = dailyRestrictionStartsAt
        ?.let { date.atTime(it).atZone(DAILY_RESTRICTION_ZONE).toInstant() }
    private fun Row.nextDailyTransition(now: Instant): Instant? {
        val start = dailyRestrictionStartsAt ?: return null
        val end = dailyRestrictionEndsAt ?: return null
        val localNow = now.atZone(DAILY_RESTRICTION_ZONE)
        return sequenceOf(start, end).map { time ->
            localNow.toLocalDate().atTime(time).atZone(DAILY_RESTRICTION_ZONE).let { candidate -> if (candidate.toInstant().isAfter(now)) candidate else candidate.plusDays(1) }.toInstant()
        }.minOrNull()
    }

    private fun load(): Row = row(false)
    private fun loadForUpdate(): Row = row(true)
    private fun row(forUpdate: Boolean): Row = jdbc.sql(
        """select starts_at,ends_at,daily_restriction_enabled,daily_restriction_starts_at,daily_restriction_ends_at,
           daily_restriction_reconciled_for,daily_restriction_applied_at,version,updated_at,updated_by_username,reconciled_version
           from event_lifecycle_config where config_id=1${if (forUpdate) " for update" else ""}""",
    ).query { rs, _ ->
        Row(
            rs.getObject("starts_at", OffsetDateTime::class.java)?.toInstant(),
            rs.getObject("ends_at", OffsetDateTime::class.java)?.toInstant(),
            rs.getBoolean("daily_restriction_enabled"),
            rs.getObject("daily_restriction_starts_at", LocalTime::class.java),
            rs.getObject("daily_restriction_ends_at", LocalTime::class.java),
            rs.getObject("daily_restriction_reconciled_for", LocalDate::class.java),
            rs.getObject("daily_restriction_applied_at", OffsetDateTime::class.java)?.toInstant(),
            rs.getLong("version"), rs.getObject("updated_at", OffsetDateTime::class.java)?.toInstant(),
            rs.getString("updated_by_username"), rs.getLong("reconciled_version"),
        )
    }.single()

    private fun replay(operatorId: UUID, key: UUID): StoredCommand? = jdbc.sql("select fingerprint,result_json from event_lifecycle_command where operator_id=:operator and idempotency_key=:key")
        .params(mapOf("operator" to operatorId, "key" to key))
        .query { rs, _ -> StoredCommand(rs.getString("fingerprint"), rs.getString("result_json")) }.optional().orElse(null)

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(StandardCharsets.UTF_8)).joinToString("") { "%02x".format(it) }

    companion object {
        private val NOTICE_DURATION: Duration = Duration.ofDays(7)
        private val DAILY_RESTRICTION_ZONE: ZoneId = ZoneId.of("Asia/Seoul")
    }
}
