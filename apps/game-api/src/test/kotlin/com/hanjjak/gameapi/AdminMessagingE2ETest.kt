package com.hanjjak.gameapi

import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.account.application.MaterialPreferenceService
import com.hanjjak.account.domain.MaterialType
import com.hanjjak.admin.application.AdminGitlabProfile
import jakarta.servlet.http.Cookie
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.MediaType
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import java.time.Instant
import java.util.UUID

/**
 * 운영자가 보낸 공지·보상 우편이 실제 PostgreSQL 위에서 사용자 화면까지 닿는지 확인한다.
 * jsonb 첨부, 공지 노출 기간, 계정별 읽음·삭제 상태처럼 H2 로는 검증할 수 없는 것들이 여기 있다.
 */
@GameApiIntegrationTest
class AdminMessagingE2ETest {
    @Autowired lateinit var mvc: MockMvc
    @Autowired lateinit var mapper: ObjectMapper
    @Autowired lateinit var jdbc: JdbcClient
    @Autowired lateinit var gitlab: StubAdminGitlabProvider
    @Autowired lateinit var materials: MaterialPreferenceService

    @Test
    fun `a notice reaches every reader and each of them hides it on their own`() {
        val admin = gitlabLogin()
        val reader = signup()
        val bystander = signup()
        val title = "점검 안내 ${UUID.randomUUID()}"

        mvc.post("/api/admin/v1/messaging/notices") {
            cookie(admin)
            header("Origin", ADMIN_ORIGIN)
            header("Idempotency-Key", UUID.randomUUID())
            contentType = MediaType.APPLICATION_JSON
            content = """{"title":"$title","body":"오늘 점검이 있습니다.","reason":"점검 공지"}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.data.kind") { value("NOTICE") }
        }

        val noticeId = noticeIdOf(reader, title)
        assertTrue(unreadNotices(reader) >= 1)

        mvc.post("/api/v1/notices/$noticeId/read") { cookie(reader); header("Origin", ORIGIN) }.andExpect {
            status { isOk() }
            jsonPath("$.data.noticeId") { value(noticeId) }
        }
        assertTrue(titles(reader).contains(title))

        mvc.post("/api/v1/notices/$noticeId/delete") { cookie(reader); header("Origin", ORIGIN) }.andExpect { status { isOk() } }
        assertTrue(!titles(reader).contains(title), "지운 사람에게는 보이지 않아야 한다")
        assertTrue(titles(bystander).contains(title), "다른 사람의 목록은 그대로여야 한다")

        // 공지 원본은 한 건뿐이다. 읽고 지운 사람 수만큼 복제되지 않는다.
        assertEquals(
            1,
            jdbc.sql("select count(*) from admin_notice where title=:title").param("title", title).query(Long::class.java).single(),
        )
    }

    @Test
    fun `a notice outside its window is not shown and cannot be read`() {
        val admin = gitlabLogin()
        val reader = signup()
        val title = "지난 이벤트 ${UUID.randomUUID()}"

        mvc.post("/api/admin/v1/messaging/notices") {
            cookie(admin)
            header("Origin", ADMIN_ORIGIN)
            header("Idempotency-Key", UUID.randomUUID())
            contentType = MediaType.APPLICATION_JSON
            content = """{"title":"$title","body":"끝난 이벤트입니다.","publishedAt":"2026-01-01T00:00:00Z","expiresAt":"2026-01-02T00:00:00Z","reason":"지난 공지"}"""
        }.andExpect { status { isOk() } }

        assertTrue(!titles(reader).contains(title))
        val noticeId = jdbc.sql("select notice_id from admin_notice where title=:title").param("title", title).query(UUID::class.java).single()
        mvc.post("/api/v1/notices/$noticeId/read") { cookie(reader); header("Origin", ORIGIN) }.andExpect {
            status { isUnprocessableEntity() }
            jsonPath("$.code") { value("NOTICE_NOT_FOUND") }
        }
    }

    @Test
    fun `a broadcast gift is claimed once and only then can be thrown away`() {
        val admin = gitlabLogin()
        val reader = signup()
        val title = "점검 보상 ${UUID.randomUUID()}"

        mvc.post("/api/admin/v1/messaging/mails") {
            cookie(admin)
            header("Origin", ADMIN_ORIGIN)
            header("Idempotency-Key", UUID.randomUUID())
            contentType = MediaType.APPLICATION_JSON
            content = """
                {"targetMode":"ALL","title":"$title","body":"기다려 주셔서 고맙습니다.","riceAmount":500,
                 "rewards":[{"kind":"ITEM","itemId":"POTATO_M1","quantity":7}],"reason":"점검 보상 지급"}
            """.trimIndent()
        }.andExpect {
            status { isOk() }
            jsonPath("$.data.kind") { value("MAIL") }
        }

        val mails = mapper.readTree(mvc.get("/api/v1/mails") { cookie(reader) }.andExpect { status { isOk() } }.andReturn().response.contentAsString)
        val gift = mails.at("/data/items").first { it.at("/title").asText() == title }
        val mailId = gift.at("/mailId").asText()
        assertEquals("PENDING", gift.at("/rewardStatus").asText())
        assertEquals(500, gift.at("/riceAmount").asInt())
        assertEquals("감자 한 조각", gift.at("/rewards/0/displayName").asText())
        assertEquals("기다려 주셔서 고맙습니다.", gift.at("/body").asText())

        mvc.post("/api/v1/mails/$mailId/delete") { cookie(reader); header("Origin", ORIGIN) }.andExpect {
            status { isUnprocessableEntity() }
            jsonPath("$.code") { value("MAIL_REWARD_NOT_CLAIMED") }
        }

        mvc.post("/api/v1/mails/$mailId/claim") {
            cookie(reader)
            header("Origin", ORIGIN)
            header("Idempotency-Key", UUID.randomUUID())
        }.andExpect {
            status { isOk() }
            jsonPath("$.data.result.riceAmount") { value(500) }
            jsonPath("$.data.result.walletBalance") { value(500) }
        }

        val accountId = accountIdOf(reader)
        assertEquals(
            7,
            jdbc.sql("select quantity from inventory_stack where account_id=:account and item_id='POTATO_M1'")
                .param("account", accountId).query(Long::class.java).single(),
        )

        mvc.post("/api/v1/mails/$mailId/delete") { cookie(reader); header("Origin", ORIGIN) }.andExpect { status { isOk() } }
        val after = mapper.readTree(mvc.get("/api/v1/mails") { cookie(reader) }.andReturn().response.contentAsString)
        assertTrue(after.at("/data/items").none { it.at("/mailId").asText() == mailId }, "지운 우편은 목록에서 사라져야 한다")
    }

    @Test
    fun `a cosmetic received from admin mail is immediately registered`() {
        val admin = gitlabLogin()
        val reader = signup()
        val title = "치장 지급 ${UUID.randomUUID()}"

        mvc.post("/api/admin/v1/messaging/mails") {
            cookie(admin)
            header("Origin", ADMIN_ORIGIN)
            header("Idempotency-Key", UUID.randomUUID())
            contentType = MediaType.APPLICATION_JSON
            content = """{"targetMode":"ACCOUNT","targetAccountId":"${accountIdOf(reader)}","title":"$title","body":"치장을 지급합니다.","riceAmount":0,"rewards":[{"kind":"COSMETIC","cosmeticId":"cosmetic-001","quantity":1}],"reason":"치장 지급 검증"}"""
        }.andExpect { status { isOk() } }

        val mails = mapper.readTree(mvc.get("/api/v1/mails") { cookie(reader) }.andExpect { status { isOk() } }.andReturn().response.contentAsString)
        val mailId = mails.at("/data/items").first { it.at("/title").asText() == title }.at("/mailId").asText()
        mvc.post("/api/v1/mails/$mailId/claim") {
            cookie(reader)
            header("Origin", ORIGIN)
            header("Idempotency-Key", UUID.randomUUID())
        }.andExpect { status { isOk() } }

        val state = jdbc.sql("select registered_quantity,unregistered_quantity from cosmetic_collection_state where account_id=:account and cosmetic_id='cosmetic-001'")
            .param("account", accountIdOf(reader))
            .query { row, _ -> row.getInt("registered_quantity") to row.getInt("unregistered_quantity") }
            .single()
        assertEquals(1 to 0, state)
    }

    @Test
    fun `one admin mail request reaches multiple selected accounts and no others`() {
        val admin = gitlabLogin()
        val first = signup()
        val second = signup()
        val excluded = signup()
        val firstId = accountIdOf(first)
        val secondId = accountIdOf(second)
        val title = "선정 보상 ${UUID.randomUUID()}"

        mvc.post("/api/admin/v1/messaging/mails") {
            cookie(admin)
            header("Origin", ADMIN_ORIGIN)
            header("Idempotency-Key", UUID.randomUUID())
            contentType = MediaType.APPLICATION_JSON
            content = """{"targetMode":"ACCOUNTS","targetAccountIds":["$firstId","$secondId","$firstId"],"title":"$title","body":"선정된 사용자 보상입니다.","riceAmount":300,"rewards":[],"reason":"선정 사용자 보상"}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.data.recipientCount") { value(2) }
        }

        assertEquals(1, titles(first, "/api/v1/mails").count { it == title })
        assertEquals(1, titles(second, "/api/v1/mails").count { it == title })
        assertTrue(titles(excluded, "/api/v1/mails").none { it == title })
    }

