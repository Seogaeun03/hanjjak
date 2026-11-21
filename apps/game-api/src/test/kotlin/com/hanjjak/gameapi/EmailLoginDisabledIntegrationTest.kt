package com.hanjjak.gameapi

import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.MediaType
import org.springframework.test.context.TestPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import java.util.UUID

@GameApiIntegrationTest
@TestPropertySource(properties = ["hanjjak.api-security.email-login-enabled=false"])
class EmailLoginDisabledIntegrationTest {
    @Autowired private lateinit var mockMvc: MockMvc

    @Test
    fun `disabled email login is advertised and rejects signup and login`() {
        mockMvc.get("/api/v1/auth/methods")
            .andExpect {
                status { isOk() }
                jsonPath("$.data.emailEnabled") { value(false) }
            }

        listOf(
            "/api/v1/auth/signup" to """{"email":"disabled@example.com","password":"password123","nickname":"비활성"}""",
            "/api/v1/auth/login" to """{"email":"disabled@example.com","password":"password123"}""",
        ).forEach { (path, body) ->
            mockMvc.post(path) {
                header("Origin", "http://localhost:5173")
                header("Idempotency-Key", UUID.randomUUID())
                contentType = MediaType.APPLICATION_JSON
                content = body
            }.andExpect {
                status { isServiceUnavailable() }
                jsonPath("$.code") { value("EMAIL_LOGIN_DISABLED") }
            }
        }
    }
}
