package com.hanjjak.gameapi

import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.account.application.MaterialPreferenceService
import com.hanjjak.account.domain.MaterialType
import com.hanjjak.admin.application.AdminGitlabProfile
import jakarta.servlet.http.Cookie
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.MediaType
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID

/**
 * 운영자가 올린 상단 배너가 실제 PostgreSQL 위에서 사용자 화면까지 닿는지 확인한다.
 *
 * 배너는 공지와 표를 나눠 쓴다. 그 분리가 실제로 유지되는지 — 배너를 올려도 알림 탭이
 * 늘지 않는지 — 는 두 경로를 같은 DB 위에 올려 봐야만 확인된다.
 */
@GameApiIntegrationTest
class AdminBannerE2ETest {
    @Autowired lateinit var mvc: MockMvc
    @Autowired lateinit var mapper: ObjectMapper
    @Autowired lateinit var jdbc: JdbcClient
    @Autowired lateinit var gitlab: StubAdminGitlabProvider
    @Autowired lateinit var materials: MaterialPreferenceService

    @Test
    fun `a banner reaches every viewer and each of them closes it on their own`() {
        val admin = gitlabLogin()
        val viewer = signup()
        val bystander = signup()
        val message = "오늘 22시부터 점검합니다. ${UUID.randomUUID()}"

        raise(admin, message).andExpect {
            status { isOk() }
            jsonPath("$.data.tone") { value("INFO") }
        }

        val bannerId = bannerIdOf(viewer, message)
        assertTrue(messages(bystander).contains(message))

        mvc.post("/api/v1/banners/$bannerId/dismiss") { cookie(viewer); header("Origin", ORIGIN) }.andExpect {
            status { isOk() }
            jsonPath("$.data.bannerId") { value(bannerId) }
        }
        assertFalse(messages(viewer).contains(message), "닫은 사람에게는 보이지 않아야 한다")
        assertTrue(messages(bystander).contains(message), "다른 사람의 화면은 그대로여야 한다")

        // 배너 원본은 한 건뿐이다. 닫은 사람 수만큼 복제되지 않는다.
        assertEquals(
            1,
            jdbc.sql("select count(*) from admin_banner where message=:message").param("message", message).query(Long::class.java).single(),
        )
    }

    /* 배너는 알림 탭에 쌓이지 않는다. 표를 나눈 이유가 바로 이것이다. */
    @Test
    fun `raising a banner leaves the notice inbox untouched`() {
        val admin = gitlabLogin()
        val viewer = signup()
        val before = unreadNotices(viewer)

        raise(admin, "이벤트가 시작되었습니다. ${UUID.randomUUID()}").andExpect { status { isOk() } }

        assertEquals(before, unreadNotices(viewer))
    }

    @Test
    fun `a banner outside its window is not shown and cannot be closed`() {
        val admin = gitlabLogin()
        val viewer = signup()
        val message = "지난 이벤트 ${UUID.randomUUID()}"

        mvc.post("/api/admin/v1/messaging/banners") {
            cookie(admin)
            header("Origin", ADMIN_ORIGIN)
            header("Idempotency-Key", UUID.randomUUID())
            contentType = MediaType.APPLICATION_JSON
            content = """{"message":"$message","tone":"EVENT","publishedAt":"2026-01-01T00:00:00Z","expiresAt":"2026-01-02T00:00:00Z","reason":"지난 배너"}"""
        }.andExpect { status { isOk() } }

        assertFalse(messages(viewer).contains(message))
        val bannerId = jdbc.sql("select banner_id from admin_banner where message=:message").param("message", message).query(UUID::class.java).single()
        mvc.post("/api/v1/banners/$bannerId/dismiss") { cookie(viewer); header("Origin", ORIGIN) }.andExpect {
            status { isUnprocessableEntity() }
            jsonPath("$.code") { value("BANNER_NOT_FOUND") }
        }
    }

    /* 오타를 낸 배너는 기간이 남아 있어도 내릴 수 있어야 한다. */
    @Test
    fun `revoking takes the banner off every screen before its window ends`() {
        val admin = gitlabLogin()
        val viewer = signup()
        val message = "오타가 난 배너 ${UUID.randomUUID()}"

        val bannerId = mapper.readTree(raise(admin, message).andExpect { status { isOk() } }.andReturn().response.contentAsString)
            .at("/data/bannerId").asText()
        assertTrue(messages(viewer).contains(message))

        mvc.post("/api/admin/v1/messaging/banners/$bannerId/revoke") {
            cookie(admin)
            header("Origin", ADMIN_ORIGIN)
            contentType = MediaType.APPLICATION_JSON
            content = """{"reason":"문구 오타"}"""
        }.andExpect { status { isOk() } }

        assertFalse(messages(viewer).contains(message))
    }

