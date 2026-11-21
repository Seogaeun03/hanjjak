package com.hanjjak.gameapi

import com.hanjjak.account.application.PasswordResetMailSender
import com.hanjjak.battle.application.BattleStatsProvider
import com.hanjjak.sim.CombatSeedSource
import com.hanjjak.sim.FighterStats
import com.hanjjak.admin.application.AdminGitlabProfile
import com.hanjjak.admin.application.AdminGitlabProvider
import com.hanjjak.gems.application.GemRollSource
import com.hanjjak.skills.application.SkillRollSource
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.context.ApplicationContextInitializer
import org.springframework.context.ConfigurableApplicationContext
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Import
import org.springframework.context.annotation.Primary
import org.springframework.test.context.ContextConfiguration
import org.springframework.test.context.TestContext
import org.springframework.test.context.TestExecutionListeners
import org.springframework.test.context.support.AbstractTestExecutionListener
import org.springframework.test.context.support.TestPropertySourceUtils
import java.net.URI
import java.util.ArrayDeque
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.sql.DriverManager

@Target(AnnotationTarget.CLASS)
@Retention(AnnotationRetention.RUNTIME)
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.MOCK,
    properties = [
        "hanjjak.admin.bootstrap.username=bootstrap-admin",
        "hanjjak.admin.bootstrap.password=change-me-now-123",
        "hanjjak.admin.bootstrap.display-name=테스트 운영자",
        "hanjjak.admin.deployment.commit-sha=test-sha",
        "hanjjak.api-security.authentication-rate-limit.max-requests=10000",
        "hanjjak.api-security.password-reset-rate-limit.max-requests=10000",
        "hanjjak.api-security.mutation-rate-limit.max-requests=10000",
        "hanjjak.admin.authentication-rate-limit.max-requests=10000",
        "hanjjak.api-security.legacy-battle-reward-api-enabled=true",
        "hanjjak.admin.gitlab.enabled=true",
        "hanjjak.admin.gitlab.client-id=gitlab-client",
        "hanjjak.admin.gitlab.client-secret=gitlab-secret",
        "hanjjak.admin.gitlab.authorization-uri=https://gitlab.example.com/oauth/authorize",
        "hanjjak.admin.gitlab.token-uri=https://gitlab.example.com/oauth/token",
        "hanjjak.admin.gitlab.user-uri=https://gitlab.example.com/api/v4/user",
        "hanjjak.admin.gitlab.allowed-usernames=allowed-admin,allowed-link-admin",
        "hanjjak.admin.gitlab.public-base-url=http://localhost:5173",
        "hanjjak.admin.gitlab.success-url=http://localhost:5173/admin/",
        "hanjjak.admin.gitlab.failure-url=http://localhost:5173/admin/",
        "hanjjak.offline-reward.test-all-accounts=false",
        "hanjjak.offline-reward.test-account-ids=",
        "hanjjak.offline-reward.test-reward-multiplier=",
        "hanjjak.offline-reward.test-grace-period-seconds=",
        "hanjjak.offline-reward.test-bucket-seconds=",
        "hanjjak.liveops.enabled=true",
        "hanjjak.liveops.test-window-open=true",
        "hanjjak.offline-reward.test-accrual-cap-seconds=",
        "hanjjak.gem-dungeon.rotation-period-seconds=3600",
        "hanjjak.gem-dungeon.ticket.regen-seconds=3600",
        "hanjjak.gem-dungeon.ticket.max-stock=3",
        "hanjjak.gem-dungeon.ticket.initial-grant=3",
        // 치장 뽑기는 서명 키가 있어야 돈다. 통합 시험 전용 32바이트 키를 고정해 뽑기 경로를 켠다.
        "hanjjak.cosmetics.gacha-hmac-secret=aGFuamphay1pbnRlZ3JhdGlvbi10ZXN0LWdhY2hhLXM=",
        "hanjjak.cosmetics.gacha-hmac-key-id=integration-test-key",
    ],
)
@AutoConfigureMockMvc
@Import(GameApiIntegrationTestConfiguration::class)
@ContextConfiguration(initializers = [GameApiIntegrationTestInitializer::class])
@TestExecutionListeners(
    listeners = [GameApiIntegrationTestListener::class],
    mergeMode = TestExecutionListeners.MergeMode.MERGE_WITH_DEFAULTS,
)
annotation class GameApiIntegrationTest

