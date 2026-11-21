package com.hanjjak.admin.application

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import com.hanjjak.account.application.OfflineRewardLifecycle
import org.h2.jdbcx.JdbcDataSource
import org.springframework.jdbc.core.simple.JdbcClient
import java.time.Clock
import java.time.Instant
import java.time.LocalTime
import java.time.ZoneOffset
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class EventLifecycleServiceTest {
    private val now = Instant.parse("2026-09-21T03:00:00Z")
    private val operatorId = UUID.randomUUID()
    private val jdbc = JdbcClient.create(JdbcDataSource().apply { setURL("jdbc:h2:mem:${System.nanoTime()};MODE=PostgreSQL;DB_CLOSE_DELAY=-1") })
    private val service: EventLifecycleService
    private val frozenAt = mutableListOf<Instant>()
    private val offlineRewards = object : OfflineRewardLifecycle {
        override fun freezeAll(endedAt: Instant, reason: String) { frozenAt += endedAt }
        override fun freezeAllExcept(endedAt: Instant, reason: String, excludedAccountIds: Set<UUID>) { frozenAt += endedAt }
    }

    init {
        jdbc.sql(
            """
            create table admin_operator(operator_id uuid primary key);
            create table event_lifecycle_config(config_id smallint primary key,starts_at timestamp with time zone,ends_at timestamp with time zone,daily_restriction_enabled boolean not null,daily_restriction_starts_at time,daily_restriction_ends_at time,daily_restriction_reconciled_for date,daily_restriction_applied_at timestamp with time zone,version bigint not null,updated_at timestamp with time zone,updated_by uuid,updated_by_username varchar(255),reason varchar(500),reconciled_version bigint not null);
            create table event_lifecycle_command(operator_id uuid not null,idempotency_key uuid not null,fingerprint varchar(64) not null,result_json varchar not null,created_at timestamp with time zone not null,primary key(operator_id,idempotency_key));
            create table admin_game_account(operator_id uuid primary key,account_id uuid unique);
            create table battle_session(id uuid primary key,account_id uuid,status varchar(16),closed_at timestamp with time zone);
            create table game_session(id uuid primary key,account_id uuid,status varchar(16),closed_at timestamp with time zone);
            create table account_active_session(account_id uuid primary key,session_id varchar(128));
            create table spring_session(primary_id varchar(36) primary key,session_id varchar(36));
            """.trimIndent(),
        ).update()
        jdbc.sql("insert into admin_operator(operator_id) values (:operator)").param("operator", operatorId).update()
        jdbc.sql("insert into event_lifecycle_config(config_id,daily_restriction_enabled,version,updated_at,reconciled_version) values (1,false,0,current_timestamp,-1)").update()
        service = EventLifecycleService(
            jdbc, ObjectMapper().registerKotlinModule().registerModule(JavaTimeModule()), Clock.fixed(now, ZoneOffset.UTC),
            offlineRewards, "event-2026-09", true, "https://hanjjak.verte.kr",
        )
    }

    @Test
    fun `missing start blocks players and an open end keeps the event running`() {
        assertEquals(EventLifecycleService.Phase.PRE_START, service.snapshot().phase)
        service.update(operatorId, "admin", UUID.randomUUID(), 0, now.minusSeconds(1), null, false, null, null, "이벤트 시작")
        assertEquals(EventLifecycleService.Phase.RUNNING, service.snapshot().phase)
    }

    @Test
    fun `update advances version replays a key and rejects stale writers`() {
        val key = UUID.randomUUID()
        val start = now.plusSeconds(60)
        val first = service.update(operatorId, "admin", key, 0, start, null, false, null, null, "일정 등록")
        val replay = service.update(operatorId, "admin", key, 0, start, null, false, null, null, "일정 등록")
        assertEquals(1, first.after.version)
        assertTrue(replay.replayed)
        assertEquals("EVENT_LIFECYCLE_VERSION_CONFLICT", assertFailsWith<IllegalArgumentException> {
            service.update(operatorId, "admin", UUID.randomUUID(), 0, now, null, false, null, null, "오래된 변경")
        }.message)
    }

    @Test
    fun `ended events enter notice then post notice and close active sessions once`() {
        val end = now.minusSeconds(1)
        service.update(operatorId, "admin", UUID.randomUUID(), 0, now.minusSeconds(60), end, false, null, null, "이벤트 종료")
        assertEquals(EventLifecycleService.Phase.ENDED_NOTICE, service.snapshot().phase)
        assertFalse(service.reconcileInactiveSessions())
        assertEquals(EventLifecycleService.Phase.POST_NOTICE, service.snapshot(end.plusSeconds(7 * 86_400 + 1)).phase)
    }

    @Test
    fun `daily cross midnight restriction starts at save time when enabled live`() {
        service.update(operatorId, "admin", UUID.randomUUID(), 0, now.minusSeconds(3_600), null, true, LocalTime.of(11, 0), LocalTime.of(8, 0), "매일 이용 제한")

        assertEquals(EventLifecycleService.Phase.DAILY_RESTRICTED, service.snapshot().phase)
        assertFalse(service.reconcileInactiveSessions())
        assertEquals(now, frozenAt.single())
    }

    @Test
    fun `reconciliation retry keeps the original restriction boundary`() {
        service.update(operatorId, "admin", UUID.randomUUID(), 0, now.minusSeconds(3_600), null, true, LocalTime.of(11, 0), LocalTime.of(8, 0), "매일 이용 제한")
        jdbc.sql("update event_lifecycle_config set daily_restriction_reconciled_for=null where config_id=1").update()
        assertTrue(service.reconcileInactiveSessions(now.plusSeconds(3_600)))
        assertEquals(listOf(now, now), frozenAt)
    }

    @Test
    fun `next daily restriction uses its own boundary rather than the prior day`() {
        service.update(operatorId, "admin", UUID.randomUUID(), 0, now.minusSeconds(3_600), null, true, LocalTime.of(11, 0), LocalTime.of(8, 0), "매일 이용 제한")

        val nextDay = now.plusSeconds(86_400)
        assertTrue(service.reconcileInactiveSessions(nextDay))
        assertEquals(listOf(now, Instant.parse("2026-09-22T02:00:00Z")), frozenAt)
    }

    @Test
    fun `daily restriction validates complete nonzero windows`() {
        assertEquals("EVENT_DAILY_RESTRICTION_INVALID_RANGE", assertFailsWith<IllegalArgumentException> {
            service.update(operatorId, "admin", UUID.randomUUID(), 0, now, null, true, LocalTime.of(22, 0), LocalTime.of(22, 0), "잘못된 시간")
        }.message)
    }
}
