package com.hanjjak.gameapi

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.sim.FighterStats
import jakarta.servlet.http.Cookie
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.MediaType
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get as getRequest
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch as patchRequest
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import java.util.UUID

@GameApiIntegrationTest
class BattleSessionE2ETest {
    @Autowired lateinit var mvc: MockMvc
    @Autowired lateinit var mapper: ObjectMapper
    @Autowired lateinit var jdbc: JdbcClient
    @Autowired lateinit var battleStats: MutableBattleStatsProvider
    @Autowired lateinit var battleSessions: com.hanjjak.battle.application.BattleSessionService
    @Autowired lateinit var seeds: TestCombatSeedSource

    /** The stored seed drives resume and settlement, and it used to be derived from the Idempotency-Key. */
    @Test
    fun `battle session seed comes from the server source, not the idempotency key`() {
        val client = Client()
        val signup = client.post("/api/v1/auth/signup", mapOf("email" to "session-seed-${UUID.randomUUID()}@test.local", "password" to "password123", "nickname" to "seed-runner"))
        val accountId = UUID.fromString(signup.at("/data/accountId").asText())
        client.post("/api/v1/material-preference", mapOf("materialType" to "POTATO"))
        battleStats.set(accountId, FighterStats(1_000_000, 1_000_000, 1_000_000))
        val gameSessionId = client.post("/api/v1/game-sessions", emptyMap<String, String>()).at("/data/gameSessionId").asText()
        val key = UUID.randomUUID()
        seeds.pin(4_242_424_242L)

        val started = client.post("/api/v1/battles/sessions", mapOf("stageId" to "stage.01-01"), gameSessionId, key = key)

        val stored = jdbc.sql("select seed from battle_session where id=:id")
            .param("id", UUID.fromString(started.at("/data/battleSessionId").asText()))
            .query(Long::class.java).single()
        assertEquals(4_242_424_242L, stored)
        assertNotEquals(key.mostSignificantBits xor key.leastSignificantBits, stored)
    }

    @Test
    fun `battle session completes once then aborts and expires without extra rewards`() {
        val client = Client()
        val signup = client.post("/api/v1/auth/signup", mapOf("email" to "battle-session-${UUID.randomUUID()}@test.local", "password" to "password123", "nickname" to "session-runner"))
        val accountId = UUID.fromString(signup.at("/data/accountId").asText())
        client.post("/api/v1/material-preference", mapOf("materialType" to "POTATO"))
        battleStats.set(accountId, FighterStats(1_000_000, 1_000_000, 1_000_000))
        val gameSessionId = client.post("/api/v1/game-sessions", emptyMap<String, String>()).at("/data/gameSessionId").asText()

        val started = client.post("/api/v1/battles/sessions", mapOf("stageId" to "stage.01-01"), gameSessionId)
        val battleSessionId = started.at("/data/battleSessionId").asText()
        val token = started.at("/data/battleToken").asText()
        assertTrue(started.at("/data/durationMilliseconds").asLong() > 0)
        jdbc.sql("update battle_session set completable_at=now()-interval '1 second' where id=:id")
            .param("id", UUID.fromString(battleSessionId))
            .update()

        val completionKey = UUID.randomUUID()
        val completion = client.post("/api/v1/battles/sessions/$battleSessionId/complete", mapOf("predictedHash" to null, "renderingCheckpoint" to null), gameSessionId, token, completionKey)
        val replay = client.post("/api/v1/battles/sessions/$battleSessionId/complete", mapOf("predictedHash" to null, "renderingCheckpoint" to null), gameSessionId, token, completionKey)
        assertEquals(completion.at("/data"), replay.at("/data"))
        assertEquals("COMPLETED", completion.at("/data/status").asText())
        assertEquals(1, clearCount(accountId, "stage.01-01"))

        client.postExpectConflict("/api/v1/battles/sessions/$battleSessionId/complete", mapOf("predictedHash" to null, "renderingCheckpoint" to null), gameSessionId, token)

        val second = client.post("/api/v1/battles/sessions", mapOf("stageId" to "stage.01-02"), gameSessionId)
        client.post("/api/v1/battles/sessions/${second.at("/data/battleSessionId").asText()}/abort", emptyMap<String, String>(), gameSessionId, second.at("/data/battleToken").asText())
        assertEquals(0, clearCount(accountId, "stage.01-02"))

        val third = client.post("/api/v1/battles/sessions", mapOf("stageId" to "stage.01-02"), gameSessionId)
        val thirdId = third.at("/data/battleSessionId").asText()
        jdbc.sql("update battle_session set last_heartbeat_at=now()-interval '91 seconds' where id=:id")
            .param("id", UUID.fromString(thirdId))
            .update()
        client.postExpectConflict("/api/v1/battles/sessions/$thirdId/heartbeat", emptyMap<String, String>(), gameSessionId, third.at("/data/battleToken").asText())
    }

