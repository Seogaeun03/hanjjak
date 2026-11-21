package com.hanjjak.admin.api

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.hanjjak.account.api.AccountSessionRegistry
import com.hanjjak.account.application.GameSessionLifecycle
import com.hanjjak.admin.application.AdminAuthenticationService
import com.hanjjak.admin.domain.AdminPermission
import com.hanjjak.admin.domain.AdminPrincipal
import com.hanjjak.admin.domain.AdminRole
import com.hanjjak.admin.infrastructure.AdminAuditRepository
import com.hanjjak.admin.infrastructure.AdminRepository
import org.mockito.Mockito
import org.springframework.http.MediaType
import org.springframework.mock.env.MockEnvironment
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.request.RequestPostProcessor
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.cookie
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import org.springframework.test.web.servlet.setup.MockMvcBuilders
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import kotlin.test.Test
import org.mockito.ArgumentMatchers.anyString

class AdminLocalLoginControllerTest {
    private val clock = Clock.fixed(Instant.parse("2026-09-30T00:00:00Z"), ZoneOffset.UTC)
    private val properties = AdminProperties(
        gitlab = AdminProperties.Gitlab(enabled = false),
        localLogin = AdminProperties.LocalLogin(enabled = true, username = "local-admin", password = "local-controller-test-password-long-12345"),
    )
    private val authentication = Mockito.mock(AdminAuthenticationService::class.java)
    private val audit = Mockito.mock(AdminAuditRepository::class.java)
    private val admins = Mockito.mock(AdminRepository::class.java)
    private val localPolicy = AdminLocalLoginAvailability(properties, MockEnvironment().apply { setActiveProfiles("local") })
    private val controller = AdminAuthenticationController(
        authentication,
        AdminLoginRateLimiter(properties, clock),
        audit,
        properties,
        admins,
        Mockito.mock(GameSessionLifecycle::class.java),
        Mockito.mock(AccountSessionRegistry::class.java),
        clock,
        localPolicy,
    )
    private val mapper = jacksonObjectMapper().findAndRegisterModules()
    private val accessFilter = AdminAccessFilter(authentication, audit, properties.allowedOrigins, mapper, clock)
    private val mvc: MockMvc = MockMvcBuilders.standaloneSetup(controller).let { builder ->
        builder.setControllerAdvice(AdminExceptionHandler(clock))
        builder.build()
    }

    @Test
    fun `JSON local login returns existing admin session cookie and identity`() {
        val principal = AdminPrincipal(UUID.randomUUID(), "local-admin", "Local admin", setOf(AdminRole.ADMIN), AdminPermission.entries.toSet(), true)
        Mockito.`when`(authentication.completeLocalLogin(anyString(), anyString()))
            .thenReturn(AdminAuthenticationService.LoginResult("opaque-session-token", principal))

        mvc.perform(
            post("/api/admin/v1/auth/local/login")
                .header("Origin", "http://localhost:5173")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{"username":"local-admin","password":"local-controller-test-password-long-12345"}""")
                .header("Host", "localhost:5173")
                .with(remoteAddress("127.0.0.1")),
        )
            .andExpect(status().isOk)
            .andExpect(cookie().exists("HANJJAK_ADMIN_SESSION"))
            .andExpect(cookie().httpOnly("HANJJAK_ADMIN_SESSION", true))
            .andExpect(jsonPath("$.data.authenticated").value(true))
            .andExpect(jsonPath("$.data.operator.username").value("local-admin"))
            .andExpect(jsonPath("$.data.operator.roles[0]").value("ADMIN"))

    }
    @Test
    fun `local login rejects foreign origin before reaching the controller`() {
        val request = org.springframework.mock.web.MockHttpServletRequest("POST", "/api/admin/v1/auth/local/login").apply {
            addHeader("Host", "localhost:5173")
            addHeader("Origin", "http://evil.example")
            remoteAddr = "127.0.0.1"
        }
        val response = org.springframework.mock.web.MockHttpServletResponse()
        accessFilter.doFilter(request, response, org.springframework.mock.web.MockFilterChain())
        kotlin.test.assertEquals(403, response.status)
        kotlin.test.assertTrue(response.contentAsString.contains("ADMIN_ORIGIN_FORBIDDEN"))
    }

    @Test
    fun `local endpoints fail closed for non-loopback requests`() {
        mvc.perform(
            get("/api/admin/v1/auth/local/availability").with(remoteAddress("192.0.2.20")),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.data.enabled").value(false))

        mvc.perform(
            post("/api/admin/v1/auth/local/login")
                .header("Host", "localhost:5173")
                .header("Origin", "http://localhost:5173")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{"username":"local-admin","password":"local-controller-test-password-long-12345"}""")
                .with(remoteAddress("192.0.2.20")),
        )
            .andExpect(status().isUnauthorized)
            .andExpect(jsonPath("$.code").value("ADMIN_LOCAL_LOGIN_FAILED"))

        Mockito.verify(authentication, Mockito.never()).completeLocalLogin(anyString(), anyString())
    }

    @Test
    fun `local login rejects repeated attempts`() {
        val limiter = AdminLoginRateLimiter(properties.copy(authenticationRateLimit = AdminProperties.AuthenticationRateLimit(maxRequests = 1)), clock)
        val principal = AdminPrincipal(UUID.randomUUID(), "local-admin", "Local admin", setOf(AdminRole.ADMIN), AdminPermission.entries.toSet(), true)
        Mockito.`when`(authentication.completeLocalLogin(anyString(), anyString()))
            .thenReturn(AdminAuthenticationService.LoginResult("opaque-session-token", principal))
        val rateLimitedController = AdminAuthenticationController(
            authentication,
            limiter,
            audit,
            properties,
            admins,
            Mockito.mock(GameSessionLifecycle::class.java),
            Mockito.mock(AccountSessionRegistry::class.java),
            clock,
            localPolicy,
        )
        val builder = MockMvcBuilders.standaloneSetup(rateLimitedController)
        builder.setControllerAdvice(AdminExceptionHandler(clock))
        val limitedMvc = builder.build()
        val request = {
            post("/api/admin/v1/auth/local/login")
                .header("Host", "localhost:5173")
                .header("Origin", "http://localhost:5173")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{"username":"local-admin","password":"local-controller-test-password-long-12345"}""")
                .with(remoteAddress("127.0.0.1"))
        }

        limitedMvc.perform(request()).andExpect(status().isOk)
        limitedMvc.perform(request()).andExpect(status().isTooManyRequests)
    }

    private fun remoteAddress(address: String) = RequestPostProcessor { request ->
        request.remoteAddr = address
        request
    }
}
