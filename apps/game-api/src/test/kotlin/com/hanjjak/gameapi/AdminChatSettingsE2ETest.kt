package com.hanjjak.gameapi

import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.account.application.MaterialPreferenceService
import com.hanjjak.account.domain.MaterialType
import com.hanjjak.admin.application.AdminGitlabProfile
import jakarta.servlet.http.Cookie
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.MediaType
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import org.springframework.test.web.servlet.put
import java.util.UUID

@GameApiIntegrationTest
class AdminChatSettingsE2ETest {
    @Autowired lateinit var mvc: MockMvc
    @Autowired lateinit var mapper: ObjectMapper
    @Autowired lateinit var jdbc: JdbcClient
    @Autowired lateinit var gitlab: StubAdminGitlabProvider
    @Autowired lateinit var materials: MaterialPreferenceService

    @BeforeEach
    fun resetChatSettings() {
        jdbc.sql("update chat_send_settings set enabled=true,version=0,updated_at=now(),updated_by=null,updated_by_username=null,reason=null where config_id=1").update()
    }

    @Test
    fun `admin can toggle sending without hiding history and a disabled send cannot replay`() {
        val admin = gitlabLogin()
        val (player, accountId) = signup()
        val initialKey = UUID.randomUUID()
        val initial = send(player, initialKey, "감자 팝니다")
            .andExpect { status { isOk() } }
            .andReturn()
        val originalMessageId = mapper.readTree(initial.response.contentAsString).at("/data/result/message/messageId").asText()

        mvc.get("/api/admin/v1/chat/settings") { cookie(admin); header("Origin", ADMIN_ORIGIN) }.andExpect {
            status { isOk() }
            jsonPath("$.data.enabled") { value(true) }
            jsonPath("$.data.version") { value(0) }
        }
        val disableKey = UUID.randomUUID()
        updateSettings(admin, disableKey, false, 0, "긴급 점검").andExpect {
            status { isOk() }
            jsonPath("$.data.before.enabled") { value(true) }
            jsonPath("$.data.after.enabled") { value(false) }
            jsonPath("$.data.after.version") { value(1) }
            jsonPath("$.data.replayed") { value(false) }
        }
        updateSettings(admin, disableKey, false, 0, "긴급 점검").andExpect {
            status { isOk() }
            jsonPath("$.data.replayed") { value(true) }
        }

        val blockedKey = UUID.randomUUID()
        send(player, blockedKey, "점검 중 메시지").andExpect {
            status { isForbidden() }
            jsonPath("$.code") { value("CHAT_DISABLED") }
        }
        send(player, initialKey, "감자 팝니다").andExpect {
            status { isForbidden() }
            jsonPath("$.code") { value("CHAT_DISABLED") }
        }

        assertEquals(1, jdbc.sql("select count(*) from chat_message where account_id=:account").param("account", accountId).query(Long::class.java).single())
        assertEquals(0, jdbc.sql("select count(*) from command_record where account_id=:account and idempotency_key=:key")
            .params(mapOf("account" to accountId, "key" to blockedKey)).query(Long::class.java).single())
        assertEquals(1, jdbc.sql("select count(*) from command_record where account_id=:account and idempotency_key=:key")
            .params(mapOf("account" to accountId, "key" to initialKey)).query(Long::class.java).single())
        assertEquals(1, jdbc.sql("select count(*) from outbox_event where event_type='CHAT_MESSAGE_CREATED'").query(Long::class.java).single())
        mvc.get("/api/v1/chat/messages") { cookie(player) }.andExpect {
            status { isOk() }
            jsonPath("$.data.items[0].messageId") { value(originalMessageId) }
        }
        val staleKey = UUID.randomUUID()
        updateSettings(admin, staleKey, true, 0, "오래된 설정 변경").andExpect {
            status { isConflict() }
            jsonPath("$.code") { value("CHAT_SETTINGS_VERSION_CONFLICT") }
        }
        assertEquals(1, jdbc.sql("select count(*) from admin_audit_event where action='UPDATE_CHAT_SETTINGS' and outcome='FAILED' and idempotency_key=:key")
            .param("key", staleKey).query(Long::class.java).single())

        updateSettings(admin, UUID.randomUUID(), true, 1, "점검 완료").andExpect {
            status { isOk() }
            jsonPath("$.data.after.enabled") { value(true) }
            jsonPath("$.data.after.version") { value(2) }
        }
        send(player, UUID.randomUUID(), "점검 완료 채팅").andExpect { status { isOk() } }
        assertEquals(2, jdbc.sql("select count(*) from chat_message where account_id=:account").param("account", accountId).query(Long::class.java).single())
    }

    @Test
    fun `chat settings require admin authentication`() {
        mvc.get("/api/admin/v1/chat/settings").andExpect {
            status { isUnauthorized() }
            jsonPath("$.code") { value("ADMIN_AUTHENTICATION_REQUIRED") }
        }
    }

    private fun updateSettings(admin: Cookie, key: UUID, enabled: Boolean, expectedVersion: Long, reason: String) =
        mvc.put("/api/admin/v1/chat/settings") {
            cookie(admin)
            header("Origin", ADMIN_ORIGIN)
            header("Idempotency-Key", key)
            contentType = MediaType.APPLICATION_JSON
            content = """{"enabled":$enabled,"expectedVersion":$expectedVersion,"reason":"$reason"}"""
        }

    private fun send(player: Cookie, key: UUID, body: String) = mvc.post("/api/v1/chat/messages") {
        cookie(player)
        header("Origin", ORIGIN)
        header("Idempotency-Key", key)
        contentType = MediaType.APPLICATION_JSON
        content = mapper.writeValueAsString(mapOf("body" to body))
    }

    private fun signup(): Pair<Cookie, UUID> {
        val suffix = UUID.randomUUID().toString().take(8)
        val response = mvc.post("/api/v1/auth/signup") {
            header("Origin", ORIGIN)
            header("Idempotency-Key", UUID.randomUUID())
            contentType = MediaType.APPLICATION_JSON
            content = """{"email":"chat-lock-$suffix@test.local","password":"password123","nickname":"광장$suffix"}"""
        }.andExpect { status { isOk() } }.andReturn()
        val accountId = UUID.fromString(mapper.readTree(response.response.contentAsString).at("/data/accountId").asText())
        materials.select(accountId, UUID.randomUUID(), MaterialType.POTATO)
        return response.response.cookies.single { it.name == "SESSION" } to accountId
    }

    private fun gitlabLogin(): Cookie {
        val begin = mvc.post("/api/admin/v1/auth/gitlab/begin") { header("Origin", ADMIN_ORIGIN) }
            .andExpect { status { isOk() } }.andReturn()
        val authorizationUrl = mapper.readTree(begin.response.contentAsString).at("/data/authorizationUrl").asText()
        val state = java.net.URI(authorizationUrl).rawQuery.split('&')
            .map { it.split('=', limit = 2) }.first { it[0] == "state" }[1]
        gitlab.profile = AdminGitlabProfile(314, "allowed-admin", "Chat Admin", "active", false)
        val callback = mvc.get("/api/admin/v1/auth/gitlab/callback?state=$state&code=provider-code")
            .andExpect { status { isFound() } }.andReturn()
        return requireNotNull(callback.response.getCookie("HANJJAK_ADMIN_SESSION"))
    }

    private companion object {
        const val ORIGIN = "http://localhost:5173"
        const val ADMIN_ORIGIN = "http://localhost:5173"
    }
}
