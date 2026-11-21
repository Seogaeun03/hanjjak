package com.hanjjak.admin.api

import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.account.api.ApiRequestPath
import com.hanjjak.admin.application.EventLifecycleService
import com.hanjjak.admin.infrastructure.AdminRepository
import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.http.MediaType
import org.springframework.web.filter.OncePerRequestFilter
import java.time.Clock
import java.time.Instant
import java.util.UUID

class EventLifecycleFilter(
    private val lifecycle: EventLifecycleService,
    private val admins: AdminRepository,
    private val mapper: ObjectMapper,
    private val clock: Clock,
) : OncePerRequestFilter() {
    data class ErrorEnvelope(val requestId: UUID, val serverTime: Instant, val code: String, val messageKey: String, val retryable: Boolean)

    override fun shouldNotFilter(request: HttpServletRequest): Boolean {
        val resolved = ApiRequestPath.resolve(request)
        return !lifecycle.enabled || !ApiRequestPath.guarded(request, resolved, ApiRequestPath.PLAYER_API_PREFIX) && request.requestURI != "/ws/chat" ||
            resolved.canonical == "/api/v1/event-lifecycle"
    }

    override fun doFilterInternal(request: HttpServletRequest, response: HttpServletResponse, chain: FilterChain) {
        val now = clock.instant()
        val snapshot = lifecycle.snapshot(now)
        val phase = snapshot.phase
        if (isAdminGameSession(request)) {
            chain.doFilter(request, response)
            return
        }
        if (phase in setOf(EventLifecycleService.Phase.PRE_START, EventLifecycleService.Phase.DAILY_RESTRICTED, EventLifecycleService.Phase.ENDED_NOTICE, EventLifecycleService.Phase.POST_NOTICE)) lifecycle.reconcileInactiveSessions(now)
        if (phase in setOf(EventLifecycleService.Phase.DISABLED, EventLifecycleService.Phase.RUNNING)) {
            chain.doFilter(request, response)
            return
        }
        if (phase == EventLifecycleService.Phase.DAILY_RESTRICTED && isRestrictedAllowedRequest(request)) {
            chain.doFilter(request, response)
            return
        }
        if (phase != EventLifecycleService.Phase.DAILY_RESTRICTED) invalidatePlayerSession(request)
        val code = when (phase) {
            EventLifecycleService.Phase.PRE_START -> "EVENT_NOT_STARTED"
            EventLifecycleService.Phase.DAILY_RESTRICTED -> "EVENT_DAILY_RESTRICTED"
            else -> "EVENT_ENDED"
        }
        response.status = HttpServletResponse.SC_SERVICE_UNAVAILABLE
        response.contentType = MediaType.APPLICATION_JSON_VALUE
        mapper.writeValue(response.outputStream, ErrorEnvelope(UUID.randomUUID(), clock.instant(), code, "error.${code.lowercase().replace('_', '.')}", false))
    }

    private fun isRestrictedAllowedRequest(request: HttpServletRequest): Boolean {
        val resolved = ApiRequestPath.resolve(request)
        if (resolved.ambiguous) return false
        return when (resolved.canonical) {
            "/api/v1/auth/session" -> request.method == "GET"
            "/api/v1/auth/logout" -> request.method == "POST"
            "/api/v1/offline-rewards/pending" -> request.method == "GET"
            "/api/v1/offline-rewards/claim" -> request.method == "POST"
            else -> false
        }
    }

    private fun isAdminGameSession(request: HttpServletRequest): Boolean {
        val session = request.getSession(false) ?: return false
        val accountId = session.getAttribute("accountId") as? UUID ?: return false
        return session.getAttribute(ADMIN_OPERATOR_ID_ATTRIBUTE) is UUID || admins.isGameAccount(accountId)
    }

    private fun invalidatePlayerSession(request: HttpServletRequest) {
        val session = request.getSession(false) ?: return
        if (session.getAttribute("accountId") != null) runCatching { session.invalidate() }
    }

    companion object {
        const val ADMIN_OPERATOR_ID_ATTRIBUTE = "hanjjak.admin.gameOperatorId"
    }
}