    @Test
    fun `a user who joins after publication receives the broadcast gift exactly once`() {
        val admin = gitlabLogin()
        val title = "신규 가입 보상 ${UUID.randomUUID()}"

        mvc.post("/api/admin/v1/messaging/mails") {
            cookie(admin)
            header("Origin", ADMIN_ORIGIN)
            header("Idempotency-Key", UUID.randomUUID())
            contentType = MediaType.APPLICATION_JSON
            content = """{"targetMode":"ALL","title":"$title","body":"게시 뒤 가입해도 받습니다.","riceAmount":100,"rewards":[],"reason":"신규 가입 포함 검증"}"""
        }.andExpect { status { isOk() } }

        val lateReader = signup()
        assertEquals(1, titles(lateReader, "/api/v1/mails").count { it == title })
        assertEquals(1, titles(lateReader, "/api/v1/mails").count { it == title })
    }

    @Test
    fun `a scheduled gift stays hidden before its publication time`() {
        val admin = gitlabLogin()
        val reader = signup()
        val title = "예약 보상 ${UUID.randomUUID()}"
        val future = Instant.now().plusSeconds(3_600)

        mvc.post("/api/admin/v1/messaging/mails") {
            cookie(admin)
            header("Origin", ADMIN_ORIGIN)
            header("Idempotency-Key", UUID.randomUUID())
            contentType = MediaType.APPLICATION_JSON
            content = """{"targetMode":"ALL","title":"$title","body":"아직 보이면 안 됩니다.","riceAmount":100,"rewards":[],"publishedAt":"$future","reason":"예약 발송 검증"}"""
        }.andExpect { status { isOk() } }

        assertTrue(titles(reader, "/api/v1/mails").none { it == title })
        assertEquals(
            0,
            jdbc.sql("select count(*) from mail_message where title=:title").param("title", title).query(Long::class.java).single(),
        )

        jdbc.sql("update admin_mail_send set published_at=now() - interval '1 second' where title=:title")
            .param("title", title).update()

        assertEquals(1, titles(reader, "/api/v1/mails").count { it == title })
        assertEquals(1, titles(reader, "/api/v1/mails").count { it == title })
    }

