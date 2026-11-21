package com.hanjjak.admin.application

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import com.hanjjak.admin.infrastructure.AdminAuditRepository
import org.h2.jdbcx.JdbcDataSource
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class AdminChatSettingsServiceTest {
    private val now = Instant.parse("2026-09-30T12:00:00Z")
    private val dataSource = JdbcDataSource().apply { setURL("jdbc:h2:mem:${System.nanoTime()};MODE=PostgreSQL;DB_CLOSE_DELAY=-1") }
    private val jdbc = JdbcClient.create(dataSource)
    private val operatorId = UUID.randomUUID()
    private val secondOperatorId = UUID.randomUUID()
    private val audit: AdminAuditRepository
    private val service: AdminChatSettingsService

    init {
        jdbc.sql(
            """
            create table admin_operator(operator_id uuid primary key);
            create table chat_send_settings(config_id smallint primary key,enabled boolean not null,version bigint not null,updated_at timestamp with time zone not null,updated_by uuid,updated_by_username varchar(255),reason varchar(500));
            create table admin_chat_settings_command(operator_id uuid not null,idempotency_key uuid not null,fingerprint varchar(64) not null,result_json text not null,created_at timestamp with time zone not null,primary key(operator_id,idempotency_key));
            create table admin_audit_event(audit_id uuid primary key,occurred_at timestamp with time zone,operator_id uuid,username varchar,action varchar,target_type varchar,target_id varchar,outcome varchar,request_id uuid,remote_address varchar,mutation boolean,reason varchar,before_summary varchar,after_summary varchar,idempotency_key uuid);
            """.trimIndent(),
        ).update()
        jdbc.sql("insert into admin_operator(operator_id) values (:operator)").param("operator", operatorId).update()
        jdbc.sql("insert into admin_operator(operator_id) values (:operator)").param("operator", secondOperatorId).update()
        jdbc.sql("insert into chat_send_settings(config_id,enabled,version,updated_at) values (1,true,0,:now)")
            .param("now", java.sql.Timestamp.from(now)).update()
        val mapper = ObjectMapper().registerKotlinModule().registerModule(JavaTimeModule())
        audit = AdminAuditRepository(jdbc, DataSourceTransactionManager(dataSource))
        service = AdminChatSettingsService(jdbc, mapper, audit, Clock.fixed(now, ZoneOffset.UTC))
    }

    @Test
    fun `default is enabled and settings can be disabled and re-enabled`() {
        assertEquals(true, service.settings().enabled)
        assertEquals(0, service.settings().version)

        val disabled = service.update(operatorId, "admin", UUID.randomUUID(), false, 0, "점검 중", UUID.randomUUID(), "127.0.0.1")
        assertEquals(true, disabled.before.enabled)
        assertEquals(false, disabled.after.enabled)
        assertEquals(1, disabled.after.version)
        assertEquals(false, service.settings().enabled)

        val enabled = service.update(operatorId, "admin", UUID.randomUUID(), true, 1, "점검 완료", UUID.randomUUID(), "127.0.0.1")
        assertEquals(false, enabled.before.enabled)
        assertEquals(true, enabled.after.enabled)
        assertEquals(2, enabled.after.version)
        assertEquals(true, service.settings().enabled)
        assertEquals("admin", jdbc.sql("select updated_by_username from chat_send_settings where config_id=1").query(String::class.java).single())
        assertEquals("점검 완료", jdbc.sql("select reason from chat_send_settings where config_id=1").query(String::class.java).single())
    }

    @Test
    fun `update response is operator scoped idempotent and rejects stale versions`() {
        val key = UUID.randomUUID()
        val first = service.update(operatorId, "admin", key, false, 0, "긴급 점검", UUID.randomUUID(), "127.0.0.1")
        val replay = service.update(operatorId, "admin", key, false, 0, "긴급 점검", UUID.randomUUID(), "127.0.0.1")

        assertEquals(1, first.after.version)
        assertTrue(replay.replayed)
        assertEquals(first.before, replay.before)
        assertEquals(first.after, replay.after)
        assertEquals("CHAT_SETTINGS_VERSION_CONFLICT", assertFailsWith<IllegalArgumentException> {
            service.update(secondOperatorId, "other-admin", key, false, 0, "긴급 점검", UUID.randomUUID(), "127.0.0.1")
        }.message)
        assertEquals("IDEMPOTENCY_KEY_REUSED", assertFailsWith<IllegalArgumentException> {
            service.update(operatorId, "admin", key, true, 0, "긴급 점검", UUID.randomUUID(), "127.0.0.1")
        }.message)
        assertEquals("CHAT_SETTINGS_VERSION_CONFLICT", assertFailsWith<IllegalArgumentException> {
            service.update(operatorId, "admin", UUID.randomUUID(), true, 0, "오래된 변경", UUID.randomUUID(), "127.0.0.1")
        }.message)
        assertEquals(1, service.settings().version)

        val events = audit.list(10, operatorId, "UPDATE_CHAT_SETTINGS", true)
        assertEquals(2, events.size)
        assertEquals("긴급 점검", events.first().reason)
        assertEquals(key, events.first().idempotencyKey)
        assertTrue(events.first().beforeSummary!!.contains("\"enabled\":true"))
        assertTrue(events.first().afterSummary!!.contains("\"enabled\":false"))
    }
}