class GameApiIntegrationTestInitializer : ApplicationContextInitializer<ConfigurableApplicationContext> {
    override fun initialize(applicationContext: ConfigurableApplicationContext) {
        val database = PostgresTestDatabase.workerConnection
        TestPropertySourceUtils.addInlinedPropertiesToEnvironment(
            applicationContext,
            "spring.datasource.url=${database.jdbcUrl}",
            "spring.datasource.username=${database.username}",
            "spring.datasource.password=${database.password}",
        )
    }
}

@TestConfiguration(proxyBeanMethods = false)
class GameApiIntegrationTestConfiguration {
    @Bean
    @Primary
    fun mutableBattleStatsProvider(): MutableBattleStatsProvider = MutableBattleStatsProvider()

    @Bean
    @Primary
    fun recordingPasswordResetMailSender(): RecordingPasswordResetMailSender = RecordingPasswordResetMailSender()

    @Bean
    @Primary
    fun queueSkillRollSource(): QueueSkillRollSource = QueueSkillRollSource()

    @Bean
    @Primary
    fun queueGemRollSource(): QueueGemRollSource = QueueGemRollSource()

    @Bean
    @Primary
    fun testCombatSeedSource(): TestCombatSeedSource = TestCombatSeedSource()

    @Bean
    @Primary
    fun stubAdminGitlabProvider(): StubAdminGitlabProvider = StubAdminGitlabProvider()
}

class GameApiIntegrationTestListener : AbstractTestExecutionListener() {
    override fun beforeTestClass(testContext: TestContext) {
        /*
         * 스프링을 거치지 않고 지운다.
         *
         * 예전에는 testContext.applicationContext 로 DataSource 를 꺼냈는데, 그 한 줄이 컨텍스트를
         * 띄운다. 지우기 전에 뜨는 셈이라 레이드 스케줄러의 초기화가 앞 시험이 남긴 회차를 그대로
         * 보고 돈다. 스케줄러는 제 마감 시각에 회차가 없으면 하나 여는데, 앞 시험이 열어 둔 회차가
         * 아직 남아 있으면 "열린 회차는 하나" 제약에 걸려 컨텍스트가 통째로 못 뜬다. 그러면 그
         * 반에서 끝나지 않고, 뒤따르는 반들이 전부 컨텍스트 실패 한도에 걸려 함께 넘어간다.
         * 한 반이 남긴 회차 하나에 열대여섯 반이 통째로 무너졌다.
         */
        val database = PostgresTestDatabase.workerConnection
        DriverManager.getConnection(database.jdbcUrl, database.username, database.password).use { connection ->
            val tables = connection.prepareStatement(
                """
                select tablename
                from pg_tables
                where schemaname = current_schema()
                  and tablename not in ('flyway_schema_history', 'admin_operator', 'admin_operator_role')
                order by tablename
                """.trimIndent(),
            ).use { statement ->
                statement.executeQuery().use { rows ->
                    buildList {
                        while (rows.next()) add(rows.getString(1))
                    }
                }
            }
            if (tables.isNotEmpty()) {
                val quotedTables = tables.joinToString(",") { table -> "\"${table.replace("\"", "\"\"")}\"" }
                connection.createStatement().use { statement ->
                    statement.execute("truncate table $quotedTables restart identity cascade")
                }
            }
            if ("chat_send_settings" in tables) {
                connection.createStatement().use { statement ->
                    statement.execute("insert into chat_send_settings(config_id,enabled,version,updated_at) values (1,true,0,now())")
                }
            }
        }
    }

    override fun beforeTestMethod(testContext: TestContext) {
        testContext.applicationContext.getBean(MutableBattleStatsProvider::class.java).reset()
        testContext.applicationContext.getBean(StubAdminGitlabProvider::class.java).reset()
        testContext.applicationContext.getBean(RecordingPasswordResetMailSender::class.java).reset()
        testContext.applicationContext.getBean(QueueSkillRollSource::class.java).reset()
        testContext.applicationContext.getBean(QueueGemRollSource::class.java).reset()
        testContext.applicationContext.getBean(TestCombatSeedSource::class.java).reset()
    }

    override fun afterTestMethod(testContext: TestContext) {
        testContext.applicationContext.getBean(MutableBattleStatsProvider::class.java).reset()
        testContext.applicationContext.getBean(StubAdminGitlabProvider::class.java).reset()
        testContext.applicationContext.getBean(RecordingPasswordResetMailSender::class.java).reset()
        testContext.applicationContext.getBean(QueueSkillRollSource::class.java).reset()
        testContext.applicationContext.getBean(QueueGemRollSource::class.java).reset()
        testContext.applicationContext.getBean(TestCombatSeedSource::class.java).reset()
    }
}

