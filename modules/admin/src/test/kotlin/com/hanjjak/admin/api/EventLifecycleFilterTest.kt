package com.hanjjak.admin.api

import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.admin.application.EventLifecycleService
import com.hanjjak.admin.infrastructure.AdminRepository
import org.mockito.Mockito
import org.springframework.mock.web.MockFilterChain
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.mock.web.MockHttpServletResponse
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.time.LocalTime
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class EventLifecycleFilterTest {
    private val now = Instant.parse("2026-09-21T03:00:00Z")
    private val lifecycle = Mockito.mock(EventLifecycleService::class.java)
    private val admins = Mockito.mock(AdminRepository::class.java)
    private val filter = EventLifecycleFilter(lifecycle, admins, ObjectMapper().findAndRegisterModules(), Clock.fixed(now, ZoneOffset.UTC))

    @Test
    fun `pre start blocks player endpoints but exposes lifecycle state`() {
        Mockito.`when`(lifecycle.enabled).thenReturn(true)
        Mockito.`when`(lifecycle.snapshot(now)).thenReturn(snapshot(EventLifecycleService.Phase.PRE_START))
        Mockito.`when`(lifecycle.reconcileInactiveSessions(now)).thenReturn(true)
        val request = MockHttpServletRequest("POST", "/api/v1/auth/social/ssafy-gitlab/begin")
        val response = MockHttpServletResponse()
        filter.doFilter(request, response, MockFilterChain())
        assertEquals(503, response.status)
        assertTrue(response.contentAsString.contains("EVENT_NOT_STARTED"))
        val publicResponse = MockHttpServletResponse()
        filter.doFilter(MockHttpServletRequest("GET", "/api/v1/event-lifecycle"), publicResponse, MockFilterChain())
        assertEquals(200, publicResponse.status)
    }

    @Test
    fun `running events pass through`() {
        Mockito.`when`(lifecycle.enabled).thenReturn(true)
        Mockito.`when`(lifecycle.snapshot(now)).thenReturn(snapshot(EventLifecycleService.Phase.RUNNING))
        val response = MockHttpServletResponse()
        filter.doFilter(MockHttpServletRequest("GET", "/api/v1/stages"), response, MockFilterChain())
        assertEquals(200, response.status)
    }


    @Test
    fun `daily restriction blocks gameplay but allows only session and offline rewards`() {
        Mockito.`when`(lifecycle.enabled).thenReturn(true)
        Mockito.`when`(lifecycle.snapshot(now)).thenReturn(snapshot(EventLifecycleService.Phase.DAILY_RESTRICTED))
        Mockito.`when`(lifecycle.reconcileInactiveSessions(now)).thenReturn(true)

        val battle = MockHttpServletResponse()
        filter.doFilter(MockHttpServletRequest("POST", "/api/v1/battle-sessions"), battle, MockFilterChain())
        assertEquals(503, battle.status)
        assertTrue(battle.contentAsString.contains("EVENT_DAILY_RESTRICTED"))
        mapOf(
            "/api/v1/auth/session" to "GET",
            "/api/v1/offline-rewards/pending" to "GET",
            "/api/v1/offline-rewards/claim" to "POST",
        ).forEach { (path, method) ->
            val response = MockHttpServletResponse()
            filter.doFilter(MockHttpServletRequest(method, path), response, MockFilterChain())
            assertEquals(200, response.status, path)
        }
        val wrongMethod = MockHttpServletResponse()
        filter.doFilter(MockHttpServletRequest("POST", "/api/v1/auth/session"), wrongMethod, MockFilterChain())
        assertEquals(503, wrongMethod.status)
    }

    @Test
    fun `administrator game session bypasses lifecycle restrictions`() {
        Mockito.`when`(lifecycle.enabled).thenReturn(true)
        Mockito.`when`(lifecycle.snapshot(now)).thenReturn(snapshot(EventLifecycleService.Phase.PRE_START))
        val request = MockHttpServletRequest("POST", "/api/v1/battle-sessions")
        request.getSession(true)!!.setAttribute("accountId", java.util.UUID.randomUUID())
        request.getSession(false)!!.setAttribute(EventLifecycleFilter.ADMIN_OPERATOR_ID_ATTRIBUTE, java.util.UUID.randomUUID())
        val response = MockHttpServletResponse()

        filter.doFilter(request, response, MockFilterChain())

        assertEquals(200, response.status)
        Mockito.verify(lifecycle, Mockito.never()).reconcileInactiveSessions(now)
    }

    @Test
    fun `persisted administrator game account bypasses without the transient session marker`() {
        Mockito.`when`(lifecycle.enabled).thenReturn(true)
        Mockito.`when`(lifecycle.snapshot(now)).thenReturn(snapshot(EventLifecycleService.Phase.PRE_START))
        val accountId = java.util.UUID.randomUUID()
        Mockito.`when`(admins.isGameAccount(accountId)).thenReturn(true)
        val request = MockHttpServletRequest("GET", "/api/v1/stages")
        request.getSession(true)!!.setAttribute("accountId", accountId)
        val response = MockHttpServletResponse()

        filter.doFilter(request, response, MockFilterChain())

        assertEquals(200, response.status)
        Mockito.verify(lifecycle, Mockito.never()).reconcileInactiveSessions(now)
    }
    @Test
    fun `main service is not filtered`() {
        Mockito.`when`(lifecycle.enabled).thenReturn(false)
        val response = MockHttpServletResponse()
        filter.doFilter(MockHttpServletRequest("POST", "/api/v1/auth/login"), response, MockFilterChain())
        assertEquals(200, response.status)
    }

    private fun snapshot(phase: EventLifecycleService.Phase) = EventLifecycleService.Snapshot(
        "event-2026-09", true, phase, null, null, null,
        phase == EventLifecycleService.Phase.DAILY_RESTRICTED, LocalTime.of(22, 0), LocalTime.of(8, 0), "Asia/Seoul", true, null,
        0, now, "https://hanjjak.verte.kr", null, null,
    )
}