    @Test
    fun `normal monster settlement persists before cycle completion and replays once`() {
        val client = Client()
        val signup = client.post("/api/v1/auth/signup", mapOf("email" to "monster-settlement-${UUID.randomUUID()}@test.local", "password" to "password123", "nickname" to "settlement-runner"))
        val accountId = UUID.fromString(signup.at("/data/accountId").asText())
        client.post("/api/v1/material-preference", mapOf("materialType" to "POTATO"))
        battleStats.set(accountId, FighterStats(1_000_000, 1_000_000, 1_000_000))
        val gameSessionId = client.post("/api/v1/game-sessions", emptyMap<String, String>()).at("/data/gameSessionId").asText()
        val started = client.post("/api/v1/battles/sessions", mapOf("stageId" to "stage.01-01"), gameSessionId)
        val battleSessionId = started.at("/data/battleSessionId").asText()
        val token = started.at("/data/battleToken").asText()
        val firstDefeat = started.at("/data/renderingTimeline").first { it.at("/type").asText() == "ENEMY_DEFEATED" }
        val enemyIndex = firstDefeat.at("/enemyIndex").asInt()
        val logicalTick = firstDefeat.at("/logicalTick").asInt()
        jdbc.sql("update battle_enemy_settlement set eligible_at=now()-interval '1 second' where battle_session_id=:battle and enemy_index=:enemy")
            .params(mapOf("battle" to UUID.fromString(battleSessionId), "enemy" to enemyIndex))
            .update()

        val key = UUID.randomUUID()
        val request = mapOf(
            "throughEnemyIndex" to enemyIndex,
            "renderingCheckpoint" to mapOf("logicalTick" to logicalTick, "defeatedNormals" to enemyIndex, "playerHp" to started.at("/data/input/player/maxHp").asInt()),
        )
        val settled = client.post("/api/v1/battles/sessions/$battleSessionId/settlements", request, gameSessionId, token, key)
        val replay = client.post("/api/v1/battles/sessions/$battleSessionId/settlements", request, gameSessionId, token, key)

        assertEquals(settled.at("/data"), replay.at("/data"))
        assertEquals(1, settled.at("/data/settlements").size())
        assertTrue(settled.at("/data/settlements/0/progression/experienceGained").asLong() > 0)
        assertTrue(settled.at("/data/settlements/0/progression/riceGained").asLong() > 0)
        assertEquals(1, jdbc.sql("select count(*) from battle_enemy_settlement where battle_session_id=:battle and settled_at is not null").param("battle", UUID.fromString(battleSessionId)).query(Int::class.java).single())
        assertEquals(1, jdbc.sql("select count(*) from progression_reward_command where account_id=:account").param("account", accountId).query(Int::class.java).single())
        assertEquals(0, clearCount(accountId, "stage.01-01"))

        client.post("/api/v1/battles/sessions/$battleSessionId/abort", mapOf("renderingCheckpoint" to request.getValue("renderingCheckpoint")), gameSessionId, token)
        assertEquals(1, jdbc.sql("select count(*) from battle_enemy_settlement where battle_session_id=:battle and settled_at is not null").param("battle", UUID.fromString(battleSessionId)).query(Int::class.java).single())
    }

    /*
     * 자동 진행은 챕터 경계에서 멈추지 않는다. 4-10 을 깨면 5-1 로 넘어간다. 예전에는 40 번째
     * 스테이지가 종점으로 박혀 있어 4-10 에서 제자리 반복으로 남았다. 진행 상한은 이제
     * 그림이 붙은 마지막 스테이지에서 나오므로, 아트 없는 챕터는 자동으로 닫힌 채다.
     */
    @Test
    fun `clearing the chapter four finale advances into chapter five`() {
        val client = Client()
        val signup = client.post("/api/v1/auth/signup", mapOf("email" to "chapter-cross-${UUID.randomUUID()}@test.local", "password" to "password123", "nickname" to "cross-runner"))
        val accountId = UUID.fromString(signup.at("/data/accountId").asText())
        client.post("/api/v1/material-preference", mapOf("materialType" to "POTATO"))
        battleStats.set(accountId, FighterStats(1_000_000, 1_000_000, 1_000_000))
        seedClearsThrough(accountId, "stage.04-09")
        val gameSessionId = client.post("/api/v1/game-sessions", emptyMap<String, String>()).at("/data/gameSessionId").asText()

        val started = client.post("/api/v1/battles/sessions", mapOf("stageId" to "stage.04-10"), gameSessionId)
        jdbc.sql("update battle_session set completable_at=now()-interval '1 second' where id=:id")
            .param("id", UUID.fromString(started.at("/data/battleSessionId").asText()))
            .update()
        val completion = client.post(
            "/api/v1/battles/sessions/${started.at("/data/battleSessionId").asText()}/complete",
            mapOf("predictedHash" to null, "renderingCheckpoint" to null),
            gameSessionId,
            started.at("/data/battleToken").asText(),
        )

        assertTrue(completion.at("/data/battle/success").asBoolean())
        assertEquals("stage.05-01", completion.at("/data/nextStageId").asText())
    }

    /** 그림이 없는 챕터는 진행이 닿지 않는다. 지금은 7-10 이 마지막이라 그대로 머문다. */
    @Test
    fun `progress stops at the last stage that has art`() {
        val client = Client()
        val signup = client.post("/api/v1/auth/signup", mapOf("email" to "chapter-tail-${UUID.randomUUID()}@test.local", "password" to "password123", "nickname" to "tail-runner"))
        val accountId = UUID.fromString(signup.at("/data/accountId").asText())
        client.post("/api/v1/material-preference", mapOf("materialType" to "POTATO"))
        battleStats.set(accountId, FighterStats(1_000_000, 1_000_000, 1_000_000))
        seedClearsThrough(accountId, "stage.15-09")
        val gameSessionId = client.post("/api/v1/game-sessions", emptyMap<String, String>()).at("/data/gameSessionId").asText()

        val started = client.post("/api/v1/battles/sessions", mapOf("stageId" to "stage.15-10"), gameSessionId)
        jdbc.sql("update battle_session set completable_at=now()-interval '1 second' where id=:id")
            .param("id", UUID.fromString(started.at("/data/battleSessionId").asText()))
            .update()
        val completion = client.post(
            "/api/v1/battles/sessions/${started.at("/data/battleSessionId").asText()}/complete",
            mapOf("predictedHash" to null, "renderingCheckpoint" to null),
            gameSessionId,
            started.at("/data/battleToken").asText(),
        )

        assertTrue(completion.at("/data/battle/success").asBoolean())
        assertEquals("stage.15-10", completion.at("/data/nextStageId").asText())
    }

