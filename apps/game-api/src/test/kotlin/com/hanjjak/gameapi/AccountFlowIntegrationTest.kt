package com.hanjjak.gameapi

import com.hanjjak.account.application.AuthenticationCommandService
import com.hanjjak.battle.application.GameSessionService
import com.hanjjak.account.application.AuthenticationService
import com.hanjjak.account.application.MaterialPreferenceService
import com.hanjjak.account.application.AccountRepository
import com.hanjjak.account.application.SsafyAffiliationClassifier
import com.hanjjak.account.application.SsafyAffiliationLookup
import com.hanjjak.account.application.SsafyAffiliationRepository
import com.hanjjak.account.application.SocialIdentityRepository
import com.hanjjak.account.application.SocialProvider
import com.hanjjak.account.domain.MaterialAlreadySelectedException
import com.hanjjak.account.domain.MaterialType
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.MockMvc
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.core.io.ClassPathResource
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import com.hanjjak.sim.FighterStats
import java.security.MessageDigest

@GameApiIntegrationTest
class AccountFlowIntegrationTest {
    @Autowired private lateinit var authentication: AuthenticationService
    @Autowired private lateinit var authenticationCommands: AuthenticationCommandService
    @Autowired private lateinit var materials: MaterialPreferenceService
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var mockMvc: MockMvc
    @Autowired private lateinit var ssafyAffiliations: SsafyAffiliationRepository
    @Autowired private lateinit var socialIdentities: SocialIdentityRepository
    @Autowired private lateinit var jdbc: JdbcClient
    @Autowired private lateinit var resetMail: RecordingPasswordResetMailSender
    @Autowired private lateinit var mapper: com.fasterxml.jackson.databind.ObjectMapper
    @Autowired private lateinit var battleStats: MutableBattleStatsProvider
    @Autowired private lateinit var offlineRewardSettings: com.hanjjak.battle.application.OfflineRewardSettings
    @Autowired private lateinit var gameSessionService: GameSessionService

    @Test
    fun `authentication validation always uses the common error envelope`() {
        mockMvc.post("/api/v1/auth/signup") {
            header("Origin", "http://localhost:5173")
            header("Idempotency-Key", UUID.randomUUID())
            contentType = MediaType.APPLICATION_JSON
            content = """{"email":"player@example.com","password":"short","nickname":"한짝-${UUID.randomUUID().toString().take(6)}"}"""
        }.andExpect {
            status { isUnprocessableEntity() }
            jsonPath("$.code") { value("PASSWORD_TOO_SHORT") }
            jsonPath("$.messageKey") { value("error.password.too.short") }
            jsonPath("$.retryable") { value(false) }
            jsonPath("$.details[0].field") { value("password") }
        }

        mockMvc.post("/api/v1/auth/login") {
            header("Origin", "http://localhost:5173")
            contentType = MediaType.APPLICATION_JSON
            content = """{"email":"player@example.com","password":"password123"}"""
        }.andExpect {
            status { isBadRequest() }
            jsonPath("$.code") { value("IDEMPOTENCY_KEY_REQUIRED") }
        }

        mockMvc.post("/api/v1/auth/login") {
            header("Origin", "http://localhost:5173")
            header("Idempotency-Key", "not-a-uuid")
            contentType = MediaType.APPLICATION_JSON
            content = """{"email":"player@example.com","password":"password123"}"""
        }.andExpect {
            status { isBadRequest() }
            jsonPath("$.code") { value("INVALID_IDEMPOTENCY_KEY") }
        }
    }

    @Test
    fun `nickname availability and writes enforce exact uniqueness`() {
        val nickname = "중복-${UUID.randomUUID().toString().take(8)}"

        mockMvc.get("/api/v1/auth/nickname-availability") {
            param("nickname", " $nickname ")
        }.andExpect {
            status { isOk() }
            jsonPath("$.data.available") { value(true) }
        }

        val first = authentication.signup("first-${UUID.randomUUID()}@example.com", "password123", nickname)
        mockMvc.get("/api/v1/auth/nickname-availability") {
            param("nickname", nickname)
        }.andExpect {
            status { isOk() }
            jsonPath("$.data.available") { value(false) }
        }

        val duplicateSignup = runCatching {
            authentication.signup("second-${UUID.randomUUID()}@example.com", "password123", " $nickname ")
        }.exceptionOrNull()
        assertEquals("NICKNAME_ALREADY_EXISTS", duplicateSignup?.message)

        val second = authentication.signup("third-${UUID.randomUUID()}@example.com", "password123", "다른-$nickname")
        val duplicateUpdate = runCatching { authentication.updateNickname(second.account.id, first.character.nickname) }.exceptionOrNull()
        assertEquals("NICKNAME_ALREADY_EXISTS", duplicateUpdate?.message)
    }

