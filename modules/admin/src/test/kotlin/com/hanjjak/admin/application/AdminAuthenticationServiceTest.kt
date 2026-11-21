package com.hanjjak.admin.application

import com.hanjjak.admin.api.AdminProperties
import com.hanjjak.admin.api.AdminLocalLoginAvailability
import com.hanjjak.account.application.AuthenticationService
import org.mockito.Mockito
import com.hanjjak.admin.infrastructure.AdminRepository
import org.h2.jdbcx.JdbcDataSource
import org.springframework.jdbc.core.simple.JdbcClient
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import org.mockito.ArgumentMatchers.anyString

class AdminAuthenticationServiceTest {
    private val now = Instant.parse("2026-09-11T00:00:00Z")
    private val dataSource = JdbcDataSource().apply { setURL("jdbc:h2:mem:${System.nanoTime()};MODE=PostgreSQL;DB_CLOSE_DELAY=-1") }
    private val jdbc = JdbcClient.create(dataSource)
    private val repository = AdminRepository(jdbc)
    private val provider = RecordingGitlabProvider()
    private val properties = AdminProperties(
        gitlab = AdminProperties.Gitlab(
            enabled = true,
            clientId = "client-id",
            clientSecret = "client-secret",
            authorizationUri = "https://gitlab.example.com/oauth/authorize",
            tokenUri = "https://gitlab.example.com/oauth/token",
            userUri = "https://gitlab.example.com/api/v4/user",
            allowedUsernames = listOf("allowed-admin"),
            publicBaseUrl = "https://app.example.com",
            successUrl = "https://app.example.com",
            failureUrl = "https://app.example.com",
        ),
        localLogin = AdminProperties.LocalLogin(enabled = true, username = "local-admin", password = "long-local-password-not-a-repo-secret-0001"),
    )
    private val playerAuthentication = Mockito.mock(AuthenticationService::class.java)
    private val localLoginAvailability = AdminLocalLoginAvailability(properties, org.springframework.mock.env.MockEnvironment().apply { setActiveProfiles("local") })
    private val service = AdminAuthenticationService(
        repository, provider, playerAuthentication, properties, Clock.fixed(now, ZoneOffset.UTC), localLoginAvailability,
    )
    private val gameAccountId = UUID.randomUUID()

    init {
        jdbc.sql("""
            create table admin_operator(
              operator_id uuid primary key,
              username varchar(255) not null unique,
              display_name varchar(120) not null,
              enabled boolean not null default true,
              gitlab_user_id bigint unique,
              local_login boolean not null default false,
              updated_at timestamp with time zone not null default current_timestamp
            );
            create table admin_operator_role(operator_id uuid not null, role varchar(32) not null, primary key(operator_id, role));
            create table admin_session(session_token_hash varchar(64) primary key, operator_id uuid not null, created_at timestamp with time zone not null, last_seen_at timestamp with time zone not null, expires_at timestamp with time zone not null, revoked_at timestamp with time zone);
            create table admin_gitlab_oauth_flow(flow_id uuid primary key, state_token_hash varchar(64) not null unique, code_verifier varchar(128) not null, login_purpose varchar(16) not null default 'CONSOLE', consumed boolean not null default false, created_at timestamp with time zone not null, expires_at timestamp with time zone not null);
            create table admin_game_account(operator_id uuid primary key, account_id uuid unique, created_at timestamp with time zone not null);
        """.trimIndent()).update()
    }

    @Test
    fun `whitelisted GitLab user receives an admin session`() {
        val authorization = service.beginGitlabLogin()
        val state = queryParameter(authorization.url, "state")

        val login = service.completeGitlabLogin(state, "provider-code")

        assertEquals("allowed-admin", login.principal.username)
        assertEquals(setOf("ADMIN"), login.principal.roles.mapTo(linkedSetOf()) { it.name })
        assertNotNull(service.authenticate(login.token))
        assertEquals("read_user", queryParameter(authorization.url, "scope"))
        assertEquals("S256", queryParameter(authorization.url, "code_challenge_method"))
        assertTrue(provider.codeVerifier.isNotBlank())
    }
    @Test
    fun `local credentials create ADMIN session while GitLab mode is disabled`() {
        val localProperties = properties.copy(gitlab = properties.gitlab.copy(enabled = false))
        val availability = AdminLocalLoginAvailability(localProperties, org.springframework.mock.env.MockEnvironment().apply { setActiveProfiles("local") })
        val localService = AdminAuthenticationService(repository, provider, playerAuthentication, localProperties, Clock.fixed(now, ZoneOffset.UTC), availability)
        val login = localService.completeLocalLogin("local-admin", "long-local-password-not-a-repo-secret-0001")

        assertEquals("local-admin", login.principal.username)
        assertEquals(setOf("ADMIN"), login.principal.roles.mapTo(linkedSetOf()) { it.name })
        assertEquals(true, login.principal.localLogin)
        assertEquals("ADMIN", jdbc.sql("select role from admin_operator_role where operator_id = :operatorId").param("operatorId", login.principal.operatorId).query(String::class.java).single())
        assertNotNull(localService.authenticate(login.token))
    }