    /*
     * 같은 멱등 키로 두 번 올려도 배너는 하나만 걸린다. 운영자가 다시 누른 것이므로
     * 노출 기간까지 똑같은 요청이어야 한다 — 내용이 달라지면 그건 재시도가 아니라 다른 발송이고,
     * 서버는 키 재사용으로 거절해야 맞다.
     */
    @Test
    fun `raising the same banner twice with one key hangs it once`() {
        val admin = gitlabLogin()
        val viewer = signup()
        val message = "중복 방지 ${UUID.randomUUID()}"
        val key = UUID.randomUUID()
        val expires = Instant.now().plus(1, ChronoUnit.HOURS)

        repeat(2) { raise(admin, message, key, expires).andExpect { status { isOk() } } }

        assertEquals(1, messages(viewer).count { it == message })
    }

    /* 내용이 달라진 재사용은 거절한다. 같은 키로 다른 배너가 걸리면 이력과 화면이 어긋난다. */
    @Test
    fun `refuses a reused key that carries a different banner`() {
        val admin = gitlabLogin()
        val key = UUID.randomUUID()
        val expires = Instant.now().plus(1, ChronoUnit.HOURS)
        raise(admin, "처음 문구 ${UUID.randomUUID()}", key, expires).andExpect { status { isOk() } }
        raise(admin, "바뀐 문구 ${UUID.randomUUID()}", key, expires).andExpect {
            status { isBadRequest() }
            jsonPath("$.code") { value("IDEMPOTENCY_KEY_REUSED") }
        }
    }

    /*
     * 노출 종료가 없는 배너는 아예 만들어지지 않는다. `expiresAt` 이 필수 칸이라 본문이
     * 서비스에 닿기도 전에 막히고, 그 거절은 공용 예외 처리기가 422 로 돌려준다.
     */
    @Test
    fun `refuses a banner whose window never ends`() {
        val admin = gitlabLogin()
        mvc.post("/api/admin/v1/messaging/banners") {
            cookie(admin)
            header("Origin", ADMIN_ORIGIN)
            header("Idempotency-Key", UUID.randomUUID())
            contentType = MediaType.APPLICATION_JSON
            content = """{"message":"영원히 붙는 배너","tone":"INFO","reason":"기간 누락"}"""
        }.andExpect { status { isUnprocessableEntity() } }
        assertEquals(
            0,
            jdbc.sql("select count(*) from admin_banner where message='영원히 붙는 배너'").query(Long::class.java).single(),
        )
    }

    /* 기간을 거꾸로 넣은 배너는 서비스가 막고, 운영 규칙 위반이므로 400 으로 돌려준다. */
    @Test
    fun `refuses a window that ends before it starts`() {
        val admin = gitlabLogin()
        mvc.post("/api/admin/v1/messaging/banners") {
            cookie(admin)
            header("Origin", ADMIN_ORIGIN)
            header("Idempotency-Key", UUID.randomUUID())
            contentType = MediaType.APPLICATION_JSON
            content = """{"message":"거꾸로 배너","tone":"INFO","publishedAt":"2026-02-01T00:00:00Z","expiresAt":"2026-01-01T00:00:00Z","reason":"기간 역전"}"""
        }.andExpect {
            status { isBadRequest() }
            jsonPath("$.code") { value("ADMIN_BANNER_WINDOW_INVALID") }
        }
    }

    private fun raise(
        admin: Cookie,
        message: String,
        key: UUID = UUID.randomUUID(),
        expiresAt: Instant = Instant.now().plus(1, ChronoUnit.HOURS),
    ) =
        mvc.post("/api/admin/v1/messaging/banners") {
            cookie(admin)
            header("Origin", ADMIN_ORIGIN)
            header("Idempotency-Key", key)
            contentType = MediaType.APPLICATION_JSON
            content = """{"message":"$message","tone":"INFO","expiresAt":"$expiresAt","reason":"점검 배너"}"""
        }

    private fun messages(cookie: Cookie): List<String> =
        mapper.readTree(mvc.get("/api/v1/banners") { cookie(cookie) }.andExpect { status { isOk() } }.andReturn().response.contentAsString)
            .at("/data/items").map { it.at("/message").asText() }

    private fun bannerIdOf(cookie: Cookie, message: String): String =
        mapper.readTree(mvc.get("/api/v1/banners") { cookie(cookie) }.andReturn().response.contentAsString)
            .at("/data/items").first { it.at("/message").asText() == message }.at("/bannerId").asText()

    private fun unreadNotices(cookie: Cookie): Int =
        mapper.readTree(mvc.get("/api/v1/notices") { cookie(cookie) }.andReturn().response.contentAsString)
            .at("/data/unreadCount").asInt()

    private fun signup(): Cookie {
        val suffix = UUID.randomUUID().toString().take(8)
        val response = mvc.post("/api/v1/auth/signup") {
            header("Origin", ORIGIN)
            header("Idempotency-Key", UUID.randomUUID())
            contentType = MediaType.APPLICATION_JSON
            content = """{"email":"banner-$suffix@test.local","password":"password123","nickname":"관람자$suffix"}"""
        }.andExpect { status { isOk() } }.andReturn()
        // 주력 재료를 고르기 전에는 게임 API 가 막힌다. 배너도 그 뒤에 열린다.
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