    @Test
    fun `deleted social identity can sign up again with the same provider subject`() {
        val provider = SocialProvider.SSAFY_GITLAB
        val subject = "deleted-rejoin-${UUID.randomUUID()}"
        val deleted = authentication.signupSocial(
            "deleted-rejoin-${UUID.randomUUID()}@example.com",
            "탈퇴-${UUID.randomUUID().toString().take(6)}",
        )
        socialIdentities.link(deleted.account.id, provider, subject, deleted.account.email, java.time.Instant.now())

        authentication.deleteAccount(deleted.account.id)

        assertEquals(null, socialIdentities.findAccountId(provider, subject))
        val replacement = authentication.signupSocial(
            "replacement-${UUID.randomUUID()}@example.com",
            "재가입-${UUID.randomUUID().toString().take(6)}",
        )
        socialIdentities.link(replacement.account.id, provider, subject, replacement.account.email, java.time.Instant.now())
        assertEquals(replacement.account.id, socialIdentities.findAccountId(provider, subject))
    }

    @Test
    fun `soft delete does not release an identity when the guarded account update did not run`() {
        val provider = SocialProvider.SSAFY_GITLAB
        val subject = "guarded-delete-${UUID.randomUUID()}"
        val account = authentication.signupSocial(
            "guarded-delete-${UUID.randomUUID()}@example.com",
            "삭제보호-${UUID.randomUUID().toString().take(6)}",
        ).account
        socialIdentities.link(account.id, provider, subject, account.email, java.time.Instant.now())
        jdbc.sql("update account set deleted_at = now() where id = :account")
            .param("account", account.id)
            .update()

        assertEquals(false, accounts.softDelete(account.id, "ignored@deleted.local", "삭제보호"))
        assertEquals(account.id, socialIdentities.findAccountId(provider, subject))
    }

    @Test
    fun `social identity cleanup migration releases subjects from accounts deleted before the fix`() {
        val provider = SocialProvider.SSAFY_GITLAB
        val subject = "legacy-deleted-${UUID.randomUUID()}"
        val deleted = authentication.signupSocial(
            "legacy-deleted-${UUID.randomUUID()}@example.com",
            "기존탈퇴-${UUID.randomUUID().toString().take(6)}",
        )
        socialIdentities.link(deleted.account.id, provider, subject, deleted.account.email, java.time.Instant.now())
        val activeSubject = "active-account-${UUID.randomUUID()}"
        val active = authentication.signupSocial(
            "active-account-${UUID.randomUUID()}@example.com",
            "활성계정-${UUID.randomUUID().toString().take(6)}",
        )
        socialIdentities.link(active.account.id, provider, activeSubject, active.account.email, java.time.Instant.now())
        jdbc.sql("update account set deleted_at = now() where id = :account")
            .param("account", deleted.account.id)
            .update()

        val migration = ClassPathResource("db/migration/V85__release_deleted_social_identities.sql")
            .inputStream.bufferedReader().use { it.readText() }
        jdbc.sql(migration).update()

        assertEquals(null, socialIdentities.findAccountId(provider, subject))
        assertEquals(active.account.id, socialIdentities.findAccountId(provider, activeSubject))
    }