class MutableBattleStatsProvider : BattleStatsProvider {
    private val statsByAccount = ConcurrentHashMap<UUID, FighterStats>()

    override fun forAccount(accountId: UUID): FighterStats = statsByAccount[accountId] ?: FighterStats(1, 1, 0)

    fun set(accountId: UUID, stats: FighterStats) {
        statsByAccount[accountId] = stats
    }

    fun reset() = statsByAccount.clear()
}

class RecordingPasswordResetMailSender : PasswordResetMailSender {
    private val links = LinkedBlockingQueue<URI>()

    override fun send(to: String, resetLink: URI) {
        links.put(resetLink)
    }

    fun awaitLink(): URI = requireNotNull(links.poll(5, TimeUnit.SECONDS)) { "Password reset mail was not sent" }

    fun clear() = links.clear()

    fun reset() = clear()
}

class QueueSkillRollSource : SkillRollSource {
    private val queue = ArrayDeque<Int>()
    var draws: Int = 0
        private set

    fun reset() {
        queue.clear()
        draws = 0
    }

    fun enqueue(vararg values: Int) = values.forEach(queue::addLast)

    override fun nextBasisPoint(): Int {
        draws++
        if (queue.isEmpty()) error("TEST_ROLL_QUEUE_EXHAUSTED")
        return queue.removeFirst()
    }
}

/**
 * 보석 추첨을 시험에서 고정한다. 비워 두면 고정 시드 난수로 떨어져 실행마다 같은 값이 나오고,
 * 뽑히는 보석이 중요한 시험만 enqueue 로 지정한다. 예전에는 Idempotency-Key 를 손으로 깎아
 * 같은 일을 했는데, 그게 곧 서버가 막아야 할 취약점이었다.
 */
class QueueGemRollSource : GemRollSource {
    private val queue = ArrayDeque<Int>()
    private var fallback = java.util.Random(20260916L)

    fun reset() {
        queue.clear()
        fallback = java.util.Random(20260916L)
    }

    fun enqueue(vararg values: Int) = values.forEach(queue::addLast)

    override fun nextBasisPoint(): Int = if (queue.isEmpty()) fallback.nextInt(10_000) else queue.removeFirst()
}

/**
 * Combat seeds are drawn server side, so a test that needs a reproducible fight pins one here
 * instead of picking an Idempotency-Key. The default stays genuinely random, which is what every
 * existing test already saw back when the seed came from a random key.
 */
class TestCombatSeedSource : CombatSeedSource {
    private val queue = ArrayDeque<Long>()
    private val secure = java.security.SecureRandom()
    private var pinned: Long? = null

    var draws: Int = 0
        private set

    fun reset() {
        queue.clear()
        pinned = null
        draws = 0
    }

    /** Every later draw returns [seed]. */
    fun pin(seed: Long) {
        pinned = seed
    }

    fun enqueue(vararg values: Long) = values.forEach(queue::addLast)

    override fun nextSeed(): Long {
        draws++
        if (queue.isNotEmpty()) return queue.removeFirst()
        return pinned ?: secure.nextLong()
    }
}

class StubAdminGitlabProvider : AdminGitlabProvider {
    var profile = AdminGitlabProfile(314, "allowed-admin", "Allowed Admin", "active", false)

    override fun exchange(code: String, redirectUri: String, codeVerifier: String) = profile

    fun reset() {
        profile = AdminGitlabProfile(314, "allowed-admin", "Allowed Admin", "active", false)
    }
}
