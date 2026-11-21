package com.hanjjak.gameapi

import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.cosmetics.application.CosmeticGachaService
import com.hanjjak.cosmetics.application.CosmeticsCommandService
import com.hanjjak.cosmetics.application.CosmeticsService
import com.hanjjak.cosmetics.domain.CollectionSnapshot
import com.hanjjak.cosmetics.domain.RegistrationMode
import com.hanjjak.gameapi.character.CharacterStatsService
import com.hanjjak.progression.application.ProgressionRewardService
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.MediaType
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.sql.DataSource

/**
 * 조회가 보상·뽑기 트랜잭션의 행 잠금 뒤에서 기다리지 않는지, 그리고 잠금을 남겨 둔 변경
 * 경로가 동시에 돌아도 잔액·티켓·등록 수량·state_version을 잃지 않는지 실제 PostgreSQL에서 본다.
 */
@GameApiIntegrationTest
class ProgressionCosmeticsReadLockIntegrationTest {
    @Autowired lateinit var jdbc: JdbcClient
    @Autowired lateinit var dataSource: DataSource
    @Autowired lateinit var mvc: MockMvc
    @Autowired lateinit var mapper: ObjectMapper
    @Autowired lateinit var progression: ProgressionRewardService
    @Autowired lateinit var cosmetics: CosmeticsService
    @Autowired lateinit var gacha: CosmeticGachaService
    @Autowired lateinit var commands: CosmeticsCommandService
    @Autowired lateinit var stats: CharacterStatsService

    private val bannerId = "cosmetic-banner-01"

    @Test
    fun `read paths finish while another transaction holds the account character and wallet rows`() {
        val account = account(rice = 100_000, tickets = 3)
        val reads = linkedMapOf<String, Callable<Any>>(
            "progression.current" to Callable { progression.current(account) },
            "cosmetics.collection" to Callable { cosmetics.versionedCollection(account) },
            "cosmetics.catalog" to Callable { cosmetics.catalog(account) },
            "cosmetics.snapshotForCombat" to Callable { cosmetics.snapshotForCombat(account) },
            "gacha.banners" to Callable { gacha.banners(account) },
            "gacha.detail" to Callable { gacha.detail(account, bannerId) },
            "character.snapshot" to Callable { stats.snapshot(account) },
        )
        val readers = Executors.newFixedThreadPool(reads.size)

        dataSource.connection.use { holder ->
            holder.autoCommit = false
            lockRow(holder, "select id from account where id=? for update", account)
            lockRow(
                holder,
                "select c.account_id from character c join wallet_balance w on w.account_id=c.account_id where c.account_id=? for update",
                account,
            )
            try {
                // 잠금을 든 채로 조회를 모두 띄운다. FOR UPDATE가 남아 있으면 여기서 timeout 난다.
                val released = CountDownLatch(1)
                val futures = reads.mapValues { (_, read) ->
                    readers.submit(Callable { released.await(READ_TIMEOUT_SECONDS, TimeUnit.SECONDS); read.call() })
                }
                released.countDown()
                futures.forEach { (name, future) ->
                    runCatching { future.get(READ_TIMEOUT_SECONDS, TimeUnit.SECONDS) }
                        .onFailure { error -> throw AssertionError("$name did not finish while the rows were locked", error) }
                }
            } finally {
                readers.shutdownNow()
                holder.rollback()
            }
        }

        // 조회는 아무것도 바꾸지 않는다.
        assertEquals(100_000L, riceBalance(account))
        assertEquals(3L, ticketBalance(account))
    }

