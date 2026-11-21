package com.hanjjak.admin.application

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import com.hanjjak.cosmetics.domain.CosmeticDefinition
import com.hanjjak.cosmetics.domain.CosmeticGrade
import com.hanjjak.cosmetics.domain.CosmeticSlot
import com.hanjjak.cosmetics.domain.CosmeticsContent
import com.hanjjak.gems.domain.GemOption
import com.hanjjak.inventory.infrastructure.StaticItemCatalog
import org.h2.jdbcx.JdbcDataSource
import org.springframework.jdbc.core.simple.JdbcClient
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class AdminMessagingServiceTest {
    private val operatorId = UUID.randomUUID()
    private val alice = UUID.randomUUID()
    private val bob = UUID.randomUUID()
    private val retired = UUID.randomUUID()
    private val now = Instant.parse("2026-09-15T03:00:00Z")
    private val jdbc = JdbcClient.create(JdbcDataSource().apply { setURL("jdbc:h2:mem:${System.nanoTime()};MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1") })
    private val cosmetics = CosmeticsContent(
        "test", 1, CosmeticGrade.entries.associateWith { 250_000 }, CosmeticGrade.entries.associateWith { listOf(1, 2, 3, 4, 5) },
        listOf(
            CosmeticDefinition("cosmetic-001", "테스트 치장", null, CosmeticGrade.NORMAL, CosmeticSlot.HEAD, "set-1"),
            CosmeticDefinition("cosmetic-188", "싸피 후드집업 검정", null, CosmeticGrade.RARE, CosmeticSlot.TOP, null, gachaEligible = false),
            CosmeticDefinition("cosmetic-189", "싸피 후드집업 파랑", null, CosmeticGrade.RARE, CosmeticSlot.TOP, null, gachaEligible = false),
            CosmeticDefinition("cosmetic-190", "싸피 후드집업 하양", null, CosmeticGrade.RARE, CosmeticSlot.TOP, null, gachaEligible = false),
        ), emptyList(),
    )
    private val service: AdminMessagingService

    init {
        // H2 에는 jsonb 가 없다. 운영 SQL 의 cast 를 그대로 쓰기 위해 같은 이름의 도메인을 만든다.
        jdbc.sql(
            """
            create domain if not exists jsonb as varchar;
            create table account(id uuid primary key,state_version bigint not null,deleted_at timestamp with time zone);
            create table admin_operator(operator_id uuid primary key);
            create table admin_notice(
              notice_id uuid primary key,title varchar(120) not null,body varchar not null,sender_name varchar(120) not null,
              operator_id uuid not null,published_at timestamp with time zone not null,expires_at timestamp with time zone,
              reason varchar(500) not null,created_at timestamp with time zone not null);
            create table mail_message(
              mail_id uuid primary key,account_id uuid not null,type varchar(64) not null,rice_amount bigint not null,
              reward_status varchar(16) not null,created_at timestamp with time zone not null,claimed_at timestamp with time zone,
              title varchar(120),body varchar,sender_name varchar(120),read_at timestamp with time zone,
              deleted_at timestamp with time zone,rewards_json jsonb not null,send_id uuid,claimed boolean not null default false);
            create table admin_mail_send(
              send_id uuid primary key,operator_id uuid not null,target_mode varchar(16) not null,target_account_id uuid,
              title varchar(120) not null,body varchar not null,sender_name varchar(120) not null,
              rice_amount bigint not null,rewards_json jsonb not null,recipient_count integer not null,
              published_at timestamp with time zone not null,expires_at timestamp with time zone,
              reason varchar(500) not null,created_at timestamp with time zone not null);
            create table admin_mail_send_recipient(send_id uuid not null,account_id uuid not null,primary key(send_id,account_id));
            create table admin_message_command(
              operator_id uuid not null,idempotency_key uuid not null,fingerprint varchar(64) not null,
              result_json varchar not null,created_at timestamp with time zone not null,primary key(operator_id,idempotency_key));
            """.trimIndent(),
        ).update()
        jdbc.sql("insert into admin_operator(operator_id) values (:operator)").param("operator", operatorId).update()
        listOf(alice, bob).forEach { jdbc.sql("insert into account(id,state_version) values (:id,1)").param("id", it).update() }
        jdbc.sql("insert into account(id,state_version,deleted_at) values (:id,1,:now)")
            .params(mapOf("id" to retired, "now" to java.sql.Timestamp.from(now))).update()
        service = AdminMessagingService(
            jdbc, StaticItemCatalog(), cosmetics,
            ObjectMapper().registerKotlinModule().registerModule(JavaTimeModule()),
            TickingClock(now),
        )
    }

    /**
     * 부르는 때마다 1초씩 흐르는 시계.
     *
     * 멈춘 시계로는 멱등을 확인할 수 없다. 노출 시작을 비우고 보낸 공지는 서버가 `now` 로
     * 채우는데, 시계가 멈춰 있으면 두 번째 요청도 같은 값을 받아 지문이 우연히 맞아떨어진다.
     * 실제 서버에서는 두 요청 사이에 시간이 흐르므로, 여기서도 흘려야 진짜를 잰다.
     */
    private class TickingClock(private var current: Instant) : Clock() {
        override fun instant(): Instant = current.also { current = current.plusSeconds(1) }
        override fun getZone(): ZoneOffset = ZoneOffset.UTC
        override fun withZone(zone: java.time.ZoneId): Clock = this
    }

    /* 전체 발송은 받는 사람마다 한 통이지만 운영 이력에는 한 줄로만 남는다. */
    @Test
    fun `a broadcast reaches every living account and records one send`() {
        val result = service.sendMail(
            operatorId, "운영자", UUID.randomUUID(), AdminMessagingService.TargetMode.ALL, null,
            "점검 보상", "기다려 주셔서 고맙습니다.", 1_000, emptyList(), "점검 보상 지급",
        )
        assertEquals(2, result.recipientCount)
        assertEquals(2, mailCount())
        assertEquals(setOf(alice, bob), recipients())
        assertEquals(1, jdbc.sql("select count(*) from admin_mail_send").query(Long::class.java).single())
    }

    /* 탈퇴한 계정에는 보내지 않는다. */
    @Test
    fun `a broadcast skips accounts that are already gone`() {
        service.sendMail(
            operatorId, "운영자", UUID.randomUUID(), AdminMessagingService.TargetMode.ALL, null,
            "점검 보상", "본문", 10, emptyList(), "점검 보상 지급",
        )
        assertTrue(retired !in recipients())
    }

    @Test
    fun `an individual send touches only that account`() {
        service.sendMail(
            operatorId, "운영자", UUID.randomUUID(), AdminMessagingService.TargetMode.ACCOUNT, alice,
            "문의 답변", "확인했습니다.", 0, emptyList(), "CS 답변",
        )
        assertEquals(setOf(alice), recipients())
    }

    @Test
    fun `a multi-account send reaches each selected living account once`() {
        val result = service.sendMail(
            operatorId, "운영자", UUID.randomUUID(), AdminMessagingService.TargetMode.ACCOUNTS, null,
            "선정 보상", "두 분께 드립니다.", 500, emptyList(), "선정 사용자 보상", targetAccountIds = listOf(bob, alice, alice),
        )

        assertEquals(2, result.recipientCount)
        assertEquals(setOf(alice, bob), recipients())
        assertEquals(2, jdbc.sql("select count(*) from admin_mail_send_recipient").query(Long::class.java).single())
        assertEquals(AdminMessagingService.TargetMode.ACCOUNTS, service.history().single().targetMode)
    }

    @Test
    fun `a multi-account send rejects an empty or deleted recipient set atomically`() {
        val empty = assertFailsWith<IllegalArgumentException> {
            service.sendMail(
                operatorId, "운영자", UUID.randomUUID(), AdminMessagingService.TargetMode.ACCOUNTS, null,
                "선정 보상", "본문", 0, emptyList(), "선정 사용자 보상", targetAccountIds = emptyList(),
            )
        }
        val deleted = assertFailsWith<IllegalArgumentException> {
            service.sendMail(
                operatorId, "운영자", UUID.randomUUID(), AdminMessagingService.TargetMode.ACCOUNTS, null,
                "선정 보상", "본문", 0, emptyList(), "선정 사용자 보상", targetAccountIds = listOf(alice, retired),
            )
        }

        assertEquals("ADMIN_MESSAGE_TARGET_INVALID", empty.message)
        assertEquals("ADMIN_ACCOUNT_NOT_FOUND", deleted.message)
        assertEquals(0, mailCount())
    }

    @Test
    fun `a scheduled mail is recorded now but is not copied before publication`() {
        val expiresAt = now.plusSeconds(1_200)
        val result = service.sendMail(
            operatorId, "운영자", UUID.randomUUID(), AdminMessagingService.TargetMode.ALL, null,
            "예약 보상", "나중에 열립니다.", 100, emptyList(), "예약 보상 지급", now.plusSeconds(600), expiresAt,
        )
        assertEquals(2, result.recipientCount)
        assertEquals(0, mailCount())
        val history = service.history().single()
        assertEquals(now.plusSeconds(600), history.publishedAt)
        assertEquals(expiresAt, history.expiresAt)
        assertEquals("나중에 열립니다.", history.body)
    }

    @Test
    fun `refuses a mail whose window ends before it starts`() {
        val failure = assertFailsWith<IllegalArgumentException> {
            service.sendMail(
                operatorId, "운영자", UUID.randomUUID(), AdminMessagingService.TargetMode.ALL, null,
                "예약 보상", "본문", 100, emptyList(), "예약 보상 지급",
                now.plusSeconds(600), now.plusSeconds(60),
            )
        }
        assertEquals("ADMIN_MAIL_WINDOW_INVALID", failure.message)
    }

    /* 보상이 없는 안내문은 받을 것이 없다. 미수령 배지에 걸리면 안 된다. */
    @Test
    fun `a message without rewards is marked as having nothing to claim`() {
        service.sendMail(
            operatorId, "운영자", UUID.randomUUID(), AdminMessagingService.TargetMode.ACCOUNT, alice,
            "문의 답변", "확인했습니다.", 0, emptyList(), "CS 답변",
        )
        assertEquals("NONE", jdbc.sql("select reward_status from mail_message").query(String::class.java).single())
    }

    /*
     * claimed 는 아직 살아 있는 구버전이 읽는 칸이다. 배포가 끝나 구버전이 사라질 때까지
     * 새 코드가 함께 채워야 한다. 받을 것이 없는 안내문은 구버전에서도 받을 것이 없어야 한다.
     */
    @Test
    fun `keeps the old claimed column in step with the reward status`() {
        service.sendMail(
            operatorId, "운영자", UUID.randomUUID(), AdminMessagingService.TargetMode.ACCOUNT, alice,
            "보상 있음", "본문", 100, emptyList(), "보상 지급",
        )
        service.sendMail(
            operatorId, "운영자", UUID.randomUUID(), AdminMessagingService.TargetMode.ACCOUNT, bob,
            "안내만", "본문", 0, emptyList(), "안내 발송",
        )
        val byStatus = jdbc.sql("select reward_status, claimed from mail_message")
            .query { row, _ -> row.getString("reward_status") to row.getBoolean("claimed") }
            .list()
            .toMap()
        assertEquals(mapOf("PENDING" to false, "NONE" to true), byStatus)
    }

    @Test
    fun `the same key sent twice does not send twice`() {
        val key = UUID.randomUUID()
        val first = service.sendMail(
            operatorId, "운영자", key, AdminMessagingService.TargetMode.ALL, null,
            "점검 보상", "본문", 100, emptyList(), "점검 보상 지급",
        )
        val second = service.sendMail(
            operatorId, "운영자", key, AdminMessagingService.TargetMode.ALL, null,
            "점검 보상", "본문", 100, emptyList(), "점검 보상 지급",
        )
        assertEquals(first.sendId, second.sendId)
        assertTrue(second.replayed)
        assertEquals(2, mailCount())
    }

    @Test
    fun `stores the reward names as they read on the day it was sent`() {
        service.sendMail(
            operatorId, "운영자", UUID.randomUUID(), AdminMessagingService.TargetMode.ACCOUNT, alice,
            "보상", "본문", 0,
            listOf(
                AdminMessagingService.RewardInput(AdminMessagingService.RewardKind.ITEM, 5, itemId = "POTATO_M1"),
                AdminMessagingService.RewardInput(AdminMessagingService.RewardKind.GEM, 1, gemLevel = 1, gemOption = GemOption.FLAT_ATTACK),
            ),
            "보상 지급",
        )
        val stored = jdbc.sql("select rewards_json from mail_message").query(String::class.java).single()
        assertTrue(stored.contains("감자 한 조각"), stored)
        assertTrue(stored.contains("1단계"), stored)
    }

    @Test
    fun `merges two lines that carry the same reward`() {
        service.sendMail(
            operatorId, "운영자", UUID.randomUUID(), AdminMessagingService.TargetMode.ACCOUNT, alice,
            "보상", "본문", 0,
            listOf(
                AdminMessagingService.RewardInput(AdminMessagingService.RewardKind.ITEM, 5, itemId = "POTATO_M1"),
                AdminMessagingService.RewardInput(AdminMessagingService.RewardKind.ITEM, 3, itemId = "POTATO_M1"),
            ),
            "보상 지급",
        )
        val stored = jdbc.sql("select rewards_json from mail_message").query(String::class.java).single()
        assertEquals(1, Regex("POTATO_M1").findAll(stored).count(), stored)
        assertTrue(stored.contains("\"quantity\":8"), stored)
    }

    /* 뽑기권은 고를 항목이 없다. 수량만 보내도 이름이 붙고, 두 줄은 한 줄로 합쳐진다. */
    @Test
    fun `cosmetic gacha tickets need nothing but a quantity`() {
        service.sendMail(
            operatorId, "운영자", UUID.randomUUID(), AdminMessagingService.TargetMode.ACCOUNT, alice,
            "보상", "본문", 0,
            listOf(
                AdminMessagingService.RewardInput(AdminMessagingService.RewardKind.TICKET, 10),
                AdminMessagingService.RewardInput(AdminMessagingService.RewardKind.TICKET, 5),
            ),
            "뽑기권 지급",
        )
        val stored = jdbc.sql("select rewards_json from mail_message").query(String::class.java).single()
        assertEquals(1, Regex("TICKET").findAll(stored).count(), stored)
        assertTrue(stored.contains("치장 뽑기권"), stored)
        assertTrue(stored.contains("\"quantity\":15"), stored)
    }

    @Test
    fun `stores the three event hood options as one cosmetic choice reward`() {
        service.sendMail(
            operatorId, "운영자", UUID.randomUUID(), AdminMessagingService.TargetMode.ACCOUNT, alice,
            "설문 참여 보상", "원하는 색을 골라 주세요.", 0,
            listOf(AdminMessagingService.RewardInput(
                AdminMessagingService.RewardKind.COSMETIC_CHOICE,
                1,
                cosmeticIds = listOf("cosmetic-188", "cosmetic-189", "cosmetic-190"),
            )),
            "설문 참여자 이벤트 의상 지급",
        )

        val stored = jdbc.sql("select rewards_json from mail_message").query(String::class.java).single()
        assertTrue(stored.contains("COSMETIC_CHOICE"), stored)
        assertTrue(stored.contains("cosmetic-188"), stored)
        assertTrue(stored.contains("cosmetic-189"), stored)
        assertTrue(stored.contains("cosmetic-190"), stored)
    }

    @Test
    fun `cosmetic choice rejects ordinary gacha cosmetics`() {
        val failure = assertFailsWith<IllegalArgumentException> {
            service.sendMail(
                operatorId, "운영자", UUID.randomUUID(), AdminMessagingService.TargetMode.ACCOUNT, alice,
                "보상", "본문", 0,
                listOf(AdminMessagingService.RewardInput(
                    AdminMessagingService.RewardKind.COSMETIC_CHOICE,
                    1,
                    cosmeticIds = listOf("cosmetic-001", "cosmetic-188"),
                )),
                "보상 지급",
            )
        }
        assertEquals("COSMETIC_CHOICE_NOT_EVENT_ONLY", failure.message)
    }

    @Test
    fun `cosmetic choice cannot be mixed with another item reward`() {
        val failure = assertFailsWith<IllegalArgumentException> {
            service.sendMail(
                operatorId, "운영자", UUID.randomUUID(), AdminMessagingService.TargetMode.ACCOUNT, alice,
                "보상", "본문", 0,
                listOf(
                    AdminMessagingService.RewardInput(
                        AdminMessagingService.RewardKind.COSMETIC_CHOICE, 1,
                        cosmeticIds = listOf("cosmetic-188", "cosmetic-189", "cosmetic-190"),
                    ),
                    AdminMessagingService.RewardInput(AdminMessagingService.RewardKind.ITEM, 1, itemId = "POTATO_M1"),
                ),
                "보상 지급",
            )
        }
        assertEquals("COSMETIC_CHOICE_MUST_BE_EXCLUSIVE", failure.message)
    }

    @Test
    fun `cosmetic choice cannot be duplicated into quantity two`() {
        val choice = AdminMessagingService.RewardInput(
            AdminMessagingService.RewardKind.COSMETIC_CHOICE, 1,
            cosmeticIds = listOf("cosmetic-188", "cosmetic-189", "cosmetic-190"),
        )
        val failure = assertFailsWith<IllegalArgumentException> {
            service.sendMail(
                operatorId, "운영자", UUID.randomUUID(), AdminMessagingService.TargetMode.ACCOUNT, alice,
                "보상", "본문", 0, listOf(choice, choice), "보상 지급",
            )
        }
        assertEquals("COSMETIC_CHOICE_MUST_BE_EXCLUSIVE", failure.message)
    }

    @Test
    fun `refuses a reward the content does not know`() {
        val failure = assertFailsWith<IllegalArgumentException> {
            service.sendMail(
                operatorId, "운영자", UUID.randomUUID(), AdminMessagingService.TargetMode.ACCOUNT, alice,
                "보상", "본문", 0,
                listOf(AdminMessagingService.RewardInput(AdminMessagingService.RewardKind.COSMETIC, 1, cosmeticId = "없는-치장")),
                "보상 지급",
            )
        }
        assertEquals("COSMETIC_NOT_FOUND", failure.message)
        assertEquals(0, mailCount())
    }

    @Test
    fun `non-set cosmetic mail rejects quantities that the recipient cannot claim`() {
        val duplicateLines = List(2) {
            AdminMessagingService.RewardInput(AdminMessagingService.RewardKind.COSMETIC, 1, cosmeticId = "cosmetic-188")
        }
        val failure = assertFailsWith<IllegalArgumentException> {
            service.sendMail(
                operatorId, "운영자", UUID.randomUUID(), AdminMessagingService.TargetMode.ACCOUNT, alice,
                "보상", "본문", 0, duplicateLines, "보상 지급",
            )
        }
        assertEquals("INVALID_QUANTITY", failure.message)
        assertEquals(0, mailCount())
    }

    @Test
    fun `cosmetic mail rejects quantities larger than collection state can store`() {
        val failure = assertFailsWith<IllegalArgumentException> {
            service.sendMail(
                operatorId, "운영자", UUID.randomUUID(), AdminMessagingService.TargetMode.ACCOUNT, alice,
                "보상", "본문", 0,
                listOf(AdminMessagingService.RewardInput(AdminMessagingService.RewardKind.COSMETIC, Int.MAX_VALUE.toLong() + 1, cosmeticId = "cosmetic-001")),
                "보상 지급",
            )
        }
        assertEquals("INVALID_QUANTITY", failure.message)
        assertEquals(0, mailCount())
    }

    @Test
    fun `refuses a notice whose window ends before it starts`() {
        val failure = assertFailsWith<IllegalArgumentException> {
            service.sendNotice(
                operatorId, "운영자", UUID.randomUUID(), "점검", "본문",
                now.plusSeconds(600), now.plusSeconds(60), "점검 공지",
            )
        }
        assertEquals("ADMIN_NOTICE_WINDOW_INVALID", failure.message)
    }

    /*
     * 노출 시작을 비우고 보낸 공지도 같은 키로 재시도하면 한 건만 남는다. 비운 칸을 서버가
     * 채운 시각은 지문에 들어가지 않는다 — 들어가면 재시도마다 지문이 달라져, 멱등 키가
     * 막으려던 두 번 누름에서 오히려 거절이 난다.
     */
    @Test
    fun `the same notice sent twice with one key is posted once`() {
        val key = UUID.randomUUID()
        val first = service.sendNotice(operatorId, "운영자", key, "점검 안내", "오늘 점검이 있습니다.", null, null, "점검 공지")
        val second = service.sendNotice(operatorId, "운영자", key, "점검 안내", "오늘 점검이 있습니다.", null, null, "점검 공지")
        assertEquals(first.sendId, second.sendId)
        assertTrue(second.replayed)
        assertEquals(1, jdbc.sql("select count(*) from admin_notice").query(Long::class.java).single())
    }

    /* 내용이 달라진 재사용은 거절한다. 같은 키로 다른 공지가 올라가면 이력과 화면이 어긋난다. */
    @Test
    fun `refuses a reused key that carries a different notice`() {
        val key = UUID.randomUUID()
        service.sendNotice(operatorId, "운영자", key, "점검 안내", "오늘 점검이 있습니다.", null, null, "점검 공지")
        val failure = assertFailsWith<IllegalArgumentException> {
            service.sendNotice(operatorId, "운영자", key, "다른 안내", "다른 본문입니다.", null, null, "점검 공지")
        }
        assertEquals("IDEMPOTENCY_KEY_REUSED", failure.message)
    }

    @Test
    fun `a notice is one row and shows up in the send history`() {
        service.sendNotice(operatorId, "운영자", UUID.randomUUID(), "점검 안내", "오늘 점검이 있습니다.", null, now.plusSeconds(3600), "점검 공지")
        service.sendMail(
            operatorId, "운영자", UUID.randomUUID(), AdminMessagingService.TargetMode.ALL, null,
            "점검 보상", "본문", 10, emptyList(), "점검 보상 지급",
        )
        val history = service.history()
        assertEquals(2, history.size)
        assertEquals(
            setOf(AdminMessagingService.HistoryKind.NOTICE, AdminMessagingService.HistoryKind.MAIL),
            history.map { it.kind }.toSet(),
        )
        assertEquals(1, jdbc.sql("select count(*) from admin_notice").query(Long::class.java).single())
    }

    private fun mailCount() = jdbc.sql("select count(*) from mail_message").query(Long::class.java).single()
    private fun recipients() = jdbc.sql("select account_id from mail_message").query(UUID::class.java).list().toSet()
}
