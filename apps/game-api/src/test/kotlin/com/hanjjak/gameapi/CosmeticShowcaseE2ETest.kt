package com.hanjjak.gameapi

import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.admin.application.AdminGitlabProfile
import com.hanjjak.account.application.MaterialPreferenceService
import com.hanjjak.account.domain.MaterialType
import jakarta.servlet.http.Cookie
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.MediaType
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import java.util.UUID

@GameApiIntegrationTest
class CosmeticShowcaseE2ETest {
    @Autowired lateinit var mvc: MockMvc
    @Autowired lateinit var mapper: ObjectMapper
    @Autowired lateinit var jdbc: JdbcClient
    @Autowired lateinit var gitlab: StubAdminGitlabProvider
    @Autowired lateinit var materials: MaterialPreferenceService

    @Test
    fun `legacy admin selection is audited but public showcase remains the fixed gallery`() {
        val admin = gitlabLogin()
        val viewer = signup()
        val config = adminConfig(admin)
        val key = UUID.randomUUID()

        repeat(2) {
            mvc.post("/api/admin/v1/cosmetics/showcase") {
                cookie(admin)
                header("Origin", ORIGIN)
                header("Idempotency-Key", key)
                contentType = MediaType.APPLICATION_JSON
                content = """{"selectedSetIds":["white-fox-spirit"],"expectedVersion":${config.at("/version").asLong()},"reason":"가을 대표 세트 변경"}"""
            }.andExpect {
                status { isOk() }
                jsonPath("$.data.after.selectedSetIds[0]") { value("white-fox-spirit") }
                jsonPath("$.data.after.options[4].displayName") { value("구미호 세트") }
                if (it == 1) jsonPath("$.data.replayed") { value(true) }
            }
        }

        mvc.get("/api/v1/cosmetic-gacha/showcase") { cookie(viewer) }.andExpect {
            status { isOk() }
            jsonPath("$.data.sets.length()") { value(9) }
            jsonPath("$.data.sets[?(@.setId == 'white-fox-spirit')].displayName") { value("구미호 세트") }
            jsonPath("$.data.sets[?(@.setId == 'cardboard-crayon-warrior')].displayName") { value("골판지 크레용 전사") }
            jsonPath("$.data.sets[?(@.setId == 'forest-spirit')].displayName") { value("숲의정령") }
            jsonPath("$.data.sets[?(@.setId == 'snake-water-guardian')].displayName") { value("뱀물수호자") }
        }
        assertEquals(
            2,
            jdbc.sql("select count(*) from admin_audit_event where action='UPDATE_COSMETIC_SHOWCASE' and outcome='SUCCEEDED'")
                .query(Long::class.java).single(),
        )
    }

    @Test
    fun `empty selections are rejected without changing the version`() {
        val admin = gitlabLogin()
        val before = adminConfig(admin).at("/version").asLong()

        mvc.post("/api/admin/v1/cosmetics/showcase") {
            cookie(admin)
            header("Origin", ORIGIN)
            header("Idempotency-Key", UUID.randomUUID())
            contentType = MediaType.APPLICATION_JSON
            content = """{"selectedSetIds":[],"expectedVersion":$before,"reason":"빈 목록 검증"}"""
        }.andExpect {
            status { isBadRequest() }
            jsonPath("$.code") { value("COSMETIC_SHOWCASE_SELECTION_REQUIRED") }
        }

        assertEquals(before, adminConfig(admin).at("/version").asLong())
    }

    private fun adminConfig(cookie: Cookie) =
        mapper.readTree(
            mvc.get("/api/admin/v1/cosmetics/showcase") { cookie(cookie) }
                .andExpect { status { isOk() } }
                .andReturn().response.contentAsString,
        ).at("/data")

    private fun signup(): Cookie {
        val suffix = UUID.randomUUID().toString().take(8)
        val response = mvc.post("/api/v1/auth/signup") {
            header("Origin", ORIGIN)
            header("Idempotency-Key", UUID.randomUUID())
            contentType = MediaType.APPLICATION_JSON
            content = """{"email":"showcase-$suffix@test.local","password":"password123","nickname":"전시$suffix"}"""
        }.andExpect { status { isOk() } }.andReturn()
        val accountId = UUID.fromString(mapper.readTree(response.response.contentAsString).at("/data/accountId").asText())
        materials.select(accountId, UUID.randomUUID(), MaterialType.POTATO)
        return response.response.cookies.single { it.name == "SESSION" }
    }

    private fun gitlabLogin(): Cookie {
        val begin = mvc.post("/api/admin/v1/auth/gitlab/begin") { header("Origin", ORIGIN) }
            .andExpect { status { isOk() } }.andReturn()
        val state = java.net.URI(mapper.readTree(begin.response.contentAsString).at("/data/authorizationUrl").asText())
            .rawQuery.split('&').map { it.split('=', limit = 2) }.first { it[0] == "state" }[1]
        gitlab.profile = AdminGitlabProfile(314, "allowed-admin", "Showcase Admin", "active", false)
        val callback = mvc.get("/api/admin/v1/auth/gitlab/callback?state=$state&code=provider-code")
            .andExpect { status { isFound() } }.andReturn()
        return requireNotNull(callback.response.getCookie("HANJJAK_ADMIN_SESSION"))
    }

    private companion object {
        const val ORIGIN = "http://localhost:5173"
    }
}
