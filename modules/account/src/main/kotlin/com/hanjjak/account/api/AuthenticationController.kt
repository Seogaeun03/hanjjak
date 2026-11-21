package com.hanjjak.account.api

import com.hanjjak.account.application.AuthenticationCommandService
import com.hanjjak.account.application.GameSessionLifecycle
import com.hanjjak.account.application.AuthenticationService
import com.hanjjak.account.application.PasswordResetService
import com.hanjjak.account.application.SsafyAffiliation
import com.hanjjak.account.application.SsafyAffiliationRegion
import com.hanjjak.account.application.SsafyAffiliationRegionReason
import com.hanjjak.account.application.SsafyAffiliationRepository
import com.hanjjak.account.application.SsafyAffiliationVerificationStatus
import jakarta.servlet.http.HttpServletRequest
import jakarta.validation.Valid
import jakarta.validation.constraints.Email
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size
import org.slf4j.LoggerFactory
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.web.bind.annotation.*
import java.time.Clock
import java.util.UUID

@RestController
@RequestMapping("/api/v1/auth")
class AuthenticationController(
    private val authentication: AuthenticationService,
    private val commands: AuthenticationCommandService,
    private val passwordReset: PasswordResetService,
    private val affiliations: SsafyAffiliationRepository,
    private val gameSessions: GameSessionLifecycle,
    private val clock: Clock,
    private val jdbc: JdbcClient,
    private val sessions: AccountSessionRegistry,
    private val rateLimiter: RequestRateLimiter,
    private val securityProperties: ApiSecurityProperties,
) {
    data class Credentials(
        @field:NotBlank @field:Email @field:Size(max = 320) val email: String,
        @field:Size(min = 8) val password: String,
    )
    data class SignupCredentials(
        @field:NotBlank @field:Email @field:Size(max = 320) val email: String,
        @field:Size(min = 8) val password: String,
        @field:NotBlank @field:Size(min = 1, max = 20) val nickname: String,
    )
    data class NicknameUpdate(@field:NotBlank @field:Size(min = 1, max = 20) val nickname: String)
    data class NicknameAvailability(val available: Boolean)
    data class PasswordResetRequest(
        @field:NotBlank @field:Email @field:Size(max = 320) val email: String,
    )
    data class PasswordResetConfirmation(
        @field:NotBlank @field:Size(max = 128) val token: String,
        @field:Size(min = 8) val password: String,
    )
    data class PasswordResetAcknowledgement(val accepted: Boolean = true)
    data class PasswordChange(
        @field:NotBlank val currentPassword: String,
        @field:Size(min = 8) val newPassword: String,
        @field:NotBlank val newPasswordConfirmation: String,
    )
    data class SsafyAffiliationView(
        val currentCohort: Int?,
        val cohortHistory: List<Int>,
        val multipleCohorts: Boolean,
        val region: SsafyAffiliationRegion?,
        val regionReason: SsafyAffiliationRegionReason?,
        val verificationStatus: SsafyAffiliationVerificationStatus,
        val lastAttemptedAt: java.time.Instant,
        val lastVerifiedAt: java.time.Instant?,
    )
    data class Identity(
        val accountId: UUID,
        val characterId: UUID,
        val email: String,
        val nickname: String,
        val level: Int,
        val experience: Long,
        val rice: Long,
        val nicknameChangeCost: Long,
        val ssafyAffiliation: SsafyAffiliationView?,
    )
    data class SessionState(val authenticated: Boolean, val account: Identity?, val administrator: Boolean = false)
    data class AuthenticationMethods(val emailEnabled: Boolean)

    @GetMapping("/methods")
    fun methods(): Envelope<AuthenticationMethods> = envelope(0, AuthenticationMethods(securityProperties.emailLoginEnabled))
    data class Envelope<T>(val requestId: UUID, val serverTime: java.time.Instant, val stateVersion: Long, val data: T)

    @PostMapping("/signup")
    fun signup(@RequestHeader("Idempotency-Key") idempotencyKey: UUID, @Valid @RequestBody request: SignupCredentials, servletRequest: HttpServletRequest): Envelope<Identity> {
        securityProperties.requireEmailLoginEnabled()
        rateLimiter.checkAuthentication(request.email, remoteAddress(servletRequest), false)
        val result = commands.signup(idempotencyKey, request.email, request.password, request.nickname)
        establishSession(servletRequest, result.account.id)
        return envelope(result.account.stateVersion, identity(result))
    }

    @PostMapping("/login")
    fun login(@RequestHeader("Idempotency-Key") idempotencyKey: UUID, @Valid @RequestBody request: Credentials, servletRequest: HttpServletRequest): Envelope<Identity> {
        securityProperties.requireEmailLoginEnabled()
        rateLimiter.checkAuthentication(request.email, remoteAddress(servletRequest), true)
        val result = commands.login(idempotencyKey, request.email, request.password)
        gameSessions.replaceForLogin(result.account.id)
        establishSession(servletRequest, result.account.id)
        return envelope(result.account.stateVersion, identity(result))
    }

    @PostMapping("/password-reset/request")
    fun requestPasswordReset(
        @Valid @RequestBody request: PasswordResetRequest,
        servletRequest: HttpServletRequest,
    ): Envelope<PasswordResetAcknowledgement> {
        val startedAt = System.nanoTime()
        try {
            rateLimiter.checkPasswordReset(request.email, remoteAddress(servletRequest))
            passwordReset.request(request.email)
        } catch (_: RateLimitExceededException) {
            // Return the same response for limited requests so the endpoint cannot disclose account state.
        } catch (exception: RuntimeException) {
            logger.warn("Password reset request could not be dispatched", exception)
        }
        val remainingMillis = 250L - (System.nanoTime() - startedAt) / 1_000_000L
        if (remainingMillis > 0) Thread.sleep(remainingMillis)
        return envelope(0, PasswordResetAcknowledgement())
    }

    @PostMapping("/password-reset/confirm")
    fun confirmPasswordReset(
        @Valid @RequestBody request: PasswordResetConfirmation,
    ): Envelope<PasswordResetAcknowledgement> {
        passwordReset.reset(request.token, request.password)
        return envelope(0, PasswordResetAcknowledgement())
    }

    @GetMapping("/session")
    fun session(request: HttpServletRequest): Envelope<SessionState> {
        val accountId = request.getSession(false)?.getAttribute("accountId") as? UUID
        if (accountId == null) return Envelope(UUID.randomUUID(), clock.instant(), 0, SessionState(false, null))
        val result = authentication.session(accountId)
        return envelope(
            result.account.stateVersion,
            SessionState(true, identity(result), request.getSession(false)?.getAttribute("hanjjak.admin.gameOperatorId") is UUID),
        )
    }

    @GetMapping("/nickname-availability")
    fun nicknameAvailability(@RequestParam nickname: String): Envelope<NicknameAvailability> =
        envelope(0, NicknameAvailability(authentication.isNicknameAvailable(nickname)))

    @PostMapping("/profile/nickname")
    fun updateNickname(@RequestHeader("Idempotency-Key") idempotencyKey: UUID, @Valid @RequestBody request: NicknameUpdate, servletRequest: HttpServletRequest): Envelope<Identity> {
        val accountId = servletRequest.getSession(false)?.getAttribute("accountId") as? UUID ?: throw IllegalArgumentException("AUTHENTICATION_REQUIRED")
        val result = commands.updateNickname(idempotencyKey, accountId, request.nickname)
        return envelope(result.account.stateVersion, identity(result))
    }
    @PostMapping("/profile/password")
    fun changePassword(
        @RequestHeader("Idempotency-Key") idempotencyKey: UUID,
        @Valid @RequestBody request: PasswordChange,
        servletRequest: HttpServletRequest,
    ): Envelope<SessionState> {
        val session = servletRequest.getSession(false) ?: throw IllegalArgumentException("AUTHENTICATION_REQUIRED")
        val accountId = session.getAttribute("accountId") as? UUID ?: throw IllegalArgumentException("AUTHENTICATION_REQUIRED")
        val result = commands.changePassword(
            idempotencyKey,
            accountId,
            request.currentPassword,
            request.newPassword,
            request.newPasswordConfirmation,
        )
        sessions.deactivate(accountId, session.id)
        gameSessions.closeForLogout(accountId)
        session.invalidate()
        return envelope(result.account.stateVersion, SessionState(false, null))
    }


    @PostMapping("/delete")
    fun deleteAccount(request: HttpServletRequest): Envelope<SessionState> {
        val session = request.getSession(false)
        val accountId = session?.getAttribute("accountId") as? UUID ?: throw IllegalArgumentException("AUTHENTICATION_REQUIRED")
        authentication.deleteAccount(accountId)
        sessions.deactivate(accountId, session.id)
        gameSessions.closeForLogout(accountId)
        session.invalidate()
        return Envelope(UUID.randomUUID(), clock.instant(), 0, SessionState(false, null))
    }

    private fun identity(result: com.hanjjak.account.application.AuthenticationResult): Identity {
        val rice = jdbc.sql("select balance from wallet_balance where account_id=:account")
            .param("account", result.account.id)
            .query(Long::class.java)
            .optional()
            .orElse(result.character.rice)
        return Identity(
            result.account.id,
            result.character.id,
            result.account.email,
            result.character.nickname,
            result.character.level,
            result.character.experience,
            rice,
            authentication.nicknameChangeCost(result.character.nicknameChangeCount),
            affiliations.find(result.account.id)?.toView(),
        )
    }
    fun identityEnvelope(result: com.hanjjak.account.application.AuthenticationResult): Envelope<Identity> =
        envelope(result.account.stateVersion, identity(result))

    private fun <T> envelope(stateVersion: Long, data: T): Envelope<T> = Envelope(UUID.randomUUID(), clock.instant(), stateVersion, data)

    private fun SsafyAffiliation.toView() = SsafyAffiliationView(
        currentCohort,
        cohortHistory,
        multipleCohorts,
        region,
        regionReason,
        verificationStatus,
        lastAttemptedAt,
        lastVerifiedAt,
    )

    @PostMapping("/logout")
    fun logout(@RequestHeader("Idempotency-Key") idempotencyKey: UUID, request: HttpServletRequest): Envelope<SessionState> {
        val session = request.getSession(false)
        val accountId = session?.getAttribute("accountId") as? UUID
        if (accountId != null) {
            sessions.deactivate(accountId, session.id)
            gameSessions.closeForLogout(accountId)
        }
        session?.invalidate()
        return Envelope(UUID.randomUUID(), clock.instant(), 0, SessionState(false, null))
    }

    private fun establishSession(request: HttpServletRequest, accountId: UUID) {
        val session = request.getSession(true)
        request.changeSessionId()
        session.setAttribute("accountId", accountId)
        sessions.activate(accountId, session.id)
    }

    private fun remoteAddress(request: HttpServletRequest): String = request.remoteAddr.orEmpty().ifBlank { "unknown" }

    private companion object {
        val logger = LoggerFactory.getLogger(AuthenticationController::class.java)
    }
}