    @Test
    fun `local login rejects GitLab enabled wrong credentials and sessions when disabled`() {
        assertFailsWith<IllegalArgumentException> { service.completeLocalLogin("local-admin", "long-local-password-not-a-repo-secret-0001") }
        val localProperties = properties.copy(gitlab = properties.gitlab.copy(enabled = false))
        val enabledAvailability = AdminLocalLoginAvailability(localProperties, org.springframework.mock.env.MockEnvironment().apply { setActiveProfiles("local") })
        val localService = AdminAuthenticationService(repository, provider, playerAuthentication, localProperties, Clock.fixed(now, ZoneOffset.UTC), enabledAvailability)
        val wrong = assertFailsWith<IllegalArgumentException> { localService.completeLocalLogin("local-admin", "incorrect-password-which-is-long-enough-0001") }
        assertEquals("ADMIN_LOCAL_LOGIN_FAILED", wrong.message)
        val noProfile = AdminLocalLoginAvailability(localProperties, org.springframework.mock.env.MockEnvironment())
        assertEquals(false, noProfile.isEnabled())
        val login = localService.completeLocalLogin("local-admin", "long-local-password-not-a-repo-secret-0001")
        val disabledProperties = localProperties.copy(localLogin = localProperties.localLogin.copy(enabled = false))
        val disabledAvailability = AdminLocalLoginAvailability(disabledProperties, org.springframework.mock.env.MockEnvironment().apply { setActiveProfiles("local") })
        val disabledService = AdminAuthenticationService(repository, provider, playerAuthentication, disabledProperties, Clock.fixed(now, ZoneOffset.UTC), disabledAvailability)
        assertEquals(null, disabledService.authenticate(login.token))
        assertEquals(1, jdbc.sql("select count(*) from admin_session where revoked_at is not null").query(Long::class.java).single())
    }


    @Test
    fun `local identity never reuses a matching GitLab username`() {
        val authorization = service.beginGitlabLogin()
        val gitlab = service.completeGitlabLogin(queryParameter(authorization.url, "state"), "provider-code")
        val localProperties = properties.copy(
            gitlab = properties.gitlab.copy(enabled = false),
            localLogin = properties.localLogin.copy(username = gitlab.principal.username),
        )
        val localAvailability = AdminLocalLoginAvailability(localProperties, org.springframework.mock.env.MockEnvironment().apply { setActiveProfiles("local") })
        val localService = AdminAuthenticationService(repository, provider, playerAuthentication, localProperties, Clock.fixed(now, ZoneOffset.UTC), localAvailability)

        val denied = assertFailsWith<IllegalArgumentException> {
            localService.completeLocalLogin(gitlab.principal.username, localProperties.localLogin.password)
        }

        assertEquals("ADMIN_LOCAL_LOGIN_FAILED", denied.message)
        assertEquals(1, jdbc.sql("select count(*) from admin_operator").query(Long::class.java).single())
        assertEquals(false, localService.authenticate(gitlab.token)?.localLogin)
    }

    @Test
    fun `non-whitelisted user is denied and state cannot be replayed`() {
        val authorization = service.beginGitlabLogin()
        val state = queryParameter(authorization.url, "state")
        provider.profile = AdminGitlabProfile(404, "outside-user", "Outside User", "active", false)

        val denied = assertFailsWith<IllegalArgumentException> {
            service.completeGitlabLogin(state, "provider-code")
        }
        val replay = assertFailsWith<IllegalArgumentException> {
            service.completeGitlabLogin(state, "provider-code")
        }

        assertEquals("ADMIN_GITLAB_ACCESS_DENIED", denied.message)
        assertEquals("ADMIN_GITLAB_STATE_INVALID", replay.message)
        assertEquals(0, jdbc.sql("select count(*) from admin_operator").query(Long::class.java).single())
    }

    @Test
    fun `game login creates one dedicated player account and reuses it`() {
        val firstAccount = com.hanjjak.account.domain.Account(
            gameAccountId, "admin@test.local", null, null, 1, now,
        )
        val firstCharacter = com.hanjjak.account.domain.Character(
            UUID.randomUUID(), gameAccountId, "관리자", 1, 0, 0,
        )
        Mockito.`when`(playerAuthentication.signupSocial(anyString(), anyString()))
            .thenReturn(com.hanjjak.account.application.AuthenticationResult(firstAccount, firstCharacter))

        val firstAuthorization = service.beginGitlabLogin(com.hanjjak.admin.domain.AdminLoginPurpose.GAME)
        val first = service.completeGameLogin(queryParameter(firstAuthorization.url, "state"), "provider-code")
        val secondAuthorization = service.beginGitlabLogin(com.hanjjak.admin.domain.AdminLoginPurpose.GAME)
        val second = service.completeGameLogin(queryParameter(secondAuthorization.url, "state"), "provider-code")

        assertEquals(gameAccountId, first.accountId)
        assertEquals(gameAccountId, second.accountId)
        assertEquals("https://app.example.com/api/admin/v1/auth/game/gitlab/callback", provider.redirectUri)
        Mockito.verify(playerAuthentication, Mockito.times(1)).signupSocial(anyString(), anyString())
    }

    private fun queryParameter(url: String, name: String): String = java.net.URI(url).rawQuery.split('&')
        .map { it.split('=', limit = 2) }
        .first { it[0] == name }[1]
        .let { java.net.URLDecoder.decode(it, Charsets.UTF_8) }

    private class RecordingGitlabProvider : AdminGitlabProvider {
        var profile = AdminGitlabProfile(314, "allowed-admin", "Allowed Admin", "active", false)
        var codeVerifier = ""
        var redirectUri = ""
        override fun exchange(code: String, redirectUri: String, codeVerifier: String): AdminGitlabProfile {
            this.redirectUri = redirectUri
            this.codeVerifier = codeVerifier
            return profile
        }
    }
}
