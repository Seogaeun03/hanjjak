package com.hanjjak.gameapi

import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.core.io.support.PathMatchingResourcePatternResolver

class FlywayMigrationVersionTest {
    @Test
    fun `migration versions are unique on the runtime classpath`() {
        val migrationPattern = Regex("^V([^_]+)__.+\\.sql$")
        val duplicates = PathMatchingResourcePatternResolver()
            .getResources("classpath*:db/migration/V*__*.sql")
            .mapNotNull { resource ->
                val filename = resource.filename ?: return@mapNotNull null
                migrationPattern.matchEntire(filename)?.groupValues?.get(1)?.let { version -> version to filename }
            }
            .groupBy({ it.first }, { it.second })
            .filterValues { filenames -> filenames.size > 1 }

        assertTrue(duplicates.isEmpty(), "Duplicate Flyway migration versions: $duplicates")
    }

    @Test
    fun `deployed market and chat migrations stay immutable`() {
        val expectedHashes = mapOf(
            "V43__market_one_rice_price_limits.sql" to "146854b3e4289e72134a0007fecf4767eab0ec089db23db5bf444a5b9dc12c97",
            "V44__chat_bans.sql" to "57e241757f3f716b3142c549e320b552f61d1c573f1eea59743eb2468687574f",
        )
        val migrations = PathMatchingResourcePatternResolver()
            .getResources("classpath*:db/migration/V*__*.sql")
            .associateBy { it.filename }

        expectedHashes.forEach { (filename, expectedHash) ->
            val resource = migrations[filename]
            assertTrue(resource != null, "Deployed Flyway migration is missing: $filename")
            val normalizedSql = resource!!.inputStream.bufferedReader(StandardCharsets.UTF_8).use { it.readText() }
                .replace("\r\n", "\n")
                .replace("\r", "\n")
            val actualHash = MessageDigest.getInstance("SHA-256")
                .digest(normalizedSql.toByteArray(StandardCharsets.UTF_8))
                .joinToString("") { byte -> "%02x".format(byte) }

            assertEquals(expectedHash, actualHash, "Deployed Flyway migration changed: $filename")
        }
    }

    @Test
    fun `main and raid migration versions stay distinct`() {
        val filenames = PathMatchingResourcePatternResolver()
            .getResources("classpath*:db/migration/V*__*.sql")
            .mapNotNull { it.filename }
            .toSet()

        assertTrue(
            setOf(
                "V53__account_balance_version.sql",
                "V54__first_clear_reward_inbox.sql",
                "V56__daily_seal_raid.sql",
                "V57__raid_battle_handoff.sql",
                "V58__raid_settlement_phases.sql",
            ).all(filenames::contains),
            "Expected main-owned V53/V54 and raid V56/V57/V58 migrations, found: $filenames",
        )
    }

    @Test
    fun `daily seal raid migration reserves version 56`() {
        val migrationPattern = Regex("^V([^_]+)__daily_seal_raid\\.sql$")
        val migration = PathMatchingResourcePatternResolver()
            .getResources("classpath*:db/migration/V*__daily_seal_raid.sql")
            .mapNotNull { resource -> resource.filename?.let { filename -> migrationPattern.matchEntire(filename)?.groupValues?.get(1) } }
        assertTrue(migration.contains("56"), "Expected V56 daily seal raid migration, found: $migration")
    }

    @Test
    fun `raid settlement migration reserves version 58`() {
        val migrationPattern = Regex("^V([^_]+)__raid_settlement_phases\\.sql$")
        val migration = PathMatchingResourcePatternResolver()
            .getResources("classpath*:db/migration/V*__raid_settlement_phases.sql")
            .mapNotNull { resource -> resource.filename?.let { filename -> migrationPattern.matchEntire(filename)?.groupValues?.get(1) } }
        assertTrue(migration.contains("58"), "Expected V58 raid settlement migration, found: $migration")
    }

    @Test
    fun `raid battle handoff migration reserves version 57`() {
        val migrationPattern = Regex("^V([^_]+)__raid_battle_handoff\\.sql$")
        val migration = PathMatchingResourcePatternResolver()
            .getResources("classpath*:db/migration/V*__raid_battle_handoff.sql")
            .mapNotNull { resource -> resource.filename?.let { filename -> migrationPattern.matchEntire(filename)?.groupValues?.get(1) } }

        assertTrue(migration.contains("57"), "Expected V57 raid battle handoff migration, found: $migration")
    }

    /**
     * 돌아갈 판은 보스 판(X-10)도 될 수 있어서 V69 의 반복 판 제약보다 판 번호 자리가 넓다.
     * 반복 판은 BattleModeService 가 1..9 로 막는다. 둘을 "같게 맞추는" 수정이 이 차이를 지운다.
     */
    @Test
    fun `battle retry target migration accepts boss stages unlike the repeat target`() {
        val sql = PathMatchingResourcePatternResolver()
            .getResource("classpath:db/migration/V75__battle_retry_target.sql")
            .inputStream.bufferedReader().use { it.readText() }

        assertTrue(sql.contains("^stage\\.(0[1-9]|10)-(0[1-9]|10)$"))
    }

    @Test
    fun `battle repeat target migration expands the persisted chapter range`() {
        val migration = PathMatchingResourcePatternResolver()
            .getResource("classpath:db/migration/V69__battle_repeat_target_chapters_5_10.sql")
        val sql = migration.inputStream.bufferedReader().use { it.readText() }

        assertTrue(sql.contains("drop constraint account_runtime_state_repeat_stage_format"))
        assertTrue(sql.contains("^stage\\.(0[1-9]|10)-(0[1-9])$"))
    }
}