    /** `upTo` 까지를 클리어한 것으로 둔다. 해금 판정이 직전 스테이지 클리어만 보기 때문이다. */
    private fun seedClearsThrough(accountId: UUID, upTo: String) {
        val chapter = upTo.removePrefix("stage.").substringBefore("-").toInt()
        val number = upTo.substringAfter("-").toInt()
        val last = (chapter - 1) * 10 + number
        (1..last).forEach { index ->
            jdbc.sql(
                """insert into stage_progress(account_id,stage_id,unlocked,first_cleared_at,highest_clear_count,content_version)
                   values (:account,:stage,true,now(),1,'progression-rebalance-v1')
                   on conflict (account_id,stage_id) do update set unlocked=true, first_cleared_at=now(), highest_clear_count=1""",
            ).params(
                mapOf(
                    "account" to accountId,
                    "stage" to "stage.%02d-%02d".format((index - 1) / 10 + 1, (index - 1) % 10 + 1),
                ),
            ).update()
        }
    }

    @Test
    fun `repeat target is validated persisted and applied at the cycle boundary`() {
        val client = Client()
        val signup = client.post("/api/v1/auth/signup", mapOf("email" to "repeat-${UUID.randomUUID()}@test.local", "password" to "password123", "nickname" to "repeat-runner"))
        val accountId = UUID.fromString(signup.at("/data/accountId").asText())
        client.post("/api/v1/material-preference", mapOf("materialType" to "POTATO"))
        battleStats.set(accountId, FighterStats(1_000_000, 1_000_000, 1_000_000))
        val gameSessionId = client.post("/api/v1/game-sessions", emptyMap<String, String>()).at("/data/gameSessionId").asText()

        val started = client.post("/api/v1/battles/sessions", mapOf("stageId" to "stage.01-01"), gameSessionId)
        val update = client.patch("/api/v1/battle/repeat-stage", mapOf("stageId" to "stage.01-01"), gameSessionId)
        assertEquals("REPEAT_STAGE", update.at("/data/idleMode").asText())
        assertEquals("stage.01-01", update.at("/data/repeatStageId").asText())
        assertTrue(update.at("/data/appliesAfterCurrentCycle").asBoolean())

        assertEquals("AUTO_PROGRESS", started.at("/data/idleMode").asText())
        assertTrue(started.at("/data/repeatStageId").isNull)
        jdbc.sql("update battle_session set completable_at=now()-interval '1 second' where id=:id")
            .param("id", UUID.fromString(started.at("/data/battleSessionId").asText()))
            .update()
        val completion = client.post(
            "/api/v1/battles/sessions/${started.at("/data/battleSessionId").asText()}/complete",
            mapOf("predictedHash" to null, "renderingCheckpoint" to null),
            gameSessionId,
            started.at("/data/battleToken").asText(),
        )
        assertEquals("stage.01-01", completion.at("/data/nextStageId").asText())
        assertEquals("REPEAT_STAGE", completion.at("/data/idleMode").asText())
        assertEquals("stage.01-01", completion.at("/data/repeatStageId").asText())

        val restored = client.get("/api/v1/runtime-state")
        assertEquals("stage.01-01", restored.at("/data/currentStageId").asText())
        assertEquals("REPEAT_STAGE", restored.at("/data/idleMode").asText())
        assertEquals("stage.01-01", restored.at("/data/repeatStageId").asText())

        val automatic = client.patch("/api/v1/battle/repeat-stage", mapOf("stageId" to null), gameSessionId)
        assertEquals("AUTO_PROGRESS", automatic.at("/data/idleMode").asText())
        assertTrue(automatic.at("/data/repeatStageId").isMissingNode || automatic.at("/data/repeatStageId").isNull)
        assertFalse(automatic.at("/data/appliesAfterCurrentCycle").asBoolean())
    }

    @Test
    fun `chapter five stage can be persisted and repeated`() {
        val client = Client()
        val signup = client.post("/api/v1/auth/signup", mapOf("email" to "repeat-chapter-five-${UUID.randomUUID()}@test.local", "password" to "password123", "nickname" to "repeat-five"))
        val accountId = UUID.fromString(signup.at("/data/accountId").asText())
        client.post("/api/v1/material-preference", mapOf("materialType" to "POTATO"))
        battleStats.set(accountId, FighterStats(1_000_000, 1_000_000, 1_000_000))
        seedClearsThrough(accountId, "stage.04-10")
        val gameSessionId = client.post("/api/v1/game-sessions", emptyMap<String, String>()).at("/data/gameSessionId").asText()

        val stages = client.get("/api/v1/stages").at("/data")
        assertTrue(stages.first { it.at("/stageId").asText() == "stage.05-01" }.at("/repeatEligible").asBoolean())

        val update = client.patch("/api/v1/battle/repeat-stage", mapOf("stageId" to "stage.05-01"), gameSessionId)
        assertEquals("REPEAT_STAGE", update.at("/data/idleMode").asText())
        assertEquals("stage.05-01", update.at("/data/repeatStageId").asText())

        val started = client.post("/api/v1/battles/sessions", mapOf("stageId" to "stage.05-01"), gameSessionId)
        jdbc.sql("update battle_session set completable_at=now()-interval '1 second' where id=:id")
            .param("id", UUID.fromString(started.at("/data/battleSessionId").asText()))
            .update()
        val completion = client.post(
            "/api/v1/battles/sessions/${started.at("/data/battleSessionId").asText()}/complete",
            mapOf("predictedHash" to null, "renderingCheckpoint" to null),
            gameSessionId,
            started.at("/data/battleToken").asText(),
        )

        assertTrue(completion.at("/data/battle/success").asBoolean())
        assertEquals("stage.05-01", completion.at("/data/nextStageId").asText())
        assertEquals("stage.05-01", client.get("/api/v1/runtime-state").at("/data/repeatStageId").asText())
    }