    @Test
    fun `concurrent rewards draws and registrations keep balances tickets quantities and state versions`() {
        val account = account(rice = 1_000_000, tickets = TICKETS.toLong())
        jdbc.sql("insert into cosmetic_collection_state(account_id,cosmetic_id,registered_quantity,unregistered_quantity,reserved_quantity) values (:account,'cosmetic-001',1,:spare,0)")
            .param("account", account).param("spare", REGISTRATIONS).update()
        val riceBefore = riceBalance(account)
        val experienceBefore = experience(account)
        val stateVersionBefore = stateVersion(account)

        val workers = Executors.newFixedThreadPool(WORKERS)
        val start = CountDownLatch(1)
        val grants = (1..REWARDS).map { index ->
            workers.submit(Callable { start.await(); progression.grantEnemy(account, UUID.randomUUID(), "stage.01-01", index % 20 + 1, boss = false) })
        }
        val draws = (1..DRAWS).map {
            workers.submit(Callable {
                start.await()
                val key = UUID.randomUUID()
                commands.executeVersioned(account, key, "draw:$bannerId:1", CosmeticGachaService.DrawResponse::class.java) {
                    gacha.draw(account, bannerId, 1, key)
                }
            })
        }
        val registrations = (1..REGISTRATIONS).map {
            workers.submit(Callable {
                start.await()
                commands.executeVersioned(account, UUID.randomUUID(), "register:cosmetic-001:ONE", CollectionSnapshot::class.java) {
                    cosmetics.register(account, "cosmetic-001", RegistrationMode.ONE)
                }
            })
        }
        start.countDown()
        val rewardResults = grants.map { it.get(COMMAND_TIMEOUT_SECONDS, TimeUnit.SECONDS) }
        val drawResults = draws.map { it.get(COMMAND_TIMEOUT_SECONDS, TimeUnit.SECONDS) }
        val registrationResults = registrations.map { it.get(COMMAND_TIMEOUT_SECONDS, TimeUnit.SECONDS) }
        workers.shutdown()

        // 보상: 경험치와 쌀이 한 번씩만 반영된다.
        val grantedRice = rewardResults.sumOf { it.result.riceGained }
        val grantedExperience = rewardResults.sumOf { it.result.experienceGained }
        assertEquals(REWARDS, rewardResults.count { !it.replayed })
        assertTrue(grantedExperience > 0)
        assertEquals(experienceBefore + grantedExperience, experience(account))
        assertEquals(REWARDS.toLong(), jdbc.sql("select count(*) from progression_reward_command where account_id=:account")
            .param("account", account).query(Long::class.java).single())

        // 뽑기: 티켓을 먼저 쓰고 남은 횟수만 쌀로 결제한다.
        val ticketSpend = drawResults.sumOf { it.data.ticketCost }
        val riceSpend = drawResults.sumOf { it.data.riceCost }
        assertEquals(TICKETS.toLong(), ticketSpend)
        assertEquals((DRAWS - TICKETS) * SINGLE_RICE_COST, riceSpend)
        assertEquals(0L, ticketBalance(account))
        assertEquals(riceBefore + grantedRice - riceSpend, riceBalance(account))
        assertEquals(DRAWS.toLong(), jdbc.sql("select total_successful_draws from cosmetic_banner_progress where account_id=:account and banner_id=:banner")
            .param("account", account).param("banner", bannerId).query(Long::class.java).single())

        // 등록: 미등록 수량이 등록 수량으로만 옮겨 가고 총량은 뽑은 만큼만 늘어난다.
        assertEquals(REGISTRATIONS, registrationResults.size)
        assertEquals((1 + REGISTRATIONS).toLong(), jdbc.sql("select registered_quantity from cosmetic_collection_state where account_id=:account and cosmetic_id='cosmetic-001'")
            .param("account", account).query(Long::class.java).single())
        assertEquals((1 + REGISTRATIONS + DRAWS).toLong(), jdbc.sql("select sum(registered_quantity+unregistered_quantity) from cosmetic_collection_state where account_id=:account")
            .param("account", account).query(Long::class.java).single())

        // 음수 잔액·수량이 남지 않는다.
        assertEquals(0L, jdbc.sql("select count(*) from cosmetic_collection_state where account_id=:account and (registered_quantity<0 or unregistered_quantity<0 or reserved_quantity<0)")
            .param("account", account).query(Long::class.java).single())
        assertTrue(riceBalance(account) >= 0)
        assertTrue(ticketBalance(account) >= 0)

        // state_version: 치장 명령마다 새 값이 하나씩 나오고 겹치지 않는다.
        val issued = drawResults.map { it.stateVersion } + registrationResults.map { it.stateVersion }
        assertEquals(issued.size, issued.distinct().size)
        assertTrue(stateVersion(account) >= stateVersionBefore + issued.size)
        assertTrue(issued.max() <= stateVersion(account))
    }

    private fun lockRow(connection: java.sql.Connection, sql: String, account: UUID) {
        connection.prepareStatement(sql).use { statement ->
            statement.setObject(1, account)
            statement.executeQuery().use { rows -> assertTrue(rows.next(), "fixture row missing for $sql") }
        }
    }

    private fun account(rice: Long, tickets: Long): UUID {
        val account = signup()
        jdbc.sql("update character set cosmetics_unlocked=true,cosmetic_ticket_balance=:tickets where account_id=:account")
            .param("account", account).param("tickets", tickets).update()
        jdbc.sql("update wallet_balance set balance=:rice where account_id=:account")
            .param("account", account).param("rice", rice).update()
        return account
    }

    private fun signup(): UUID {
        val unique = UUID.randomUUID()
        val response = mvc.perform(
            post("/api/v1/auth/signup")
                .header("Idempotency-Key", UUID.randomUUID().toString())
                .header("Origin", "http://localhost:5173")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(mapOf("email" to "lock-$unique@test.local", "password" to "password123", "nickname" to "lock-${unique.toString().take(8)}"))),
        ).andExpect(status().isOk).andReturn().response.contentAsString
        return UUID.fromString(mapper.readTree(response).at("/data/accountId").asText())
    }

    private fun riceBalance(account: UUID): Long = jdbc.sql("select balance from wallet_balance where account_id=:account")
        .param("account", account).query(Long::class.java).single()

    private fun ticketBalance(account: UUID): Long = jdbc.sql("select cosmetic_ticket_balance from character where account_id=:account")
        .param("account", account).query(Long::class.java).single()

    private fun experience(account: UUID): Long = jdbc.sql("select experience from character where account_id=:account")
        .param("account", account).query(Long::class.java).single()

    private fun stateVersion(account: UUID): Long = jdbc.sql("select state_version from account where id=:account")
        .param("account", account).query(Long::class.java).single()

    private companion object {
        const val READ_TIMEOUT_SECONDS = 5L
        const val COMMAND_TIMEOUT_SECONDS = 120L
        const val WORKERS = 16
        const val REWARDS = 12
        const val DRAWS = 12
        const val TICKETS = 5
        const val REGISTRATIONS = 8
        const val SINGLE_RICE_COST = 5_000L
    }
}
