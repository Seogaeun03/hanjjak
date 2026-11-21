package com.hanjjak.admin.api

import com.hanjjak.admin.application.AdminAuthenticationService
import com.hanjjak.account.api.AccountSessionRegistry
import com.hanjjak.account.application.GameSessionLifecycle
import com.hanjjak.admin.domain.AdminPrincipal
import com.hanjjak.admin.domain.AdminLoginPurpose
import com.hanjjak.admin.infrastructure.AdminAuditRepository
import com.hanjjak.admin.infrastructure.AdminRepository
import jakarta.servlet.http.Cookie
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.http.ResponseCookie
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RestController
import java.time.Clock
import java.time.Instant
import java.util.UUID

@RestController
@RequestMapping("/api/admin/v1/auth")
class AdminAuthenticationController(
    private val authentication: AdminAuthenticationService,
    private val rateLimiter: AdminLoginRateLimiter,
    private val audit: AdminAuditRepository,
    private val properties: AdminProperties,
    private val admins: AdminRepository,
    private val gameSessions: GameSessionLifecycle,
    private val playerSessions: AccountSessionRegistry,
    private val clock: Clock,
    private val localLoginAvailability: AdminLocalLoginAvailability,
) {
    data class Identity(val operatorId: UUID, val username: String, val displayName: String, val roles: List<String>, val permissions: List<String>)
    data class SessionState(val authenticated: Boolean, val operator: Identity?)
    data class Authorization(val authorizationUrl: String)
    data class GameSessionState(val administrator: Boolean)
    data class Envelope<T>(val requestId: UUID, val serverTime: Instant, val stateVersion: Long, val data: T)
    data class LocalCredentials(val username: String, val password: String)
    data class LocalAvailability(val enabled: Boolean)

    @GetMapping("/local/availability")
    fun localAvailability(request: HttpServletRequest): Envelope<LocalAvailability> {
        val enabled = isLoopback(request.remoteAddr) && localLoginAvailability.isEnabled()
        val requestId = requestId(request)
        audit.record(clock.instant(), null, "anonymous", "LOCAL_LOGIN_AVAILABILITY", "ADMIN_SESSION", null, if (enabled) "SUCCEEDED" else "FAILED", requestId, remoteAddress(request))
        return envelope(requestId, LocalAvailability(enabled))
    }

    @PostMapping("/local/login")
    fun loginLocal(@RequestBody credentials: LocalCredentials, request: HttpServletRequest, response: HttpServletResponse): Envelope<SessionState> {
        val requestId = requestId(request)
        try {
            rateLimiter.check(remoteAddress(request))
        } catch (failure: AdminLoginRateLimiter.LimitExceeded) {
            audit.recordFailure(com.hanjjak.admin.infrastructure.AdminAuditRepository.Record(clock.instant(), null, "anonymous", "LOCAL_LOGIN", "ADMIN_SESSION", null, "FAILED", requestId, remoteAddress(request)))
            throw failure
        }
        val result = try {
            require(isLoopback(request.remoteAddr) && localLoginAvailability.isEnabled()) { "ADMIN_LOCAL_LOGIN_FAILED" }
            authentication.completeLocalLogin(credentials.username, credentials.password)
        } catch (failure: IllegalArgumentException) {
            audit.recordFailure(com.hanjjak.admin.infrastructure.AdminAuditRepository.Record(clock.instant(), null, "anonymous", "LOCAL_LOGIN", "ADMIN_SESSION", null, "FAILED", requestId, remoteAddress(request)))
            throw IllegalArgumentException("ADMIN_LOCAL_LOGIN_FAILED")
        }
        response.addHeader("Set-Cookie", sessionCookie(result.token).toString())
        audit.record(clock.instant(), result.principal.operatorId, result.principal.username, "LOCAL_LOGIN", "ADMIN_SESSION", null, "SUCCEEDED", requestId, remoteAddress(request))
        return envelope(requestId, SessionState(true, result.principal.toIdentity()))
    }


    @PostMapping("/gitlab/begin")
    fun beginGitlab(request: HttpServletRequest): Envelope<Authorization> {
        rateLimiter.check(remoteAddress(request))
        val requestId = requestId(request)
        val authorization = authentication.beginGitlabLogin()
        audit.record(clock.instant(), null, "anonymous", "LOGIN_BEGIN", "ADMIN_SESSION", null, "SUCCEEDED", requestId, remoteAddress(request))
        return envelope(requestId, Authorization(authorization.url))
    }

    @PostMapping("/game/gitlab/begin")
    fun beginGameGitlab(request: HttpServletRequest): Envelope<Authorization> {
        rateLimiter.check(remoteAddress(request))
        val requestId = requestId(request)
        val authorization = authentication.beginGitlabLogin(AdminLoginPurpose.GAME)
        audit.record(clock.instant(), null, "anonymous", "GAME_LOGIN_BEGIN", "ADMIN_GAME_SESSION", null, "SUCCEEDED", requestId, remoteAddress(request))
        return envelope(requestId, Authorization(authorization.url))
    }

    @GetMapping("/gitlab/callback")
    fun gitlabCallback(
        @RequestParam(required = false) code: String?,
        @RequestParam(required = false) state: String?,
        @RequestParam(required = false) error: String?,
        request: HttpServletRequest,
        response: HttpServletResponse,
    ) {
        val requestId = requestId(request)
        val destination = try {
            require(error == null && !code.isNullOrBlank() && !state.isNullOrBlank()) { "ADMIN_GITLAB_AUTHORIZATION_DENIED" }
            val result = authentication.completeGitlabLogin(state, code)
            audit.record(clock.instant(), result.principal.operatorId, result.principal.username, "LOGIN", "ADMIN_SESSION", null, "SUCCEEDED", requestId, remoteAddress(request))
            response.addHeader("Set-Cookie", sessionCookie(result.token).toString())
            authentication.successUrl()
        } catch (failure: IllegalArgumentException) {
            val codeValue = failure.message?.takeIf { it.startsWith("ADMIN_") } ?: "ADMIN_GITLAB_LOGIN_FAILED"
            audit.record(clock.instant(), null, "anonymous", "LOGIN", "ADMIN_SESSION", null, "FAILED", requestId, remoteAddress(request))
            authentication.failureUrl(codeValue)
        }
        response.status = HttpServletResponse.SC_FOUND
        response.setHeader("Location", destination)
    }

    @GetMapping("/game/gitlab/callback")
    fun gameGitlabCallback(
        @RequestParam(required = false) code: String?,
        @RequestParam(required = false) state: String?,
        @RequestParam(required = false) error: String?,
        request: HttpServletRequest,
        response: HttpServletResponse,
    ) {
        val requestId = requestId(request)
        val destination = try {
            require(error == null && !code.isNullOrBlank() && !state.isNullOrBlank()) { "ADMIN_GITLAB_AUTHORIZATION_DENIED" }
            val result = authentication.completeGameLogin(state, code)
            establishPlayerSession(request, result.accountId, result.principal.operatorId)
            audit.record(clock.instant(), result.principal.operatorId, result.principal.username, "GAME_LOGIN", "ADMIN_GAME_SESSION", result.accountId.toString(), "SUCCEEDED", requestId, remoteAddress(request))
            gameSuccessUrl()
        } catch (failure: IllegalArgumentException) {
            val codeValue = failure.message?.takeIf { it.startsWith("ADMIN_") } ?: "ADMIN_GITLAB_LOGIN_FAILED"
            audit.record(clock.instant(), null, "anonymous", "GAME_LOGIN", "ADMIN_GAME_SESSION", null, "FAILED", requestId, remoteAddress(request))
            gameFailureUrl(codeValue)
        }
        response.status = HttpServletResponse.SC_FOUND
        response.setHeader("Location", destination)
    }

    @GetMapping("/game/session")
    fun gameSession(request: HttpServletRequest): Envelope<GameSessionState> {
        val session = request.getSession(false)
        val accountId = session?.getAttribute("accountId") as? UUID
        return envelope(
            requestId(request),
            GameSessionState(accountId != null && admins.isGameAccount(accountId)),
        )
    }

    @GetMapping("/session")
    fun session(request: HttpServletRequest): Envelope<SessionState> {
        val principal = principal(request)
        audit.record(clock.instant(), principal.operatorId, principal.username, "READ_SESSION", "ADMIN_SESSION", null, "SUCCEEDED", requestId(request), remoteAddress(request))
        return envelope(requestId(request), SessionState(true, principal.toIdentity()))
    }

    @PostMapping("/logout")
    fun logout(request: HttpServletRequest, response: HttpServletResponse): Envelope<SessionState> {
        val principal = principal(request)
        authentication.logout(cookie(request)?.value)
        response.addHeader("Set-Cookie", expiredSessionCookie().toString())
        audit.record(clock.instant(), principal.operatorId, principal.username, "LOGOUT", "ADMIN_SESSION", null, "SUCCEEDED", requestId(request), remoteAddress(request))
        return envelope(requestId(request), SessionState(false, null))
    }

    private fun sessionCookie(token: String): ResponseCookie = ResponseCookie.from(AdminAccessFilter.ADMIN_COOKIE, token)
        .httpOnly(true)
        .secure(properties.session.secureCookie)
        .sameSite("Lax")
        .path("/api/admin")
        .maxAge(properties.session.absoluteLifetime)
        .build()

    private fun expiredSessionCookie(): ResponseCookie = ResponseCookie.from(AdminAccessFilter.ADMIN_COOKIE, "")
        .httpOnly(true)
        .secure(properties.session.secureCookie)
        .sameSite("Lax")
        .path("/api/admin")
        .maxAge(0)
        .build()

    private fun principal(request: HttpServletRequest): AdminPrincipal = request.getAttribute(AdminAccessFilter.PRINCIPAL_ATTRIBUTE) as? AdminPrincipal
        ?: throw IllegalArgumentException("ADMIN_AUTHENTICATION_REQUIRED")

    private fun cookie(request: HttpServletRequest): Cookie? = request.cookies?.firstOrNull { it.name == AdminAccessFilter.ADMIN_COOKIE }

    private fun establishPlayerSession(request: HttpServletRequest, accountId: UUID, operatorId: UUID) {
        val session = request.getSession(true)
        request.changeSessionId()
        session.setAttribute("accountId", accountId)
        session.setAttribute(EventLifecycleFilter.ADMIN_OPERATOR_ID_ATTRIBUTE, operatorId)
        playerSessions.activate(accountId, session.id)
    }

    private fun gameSuccessUrl(): String = "${properties.gitlab.publicBaseUrl.trimEnd('/')}/"
    private fun gameFailureUrl(code: String): String = "${properties.gitlab.publicBaseUrl.trimEnd('/')}/login2#admin-game-auth-error=$code"
    private fun requestId(request: HttpServletRequest): UUID = request.getAttribute(AdminAccessFilter.REQUEST_ID_ATTRIBUTE) as? UUID ?: UUID.randomUUID()
    private fun isLoopback(address: String?): Boolean {
        val value = address?.lowercase() ?: return false
        return value == "127.0.0.1" || value == "::1" || value == "0:0:0:0:0:0:0:1" || value == "::ffff:127.0.0.1"
    }
    private fun remoteAddress(request: HttpServletRequest): String = request.remoteAddr.orEmpty().ifBlank { "unknown" }
    private fun <T> envelope(requestId: UUID, data: T) = Envelope(requestId, clock.instant(), 0, data)
    private fun AdminPrincipal.toIdentity() = Identity(operatorId, username, displayName, roles.map { it.name }.sorted(), permissions.map { it.wireName }.sorted())
}
