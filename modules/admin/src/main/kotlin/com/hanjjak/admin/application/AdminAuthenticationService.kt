package com.hanjjak.admin.application

import com.hanjjak.admin.api.AdminProperties
import com.hanjjak.account.application.AuthenticationService
import com.hanjjak.admin.domain.AdminPrincipal
import com.hanjjak.admin.domain.AdminPermission
import com.hanjjak.admin.domain.AdminLoginPurpose
import com.hanjjak.admin.domain.AdminSession
import com.hanjjak.admin.infrastructure.AdminRepository
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.util.UriComponentsBuilder
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Clock
import java.util.Base64

@Service
class AdminAuthenticationService(
    private val repository: AdminRepository,
    private val gitlabProvider: AdminGitlabProvider,
    private val playerAuthentication: AuthenticationService,
    private val properties: AdminProperties,
    private val clock: Clock,
    private val localLoginAvailability: com.hanjjak.admin.api.AdminLocalLoginAvailability,
) {
    data class LoginResult(val token: String, val principal: AdminPrincipal)
    data class GameLoginResult(val accountId: java.util.UUID, val principal: AdminPrincipal)
    data class Authorization(val url: String)

    private val secureRandom = SecureRandom()

    @Transactional
    fun beginGitlabLogin(purpose: AdminLoginPurpose = AdminLoginPurpose.CONSOLE): Authorization {
        val configuration = requireConfiguredGitlab()
        repository.deleteExpiredGitlabFlows(clock.instant())
        val state = randomToken(32)
        val codeVerifier = randomToken(64)
        val now = clock.instant()
        repository.saveGitlabFlow(hashToken(state), codeVerifier, purpose, now, now.plus(configuration.flowLifetime))
        val authorizationUrl = UriComponentsBuilder.fromUriString(configuration.authorizationUri)
            .queryParam("client_id", configuration.clientId)
            .queryParam("redirect_uri", callbackUri(purpose))
            .queryParam("response_type", "code")
            .queryParam("scope", configuration.scopes.joinToString(" "))
            .queryParam("state", state)
            .queryParam("code_challenge", sha256Base64Url(codeVerifier))
            .queryParam("code_challenge_method", "S256")
            .build()
            .encode()
            .toUriString()
        return Authorization(authorizationUrl)
    }

    @Transactional
    fun completeGitlabLogin(state: String, code: String): LoginResult {
        val configuration = requireConfiguredGitlab()
        val now = clock.instant()
        val flow = repository.findGitlabFlow(hashToken(state), now)
            ?: throw IllegalArgumentException("ADMIN_GITLAB_STATE_INVALID")
        require(flow.purpose == AdminLoginPurpose.CONSOLE) { "ADMIN_GITLAB_LOGIN_PURPOSE_INVALID" }
        val profile = gitlabProvider.exchange(code, callbackUri(flow.purpose), flow.codeVerifier)
        val username = normalizeUsername(profile.username)
        val allowedUsernames = normalizedAllowedUsernames(configuration.allowedUsernames)
        if (profile.state != "active" || profile.locked || username !in allowedUsernames) {
            throw IllegalArgumentException("ADMIN_GITLAB_ACCESS_DENIED")
        }
        val operator = repository.upsertGitlabOperator(profile.id, username, profile.name.trim().ifBlank { username })
        val token = randomToken(32)
        repository.saveSession(AdminSession(hashToken(token), operator.operatorId, now.plus(properties.session.absoluteLifetime)), now)
        return LoginResult(
            token,
            AdminPrincipal(operator.operatorId, operator.username, operator.displayName, operator.roles, operator.permissions),
        )
    }
    @Transactional
    fun completeLocalLogin(username: String, password: String): LoginResult {
        require(localLoginAvailability.credentialsMatch(username, password)) { "ADMIN_LOCAL_LOGIN_FAILED" }
        val operator = repository.upsertLocalOperator(properties.localLogin.username)
        require(operator.enabled && operator.gitlabUserId == null) { "ADMIN_LOCAL_LOGIN_FAILED" }
        val now = clock.instant()
        val token = randomToken(32)
        repository.saveSession(AdminSession(hashToken(token), operator.operatorId, now.plus(properties.session.absoluteLifetime)), now)
        return LoginResult(token, AdminPrincipal(operator.operatorId, operator.username, operator.displayName, operator.roles, operator.permissions, true))
    }


    @Transactional
    fun completeGameLogin(state: String, code: String): GameLoginResult {
        val configuration = requireConfiguredGitlab()
        val now = clock.instant()
        val flow = repository.findGitlabFlow(hashToken(state), now)
            ?: throw IllegalArgumentException("ADMIN_GITLAB_STATE_INVALID")
        require(flow.purpose == AdminLoginPurpose.GAME) { "ADMIN_GITLAB_LOGIN_PURPOSE_INVALID" }
        val profile = gitlabProvider.exchange(code, callbackUri(flow.purpose), flow.codeVerifier)
        val username = normalizeUsername(profile.username)
        if (profile.state != "active" || profile.locked || username !in normalizedAllowedUsernames(configuration.allowedUsernames)) {
            throw IllegalArgumentException("ADMIN_GITLAB_ACCESS_DENIED")
        }
        val operator = repository.upsertGitlabOperator(profile.id, username, profile.name.trim().ifBlank { username })
        val principal = AdminPrincipal(operator.operatorId, operator.username, operator.displayName, operator.roles, operator.permissions)
        require(AdminPermission.EVENT_LIFECYCLE_MANAGE in principal.permissions) { "ADMIN_PERMISSION_DENIED" }
        val accountId = repository.findGameAccount(operator.operatorId) ?: playerAuthentication.signupSocial(
            "admin-${operator.operatorId}@admin.hanjjak.local",
            adminNickname(operator.operatorId),
        ).account.id.also { repository.linkGameAccount(operator.operatorId, it, now) }
        return GameLoginResult(accountId, principal)
    }
    @Transactional
    fun authenticate(token: String?): AdminPrincipal? {
        if (token.isNullOrBlank()) return null
        val tokenHash = hashToken(token)
        val now = clock.instant()
        val touched = repository.touchSession(tokenHash, now, now.minus(properties.session.inactivityTimeout))
        if (!touched) {
            repository.revokeSession(tokenHash, now)
            return null
        }
        return repository.findPrincipalByTokenHash(tokenHash, now)?.takeIf { principal ->
            if (principal.localLogin) localLoginAvailability.isEnabled() && principal.username == properties.localLogin.username
            else principal.username in runCatching { normalizedAllowedUsernames(properties.gitlab.allowedUsernames) }.getOrDefault(emptySet())
        } ?: run {
            repository.revokeSession(tokenHash, now)
            null
        }
    }

    @Transactional
    fun logout(token: String?) {
        if (!token.isNullOrBlank()) repository.revokeSession(hashToken(token), clock.instant())
    }

    fun successUrl(): String = adminUrl(properties.gitlab.successUrl)
    fun failureUrl(code: String): String = UriComponentsBuilder.fromUriString(adminUrl(properties.gitlab.failureUrl))
        .fragment("admin-auth-error=$code")
        .build()
        .toUriString()

    private fun adminUrl(value: String): String = value.trimEnd('/').let {
        when {
            it.endsWith("/admin") -> "$it/"
            it.contains("/admin#") || it.contains("/admin?") -> it
            else -> "$it/admin/"
        }
    }

    fun callbackUri(purpose: AdminLoginPurpose = AdminLoginPurpose.CONSOLE): String =
        "${properties.gitlab.publicBaseUrl.trimEnd('/')}/api/admin/v1/auth/${if (purpose == AdminLoginPurpose.GAME) "game/" else ""}gitlab/callback"

    private fun requireConfiguredGitlab(): AdminProperties.Gitlab = properties.gitlab.takeIf {
        it.enabled &&
            it.clientId.isNotBlank() &&
            it.clientSecret.isNotBlank() &&
            it.authorizationUri.isNotBlank() &&
            it.tokenUri.isNotBlank() &&
            it.userUri.isNotBlank() &&
            it.scopes.contains("read_user") &&
            runCatching { normalizedAllowedUsernames(it.allowedUsernames).isNotEmpty() }.getOrDefault(false) &&
            it.flowLifetime.isPositive
    } ?: throw IllegalArgumentException("ADMIN_GITLAB_NOT_CONFIGURED")

    private fun normalizedAllowedUsernames(usernames: List<String>): Set<String> = usernames
        .flatMap { it.split(',') }
        .mapTo(linkedSetOf(), ::normalizeUsername)

    private fun normalizeUsername(username: String): String = username.trim().lowercase().also {
        require(it.isNotEmpty() && it.length <= 255 && !it.contains(',')) { "ADMIN_GITLAB_RESPONSE_INVALID" }
    }

    private fun adminNickname(operatorId: java.util.UUID): String =
        "관리자-${operatorId.toString().replace("-", "").take(16)}"

    private fun randomToken(bytes: Int): String = ByteArray(bytes).also(secureRandom::nextBytes)
        .let(Base64.getUrlEncoder().withoutPadding()::encodeToString)

    private fun hashToken(token: String): String = sha256(token)
        .joinToString("") { "%02x".format(it) }

    private fun sha256Base64Url(value: String): String = sha256(value)
        .let(Base64.getUrlEncoder().withoutPadding()::encodeToString)

    private fun sha256(value: String): ByteArray = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(StandardCharsets.UTF_8))
}
