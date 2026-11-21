package com.hanjjak.gameapi

import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.sim.FighterStats
import org.junit.jupiter.api.Assertions.assertEquals
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
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders
import java.net.URI
import java.util.UUID

/**
 * 두 번째 방어선을 단독으로 검증한다.
 *
 * `addFilters = false` 로 [com.hanjjak.account.api.ApiRequestGuardFilter] 를 포함한 모든 서블릿
 * 필터를 끈 상태에서도, 라우팅이 끝난 레거시 핸들러가
 * [com.hanjjak.account.api.LegacyBattleRewardApiGate] 에 막혀 보상 로직에 진입하지 못해야 한다.
 * 필터 한 겹에만 의존하지 않는다는 증거다.
 *
 * 판단 근거 SSOT: docs/50-architecture/networking.md
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.MOCK,
    properties = ["hanjjak.api-security.legacy-battle-reward-api-enabled=false"],
)
@AutoConfigureMockMvc(addFilters = false)
class LegacyBattleRewardHandlerGateE2ETest {
    @Autowired lateinit var mvc: MockMvc
    @Autowired lateinit var mapper: ObjectMapper
    @Autowired lateinit var jdbc: JdbcClient
    @Autowired lateinit var battleStats: MutableBattleStatsProvider

    @Test
    fun `handler gate blocks legacy reward handlers even with every servlet filter disabled`() {
        val accountId = seedPlayer()
        val before = rewardFootprint(accountId)

        listOf(
            "/api/v1/battles/cycles",
            "/api/v1/battles/cycl%65s",
            "/api/v1/battles/chapters/1/auto-run",
            "/api/v1/battles/chapters/1/auto-r%75n",
            "/api/v%31/battles/cycles",
        ).forEach { path ->
            val result = mvc.perform(
                MockMvcRequestBuilders.post(URI.create(path))
                    .header("Origin", "http://localhost:5173")
                    .header("Idempotency-Key", UUID.randomUUID())
                    .header("X-Game-Session-Id", UUID.randomUUID())
                    .contentType(MediaType.APPLICATION_JSON)
                    .accept(MediaType.APPLICATION_JSON)
                    .content("""{"stageId":"stage.01-01"}""")
                    .sessionAttr("accountId", accountId),
            ).andReturn()

            assertEquals(
                403,
                result.response.status,
                "expected the handler gate to block $path but got ${result.response.status}: ${result.response.contentAsString}",
            )
            assertTrue(
                result.response.contentAsString.contains("BATTLE_COMPATIBILITY_API_DISABLED"),
                "unexpected body for $path: ${result.response.contentAsString}",
            )
            assertEquals(before, rewardFootprint(accountId), "reward state changed after $path")
        }
    }

    private fun seedPlayer(): UUID {
        val signup = mvc.perform(
            MockMvcRequestBuilders.post("/api/v1/auth/signup")
                .header("Origin", "http://localhost:5173")
                .header("Idempotency-Key", UUID.randomUUID())
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    mapper.writeValueAsString(
                        mapOf(
                            "email" to "handler-gate-${UUID.randomUUID()}@test.local",
                            "password" to "password123",
                            "nickname" to "handler-gate",
                        ),
                    ),
                ),
        ).andReturn()
        val accountId = UUID.fromString(mapper.readTree(signup.response.contentAsString).at("/data/accountId").asText())
        mvc.perform(
            MockMvcRequestBuilders.post("/api/v1/material-preference")
                .header("Origin", "http://localhost:5173")
                .header("Idempotency-Key", UUID.randomUUID())
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{"materialType":"POTATO"}""")
                .sessionAttr("accountId", accountId),
        ).andReturn()
        battleStats.set(accountId, FighterStats(1_000_000, 1_000_000, 1_000_000))
        return accountId
    }

    private fun rewardFootprint(accountId: UUID): List<Long> = listOf(
        "select count(*) from inventory_instance where account_id=:account",
        "select coalesce(max(rice),0) from character where account_id=:account",
        "select coalesce(max(experience),0) from character where account_id=:account",
        "select count(*) from stage_progress where account_id=:account and first_cleared_at is not null",
        "select count(*) from battle_command_record where account_id=:account",
    ).map { jdbc.sql(it).param("account", accountId).query(Long::class.java).single() }

    @TestConfiguration
    class BattleStatsTestConfiguration {
        @Bean
        @Primary
        fun mutableBattleStatsProvider(): MutableBattleStatsProvider = MutableBattleStatsProvider()
    }

    companion object {
        private val databaseConnection = PostgresTestDatabase.schema("legacy_handler_gate")

        @DynamicPropertySource
        @JvmStatic
        fun database(registry: DynamicPropertyRegistry) {
            databaseConnection.register(registry)
            registry.add("spring.session.store-type") { "none" }
            registry.add("hanjjak.balance.active-version") { "progression-rebalance-v1" }
        }
    }
}