    @Test
    fun `failed battle keeps its stage when a pending repeat target exists`() {
        val client = Client()
        val signup = client.post("/api/v1/auth/signup", mapOf("email" to "failed-retry-${UUID.randomUUID()}@test.local", "password" to "password123", "nickname" to "failed-retry"))
        val accountId = UUID.fromString(signup.at("/data/accountId").asText())
        client.post("/api/v1/material-preference", mapOf("materialType" to "POTATO"))
        val gameSessionId = client.post("/api/v1/game-sessions", emptyMap<String, String>()).at("/data/gameSessionId").asText()
        val started = client.post("/api/v1/battles/sessions", mapOf("stageId" to "stage.01-01"), gameSessionId)

        jdbc.sql(
            """insert into account_runtime_state(account_id,current_stage_id,repeat_stage_id)
               values (:account,'stage.01-01','stage.01-02')
               on conflict(account_id) do update set repeat_stage_id=excluded.repeat_stage_id""",
        ).param("account", accountId).update()
        jdbc.sql("update battle_session set completable_at=now()-interval '1 second' where id=:id")
            .param("id", UUID.fromString(started.at("/data/battleSessionId").asText()))
            .update()

        val completion = client.post(
            "/api/v1/battles/sessions/${started.at("/data/battleSessionId").asText()}/complete",
            mapOf("predictedHash" to null, "renderingCheckpoint" to null),
            gameSessionId,
            started.at("/data/battleToken").asText(),
        )

        assertFalse(completion.at("/data/battle/success").asBoolean())
        assertEquals("stage.01-01", completion.at("/data/nextStageId").asText())
        assertEquals("stage.01-01", client.get("/api/v1/runtime-state").at("/data/currentStageId").asText())
    }

    /** 못 깬 판은 앞 판을 깰 때까지 반복한다. 앞 판마저 못 깨도 더 내려가거나 원래 판으로 튕기지 않는다. */
    @Test
    fun `failed fallback stage repeats until it is cleared`() {
        val client = Client()
        val signup = client.post("/api/v1/auth/signup", mapOf("email" to "stage-fallback-${UUID.randomUUID()}@test.local", "password" to "password123", "nickname" to "fallback-run"))
        val accountId = UUID.fromString(signup.at("/data/accountId").asText())
        client.post("/api/v1/material-preference", mapOf("materialType" to "POTATO"))
        seedClearsThrough(accountId, "stage.01-05")
        val gameSessionId = client.post("/api/v1/game-sessions", emptyMap<String, String>()).at("/data/gameSessionId").asText()

        val failed = completeCycle(client, gameSessionId, "stage.01-06")
        assertFalse(failed.at("/data/battle/success").asBoolean())
        assertEquals("stage.01-05", failed.at("/data/nextStageId").asText())
        assertEquals("stage.01-06", retryStage(accountId))
        assertEquals("stage.01-05", client.get("/api/v1/runtime-state").at("/data/currentStageId").asText())

        val fallback = completeCycle(client, gameSessionId, "stage.01-05")
        assertFalse(fallback.at("/data/battle/success").asBoolean())
        assertEquals("stage.01-05", fallback.at("/data/nextStageId").asText())
        assertEquals("stage.01-06", retryStage(accountId))
        assertEquals("stage.01-05", client.get("/api/v1/runtime-state").at("/data/currentStageId").asText())
    }

    /** 앞 판을 깨도 다음 판으로 건너뛰지 않고 못 깬 판을 다시 붙는다. */
    @Test
    fun `cleared fallback stage hands the next cycle back to the failed stage`() {
        val client = Client()
        val signup = client.post("/api/v1/auth/signup", mapOf("email" to "stage-fallback-clear-${UUID.randomUUID()}@test.local", "password" to "password123", "nickname" to "fallback-clear"))
        val accountId = UUID.fromString(signup.at("/data/accountId").asText())
        client.post("/api/v1/material-preference", mapOf("materialType" to "POTATO"))
        seedClearsThrough(accountId, "stage.01-05")
        val gameSessionId = client.post("/api/v1/game-sessions", emptyMap<String, String>()).at("/data/gameSessionId").asText()

        assertEquals("stage.01-05", completeCycle(client, gameSessionId, "stage.01-06").at("/data/nextStageId").asText())

        battleStats.set(accountId, FighterStats(1_000_000, 1_000_000, 1_000_000))
        val fallback = completeCycle(client, gameSessionId, "stage.01-05")

        assertTrue(fallback.at("/data/battle/success").asBoolean())
        assertEquals("stage.01-06", fallback.at("/data/nextStageId").asText())
        assertNull(retryStage(accountId))
    }