    @Test
    fun `an expired gift disappears and can no longer be claimed`() {
        val admin = gitlabLogin()
        val reader = signup()
        val title = "기간 한정 보상 ${UUID.randomUUID()}"
        val future = Instant.now().plusSeconds(3_600)

        mvc.post("/api/admin/v1/messaging/mails") {
            cookie(admin)
            header("Origin", ADMIN_ORIGIN)
            header("Idempotency-Key", UUID.randomUUID())
            contentType = MediaType.APPLICATION_JSON
            content = """{"targetMode":"ALL","title":"$title","body":"기간 안에 받아야 합니다.","riceAmount":100,"rewards":[],"expiresAt":"$future","reason":"기간 종료 검증"}"""
        }.andExpect { status { isOk() } }

        val mailId = mapper.readTree(mvc.get("/api/v1/mails") { cookie(reader) }.andReturn().response.contentAsString)
            .at("/data/items").first { it.at("/title").asText() == title }.at("/mailId").asText()
        jdbc.sql("update admin_mail_send set expires_at=now() - interval '1 second' where title=:title")
            .param("title", title).update()

        assertTrue(titles(reader, "/api/v1/mails").none { it == title })
        val lateReader = signup()
        assertTrue(titles(lateReader, "/api/v1/mails").none { it == title })
        mvc.post("/api/v1/mails/$mailId/claim") {
            cookie(reader)
            header("Origin", ORIGIN)
            header("Idempotency-Key", UUID.randomUUID())
        }.andExpect {
            status { isUnprocessableEntity() }
            jsonPath("$.code") { value("MAIL_NOT_CLAIMABLE") }
        }
    }

