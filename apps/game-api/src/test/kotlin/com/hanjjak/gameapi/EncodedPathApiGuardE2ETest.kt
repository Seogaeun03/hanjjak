package com.hanjjak.gameapi

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.battle.application.BattleStatsProvider
import com.hanjjak.sim.FighterStats
import jakarta.servlet.http.Cookie
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Primary
import org.springframework.http.MediaType
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders
import java.net.URI
import java.util.UUID

/**
 * 레거시 즉시 보상 경로는 운영 기본값(`legacy-battle-reward-api-enabled=false`)에서
 * 경로 표기와 무관하게 차단되어야 한다. 이 테스트는 실제 Spring MVC 라우팅을 통과시켜
 * 인코딩된 경로가 컨트롤러 보상 로직에 도달하지 못하는지 검증한다.
 *
 * 판단 근거 SSOT: docs/50-architecture/networking.md
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.MOCK,
    properties = ["hanjjak.api-security.legacy-battle-reward-api-enabled=false"],
)
@AutoConfigureMockMvc
class EncodedPathApiGuardE2ETest {
    @Autowired lateinit var mvc: MockMvc
    @Autowired lateinit var mapper: ObjectMapper
    @Autowired lateinit var jdbc: JdbcClient
    @Autowired lateinit var battleStats: MutableBattleStatsProvider

    /** 표기는 달라도 라우터가 같은 레거시 핸들러를 고르는 경로. 전부 403 으로 막혀야 한다. */
    private val routableLegacyPaths = listOf(
        "/api/v1/battles/cycles",
        "/api/v1/battles/cycl%65s",
        "/api/v1/battles/%63ycles",
        "/api/v1/battles/cy%63les",
        "/api/v1/battles/chapters/1/auto-run",
        "/api/v1/battles/chapters/1/auto-r%75n",
        "/api/v1/battles/chapters/1/auto%2Drun",
        "/api/v1/battles/chapters/1/%61uto-run",
        "/api/v1/battles/chapters/1/aut%6f-run",
        "/api/v1/battles/chapters/1/aut%6F-run",
        "/api/v%31/battles/cycles",
        "/api/v%31/battles/chapters/1/auto-run",
        "/%61pi/v1/battles/cycles",
        "/api/v1/battles/cycles/",
    )

    /** 정규화 방식에 따라 가리키는 핸들러가 달라지는 경로. 해석하지 않고 4xx 로 거부해야 한다. */
    private val ambiguousPaths = listOf(
        "/api/v1//battles/cycles",
        "/api/v1/battles/cycl%2565s",
        "/api/v1/battles%2Fcycles",
        "/api/v1/battles%2fcycles",
        "/api/v1/battles/./cycles",
        "/api/v1/battles/chapters/1/../1/auto-run",
        "/api/v1/battles/cycles;jsessionid=x",
        "/api/v1/battles/cycl%2565s/",
    )

    /** 라우팅되지 않더라도 200 이나 상태 변경이 발생해서는 안 되는 변형. */
    private val hostileVariants = listOf(
        "/api/v1/battles/CYCLES",
        "/api/v1/battles/Cycles",
        "/api/v1/battles/chapters/1/AUTO-RUN",
    )

    @Test
    fun `legacy reward paths are blocked in every encoding without touching player state`() {
        val player = Client()
        val accountId = player.signup("encoded-guard-${UUID.randomUUID()}@test.local", "encoded-guard")
        player.selectMaterial()
        battleStats.set(accountId, FighterStats(1_000_000, 1_000_000, 1_000_000))
        player.openGameSession()

        val before = snapshot(accountId)

        routableLegacyPaths.forEach { path ->
            val result = player.postRaw(path)
            assertEquals(
                403,
                result.response.status,
                "expected 403 for $path but got ${result.response.status}: ${result.response.contentAsString}",
            )
            assertTrue(
                result.response.contentAsString.contains("BATTLE_COMPATIBILITY_API_DISABLED"),
                "expected BATTLE_COMPATIBILITY_API_DISABLED for $path but got ${result.response.contentAsString}",
            )
            assertEquals(before, snapshot(accountId), "player state changed after $path")
        }

        ambiguousPaths.forEach { path ->
            val result = player.postRaw(path)
            assertTrue(
                result.response.status in 400..499,
                "expected a 4xx rejection for $path but got ${result.response.status}: ${result.response.contentAsString}",
            )
            assertEquals(before, snapshot(accountId), "player state changed after $path")
        }

        hostileVariants.forEach { path ->
            val result = player.postRaw(path)
            assertNotEquals(200, result.response.status, "expected a non-200 rejection for $path")
            assertEquals(before, snapshot(accountId), "player state changed after $path")
        }

        assertEquals(before, snapshot(accountId))
    }

    @Test
    fun `battle session api keeps working while legacy paths are disabled`() {
        val player = Client()
        val accountId = player.signup("encoded-guard-ok-${UUID.randomUUID()}@test.local", "encoded-ok")
        player.selectMaterial()
        battleStats.set(accountId, FighterStats(1_000_000, 1_000_000, 1_000_000))
        player.openGameSession()

        val started = player.post("/api/v1/battles/sessions", mapOf("stageId" to "stage.01-01"))
        val sessionId = started.at("/data/battleSessionId").asText()
        jdbc.sql("update battle_session set completable_at=now()-interval '1 second' where id=:id")
            .param("id", UUID.fromString(sessionId)).update()

        val completed = player.post(
            "/api/v1/battles/sessions/$sessionId/complete",
            mapOf("predictedHash" to null, "renderingCheckpoint" to null),
            token = started.at("/data/battleToken").asText(),
        )

        assertTrue(completed.at("/data/battle/success").asBoolean())
        assertEquals(
            1L,
            jdbc.sql("select highest_clear_count from stage_progress where account_id=:account and stage_id='stage.01-01'")
                .param("account", accountId).query(Long::class.java).single(),
        )
    }

    @Test
    fun `encoded admin paths do not skip the admin access filter`() {
        listOf(
            "/api/admin/v1/outbox",
            "/api/admin/v%31/outbox",
            "/api/admin/v1/dashb%6Fard",
            "/api/%61dmin/v1/outbox",
        ).forEach { path ->
            val result = mvc.perform(
                MockMvcRequestBuilders.get(URI.create(path)).accept(MediaType.APPLICATION_JSON),
            ).andReturn()

            assertNotEquals(
                200,
                result.response.status,
                "unauthenticated admin request to $path was served: ${result.response.contentAsString}",
            )
        }
    }

    private data class StateSnapshot(
        val inventoryItems: Long,
        val rice: Long,
        val experience: Long,
        val level: Int,
        val stageProgressRows: Long,
        val clearedStages: Long,
        val battleCommands: Long,
        val stateVersion: Long,
    )

    private fun snapshot(accountId: UUID) = StateSnapshot(
        inventoryItems = count("select count(*) from inventory_instance where account_id=:account", accountId),
        rice = count("select coalesce(max(rice),0) from character where account_id=:account", accountId),
        experience = count("select coalesce(max(experience),0) from character where account_id=:account", accountId),
        level = count("select coalesce(max(level),0) from character where account_id=:account", accountId).toInt(),
        stageProgressRows = count("select count(*) from stage_progress where account_id=:account", accountId),
        clearedStages = count(
            "select count(*) from stage_progress where account_id=:account and first_cleared_at is not null",
            accountId,
        ),
        battleCommands = count("select count(*) from battle_command_record where account_id=:account", accountId),
        stateVersion = count("select state_version from account where id=:account", accountId),
    )

    private fun count(sql: String, accountId: UUID): Long =
        jdbc.sql(sql).param("account", accountId).query(Long::class.java).single()

    private inner class Client {
        private val cookies = mutableListOf<Cookie>()
        private lateinit var accountId: UUID
        private lateinit var gameSessionId: String

        fun signup(email: String, nickname: String): UUID {
            val result = post(
                "/api/v1/auth/signup",
                mapOf("email" to email, "password" to "password123", "nickname" to nickname),
                authenticated = false,
            )
            accountId = UUID.fromString(result.at("/data/accountId").asText())
            return accountId
        }

        fun selectMaterial() {
            post("/api/v1/material-preference", mapOf("materialType" to "POTATO"))
        }

        fun openGameSession() {
            gameSessionId = post("/api/v1/game-sessions", emptyMap<String, String>()).at("/data/gameSessionId").asText()
        }

        fun post(
            path: String,
            body: Any,
            key: UUID = UUID.randomUUID(),
            token: String? = null,
            authenticated: Boolean = true,
        ): JsonNode {
            val result = perform(path, body, key, token, authenticated, expectOk = true)
            return mapper.readTree(result.response.contentAsString)
        }

        /** 상태 코드를 그대로 관찰해야 하는 공격 경로용. 인코딩을 보존하려고 URI 오버로드를 쓴다. */
        fun postRaw(path: String): MvcResult =
            perform(path, mapOf("stageId" to "stage.01-01"), UUID.randomUUID(), null, true, expectOk = false)

        private fun perform(
            path: String,
            body: Any,
            key: UUID,
            token: String?,
            authenticated: Boolean,
            expectOk: Boolean,
        ): MvcResult {
            val request = MockMvcRequestBuilders.post(URI.create(path))
                .header("Origin", "http://localhost:5173")
                .header("Idempotency-Key", key)
                .contentType(MediaType.APPLICATION_JSON)
                .accept(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body))
            if (::gameSessionId.isInitialized) request.header("X-Game-Session-Id", gameSessionId)
            token?.let { request.header("X-Battle-Token", it) }
            if (cookies.isNotEmpty()) request.cookie(*cookies.toTypedArray())
            if (authenticated) request.sessionAttr("accountId", accountId)
            val result = mvc.perform(request).andReturn()
            if (expectOk) {
                assertEquals(200, result.response.status, "${result.response.status} for $path: ${result.response.contentAsString}")
            }
            capture(result)
            return result
        }

        private fun capture(result: MvcResult) {
            result.response.cookies.forEach { cookie ->
                cookies.removeIf { it.name == cookie.name }
                cookies += cookie
            }
        }
    }

    @TestConfiguration
    class BattleStatsTestConfiguration {
        @Bean
        @Primary
        fun mutableBattleStatsProvider(): MutableBattleStatsProvider = MutableBattleStatsProvider()
    }

    companion object {
        private val databaseConnection = PostgresTestDatabase.schema("encoded_path_guard")

        @DynamicPropertySource
        @JvmStatic
        fun database(registry: DynamicPropertyRegistry) {
            databaseConnection.register(registry)
            registry.add("spring.session.store-type") { "none" }
            registry.add("hanjjak.balance.active-version") { "progression-rebalance-v1" }
        }
    }
}