    /** 1-1 은 앞 판이 없으니 제자리에서 다시 붙는다. */
    @Test
    fun `first stage keeps itself when there is no previous stage to fall back to`() {
        val client = Client()
        val signup = client.post("/api/v1/auth/signup", mapOf("email" to "stage-fallback-first-${UUID.randomUUID()}@test.local", "password" to "password123", "nickname" to "fallback-first"))
        val accountId = UUID.fromString(signup.at("/data/accountId").asText())
        client.post("/api/v1/material-preference", mapOf("materialType" to "POTATO"))
        val gameSessionId = client.post("/api/v1/game-sessions", emptyMap<String, String>()).at("/data/gameSessionId").asText()

        val failed = completeCycle(client, gameSessionId, "stage.01-01")

        assertFalse(failed.at("/data/battle/success").asBoolean())
        assertEquals("stage.01-01", failed.at("/data/nextStageId").asText())
        assertNull(retryStage(accountId))
    }

    /** 보스 판(X-10)은 실패하면 경험치가 0이라 제자리 반복이 곧 잠김이었다. 이제 앞 판에서 벌고 온다. */
    @Test
    fun `boss stage failure falls back to the previous stage of the same chapter`() {
        val client = Client()
        val signup = client.post("/api/v1/auth/signup", mapOf("email" to "stage-fallback-boss-${UUID.randomUUID()}@test.local", "password" to "password123", "nickname" to "fallback-boss"))
        val accountId = UUID.fromString(signup.at("/data/accountId").asText())
        client.post("/api/v1/material-preference", mapOf("materialType" to "POTATO"))
        seedClearsThrough(accountId, "stage.01-09")
        val gameSessionId = client.post("/api/v1/game-sessions", emptyMap<String, String>()).at("/data/gameSessionId").asText()

        val failed = completeCycle(client, gameSessionId, "stage.01-10")

        assertFalse(failed.at("/data/battle/success").asBoolean())
        assertEquals("stage.01-09", failed.at("/data/nextStageId").asText())
        assertEquals("stage.01-10", retryStage(accountId))
        assertEquals("stage.01-09", client.get("/api/v1/runtime-state").at("/data/currentStageId").asText())
    }

    /** 챕터 첫 판을 못 깨면 앞 챕터 마지막 판으로 넘어가고, 그 판을 깰 때까지 반복한다. */
    @Test
    fun `chapter opener failure repeats the previous chapter ending until it clears`() {
        val client = Client()
        val signup = client.post("/api/v1/auth/signup", mapOf("email" to "stage-fallback-chapter-${UUID.randomUUID()}@test.local", "password" to "password123", "nickname" to "fallback-chapter"))
        val accountId = UUID.fromString(signup.at("/data/accountId").asText())
        client.post("/api/v1/material-preference", mapOf("materialType" to "POTATO"))
        seedClearsThrough(accountId, "stage.04-10")
        val gameSessionId = client.post("/api/v1/game-sessions", emptyMap<String, String>()).at("/data/gameSessionId").asText()

        val failed = completeCycle(client, gameSessionId, "stage.05-01")
        assertFalse(failed.at("/data/battle/success").asBoolean())
        assertEquals("stage.04-10", failed.at("/data/nextStageId").asText())
        assertEquals("stage.05-01", retryStage(accountId))

        val fallback = completeCycle(client, gameSessionId, "stage.04-10")
        assertFalse(fallback.at("/data/battle/success").asBoolean())
        assertEquals("stage.04-10", fallback.at("/data/nextStageId").asText())
        assertEquals("stage.05-01", retryStage(accountId))
        assertEquals("stage.04-10", client.get("/api/v1/runtime-state").at("/data/currentStageId").asText())
    }

    /** 돌아갈 판을 유저가 직접 먼저 골라 또 지면 규칙대로 앞 판으로 내려가고 돌아갈 판은 그대로다. */
    @Test
    fun `retrying the failed stage by hand and losing falls back again`() {
        val client = Client()
        val signup = client.post("/api/v1/auth/signup", mapOf("email" to "stage-fallback-manual-${UUID.randomUUID()}@test.local", "password" to "password123", "nickname" to "fallback-manual"))
        val accountId = UUID.fromString(signup.at("/data/accountId").asText())
        client.post("/api/v1/material-preference", mapOf("materialType" to "POTATO"))
        seedClearsThrough(accountId, "stage.01-05")
        val gameSessionId = client.post("/api/v1/game-sessions", emptyMap<String, String>()).at("/data/gameSessionId").asText()
        assertEquals("stage.01-05", completeCycle(client, gameSessionId, "stage.01-06").at("/data/nextStageId").asText())

        val manual = completeCycle(client, gameSessionId, "stage.01-06")

        assertFalse(manual.at("/data/battle/success").asBoolean())
        assertEquals("stage.01-05", manual.at("/data/nextStageId").asText())
        assertEquals("stage.01-06", retryStage(accountId))
        assertEquals("stage.01-05", client.get("/api/v1/runtime-state").at("/data/currentStageId").asText())
    }

    /** 돌아갈 판이 아직 못 들어가는 판이면 그 판으로 보내지 않는다. 잠긴 판이 현재 판이 되면 전투를 열 수 없다. */
    @Test
    fun `pending fallback target that cannot be entered leaves the stage alone`() {
        val client = Client()
        val signup = client.post("/api/v1/auth/signup", mapOf("email" to "stage-fallback-locked-${UUID.randomUUID()}@test.local", "password" to "password123", "nickname" to "fallback-locked"))
        val accountId = UUID.fromString(signup.at("/data/accountId").asText())
        client.post("/api/v1/material-preference", mapOf("materialType" to "POTATO"))
        val gameSessionId = client.post("/api/v1/game-sessions", emptyMap<String, String>()).at("/data/gameSessionId").asText()
        jdbc.sql(
            """insert into account_runtime_state(account_id,current_stage_id,retry_stage_id)
               values (:account,'stage.01-01','stage.09-09')
               on conflict(account_id) do update set retry_stage_id=excluded.retry_stage_id""",
        ).param("account", accountId).update()

        val failed = completeCycle(client, gameSessionId, "stage.01-01")

        assertFalse(failed.at("/data/battle/success").asBoolean())
        assertEquals("stage.01-01", failed.at("/data/nextStageId").asText())
        assertNull(retryStage(accountId))
        assertEquals("stage.01-01", client.get("/api/v1/runtime-state").at("/data/currentStageId").asText())
    }

