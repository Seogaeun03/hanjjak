package com.hanjjak.admin.api

import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.HttpStatus
import org.springframework.mock.web.MockHttpServletRequest
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals

class AdminExceptionHandlerTest {
    @Test
    fun `chat settings version conflicts are HTTP conflict responses`() {
        val handler = AdminExceptionHandler(Clock.fixed(Instant.parse("2026-09-30T12:00:00Z"), ZoneOffset.UTC))
        val request: HttpServletRequest = MockHttpServletRequest().apply {
            setAttribute(AdminAccessFilter.REQUEST_ID_ATTRIBUTE, UUID.randomUUID())
        }

        val response = handler.invalid(IllegalArgumentException("CHAT_SETTINGS_VERSION_CONFLICT"), request)

        assertEquals(HttpStatus.CONFLICT, response.statusCode)
        assertEquals("CHAT_SETTINGS_VERSION_CONFLICT", response.body?.code)
    }
}