    /*
     * 노출 시작을 비우고 올린 공지도 같은 키로 재시도하면 한 건만 남는다.
     *
     * 이건 멈춘 시계로는 못 재는 것이라 여기 둔다. 비운 칸을 서버가 채우는 시각이 지문에
     * 섞여 있으면 진짜 시계 아래에서만 두 요청의 지문이 갈라져, 재시도가 재생 대신
     * `IDEMPOTENCY_KEY_REUSED` 로 거절된다.
     */
    @Test
    fun `posting the same notice twice with one key posts it once`() {
        val admin = gitlabLogin()
        val reader = signup()
        val title = "중복 방지 공지 ${UUID.randomUUID()}"
        val key = UUID.randomUUID()

        repeat(2) {
            mvc.post("/api/admin/v1/messaging/notices") {
                cookie(admin)
                header("Origin", ADMIN_ORIGIN)
                header("Idempotency-Key", key)
                contentType = MediaType.APPLICATION_JSON
                content = """{"title":"$title","body":"한 번만 올라갑니다.","reason":"멱등 확인"}"""
            }.andExpect { status { isOk() } }
        }

        assertEquals(1, titles(reader).count { it == title })
        assertEquals(
            1,
            jdbc.sql("select count(*) from admin_notice where title=:title").param("title", title).query(Long::class.java).single(),
        )
    }

    /* 같은 멱등 키로 두 번 보내도 우편은 한 번만 만들어진다. */
    @Test
    fun `sending the same gift twice with one key delivers it once`() {
        val admin = gitlabLogin()
        val reader = signup()
        val title = "중복 방지 ${UUID.randomUUID()}"
        val key = UUID.randomUUID()
        val body = """{"targetMode":"ALL","title":"$title","body":"한 번만 도착합니다.","riceAmount":10,"rewards":[],"reason":"멱등 확인"}"""

        repeat(2) {
            mvc.post("/api/admin/v1/messaging/mails") {
                cookie(admin)
                header("Origin", ADMIN_ORIGIN)
                header("Idempotency-Key", key)
                contentType = MediaType.APPLICATION_JSON
                content = body
            }.andExpect { status { isOk() } }
        }

        assertEquals(1, titles(reader, "/api/v1/mails").count { it == title })
    }

    private fun titles(cookie: Cookie, path: String = "/api/v1/notices"): List<String> =
        mapper.readTree(mvc.get(path) { cookie(cookie) }.andExpect { status { isOk() } }.andReturn().response.contentAsString)
            .at("/data/items").map { it.at("/title").asText() }

    private fun unreadNotices(cookie: Cookie): Int =
        mapper.readTree(mvc.get("/api/v1/notices") { cookie(cookie) }.andReturn().response.contentAsString)
            .at("/data/unreadCount").asInt()

    private fun noticeIdOf(cookie: Cookie, title: String): String =
        mapper.readTree(mvc.get("/api/v1/notices") { cookie(cookie) }.andReturn().response.contentAsString)
            .at("/data/items").first { it.at("/title").asText() == title }.at("/noticeId").asText()

    private fun accountIdOf(cookie: Cookie): UUID =
        UUID.fromString(mapper.readTree(mvc.get("/api/v1/auth/session") { cookie(cookie) }.andReturn().response.contentAsString)
            .at("/data/account/accountId").asText())

    private fun signup(): Cookie {
        val suffix = UUID.randomUUID().toString().take(8)
        val response = mvc.post("/api/v1/auth/signup") {
            header("Origin", ORIGIN)
            header("Idempotency-Key", UUID.randomUUID())
            contentType = MediaType.APPLICATION_JSON
            content = """{"email":"messaging-$suffix@test.local","password":"password123","nickname":"수신자$suffix"}"""
        }.andExpect { status { isOk() } }.andReturn()
        // 주력 재료를 고르기 전에는 게임 API 가 막힌다. 메시지함도 그 뒤에 열린다.
        val accountId = UUID.fromString(mapper.readTree(response.response.contentAsString).at("/data/accountId").asText())
        materials.select(accountId, UUID.randomUUID(), MaterialType.POTATO)
        return response.response.cookies.single { it.name == "SESSION" }
    }

    private fun gitlabLogin(): Cookie {
        val begin = mvc.post("/api/admin/v1/auth/gitlab/begin") { header("Origin", ADMIN_ORIGIN) }
            .andExpect { status { isOk() } }
            .andReturn()
        val authorizationUrl = mapper.readTree(begin.response.contentAsString).at("/data/authorizationUrl").asText()
        val state = java.net.URI(authorizationUrl).rawQuery.split('&')
            .map { it.split('=', limit = 2) }
            .first { it[0] == "state" }[1]
        gitlab.profile = AdminGitlabProfile(314, "allowed-admin", "Allowed Admin", "active", false)
        val callback = mvc.get("/api/admin/v1/auth/gitlab/callback?state=$state&code=provider-code")
            .andExpect { status { isFound() } }
            .andReturn()
        return requireNotNull(callback.response.getCookie("HANJJAK_ADMIN_SESSION"))
    }

    private companion object {
        const val ORIGIN = "http://localhost:5173"
        const val ADMIN_ORIGIN = "http://localhost:5173"
    }
}