    /** 유저가 직접 고른 반복이 우선하되, 돌아갈 판을 먹어서는 안 된다. 먹으면 두 칸 미끄러진다. */
    @Test
    fun `user chosen repeat target takes priority without consuming the pending fallback`() {
        val client = Client()
        val signup = client.post("/api/v1/auth/signup", mapOf("email" to "stage-fallback-repeat-${UUID.randomUUID()}@test.local", "password" to "password123", "nickname" to "fallback-repeat"))
        val accountId = UUID.fromString(signup.at("/data/accountId").asText())
        client.post("/api/v1/material-preference", mapOf("materialType" to "POTATO"))
        seedClearsThrough(accountId, "stage.01-05")
        val gameSessionId = client.post("/api/v1/game-sessions", emptyMap<String, String>()).at("/data/gameSessionId").asText()
        assertEquals("stage.01-05", completeCycle(client, gameSessionId, "stage.01-06").at("/data/nextStageId").asText())

        client.patch("/api/v1/battle/repeat-stage", mapOf("stageId" to "stage.01-05"), gameSessionId)
        battleStats.set(accountId, FighterStats(1_000_000, 1_000_000, 1_000_000))
        val repeated = completeCycle(client, gameSessionId, "stage.01-05")

        assertTrue(repeated.at("/data/battle/success").asBoolean())
        assertEquals("stage.01-05", repeated.at("/data/nextStageId").asText())
        assertEquals("stage.01-06", retryStage(accountId))

        // 반복을 끄면 먹히지 않고 남아 있던 돌아갈 판으로 이어서 재도전한다.
        client.patch("/api/v1/battle/repeat-stage", mapOf("stageId" to null), gameSessionId)
        assertEquals("stage.01-06", completeCycle(client, gameSessionId, "stage.01-05").at("/data/nextStageId").asText())
    }

    /** 실패 완료를 같은 키로 다시 불러도 돌아갈 판이 지워지거나 한 칸 더 내려가지 않는다. */
    @Test
    fun `replaying a failed completion keeps the recorded fallback target`() {
        val client = Client()
        val signup = client.post("/api/v1/auth/signup", mapOf("email" to "stage-fallback-replay-${UUID.randomUUID()}@test.local", "password" to "password123", "nickname" to "fallback-replay"))
        val accountId = UUID.fromString(signup.at("/data/accountId").asText())
        client.post("/api/v1/material-preference", mapOf("materialType" to "POTATO"))
        seedClearsThrough(accountId, "stage.01-05")
        val gameSessionId = client.post("/api/v1/game-sessions", emptyMap<String, String>()).at("/data/gameSessionId").asText()
        val started = client.post("/api/v1/battles/sessions", mapOf("stageId" to "stage.01-06"), gameSessionId)
        val battleSessionId = started.at("/data/battleSessionId").asText()
        jdbc.sql("update battle_session set completable_at=now()-interval '1 second' where id=:id")
            .param("id", UUID.fromString(battleSessionId))
            .update()
        val key = UUID.randomUUID()
        val body = mapOf("predictedHash" to null, "renderingCheckpoint" to null)
        val token = started.at("/data/battleToken").asText()

        val failed = client.post("/api/v1/battles/sessions/$battleSessionId/complete", body, gameSessionId, token, key)
        val replay = client.post("/api/v1/battles/sessions/$battleSessionId/complete", body, gameSessionId, token, key)

        assertEquals(failed.at("/data"), replay.at("/data"))
        assertEquals("stage.01-05", replay.at("/data/nextStageId").asText())
        assertEquals("stage.01-06", retryStage(accountId))
        assertEquals("stage.01-05", client.get("/api/v1/runtime-state").at("/data/currentStageId").asText())
    }

    /** 못 깼던 판을 직접 붙어 깨면 표식에 걸리지 않고 다음 판으로 넘어간다. */
    @Test
    fun `clearing the failed stage by hand advances instead of sticking on it`() {
        val client = Client()
        val signup = client.post("/api/v1/auth/signup", mapOf("email" to "stage-fallback-beat-${UUID.randomUUID()}@test.local", "password" to "password123", "nickname" to "fallback-beat"))
        val accountId = UUID.fromString(signup.at("/data/accountId").asText())
        client.post("/api/v1/material-preference", mapOf("materialType" to "POTATO"))
        seedClearsThrough(accountId, "stage.01-05")
        val gameSessionId = client.post("/api/v1/game-sessions", emptyMap<String, String>()).at("/data/gameSessionId").asText()
        assertEquals("stage.01-05", completeCycle(client, gameSessionId, "stage.01-06").at("/data/nextStageId").asText())
        assertEquals("stage.01-06", retryStage(accountId))

        battleStats.set(accountId, FighterStats(1_000_000, 1_000_000, 1_000_000))
        val beaten = completeCycle(client, gameSessionId, "stage.01-06")

        assertTrue(beaten.at("/data/battle/success").asBoolean())
        assertEquals("stage.01-07", beaten.at("/data/nextStageId").asText())
        assertNull(retryStage(accountId))
    }

