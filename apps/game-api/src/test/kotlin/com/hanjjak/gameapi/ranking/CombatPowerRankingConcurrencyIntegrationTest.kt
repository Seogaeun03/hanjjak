package com.hanjjak.gameapi.ranking

import com.hanjjak.account.application.AuthenticationService
import com.hanjjak.account.application.MaterialPreferenceService
import com.hanjjak.account.domain.MaterialType
import com.hanjjak.gameapi.GameApiIntegrationTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@GameApiIntegrationTest
class CombatPowerRankingConcurrencyIntegrationTest {
    @Autowired private lateinit var authentication: AuthenticationService
    @Autowired private lateinit var preferences: MaterialPreferenceService
    @Autowired private lateinit var rankings: CombatPowerRankingService

    @Test
    fun `concurrent ranking reads do not fail while refreshing the shared board`() {
        val accounts = MaterialType.entries.mapIndexed { index, material ->
            val signup = authentication.signup(
                "ranking-concurrent-$index-${UUID.randomUUID()}@example.com",
                "password123",
                "동시랭커$index",
            )
            preferences.select(signup.account.id, UUID.randomUUID(), material)
            signup.account.id
        }
        val workers = 8
        val executor = Executors.newFixedThreadPool(workers)

        try {
            repeat(3) {
                val ready = CountDownLatch(workers)
                val start = CountDownLatch(1)
                val results = (0 until workers).map { index ->
                    executor.submit<CombatPowerRankingView> {
                        ready.countDown()
                        check(start.await(10, TimeUnit.SECONDS)) { "ranking workers did not start together" }
                        rankings.snapshot(accounts[index % accounts.size])
                    }
                }
                check(ready.await(10, TimeUnit.SECONDS)) { "ranking workers were not ready" }
                start.countDown()

                results.forEach { future ->
                    assertEquals(accounts.size, future.get(30, TimeUnit.SECONDS).overallTop.size)
                }
            }
        } finally {
            executor.shutdownNow()
        }
    }
}
