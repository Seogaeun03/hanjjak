package com.hanjjak.admin.application

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import org.h2.jdbcx.JdbcDataSource
import org.springframework.jdbc.core.simple.JdbcClient
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AdminBannerServiceTest {
    private val operatorId = UUID.randomUUID()
    private val now = Instant.parse("2026-09-17T03:00:00Z")
    private val clock = TickingClock(now)
    private val jdbc = JdbcClient.create(JdbcDataSource().apply { setURL("jdbc:h2:mem:${System.nanoTime()};MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1") })
    private val service: AdminBannerService

    init {
        jdbc.sql(
            """
            create table admin_operator(operator_id uuid primary key);
            create table admin_banner(
              banner_id uuid primary key,message varchar(200) not null,tone varchar(16) not null,
              operator_id uuid not null,published_at timestamp with time zone not null,
              expires_at timestamp with time zone not null,revoked_at timestamp with time zone,
              reason varchar(500) not null,created_at timestamp with time zone not null);
            create table admin_message_command(
              operator_id uuid not null,idempotency_key uuid not null,fingerprint varchar(64) not null,
              result_json varchar not null,created_at timestamp with time zone not null,primary key(operator_id,idempotency_key));
            """.trimIndent(),
        ).update()
        jdbc.sql("insert into admin_operator(operator_id) values (:operator)").param("operator", operatorId).update()
        service = AdminBannerService(jdbc, ObjectMapper().registerKotlinModule().registerModule(JavaTimeModule()), clock)
    }

    /**
     * 부르는 때마다 1초씩 흐르는 시계.
     *
     * 멈춘 시계로는 멱등을 확인할 수 없다. 시작 시각을 비우고 보낸 요청은 서버가 `now` 로
     * 채우는데, 시계가 멈춰 있으면 두 번째 요청도 같은 값을 받아 지문이 우연히 맞아떨어진다.
     * 실제 서버에서는 두 요청 사이에 시간이 흐르므로, 여기서도 흘려야 진짜를 잰다.
     */
    private class TickingClock(private var current: Instant) : Clock() {
        override fun instant(): Instant = current.also { current = current.plusSeconds(1) }
        override fun getZone(): ZoneOffset = ZoneOffset.UTC
        override fun withZone(zone: java.time.ZoneId): Clock = this
    }

    @Test
    fun `raising a banner opens its window right away when no start is given`() {
        val result = raise("점검 안내")
        assertEquals(now, result.publishedAt)
        assertEquals(AdminBannerService.Tone.INFO, result.tone)
        assertTrue(service.history().single().live)
    }

    /* 끝이 없는 배너는 모든 화면 위에 영원히 붙는다. 기간 자체를 거부한다. */
    @Test
    fun `refuses a window that ends before it starts`() {
        assertEquals(
            "ADMIN_BANNER_WINDOW_INVALID",
            assertFailsWith<IllegalArgumentException> { raise("과거", expiresAt = now.minusSeconds(1)) }.message,
        )
    }

    @Test
    fun `refuses a window longer than a week`() {
        assertEquals(
            "ADMIN_BANNER_WINDOW_TOO_LONG",
            assertFailsWith<IllegalArgumentException> { raise("영원히", expiresAt = now.plusSeconds(8 * 86_400)) }.message,
        )
    }

    @Test
    fun `refuses an empty message`() {
        assertEquals("ADMIN_BANNER_MESSAGE_REQUIRED", assertFailsWith<IllegalArgumentException> { raise("   ") }.message)
    }

    @Test
    fun `refuses a reason too short to explain anything`() {
        assertEquals("ADMIN_USER_REASON_REQUIRED", assertFailsWith<IllegalArgumentException> { raise("점검", reason = "응") }.message)
    }

    /* 같은 멱등 키로 다시 보내면 배너가 하나 더 걸리지 않는다. */
    @Test
    fun `replays the same key instead of raising a second banner`() {
        val key = UUID.randomUUID()
        val first = raise("점검 안내", key = key)
        val again = raise("점검 안내", key = key)
        assertEquals(first.bannerId, again.bannerId)
        assertTrue(again.replayed)
        assertEquals(1, service.history().size)
    }

    @Test
    fun `refuses a reused key that carries different content`() {
        val key = UUID.randomUUID()
        raise("점검 안내", key = key)
        assertEquals("IDEMPOTENCY_KEY_REUSED", assertFailsWith<IllegalArgumentException> { raise("다른 안내", key = key) }.message)
    }

    /* 잘못 올린 배너는 기간이 남아 있어도 내릴 수 있고, 두 번 내려도 처음 시각이 답이다. */
    @Test
    fun `revoking takes the banner down and stays put when repeated`() {
        val banner = raise("오타").bannerId
        val first = service.revoke(banner)
        assertEquals(first.revokedAt, service.revoke(banner).revokedAt)
        assertFalse(service.history().single().live)
    }

    @Test
    fun `refuses to revoke a banner that was never raised`() {
        assertEquals("ADMIN_BANNER_NOT_FOUND", assertFailsWith<IllegalArgumentException> { service.revoke(UUID.randomUUID()) }.message)
    }

    private fun raise(
        message: String,
        tone: AdminBannerService.Tone = AdminBannerService.Tone.INFO,
        publishedAt: Instant? = null,
        expiresAt: Instant = now.plusSeconds(3_600),
        reason: String = "정기 점검 안내",
        key: UUID = UUID.randomUUID(),
    ) = service.raise(operatorId, key, message, tone, publishedAt, expiresAt, reason)
}