    /** 돌아갈 판이 잡혀 있어도 유저가 직접 고른 판의 진행을 먹어서는 안 된다. */
    @Test
    fun `pending fallback does not hijack a manually chosen stage`() {
        val client = Client()
        val signup = client.post("/api/v1/auth/signup", mapOf("email" to "stage-fallback-hijack-${UUID.randomUUID()}@test.local", "password" to "password123", "nickname" to "fallback-hijack"))
        val accountId = UUID.fromString(signup.at("/data/accountId").asText())
        client.post("/api/v1/material-preference", mapOf("materialType" to "POTATO"))
        seedClearsThrough(accountId, "stage.03-05")
        val gameSessionId = client.post("/api/v1/game-sessions", emptyMap<String, String>()).at("/data/gameSessionId").asText()
        assertEquals("stage.03-05", completeCycle(client, gameSessionId, "stage.03-06").at("/data/nextStageId").asText())
        assertEquals("stage.03-06", retryStage(accountId))

        battleStats.set(accountId, FighterStats(1_000_000, 1_000_000, 1_000_000))
        val manual = completeCycle(client, gameSessionId, "stage.01-02")

        assertTrue(manual.at("/data/battle/success").asBoolean())
        assertEquals("stage.01-03", manual.at("/data/nextStageId").asText())
        assertNull(retryStage(accountId))
    }

    /** 앞 판을 깨고 실패한 판까지 깨면 거기서 멈추지 않고 그 다음 판으로 진행한다. */
    @Test
    fun `beating the failed stage after a fallback resumes forward progression`() {
        val client = Client()
        val signup = client.post("/api/v1/auth/signup", mapOf("email" to "stage-fallback-loop-${UUID.randomUUID()}@test.local", "password" to "password123", "nickname" to "fallback-loop"))
        val accountId = UUID.fromString(signup.at("/data/accountId").asText())
        client.post("/api/v1/material-preference", mapOf("materialType" to "POTATO"))
        seedClearsThrough(accountId, "stage.01-05")
        val gameSessionId = client.post("/api/v1/game-sessions", emptyMap<String, String>()).at("/data/gameSessionId").asText()
        assertEquals("stage.01-05", completeCycle(client, gameSessionId, "stage.01-06").at("/data/nextStageId").asText())

        battleStats.set(accountId, FighterStats(1_000_000, 1_000_000, 1_000_000))
        assertEquals("stage.01-06", completeCycle(client, gameSessionId, "stage.01-05").at("/data/nextStageId").asText())
        val retried = completeCycle(client, gameSessionId, "stage.01-06")

        assertTrue(retried.at("/data/battle/success").asBoolean())
        assertEquals("stage.01-07", retried.at("/data/nextStageId").asText())
        assertNull(retryStage(accountId))
    }

    @Test
    fun `repeat target rejects locked and breakthrough stages`() {
        val client = Client()
        client.post("/api/v1/auth/signup", mapOf("email" to "repeat-errors-${UUID.randomUUID()}@test.local", "password" to "password123", "nickname" to "repeat-errors"))
        client.post("/api/v1/material-preference", mapOf("materialType" to "POTATO"))
        val gameSessionId = client.post("/api/v1/game-sessions", emptyMap<String, String>()).at("/data/gameSessionId").asText()

        client.patchExpectUnprocessable("/api/v1/battle/repeat-stage", mapOf("stageId" to "stage.01-02"), gameSessionId, "STAGE_LOCKED")
        client.patchExpectUnprocessable("/api/v1/battle/repeat-stage", mapOf("stageId" to "stage.01-10"), gameSessionId, "STAGE_NOT_REPEATABLE")
    }

    @Test
    fun `raid handoff resumes only the exact paused battle once`() {
        val client = Client()
        val signup = client.post("/api/v1/auth/signup", mapOf("email" to "raid-handoff-${UUID.randomUUID()}@test.local", "password" to "password123", "nickname" to "raid-handoff"))
        val accountId = UUID.fromString(signup.at("/data/accountId").asText())
        client.post("/api/v1/material-preference", mapOf("materialType" to "POTATO"))
        val gameSessionId = UUID.fromString(client.post("/api/v1/game-sessions", emptyMap<String, String>()).at("/data/gameSessionId").asText())
        val started = client.post("/api/v1/battles/sessions", mapOf("stageId" to "stage.01-01"), gameSessionId.toString())
        val battleSessionId = UUID.fromString(started.at("/data/battleSessionId").asText())
        val handoff = requireNotNull(battleSessions.abortForRaidWithHandoffLocked(accountId))
        assertEquals(battleSessionId, handoff.battleSessionId)
        assertNull(battleSessions.resumeAfterRaidLocked(accountId, UUID.randomUUID(), UUID.randomUUID(), gameSessionId))

        val resumed = requireNotNull(battleSessions.resumeAfterRaidLocked(accountId, UUID.randomUUID(), battleSessionId, gameSessionId))
        assertNotEquals(battleSessionId, resumed.battleSessionId)
        assertNull(battleSessions.resumeAfterRaidLocked(accountId, UUID.randomUUID(), battleSessionId, gameSessionId))
        assertEquals(1, jdbc.sql("select count(*) from battle_session where account_id=:account and status='ACTIVE'").param("account", accountId).query(Int::class.java).single())
    }

