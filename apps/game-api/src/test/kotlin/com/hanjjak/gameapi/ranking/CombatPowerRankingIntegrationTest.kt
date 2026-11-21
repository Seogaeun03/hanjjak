package com.hanjjak.gameapi.ranking

import com.hanjjak.account.application.AuthenticationService
import com.hanjjak.account.application.MaterialPreferenceService
import com.hanjjak.account.domain.MaterialType
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.transaction.annotation.Transactional
import java.util.UUID

@com.hanjjak.gameapi.GameApiIntegrationTest
@Transactional
class CombatPowerRankingIntegrationTest {
    @Autowired private lateinit var authentication: AuthenticationService
    @Autowired private lateinit var preferences: MaterialPreferenceService
    @Autowired private lateinit var rankings: CombatPowerRankingService
    @Autowired private lateinit var jdbc: JdbcClient

    @Test
    fun `ranking contains selected specialization and server calculated power`() {
        val signup = authentication.signup("ranking-${UUID.randomUUID()}@example.com", "password123", "옥수수랭커")
        preferences.select(signup.account.id, UUID.randomUUID(), MaterialType.CORN)

        val view = rankings.snapshot(signup.account.id)
        val corn = view.specializations.first { it.materialType == MaterialType.CORN }

        assertEquals("옥수수 전문", corn.displayName)
        assertEquals("combat-power-v3", view.formulaVersion)
        assertNotNull(view.myEntry)
        assertEquals("옥수수랭커", view.myEntry!!.nickname)
        assertEquals(1, view.myEntry!!.level)
        assertEquals("옥수수 전문", view.myEntry!!.displayName)
        assertEquals(RankingAppearance(null, null, null, null, null, null, null, null), view.myEntry!!.appearance)
        assertEquals(1, view.myEntry!!.overallRank)
        assertEquals("옥수수랭커", view.overallTop.first().nickname)
        assertEquals(view.sourceStateVersion, signup.account.stateVersion + 1)
    }

    @Test
    fun `an unlimited snapshot keeps every player past the tenth place`() {
        val target = authentication.signup("ranking-target-${UUID.randomUUID()}@example.com", "password123", "통합순위대상")
        preferences.select(target.account.id, UUID.randomUUID(), MaterialType.CORN)
        repeat(10) { index ->
            val competitor = authentication.signup("ranking-top-$index-${UUID.randomUUID()}@example.com", "password123", "상위랭커$index")
            preferences.select(competitor.account.id, UUID.randomUUID(), MaterialType.entries[index % MaterialType.entries.size])
            jdbc.sql("update character set level=2 where account_id=:account")
                .param("account", competitor.account.id)
                .update()
        }

        val view = rankings.snapshot(target.account.id)

        assertTrue(view.myEntry!!.overallRank > 10)
        assertTrue(view.overallTop.size >= 11)
        // 열 명에서 끊기지 않아야 보드가 맨 밑까지 스크롤된다.
        assertTrue(view.overallTop.any { it.nickname == "통합순위대상" })
    }

    @Test
    fun `a limited snapshot still carries my own entry`() {
        val target = authentication.signup("ranking-limited-${UUID.randomUUID()}@example.com", "password123", "한도순위대상")
        preferences.select(target.account.id, UUID.randomUUID(), MaterialType.CORN)
        repeat(3) { index ->
            val competitor = authentication.signup("ranking-cap-$index-${UUID.randomUUID()}@example.com", "password123", "한도랭커$index")
            preferences.select(competitor.account.id, UUID.randomUUID(), MaterialType.CORN)
            jdbc.sql("update character set level=2 where account_id=:account")
                .param("account", competitor.account.id)
                .update()
        }

        val view = rankings.snapshot(target.account.id, 1)

        assertEquals("한도순위대상", view.myEntry!!.nickname)
        assertTrue(view.overallTop.size <= 3)
    }

    @Test
    fun `stage order follows the highest cleared stage and then the earlier clear`() {
        val ahead = signupCleared("계단위", MaterialType.POTATO, "stage.02-03", "2026-09-01T00:00:00Z")
        signupCleared("먼저깬사람", MaterialType.POTATO, "stage.01-07", "2026-09-01T00:00:00Z")
        signupCleared("나중깬사람", MaterialType.POTATO, "stage.01-07", "2026-09-02T00:00:00Z")
        val none = authentication.signup("ranking-stage-none-${UUID.randomUUID()}@example.com", "password123", "아직못깬사람")
        preferences.select(none.account.id, UUID.randomUUID(), MaterialType.POTATO)

        val view = rankings.snapshot(ahead)
        val mine = { nickname: String -> view.overallTop.first { it.nickname == nickname } }

        assertEquals("stage.02-03", mine("계단위").highestClearedStageId)
        assertTrue(mine("계단위").stageOverallRank < mine("먼저깬사람").stageOverallRank)
        // 같은 칸에 섰으면 먼저 깬 사람이 위다. 그 시각이 곧 다음 칸을 연 시각이다.
        assertTrue(mine("먼저깬사람").stageOverallRank < mine("나중깬사람").stageOverallRank)
        // 한 판도 못 깬 사람은 기록 없이 맨 아래에 선다.
        assertEquals(null, mine("아직못깬사람").highestClearedStageId)
        assertTrue(mine("아직못깬사람").stageOverallRank > mine("나중깬사람").stageOverallRank)
    }

    @Test
    fun `deleted account is excluded from ranking`() {
        val deleted = authentication.signup("ranking-deleted-${UUID.randomUUID()}@example.com", "password123", "탈퇴랭커")
        preferences.select(deleted.account.id, UUID.randomUUID(), MaterialType.POTATO)
        jdbc.sql("update account set deleted_at=now() where id=:account")
            .param("account", deleted.account.id)
            .update()

        val view = rankings.snapshot(deleted.account.id)

        assertEquals(null, view.myEntry)
        assertTrue(view.overallTop.none { it.nickname == "탈퇴랭커" })
        assertTrue(view.specializations.all { ranking -> ranking.entries.none { it.nickname == "탈퇴랭커" } })
    }

    private fun signupCleared(nickname: String, material: MaterialType, stageId: String, clearedAt: String): UUID {
        val signup = authentication.signup("ranking-stage-${UUID.randomUUID()}@example.com", "password123", nickname)
        preferences.select(signup.account.id, UUID.randomUUID(), material)
        // 아래 칸도 함께 깬 사람이라야 현실에 맞는다. 순서를 가르는 건 가장 높은 칸뿐이다.
        jdbc.sql(
            "insert into stage_progress(account_id,stage_id,unlocked,first_cleared_at,highest_clear_count,content_version) " +
                "values (:account,'stage.01-01',true,:at,1,'v1'),(:account,:stage,true,:at,1,'v1') on conflict do nothing",
        ).params(mapOf("account" to signup.account.id, "stage" to stageId, "at" to java.sql.Timestamp.from(java.time.Instant.parse(clearedAt))))
            .update()
        return signup.account.id
    }
}
