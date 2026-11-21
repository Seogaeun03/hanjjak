package com.hanjjak.admin.api

import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.admin.application.AdminAuthenticationService
import com.hanjjak.admin.domain.AdminPermission
import com.hanjjak.admin.domain.AdminPrincipal
import com.hanjjak.admin.domain.AdminRole
import com.hanjjak.admin.infrastructure.AdminAuditRepository
import jakarta.servlet.http.Cookie
import org.mockito.Mockito
import org.springframework.mock.web.MockFilterChain
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.mock.web.MockHttpServletResponse
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertSame

class AdminAccessFilterLocalSessionTest {
    private val authentication = Mockito.mock(AdminAuthenticationService::class.java)
    private val audit = Mockito.mock(AdminAuditRepository::class.java)
    private val principal = AdminPrincipal(
        UUID.randomUUID(),
        "local-admin",
        "Local admin",
        setOf(AdminRole.ADMIN),
        AdminPermission.entries.toSet(),
        localLogin = true,
    )
    private val filter = AdminAccessFilter(
        authentication,
        audit,
        listOf("http://localhost:5173"),
        ObjectMapper().findAndRegisterModules(),
        Clock.fixed(Instant.parse("2026-09-30T00:00:00Z"), ZoneOffset.UTC),
    )

    @Test
    fun `local session is loopback-only while GitLab session policy stays in auth service`() {
        Mockito.`when`(authentication.authenticate("opaque-token")).thenReturn(principal)

        val remoteRequest = request("192.0.2.20")
        val remoteResponse = MockHttpServletResponse()
        filter.doFilter(remoteRequest, remoteResponse, MockFilterChain())

        assertEquals(401, remoteResponse.status)
        assertEquals("ADMIN_AUTHENTICATION_REQUIRED", ObjectMapper().readTree(remoteResponse.contentAsString).get("code").asText())

        val localRequest = request("127.0.0.1")
        val localResponse = MockHttpServletResponse()
        val chain = MockFilterChain()
        filter.doFilter(localRequest, localResponse, chain)

        assertEquals(200, localResponse.status)
        assertSame(localRequest, chain.request)
        assertSame(principal, localRequest.getAttribute(AdminAccessFilter.PRINCIPAL_ATTRIBUTE))
    }

    private fun request(address: String) = MockHttpServletRequest("GET", "/api/admin/v1/dashboard").apply {
        remoteAddr = address
        setCookies(Cookie(AdminAccessFilter.ADMIN_COOKIE, "opaque-token"))
    }
}