    @Test
    fun `password reset stores a hash consumes once and invalidates login and game sessions`() {
        resetMail.clear()
        val email = "reset-${UUID.randomUUID()}@example.com"
        val signup = mockMvc.post("/api/v1/auth/signup") {
            header("Origin", "http://localhost:5173")
            header("Idempotency-Key", UUID.randomUUID())
            contentType = MediaType.APPLICATION_JSON
            content = """{"email":"$email","password":"old-password","nickname":"한짝-${UUID.randomUUID().toString().take(6)}"}"""
        }.andExpect { status { isOk() } }.andReturn()
        val cookie = signup.response.cookies.single { it.name == "SESSION" }
        materials.select(UUID.fromString(jdbc.sql("select id from account where email=:email").param("email", email).query(String::class.java).single()), UUID.randomUUID(), MaterialType.POTATO)
        mockMvc.post("/api/v1/game-sessions") {
            cookie(cookie)
            header("Origin", "http://localhost:5173")
            header("Idempotency-Key", UUID.randomUUID())
            contentType = MediaType.APPLICATION_JSON
            content = "{}"
        }.andExpect { status { isOk() } }
        mockMvc.post("/api/v1/auth/password-reset/request") {
            header("Origin", "http://localhost:5173")
            contentType = MediaType.APPLICATION_JSON
            content = """{"email":"$email"}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.data.accepted") { value(true) }
        }
        val rawToken = resetMail.awaitLink().rawFragment.removePrefix("token=")
        val storedHash = jdbc.sql("select token_hash from password_reset_token where account_id=:account")
            .param("account", UUID.fromString(jdbc.sql("select id from account where email=:email").param("email", email).query(String::class.java).single()))
            .query(String::class.java)
            .single()
        assertNotEquals(rawToken, storedHash)
        assertEquals(sha256(rawToken), storedHash)

        mockMvc.post("/api/v1/auth/password-reset/confirm") {
            header("Origin", "http://localhost:5173")
            contentType = MediaType.APPLICATION_JSON
            content = """{"token":"$rawToken","password":"new-password"}"""
        }.andExpect { status { isOk() } }

        mockMvc.get("/api/v1/auth/session") { cookie(cookie) }.andExpect {
            status { isOk() }
            jsonPath("$.data.authenticated") { value(false) }
        }
        assertEquals(0, jdbc.sql("select count(*) from game_session where status='ACTIVE' and account_id=(select id from account where email=:email)")
            .param("email", email).query(Int::class.java).single())
        mockMvc.post("/api/v1/auth/password-reset/confirm") {
            header("Origin", "http://localhost:5173")
            contentType = MediaType.APPLICATION_JSON
            content = """{"token":"$rawToken","password":"other-password"}"""
        }.andExpect {
            status { isBadRequest() }
            jsonPath("$.code") { value("PASSWORD_RESET_TOKEN_INVALID") }
        }
        authentication.login(email, "new-password")
    }

    @Test
    fun `password reset request does not disclose whether an account exists`() {
        val knownEmail = "known-${UUID.randomUUID()}@example.com"
        authentication.signup(knownEmail, "password123", "한짝-${UUID.randomUUID().toString().take(6)}")

        listOf(knownEmail, "missing-${UUID.randomUUID()}@example.com").forEach { email ->
            mockMvc.post("/api/v1/auth/password-reset/request") {
                header("Origin", "http://localhost:5173")
                contentType = MediaType.APPLICATION_JSON
                content = """{"email":"$email"}"""
            }.andExpect {
                status { isOk() }
                jsonPath("$.data.accepted") { value(true) }
            }
        }
    }

    @Test
    fun `flyway schema persists account profile and immutable material preference`() {
        val email = "flow-${UUID.randomUUID()}@example.com"
        // 닉네임은 계정마다 하나뿐이므로 시험 사이에서 이름이 겹치지 않게 한다. 앞뒤 공백은 다듬기를 확인하려고 남긴다.
        val suffix = UUID.randomUUID().toString().take(6)
        val renamedTo = "고구마대장$suffix"
        val signup = authentication.signup(email, "password123", " 첫한짝$suffix ")
        jdbc.sql("update wallet_balance set balance=300000 where account_id=:account")
            .param("account", signup.account.id)
            .update()

        val selected = materials.select(signup.account.id, UUID.randomUUID(), MaterialType.SWEET_POTATO)
        val renamed = authentication.updateNickname(signup.account.id, " $renamedTo ")
        val restored = authentication.login(email.uppercase(), "password123")

        assertEquals(MaterialType.SWEET_POTATO, selected.data.primaryMaterialType)
        assertEquals(MaterialType.SWEET_POTATO, materials.get(signup.account.id).data.primaryMaterialType)
        assertEquals(renamedTo, renamed.character.nickname)
        assertEquals(renamedTo, restored.character.nickname)
        assertEquals(0L, jdbc.sql("select balance from wallet_balance where account_id=:account").param("account", signup.account.id).query(Long::class.java).single())
        assertEquals(1, renamed.character.nicknameChangeCount)
        assertEquals(3, renamed.account.stateVersion)

        val error = runCatching {
            materials.select(signup.account.id, UUID.randomUUID(), MaterialType.CORN)
        }.exceptionOrNull()
        assertTrue(error is MaterialAlreadySelectedException)
    }

    @Test
    fun `rollout provisions old-pod accounts and new signup promotes its configured version`() {
        val rolloutAccount = UUID.randomUUID()
        jdbc.sql("insert into account(id,email,password_hash,state_version,created_at) values (:account,:email,'test',1,now())")
            .params(mapOf("account" to rolloutAccount, "email" to "rollout-$rolloutAccount@example.com"))
            .update()
        assertEquals(
            "enemy-v1-applied",
            jdbc.sql("select balance_version from account_balance_state where account_id=:account")
                .param("account", rolloutAccount).query(String::class.java).single(),
        )
        assertTrue(
            jdbc.sql("select provisioned_during_rollout from account_balance_state where account_id=:account")
                .param("account", rolloutAccount).query(Boolean::class.java).single(),
        )

        val signup = authentication.signup("active-${UUID.randomUUID()}@example.com", "password123", "한짝")
        assertEquals(
            "progression-rebalance-v1",
            jdbc.sql("select balance_version from account_balance_state where account_id=:account")
                .param("account", signup.account.id).query(String::class.java).single(),
        )
        assertTrue(
            jdbc.sql("select retroactive_completed_at is not null and not provisioned_during_rollout from account_balance_state where account_id=:account")
                .param("account", signup.account.id).query(Boolean::class.java).single(),
        )
    }

    @Test
    fun `concurrent signup retries with one key create one account`() {
        val key = UUID.randomUUID()
        val email = "retry-${UUID.randomUUID()}@example.com"
        // 같은 요청의 재시도이므로 닉네임도 같아야 한다. 다른 시험과만 겹치지 않게 한다.
        val nickname = "한짝-${UUID.randomUUID().toString().take(6)}"
        val ready = CountDownLatch(2)
        val start = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(2)
        try {
            val attempts = List(2) {
                pool.submit<UUID> {
                    ready.countDown()
                    check(start.await(10, TimeUnit.SECONDS)) { "signup workers did not start together" }
                    authenticationCommands.signup(key, email, "password123", nickname).account.id
                }
            }
            check(ready.await(10, TimeUnit.SECONDS)) { "signup workers were not ready" }
            start.countDown()
            assertEquals(1, attempts.map { it.get(30, TimeUnit.SECONDS) }.toSet().size)
        } finally {
            pool.shutdownNow()
        }
    }

    @Test
    fun `concurrent different material selections persist exactly one value`() {
        val accountId = authentication.signup("material-${UUID.randomUUID()}@example.com", "password123", "한짝-${UUID.randomUUID().toString().take(6)}").account.id
        val ready = CountDownLatch(2)
        val start = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(2)
        try {
            val attempts = listOf(MaterialType.POTATO, MaterialType.CORN).map { material ->
                pool.submit<Boolean> {
                    ready.countDown()
                    check(start.await(10, TimeUnit.SECONDS)) { "material workers did not start together" }
                    runCatching { materials.select(accountId, UUID.randomUUID(), material) }.isSuccess
                }
            }
            check(ready.await(10, TimeUnit.SECONDS)) { "material workers were not ready" }
            start.countDown()
            assertEquals(1, attempts.count { it.get(30, TimeUnit.SECONDS) })
            assertTrue(materials.get(accountId).data.primaryMaterialType in setOf(MaterialType.POTATO, MaterialType.CORN))
            assertEquals(2, materials.get(accountId).stateVersion)
        } finally {
            pool.shutdownNow()
        }
    }

    @Test
    fun `offline reward accrues at the highest cleared stage not the stage in progress`() {
        val email = "offline-cleared-${UUID.randomUUID()}@example.com"
        val signup = mockMvc.post("/api/v1/auth/signup") {
            header("Origin", "http://localhost:5173")
            header("Idempotency-Key", UUID.randomUUID())
            contentType = MediaType.APPLICATION_JSON
            content = """{"email":"$email","password":"password123","nickname":"방치"}"""
        }.andExpect { status { isOk() } }.andReturn()
        val cookie = signup.response.cookies.single { it.name == "SESSION" }
        val accountId = UUID.fromString(jdbc.sql("select id from account where email=:email").param("email", email).query(String::class.java).single())
        materials.select(accountId, UUID.randomUUID(), MaterialType.POTATO)
        battleStats.set(accountId, FighterStats(1_000_000, 1_000_000, 1_000_000))

        jdbc.sql(
            """insert into account_runtime_state(account_id,current_stage_id) values (:account,'stage.03-10')
               on conflict(account_id) do update set current_stage_id=excluded.current_stage_id""",
        ).param("account", accountId).update()
        listOf("stage.03-08" to true, "stage.03-09" to true, "stage.03-10" to false).forEach { (stage, cleared) ->
            jdbc.sql(
                """insert into stage_progress(account_id,stage_id,unlocked,first_cleared_at,highest_clear_count,content_version)
                   values (:account,:stage,true,case when :cleared then now() else null end,0,'test')
                   on conflict(account_id,stage_id) do update set first_cleared_at=excluded.first_cleared_at""",
            ).params(mapOf("account" to accountId, "stage" to stage, "cleared" to cleared)).update()
        }

        mockMvc.post("/api/v1/game-sessions") {
            cookie(cookie)
            header("Origin", "http://localhost:5173")
            header("Idempotency-Key", UUID.randomUUID())
            contentType = MediaType.APPLICATION_JSON
            content = "{}"
        }.andExpect { status { isOk() } }

        assertEquals(
            "stage.03-09",
            jdbc.sql("select stage_id from offline_job where account_id=:account and status='ACTIVE'")
                .param("account", accountId).query(String::class.java).single(),
        )
    }

    /**
     * 웹은 일시적 실패로 놓친 박동을 같은 Idempotency-Key로 다시 보낸다. 서버는 그 재시도를
     * 새 명령으로 세지 않고 저장한 결과를 그대로 돌려줘야 한다.
     */
    @Test
    fun `replayed heartbeat with the same key is not counted twice`() {
        val email = "heartbeat-${UUID.randomUUID()}@example.com"
        val signup = mockMvc.post("/api/v1/auth/signup") {
            header("Origin", "http://localhost:5173")
            header("Idempotency-Key", UUID.randomUUID())
            contentType = MediaType.APPLICATION_JSON
            content = """{"email":"$email","password":"password123","nickname":"박동-${UUID.randomUUID().toString().take(6)}"}"""
        }.andExpect { status { isOk() } }.andReturn()
        val cookie = signup.response.cookies.single { it.name == "SESSION" }
        val accountId = UUID.fromString(jdbc.sql("select id from account where email=:email").param("email", email).query(String::class.java).single())
        materials.select(accountId, UUID.randomUUID(), MaterialType.POTATO)

        val opened = mockMvc.post("/api/v1/game-sessions") {
            cookie(cookie)
            header("Origin", "http://localhost:5173")
            header("Idempotency-Key", UUID.randomUUID())
            contentType = MediaType.APPLICATION_JSON
            content = "{}"
        }.andExpect { status { isOk() } }.andReturn()
        val sessionId = mapper.readTree(opened.response.contentAsString).at("/data/gameSessionId").asText()
        val heartbeatKey = UUID.randomUUID()
        val beat = { ->
            mockMvc.post("/api/v1/game-sessions/$sessionId/heartbeat") {
                cookie(cookie)
                header("Origin", "http://localhost:5173")
                header("Idempotency-Key", heartbeatKey)
                contentType = MediaType.APPLICATION_JSON
                content = "{}"
            }.andExpect { status { isOk() } }.andReturn().response.contentAsString
        }

        val first = mapper.readTree(beat()).at("/data")
        val replay = mapper.readTree(beat()).at("/data")

        assertEquals(first, replay)
        assertEquals("ACTIVE", replay.at("/status").asText())
        assertEquals(
            1,
            jdbc.sql("select count(*) from game_session_command where account_id=:account and idempotency_key=:key")
                .params(mapOf("account" to accountId, "key" to heartbeatKey)).query(Int::class.java).single(),
        )
    }

    @Test
    fun `silent game session freezes and claims offline reward exactly once`() {
        val email = "offline-${UUID.randomUUID()}@example.com"
        val signup = mockMvc.post("/api/v1/auth/signup") {
            header("Origin", "http://localhost:5173")
            header("Idempotency-Key", UUID.randomUUID())
            contentType = MediaType.APPLICATION_JSON
            content = """{"email":"$email","password":"password123","nickname":"방치-${UUID.randomUUID().toString().take(6)}"}"""
        }.andExpect { status { isOk() } }.andReturn()
        val cookie = signup.response.cookies.single { it.name == "SESSION" }
        val accountId = UUID.fromString(jdbc.sql("select id from account where email=:email").param("email", email).query(String::class.java).single())
        materials.select(accountId, UUID.randomUUID(), MaterialType.POTATO)
        battleStats.set(accountId, FighterStats(1_000_000, 1_000_000, 1_000_000))

        val firstSession = mockMvc.post("/api/v1/game-sessions") {
            cookie(cookie)
            header("Origin", "http://localhost:5173")
            header("Idempotency-Key", UUID.randomUUID())
            contentType = MediaType.APPLICATION_JSON
            content = "{}"
        }.andExpect { status { isOk() } }.andReturn()
        val firstSessionId = mapper.readTree(firstSession.response.contentAsString).at("/data/gameSessionId").asText()
        jdbc.sql("update offline_job set last_heartbeat_at=now()-interval '1 hour' where account_id=:account and status='ACTIVE'")
            .param("account", accountId).update()
        mockMvc.get("/api/v1/offline-rewards/pending") { cookie(cookie) }.andExpect {
            status { isOk() }
            jsonPath("$.data") { doesNotExist() }
        }
        val resumedSession = mockMvc.post("/api/v1/game-sessions") {
            cookie(cookie)
            header("Origin", "http://localhost:5173")
            header("Idempotency-Key", UUID.randomUUID())
            contentType = MediaType.APPLICATION_JSON
            content = "{}"
        }.andExpect { status { isOk() } }.andReturn()
        assertEquals(firstSessionId, mapper.readTree(resumedSession.response.contentAsString).at("/data/gameSessionId").asText())
        jdbc.sql("update game_session set last_heartbeat_at=now()-interval '59 seconds' where account_id=:account and status='ACTIVE'")
            .param("account", accountId).update()
        jdbc.sql("update offline_job set last_heartbeat_at=now()-interval '59 seconds' where account_id=:account and status='ACTIVE'")
            .param("account", accountId).update()
        gameSessionService.requireActive(accountId, UUID.fromString(firstSessionId))
        assertEquals(0, jdbc.sql("select count(*) from offline_job where account_id=:account and last_heartbeat_at < now()-interval '5 seconds' and status='ACTIVE'")
            .param("account", accountId).query(Int::class.java).single())
        assertEquals(0, jdbc.sql("select count(*) from offline_job where account_id=:account and status='CLAIMABLE'")
            .param("account", accountId).query(Int::class.java).single())
        // DB now()와 앱 Clock의 소수점 초 차이로 정확히 1시간 전은 3599초로 내림될 수 있다.
        // 보상 경계에서 충분히 떨어진 시각으로 두고, 세션 교체·1회 청구 동작을 검증한다.
        jdbc.sql("update game_session set last_heartbeat_at=now()-interval '1 hour 5 seconds' where account_id=:account and status='ACTIVE'")
            .param("account", accountId).update()
        jdbc.sql("update offline_job set last_heartbeat_at=now()-interval '1 hour 5 seconds' where account_id=:account and status='ACTIVE'")
            .param("account", accountId).update()
        val replacementSession = mockMvc.post("/api/v1/game-sessions") {
            cookie(cookie)
            header("Origin", "http://localhost:5173")
            header("Idempotency-Key", UUID.randomUUID())
            contentType = MediaType.APPLICATION_JSON
            content = "{}"
        }.andExpect { status { isOk() } }.andReturn()
        assertNotEquals(firstSessionId, mapper.readTree(replacementSession.response.contentAsString).at("/data/gameSessionId").asText())

        mockMvc.get("/api/v1/offline-rewards/pending") { cookie(cookie) }.andExpect {
            status { isOk() }
            jsonPath("$.data.status") { value("CLAIMABLE") }
            jsonPath("$.data.stageId") { value("stage.01-01") }
            jsonPath("$.data.eligibleSeconds") { value(org.hamcrest.Matchers.greaterThan(0)) }
            jsonPath("$.data.offlineSeconds") { value(org.hamcrest.Matchers.greaterThanOrEqualTo(3_600)) }
            jsonPath("$.data.riceGained") { value(org.hamcrest.Matchers.greaterThan(0)) }
        }
        val key = UUID.randomUUID()
        val first = mockMvc.post("/api/v1/offline-rewards/claim") {
            cookie(cookie)
            header("Origin", "http://localhost:5173")
            header("Idempotency-Key", key)
            contentType = MediaType.APPLICATION_JSON
            content = "{}"
        }.andExpect {
            status { isOk() }
            jsonPath("$.data.status") { value("CLAIMED") }
            jsonPath("$.data.offlineSeconds") { value(org.hamcrest.Matchers.greaterThanOrEqualTo(3_600)) }
        }.andReturn()
        val firstJobId = mapper.readTree(first.response.contentAsString).at("/data/jobId").asText()
        val replay = mockMvc.post("/api/v1/offline-rewards/claim") {
            cookie(cookie)
            header("Origin", "http://localhost:5173")
            header("Idempotency-Key", key)
            contentType = MediaType.APPLICATION_JSON
            content = "{}"
        }.andExpect {
            status { isOk() }
            jsonPath("$.data.status") { value("CLAIMED") }
            jsonPath("$.data.offlineSeconds") { value(org.hamcrest.Matchers.greaterThanOrEqualTo(3_600)) }
        }.andReturn()
        assertEquals(firstJobId, mapper.readTree(replay.response.contentAsString).at("/data/jobId").asText())
        assertEquals(1, jdbc.sql("select count(*) from offline_job where account_id=:account and status='CLAIMED'")
            .param("account", accountId).query(Int::class.java).single())
    }

    @Test
    fun `logout reward uses whole minutes half rate and current stage`() {
        val email = "offline-test-${UUID.randomUUID()}@example.com"
        val signup = mockMvc.post("/api/v1/auth/signup") {
            header("Origin", "http://localhost:5173")
            header("Idempotency-Key", UUID.randomUUID())
            contentType = MediaType.APPLICATION_JSON
            content = """{"email":"$email","password":"password123","nickname":"테스트-${UUID.randomUUID().toString().take(6)}"}"""
        }.andExpect { status { isOk() } }.andReturn()
        val cookie = signup.response.cookies.single { it.name == "SESSION" }
        val accountId = UUID.fromString(jdbc.sql("select id from account where email=:email").param("email", email).query(String::class.java).single())
        materials.select(accountId, UUID.randomUUID(), MaterialType.POTATO)
        battleStats.set(accountId, FighterStats(1_000_000, 1_000_000, 1_000_000))
        jdbc.sql("""insert into stage_progress(account_id,stage_id,unlocked,first_cleared_at,highest_clear_count,content_version)
            values (:account,'stage.01-03',true,now(),1,'enemy-v1-applied'),
                   (:account,'stage.01-02',true,now(),1,'enemy-v1-applied')""").param("account", accountId).update()
        jdbc.sql("""insert into account_runtime_state(account_id,current_stage_id) values (:account,'stage.01-02')
            on conflict(account_id) do update set current_stage_id=excluded.current_stage_id""")
            .param("account", accountId).update()
        offlineRewardSettings.testAllAccounts = true
        offlineRewardSettings.testRewardMultiplier = "0.5"
        offlineRewardSettings.testGracePeriodSeconds = "0"
        offlineRewardSettings.testBucketSeconds = "60"
        offlineRewardSettings.testAccrualCapSeconds = "28800"
        try {
            mockMvc.post("/api/v1/game-sessions") {
                cookie(cookie)
                header("Origin", "http://localhost:5173")
                header("Idempotency-Key", UUID.randomUUID())
                contentType = MediaType.APPLICATION_JSON
                content = "{}"
            }.andExpect { status { isOk() } }
            val oneMinuteRate = mapper.readTree(jdbc.sql("select reward_rate_snapshot_json::text from offline_job where account_id=:account and status='ACTIVE'")
                .param("account", accountId).query(String::class.java).single())

            mockMvc.post("/api/v1/auth/logout") {
                cookie(cookie)
                header("Origin", "http://localhost:5173")
                header("Idempotency-Key", UUID.randomUUID())
                contentType = MediaType.APPLICATION_JSON
                content = "{}"
            }.andExpect { status { isOk() } }
            // Accrual ends when login runs, a moment after this update. Ninety seconds sits mid-bucket so
            // that moment can drift up to half a minute either way and still pay exactly one whole minute.
            jdbc.sql("update offline_job set last_heartbeat_at=now()-interval '90 seconds' where account_id=:account and status='ACTIVE'")
                .param("account", accountId).update()
            gameSessionService.expireSilentSessions()
            assertEquals(1, jdbc.sql("select count(*) from offline_job where account_id=:account and status='ACTIVE'")
                .param("account", accountId).query(Int::class.java).single())

            val login = mockMvc.post("/api/v1/auth/login") {
                header("Origin", "http://localhost:5173")
                header("Idempotency-Key", UUID.randomUUID())
                contentType = MediaType.APPLICATION_JSON
                content = """{"email":"$email","password":"password123"}"""
            }.andExpect { status { isOk() } }.andReturn()
            val loginCookie = login.response.cookies.single { it.name == "SESSION" }

            mockMvc.get("/api/v1/offline-rewards/pending") { cookie(loginCookie) }.andExpect {
                status { isOk() }
                jsonPath("$.data.status") { value("CLAIMABLE") }
                jsonPath("$.data.stageId") { value("stage.01-02") }
                jsonPath("$.data.offlineSeconds") { value(org.hamcrest.Matchers.greaterThanOrEqualTo(90)) }
                jsonPath("$.data.eligibleSeconds") { value(60) }
            }
            mockMvc.post("/api/v1/offline-rewards/claim") {
                cookie(loginCookie)
                header("Origin", "http://localhost:5173")
                header("Idempotency-Key", UUID.randomUUID())
                contentType = MediaType.APPLICATION_JSON
                content = "{}"
            }.andExpect {
                status { isOk() }
                jsonPath("$.data.eligibleSeconds") { value(60) }
                jsonPath("$.data.experienceGained") { value(oneMinuteRate["experiencePerMinute"].decimalValue().multiply(java.math.BigDecimal("0.5")).setScale(0, java.math.RoundingMode.DOWN).longValueExact()) }
                jsonPath("$.data.riceGained") { value(oneMinuteRate["ricePerMinute"].decimalValue().multiply(java.math.BigDecimal("0.5")).setScale(0, java.math.RoundingMode.DOWN).longValueExact()) }
            }

            mockMvc.post("/api/v1/auth/logout") {
                cookie(loginCookie)
                header("Origin", "http://localhost:5173")
                header("Idempotency-Key", UUID.randomUUID())
                contentType = MediaType.APPLICATION_JSON
                content = "{}"
            }.andExpect { status { isOk() } }
            jdbc.sql("update offline_job set last_heartbeat_at=now()-interval '59 seconds' where account_id=:account and status='ACTIVE'")
                .param("account", accountId).update()
            val shortLogin = mockMvc.post("/api/v1/auth/login") {
                header("Origin", "http://localhost:5173")
                header("Idempotency-Key", UUID.randomUUID())
                contentType = MediaType.APPLICATION_JSON
                content = """{"email":"$email","password":"password123"}"""
            }.andExpect { status { isOk() } }.andReturn()
            val shortLoginCookie = shortLogin.response.cookies.single { it.name == "SESSION" }
            mockMvc.get("/api/v1/offline-rewards/pending") { cookie(shortLoginCookie) }.andExpect {
                status { isOk() }
                jsonPath("$.data") { doesNotExist() }
            }
        } finally {
            offlineRewardSettings.testAllAccounts = false
            offlineRewardSettings.testRewardMultiplier = ""
            offlineRewardSettings.testGracePeriodSeconds = ""
            offlineRewardSettings.testBucketSeconds = ""
            offlineRewardSettings.testAccrualCapSeconds = ""
        }
    }

    @Test
    fun `SSAFY affiliation keeps history and exposes stale last success through session`() {
        val signup = mockMvc.post("/api/v1/auth/signup") {
            header("Origin", "http://localhost:5173")
            header("Idempotency-Key", UUID.randomUUID())
            contentType = MediaType.APPLICATION_JSON
            content = """{"email":"ssafy-${UUID.randomUUID()}@example.com","password":"password123","nickname":"싸피-${UUID.randomUUID().toString().take(6)}"}"""
        }.andExpect { status { isOk() } }.andReturn()
        val cookie = signup.response.cookies.single { it.name == "SESSION" }
        val accountId = UUID.fromString(mapper.readTree(signup.response.contentAsString).at("/data/accountId").asText())
        val firstAttempt = java.time.Instant.parse("2026-09-20T00:00:00Z")

        ssafyAffiliations.apply(
            accountId,
            SsafyAffiliationLookup.success(SsafyAffiliationClassifier.classify(listOf("s14/a01", "s15/a02"))),
            firstAttempt,
            firstAttempt.plusSeconds(1),
        )
        ssafyAffiliations.apply(
            accountId,
            SsafyAffiliationLookup.success(SsafyAffiliationClassifier.classify(listOf("s15/b03"))),
            firstAttempt.plusSeconds(2),
            firstAttempt.plusSeconds(3),
        )
        ssafyAffiliations.apply(
            accountId,
            SsafyAffiliationLookup.failed(),
            firstAttempt.plusSeconds(4),
            firstAttempt.plusSeconds(5),
        )

        mockMvc.get("/api/v1/auth/session") { cookie(cookie) }.andExpect {
            status { isOk() }
            jsonPath("$.data.account.ssafyAffiliation.currentCohort") { value(15) }
            jsonPath("$.data.account.ssafyAffiliation.cohortHistory[0]") { value(14) }
            jsonPath("$.data.account.ssafyAffiliation.cohortHistory[1]") { value(15) }
            jsonPath("$.data.account.ssafyAffiliation.multipleCohorts") { value(true) }
            jsonPath("$.data.account.ssafyAffiliation.region") { value("UNDETERMINED") }
            jsonPath("$.data.account.ssafyAffiliation.regionReason") { value("MULTIPLE_REGIONS") }
            jsonPath("$.data.account.ssafyAffiliation.verificationStatus") { value("STALE") }
            jsonPath("$.data.account.ssafyAffiliation.lastVerifiedAt") { value("2026-09-20T00:00:03Z") }
        }
    }

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray())
        .joinToString("") { "%02x".format(it) }

}