    @Test
    fun `expired game session consumes exact handoff without restarting battle`() {
        val client = Client()
        val signup = client.post("/api/v1/auth/signup", mapOf("email" to "raid-expired-${UUID.randomUUID()}@test.local", "password" to "password123", "nickname" to "raid-expired"))
        val accountId = UUID.fromString(signup.at("/data/accountId").asText())
        client.post("/api/v1/material-preference", mapOf("materialType" to "POTATO"))
        val gameSessionId = UUID.fromString(client.post("/api/v1/game-sessions", emptyMap<String, String>()).at("/data/gameSessionId").asText())
        val started = client.post("/api/v1/battles/sessions", mapOf("stageId" to "stage.01-01"), gameSessionId.toString())
        val battleSessionId = UUID.fromString(started.at("/data/battleSessionId").asText())
        battleSessions.abortForRaidWithHandoffLocked(accountId)
        jdbc.sql("update game_session set status='EXPIRED',closed_at=now() where id=:id").param("id", gameSessionId).update()

        assertNull(battleSessions.resumeAfterRaidLocked(accountId, UUID.randomUUID(), battleSessionId, gameSessionId))
        assertNull(battleSessions.resumeAfterRaidLocked(accountId, UUID.randomUUID(), battleSessionId, gameSessionId))
        assertEquals(0, jdbc.sql("select count(*) from battle_session where account_id=:account and status='ACTIVE'").param("account", accountId).query(Int::class.java).single())
    }

    private fun completeCycle(client: Client, gameSessionId: String, stageId: String): JsonNode {
        val started = client.post("/api/v1/battles/sessions", mapOf("stageId" to stageId), gameSessionId)
        val battleSessionId = started.at("/data/battleSessionId").asText()
        jdbc.sql("update battle_session set completable_at=now()-interval '1 second' where id=:id")
            .param("id", UUID.fromString(battleSessionId))
            .update()
        return client.post(
            "/api/v1/battles/sessions/$battleSessionId/complete",
            mapOf("predictedHash" to null, "renderingCheckpoint" to null),
            gameSessionId,
            started.at("/data/battleToken").asText(),
        )
    }

    private fun retryStage(accountId: UUID): String? = jdbc.sql(
        "select retry_stage_id from account_runtime_state where account_id=:account",
    ).param("account", accountId).query(String::class.java).optional().orElse(null)

    private fun clearCount(accountId: UUID, stageId: String): Int = jdbc.sql(
        "select count(*) from stage_progress where account_id=:account and stage_id=:stage and first_cleared_at is not null",
    ).params(mapOf("account" to accountId, "stage" to stageId)).query(Int::class.java).single()

    private inner class Client {
        private val cookies = mutableListOf<Cookie>()

        fun post(path: String, body: Any, gameSessionId: String? = null, token: String? = null, key: UUID = UUID.randomUUID()): JsonNode {
            val request = post(path)
                .header("Idempotency-Key", key.toString())
                .header("Origin", "http://localhost:5173")
                .contentType(MediaType.APPLICATION_JSON)
                .accept(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body))
            if (gameSessionId != null) request.header("X-Game-Session-Id", gameSessionId)
            if (token != null) request.header("X-Battle-Token", token)
            if (cookies.isNotEmpty()) request.cookie(*cookies.toTypedArray())
            val result = mvc.perform(request).andExpect(status().isOk).andReturn()
            capture(result)
            return mapper.readTree(result.response.contentAsString)
        }

        fun get(path: String): JsonNode {
            val request = getRequest(path).accept(MediaType.APPLICATION_JSON)
            if (cookies.isNotEmpty()) request.cookie(*cookies.toTypedArray())
            val result = mvc.perform(request).andExpect(status().isOk).andReturn()
            capture(result)
            return mapper.readTree(result.response.contentAsString)
        }

        fun patch(path: String, body: Any, gameSessionId: String, key: UUID = UUID.randomUUID()): JsonNode {
            val request = patchRequest(path)
                .header("Idempotency-Key", key.toString())
                .header("Origin", "http://localhost:5173")
                .header("X-Game-Session-Id", gameSessionId)
                .contentType(MediaType.APPLICATION_JSON)
                .accept(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body))
            if (cookies.isNotEmpty()) request.cookie(*cookies.toTypedArray())
            val result = mvc.perform(request).andExpect(status().isOk).andReturn()
            capture(result)
            return mapper.readTree(result.response.contentAsString)
        }

        fun patchExpectUnprocessable(path: String, body: Any, gameSessionId: String, code: String) {
            val request = patchRequest(path)
                .header("Idempotency-Key", UUID.randomUUID().toString())
                .header("Origin", "http://localhost:5173")
                .header("X-Game-Session-Id", gameSessionId)
                .contentType(MediaType.APPLICATION_JSON)
                .accept(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body))
            if (cookies.isNotEmpty()) request.cookie(*cookies.toTypedArray())
            val result = mvc.perform(request).andExpect(status().isUnprocessableEntity).andReturn()
            assertEquals(code, mapper.readTree(result.response.contentAsString).path("code").asText())
        }

        fun postExpectConflict(path: String, body: Any, gameSessionId: String, token: String) {
            val request = post(path)
                .header("Idempotency-Key", UUID.randomUUID().toString())
                .header("Origin", "http://localhost:5173")
                .header("X-Game-Session-Id", gameSessionId)
                .header("X-Battle-Token", token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body))
            if (cookies.isNotEmpty()) request.cookie(*cookies.toTypedArray())
            mvc.perform(request).andExpect(status().isConflict)
        }

        private fun capture(result: MvcResult) {
            result.response.cookies.forEach { cookie ->
                cookies.removeIf { it.name == cookie.name }
                cookies += cookie
            }
        }
    }

}
