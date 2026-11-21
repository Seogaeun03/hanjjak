package com.hanjjak.account.api

import com.hanjjak.account.application.MaterialPreferenceService
import org.mockito.Mockito.mock
import org.mockito.Mockito.verifyNoInteractions
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.mock.web.MockHttpServletResponse
import kotlin.test.Test
import kotlin.test.assertNull
import kotlin.test.assertTrue

class MaterialSelectionGateTest {
    @Test
    fun `anonymous request does not create a server session`() {
        val preferences = mock(MaterialPreferenceService::class.java)
        val request = MockHttpServletRequest()

        val allowed = MaterialSelectionGate(preferences).preHandle(request, MockHttpServletResponse(), Any())

        assertTrue(allowed)
        assertNull(request.getSession(false))
        verifyNoInteractions(preferences)
    }

    @Test
    fun `authenticated request can still read public event lifecycle before material selection`() {
        val preferences = mock(MaterialPreferenceService::class.java)
        val request = MockHttpServletRequest("GET", "/api/v1/event-lifecycle")
        request.getSession(true)!!.setAttribute("accountId", java.util.UUID.randomUUID())

        val allowed = MaterialSelectionGate(preferences).preHandle(request, MockHttpServletResponse(), Any())

        assertTrue(allowed)
        verifyNoInteractions(preferences)
    }
}
