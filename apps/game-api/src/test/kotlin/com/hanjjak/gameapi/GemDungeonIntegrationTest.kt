package com.hanjjak.gameapi

import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.gameapi.character.CharacterStatsService
import com.hanjjak.gems.application.GemDungeonService
import com.hanjjak.gems.domain.GemDungeonSweepRequest
import com.hanjjak.gems.domain.GemPreset
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.MediaType
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import java.sql.Timestamp
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@GameApiIntegrationTest
class GemDungeonIntegrationTest {
    @Autowired lateinit var mvc: MockMvc
    @Autowired lateinit var mapper: ObjectMapper
    @Autowired lateinit var jdbc: JdbcClient
    @Autowired lateinit var dungeons: GemDungeonService
    @Autowired lateinit var gems: com.hanjjak.gems.application.GemService
    private val sessionCookies = mutableMapOf<UUID, Array<jakarta.servlet.http.Cookie>>()
    @Autowired lateinit var characterStats: CharacterStatsService
    @Autowired lateinit var policy: com.hanjjak.gems.domain.GemDungeonPolicy

    @Autowired lateinit var raidSnapshots: com.hanjjak.raid.application.RaidCombatSnapshotProvider
    @Autowired lateinit var seeds: TestCombatSeedSource

    /**
     * The seed used to be `key.mostSignificantBits xor key.leastSignificantBits`, so a client could
     * brute-force an Idempotency-Key offline until the dungeon fight came out a win.
     */
    @Test
    fun `dungeon seed comes from the server source and a replay does not draw again`() {
        val accountId = signup()
        unlock(accountId)
        val key = UUID.randomUUID()
        seeds.pin(987_654_321L)

        val challenge = dungeons.start(accountId, key)
        val drawsAfterStart = seeds.draws
        val replay = dungeons.start(accountId, key)

        val stored = jdbc.sql("select seed from gem_dungeon_challenge where challenge_id=:challenge")
            .param("challenge", challenge.challengeId).query(Long::class.java).single()
        assertEquals(987_654_321L, stored)
        assertNotEquals(key.mostSignificantBits xor key.leastSignificantBits, stored)
        assertEquals(1, drawsAfterStart)
        assertEquals(drawsAfterStart, seeds.draws, "replay must not draw a new seed")
        assertEquals(challenge.challengeId, replay.challengeId)
    }
    @Test
    fun `today exposes rankings for closed dungeons ordered by stage then first clear time`() {
        val viewer = signup()
        val first = signup()
        val second = signup()
        listOf(viewer, first, second).forEach(::unlock)
        jdbc.sql("update character set nickname=:nickname where account_id=:account").params(mapOf("nickname" to "한짝", "account" to viewer)).update()
        jdbc.sql("update character set nickname=:nickname where account_id=:account").params(mapOf("nickname" to "먼저깬이", "account" to first)).update()
        jdbc.sql("update character set nickname=:nickname where account_id=:account").params(mapOf("nickname" to "나중깬이", "account" to second)).update()

        val openBoss = dungeons.today(viewer).boss
        val closedBoss = listOf(GemPreset.SURVIVAL, GemPreset.BERSERK, GemPreset.ARMORED).first { it != openBoss }
        val base = Instant.parse("2026-09-17T00:00:00Z")
        recordFirstClear(first, closedBoss, 3, base.plusSeconds(10))
        recordFirstClear(second, closedBoss, 3, base.plusSeconds(20))
        recordFirstClear(viewer, closedBoss, 2, base.plusSeconds(5))

        val today = dungeons.today(viewer)
        val ranking = today.rankings.getValue(closedBoss)

        assertEquals(setOf(GemPreset.SURVIVAL, GemPreset.BERSERK, GemPreset.ARMORED), today.rankings.keys)
        assertEquals(listOf("먼저깬이", "나중깬이", "한짝"), ranking.topEntries.map { it.nickname })
        assertEquals(listOf(1, 2, 3), ranking.topEntries.map { it.rank })
        assertEquals(3, ranking.myEntry?.rank)
        assertEquals(2, ranking.myEntry?.stage)
        assertEquals(base.plusSeconds(5), ranking.myEntry?.clearedAt)
        assertEquals(2, today.progress.first { it.boss == closedBoss }.highestClearedStage)
    }

    @Test
    fun `dungeon stores the canonical preset snapshot without applying gems twice`() {
        val accountId = signup()
        unlock(accountId)
        jdbc.sql("insert into gem_dungeon_test_access(account_id) values (:account)").param("account", accountId).update()
        val attackGem = UUID.randomUUID()
        val hasteGem = UUID.randomUUID()
        jdbc.sql("insert into gem_instance(gem_id,account_id,level,option,value,locked,content_version) values (:attack,:account,1,'FLAT_ATTACK',50,false,'test'),(:haste,:account,7,'HASTE',1200,false,'test')")
            .params(mapOf("attack" to attackGem, "haste" to hasteGem, "account" to accountId)).update()
        jdbc.sql("insert into gem_loadout(account_id,preset,slot_index,gem_id) values (:account,'BERSERK',1,:attack),(:account,'BERSERK',2,:haste)")
            .params(mapOf("account" to accountId, "attack" to attackGem, "haste" to hasteGem)).update()

        val expected = characterStats.snapshot(accountId, GemPreset.BERSERK).calculation
        val challenge = dungeons.start(accountId, UUID.randomUUID(), GemPreset.BERSERK)
        val stored = mapper.readTree(jdbc.sql("select player_snapshot::text from gem_dungeon_challenge where challenge_id=:challenge")
            .param("challenge", challenge.challengeId).query(String::class.java).single())

        assertEquals(expected.fighter.attack, stored.at("/player/attack").asInt())
        assertEquals(expected.fighter.maxHp, stored.at("/player/maxHp").asInt())
        assertEquals(expected.skills.permanentHasteBasisPoints, stored.at("/skills/permanentHasteBasisPoints").asInt())
        assertEquals(expected.skills.hasteBasisPoints, stored.at("/skills/hasteBasisPoints").asInt())
    }

    @Test
    fun `dungeon freezes permanent equipment stats at entry`() {
        val accountId = signup()
        unlock(accountId)
        jdbc.sql("insert into gem_dungeon_test_access(account_id) values (:account)").param("account", accountId).update()
        val baseline = characterStats.snapshot(accountId, GemPreset.BERSERK).calculation.fighter.attack
        jdbc.sql("insert into equipment_slot_state(account_id,slot,grade,enhancement_level) values (:account,'WEAPON','NORMAL',10)")
            .param("account", accountId).update()
        val entryAttack = characterStats.snapshot(accountId, GemPreset.BERSERK).calculation.fighter.attack
        assertTrue(entryAttack > baseline)

        val challenge = dungeons.start(accountId, UUID.randomUUID(), GemPreset.BERSERK)
        jdbc.sql("update equipment_slot_state set enhancement_level=30 where account_id=:account and slot='WEAPON'")
            .param("account", accountId).update()

        val stored = mapper.readTree(jdbc.sql("select player_snapshot::text from gem_dungeon_challenge where challenge_id=:challenge")
            .param("challenge", challenge.challengeId).query(String::class.java).single())
        assertEquals(entryAttack, stored.at("/player/attack").asInt())
        assertTrue(characterStats.snapshot(accountId, GemPreset.BERSERK).calculation.fighter.attack > entryAttack)
    }

    /**
     * V20 은 stage 를 1..10 으로 못 박았다. 30단계 확장은 이 제약을 넓히기만 하므로 기존
     * 진행도는 그대로 유효하고, 승격 전 10단계 콘텐츠로 되돌려도 스키마가 막지 않는다.
     */
    @Test
    fun `progress and sweep accept the thirty stage ladder`() {
        val accountId = signup()
        unlock(accountId)
        val boss = dungeons.today(accountId).boss
        jdbc.sql("insert into gem_dungeon_progress(account_id,boss_type,highest_cleared_stage) values (:account,:boss,30)")
            .params(mapOf("account" to accountId, "boss" to boss.name)).update()

        val stored = jdbc.sql("select highest_cleared_stage from gem_dungeon_progress where account_id=:account and boss_type=:boss")
            .params(mapOf("account" to accountId, "boss" to boss.name)).query(Int::class.java).single()
        assertEquals(30, stored)

        val sweep = dungeons.sweep(accountId, UUID.randomUUID(), GemDungeonSweepRequest(1))
        assertEquals(30, sweep.stage)
        assertEquals(com.hanjjak.gems.domain.GemDungeonRewards.sweepPerTicket(30), sweep.rewardGemBoxes)
    }

    @Test
    fun `consuming below ticket cap preserves the current recharge boundary`() {
        val accountId = signup()
        unlock(accountId)
        val boss = dungeons.today(accountId).boss
        jdbc.sql("insert into gem_dungeon_progress(account_id,boss_type,highest_cleared_stage) values (:account,:boss,1)")
            .params(mapOf("account" to accountId, "boss" to boss.name)).update()
        val rechargeStartedAt = policy.ticketSlotStartedAt(Instant.now()).truncatedTo(ChronoUnit.MICROS)
        seedTickets(accountId, 2, rechargeStartedAt)

        dungeons.sweep(accountId, UUID.randomUUID(), GemDungeonSweepRequest(1))

        val stored = jdbc.sql("select tickets,last_ticket_at from gem_account_state where account_id=:account")
            .param("account", accountId).query { row, _ -> row.getInt("tickets") to row.getTimestamp("last_ticket_at").toInstant() }.single()
        assertEquals(1, stored.first)
        assertEquals(rechargeStartedAt, stored.second)
    }

    /**
     * 조회는 저장된 값을 고치지 않고 경과분을 계산해서 보여 준다. 예전에는 이 확인을 저장된
     * 행에 대고 했는데, 그것은 곧 조회가 행을 되썼다는 뜻이기도 했다.
     */
    @Test
    fun `ticket recharge accrues on hourly boundaries and stops at three`() {
        val accountId = signup()
        assertEquals(3_600, policy.ticketRegenSeconds)
        assertEquals(3, policy.ticketMaxStock)
        unlock(accountId)
        val rechargeStartedAt = Instant.now().minusSeconds(4 * 60 * 60L).truncatedTo(ChronoUnit.MICROS)
        seedTickets(accountId, 2, rechargeStartedAt)

        assertEquals(3, dungeons.today(accountId).tickets)
        assertEquals(3, gems.state(accountId).tickets)
        assertEquals(0L, dungeons.today(accountId).secondsUntilNextTicket)
        assertEquals(2 to rechargeStartedAt, storedTickets(accountId))
    }

    /** 한 시간이 아직 차지 않았으면 한 장도 늘지 않고 남은 시간만 줄어든다. */
    @Test
    fun `a read before the next hour reports the remaining countdown`() {
        val accountId = signup()
        unlock(accountId)
        val rechargeStartedAt = policy.ticketSlotStartedAt(Instant.now()).truncatedTo(ChronoUnit.MICROS)
        seedTickets(accountId, 1, rechargeStartedAt)

        val today = dungeons.today(accountId)

        assertEquals(1, today.tickets)
        assertTrue(today.secondsUntilNextTicket in 1..policy.ticketRegenSeconds)
        assertEquals(1 to rechargeStartedAt, storedTickets(accountId))
    }

    /**
     * 조회가 티켓 행을 만들거나 잠그거나 되쓰지 않는다는 회귀 검사다. 보석 상태와 던전 화면을
     * 아무리 열어도 `gem_account_state` 는 그대로다 — 행을 만드는 것은 티켓을 바꾸는 명령뿐이다.
     */
    @Test
    fun `reads never create or move the ticket row`() {
        val accountId = signup()
        chooseMaterial(accountId)
        unlock(accountId)

        repeat(3) {
            assertEquals(3, readTickets(accountId, "/api/v1/gems"))
            assertEquals(3, readTickets(accountId, "/api/v1/gem-dungeons/today"))
            assertEquals(3, gems.state(accountId).tickets)
            assertEquals(3, dungeons.today(accountId).tickets)
        }
        assertEquals(0L, ticketRowCount(accountId), "조회만으로 티켓 행이 생기면 안 된다")

        dungeons.start(accountId, UUID.randomUUID())
        val afterCommand = storedTickets(accountId)

        repeat(3) {
            readTickets(accountId, "/api/v1/gems")
            readTickets(accountId, "/api/v1/gem-dungeons/today")
        }
        assertEquals(afterCommand, storedTickets(accountId), "조회가 티켓 행을 되쓰면 안 된다")
    }

    @Test
    fun `consuming from full ticket stock anchors recharge to the current hour`() {
        val accountId = signup()
        unlock(accountId)
        val boss = dungeons.today(accountId).boss
        jdbc.sql("insert into gem_dungeon_progress(account_id,boss_type,highest_cleared_stage) values (:account,:boss,1)")
            .params(mapOf("account" to accountId, "boss" to boss.name)).update()
        val staleRechargeStart = Instant.now().minusSeconds(2 * 60 * 60L).truncatedTo(ChronoUnit.MICROS)
        seedTickets(accountId, 3, staleRechargeStart)
        val rechargeBoundary = policy.ticketSlotStartedAt(Instant.now())

        dungeons.sweep(accountId, UUID.randomUUID(), GemDungeonSweepRequest(1))

        val stored = jdbc.sql("select tickets,last_ticket_at from gem_account_state where account_id=:account")
            .param("account", accountId).query { row, _ -> row.getInt("tickets") to row.getTimestamp("last_ticket_at").toInstant() }.single()
        assertEquals(2, stored.first)
        assertEquals(rechargeBoundary, stored.second)
    }
    @Test
    fun `sweep count is limited to one through three`() {
        val accountId = signup()
        unlock(accountId)
        val boss = dungeons.today(accountId).boss
        jdbc.sql("insert into gem_dungeon_progress(account_id,boss_type,highest_cleared_stage) values (:account,:boss,1)")
            .params(mapOf("account" to accountId, "boss" to boss.name)).update()

        for (invalidCount in listOf(0, 4)) {
            val error = org.junit.jupiter.api.assertThrows<IllegalArgumentException> {
                dungeons.sweep(accountId, UUID.randomUUID(), GemDungeonSweepRequest(invalidCount))
            }
            assertEquals("INVALID_GEM_DUNGEON_SWEEP_COUNT", error.message)
        }
        assertEquals(3, dungeons.today(accountId).tickets)
        assertEquals(0L, ticketRowCount(accountId), "거절된 소탕은 티켓 행을 남기지 않는다")
    }

    /**
     * 같은 계정으로 소탕이 한꺼번에 들어와도 티켓은 가진 만큼만 빠진다. 충전 반영과 차감이 한
     * 잠금 안에서 끝나므로, 늦게 들어온 요청은 이미 줄어든 값을 보고 거절된다.
     */
    @Test
    fun `concurrent sweeps spend each ticket exactly once`() {
        val accountId = signup()
        unlock(accountId)
        val boss = dungeons.today(accountId).boss
        jdbc.sql("insert into gem_dungeon_progress(account_id,boss_type,highest_cleared_stage) values (:account,:boss,1)")
            .params(mapOf("account" to accountId, "boss" to boss.name)).update()
        seedTickets(accountId, 2, policy.ticketSlotStartedAt(Instant.now()).truncatedTo(ChronoUnit.MICROS))

        val results = inParallel(4) { dungeons.sweep(accountId, UUID.randomUUID(), GemDungeonSweepRequest(1)) }

        assertEquals(2, results.count { it.second == null }, "가진 티켓 수만큼만 성공해야 한다: $results")
        assertTrue(results.filter { it.second != null }.all { it.second == "GEM_TICKET_EMPTY" }, "실패는 티켓 소진이어야 한다: $results")
        assertEquals(0, storedTickets(accountId).first)
        assertEquals(
            2 * com.hanjjak.gems.domain.GemDungeonRewards.sweepPerTicket(1),
            jdbc.sql("select coalesce(sum(quantity),0) from inventory_stack where account_id=:account and item_id='GEM_BOX'")
                .param("account", accountId).query(Long::class.java).single(),
        )
    }

    /**
     * 같은 도전을 여러 번 동시에 완료해도 티켓은 한 장만 빠진다. 도전 행 잠금이 한 명만
     * 통과시키고, 뒤따르는 요청은 이미 끝난 도전을 보고 그대로 돌아간다.
     */
    @Test
    fun `concurrent completions spend at most one ticket`() {
        val accountId = signup()
        unlock(accountId)
        val challenge = dungeons.start(accountId, UUID.randomUUID())
        jdbc.sql("update gem_dungeon_challenge set started_at=:started,minimum_complete_at=:minimum,expires_at=:expires where challenge_id=:id")
            .params(mapOf("started" to Timestamp.from(Instant.now().minusSeconds(90)),
                "minimum" to Timestamp.from(Instant.now().minusSeconds(60)),
                "expires" to Timestamp.from(Instant.now().plusSeconds(600)), "id" to challenge.challengeId)).update()

        val results = inParallel(3) { dungeons.complete(accountId, challenge.challengeId, UUID.randomUUID()) }

        assertTrue(results.all { it.second == null }, "완료 재요청은 실패가 아니라 같은 결과여야 한다: $results")
        val status = jdbc.sql("select status from gem_dungeon_challenge where challenge_id=:id")
            .param("id", challenge.challengeId).query(String::class.java).single()
        assertEquals(if (status == "SUCCEEDED") 2 else 3, storedTickets(accountId).first, "완료 한 번에 티켓 한 장이다 (status=$status)")
        assertTrue(jdbc.sql("select count(*) from gem_dungeon_first_clear where account_id=:account")
            .param("account", accountId).query(Long::class.java).single() <= 1)
    }


    @Test
    fun `abort releases reward capacity without consuming tickets and replay stays unchanged`() {
        val accountId = signup()
        unlock(accountId)
        val challenge = dungeons.start(accountId, UUID.randomUUID())
        assertReservation(challenge.challengeId, "ACTIVE")
        val key = UUID.randomUUID()

        dungeons.abort(accountId, challenge.challengeId, key)
        dungeons.abort(accountId, challenge.challengeId, key)
        dungeons.complete(accountId, challenge.challengeId, UUID.randomUUID())

        assertReservation(challenge.challengeId, "RELEASED")
        assertEquals("ABORTED", jdbc.sql("select status from gem_dungeon_challenge where challenge_id=:id")
            .param("id", challenge.challengeId).query(String::class.java).single())
        assertNoRewardOrTicketConsumption(accountId)
        val next = dungeons.start(accountId, UUID.randomUUID())
        assertReservation(next.challengeId, "ACTIVE")
    }

    @Test
    fun `expired challenge releases capacity and late completion cannot grant rewards`() {
        val accountId = signup()
        unlock(accountId)
        val challenge = dungeons.start(accountId, UUID.randomUUID())
        jdbc.sql("update gem_dungeon_challenge set started_at=:started,minimum_complete_at=:minimum,expires_at=:expires where challenge_id=:id")
            .params(mapOf("started" to Timestamp.from(Instant.now().minusSeconds(90)),
                "minimum" to Timestamp.from(Instant.now().minusSeconds(60)),
                "expires" to Timestamp.from(Instant.now().minusSeconds(30)), "id" to challenge.challengeId)).update()

        dungeons.today(accountId)
        dungeons.complete(accountId, challenge.challengeId, UUID.randomUUID())

        assertReservation(challenge.challengeId, "RELEASED")
        assertEquals("EXPIRED", jdbc.sql("select status from gem_dungeon_challenge where challenge_id=:id")
            .param("id", challenge.challengeId).query(String::class.java).single())
        assertNoRewardOrTicketConsumption(accountId)
    }

    @Test
    fun `raid snapshot preserves unlocked skill ids and active loadout`() {
        val accountId = signup()
        jdbc.sql("insert into skill_state(account_id,skill_id,grade,level,failure_bonus_basis_points) values (:account,'active_heavy','NORMAL',1,0),(:account,'passive_critical','NORMAL',1,0)")
            .param("account", accountId).update()
        jdbc.sql("insert into skill_loadout(account_id,slot_index,skill_id) values (:account,1,'active_heavy')")
            .param("account", accountId).update()

        jdbc.sql("update character set cosmetics_unlocked=true where account_id=:account").param("account", accountId).update()
        (1..6).forEach { index ->
            jdbc.sql("insert into cosmetic_collection_state(account_id,cosmetic_id,registered_quantity,unregistered_quantity,reserved_quantity) values (:account,:cosmetic,1,0,0)")
                .params(mapOf("account" to accountId, "cosmetic" to "cosmetic-${index.toString().padStart(3, '0')}")).update()
        }

        val snapshot = raidSnapshots.snapshot(accountId)

        assertEquals(listOf("active_heavy", "passive_critical"), snapshot.skillIds)
        assertEquals(listOf("active_heavy"), snapshot.activeSkillLoadout)
        assertEquals("MAIN", snapshot.mainGemPreset)
        assertEquals(0, snapshot.defense)
        assertEquals(listOf("cosmetic-set-01"), snapshot.cosmeticEffectIds)
    }

    private fun assertReservation(challengeId: UUID, expected: String) {
        assertEquals(expected, jdbc.sql("select status from inventory_capacity_reservation where challenge_id=:id")
            .param("id", challengeId).query(String::class.java).single())
    }

    private fun recordFirstClear(accountId: UUID, boss: GemPreset, stage: Int, clearedAt: Instant) {
        val challengeId = UUID.randomUUID()
        jdbc.sql(
            """insert into gem_dungeon_challenge(
                challenge_id,account_id,boss_type,stage,kst_date,status,seed,content_version,
                preset_snapshot,player_snapshot,battle_result,reward_gem_boxes,
                started_at,minimum_complete_at,expires_at,completed_at
            ) values (
                :challenge,:account,:boss,:stage,:date,'SUCCEEDED',1,'ranking-test',
                cast('[]' as jsonb),cast('{}' as jsonb),cast('{}' as jsonb),0,
                :started,:minimum,:expires,:completed
            )""",
        ).params(
            mapOf(
                "challenge" to challengeId,
                "account" to accountId,
                "boss" to boss.name,
                "stage" to stage,
                "date" to java.time.LocalDate.of(2026, 9, 17),
                "started" to Timestamp.from(clearedAt.minusSeconds(2)),
                "minimum" to Timestamp.from(clearedAt.minusSeconds(1)),
                "expires" to Timestamp.from(clearedAt.plusSeconds(15)),
                "completed" to Timestamp.from(clearedAt),
            ),
        ).update()
        jdbc.sql("insert into gem_dungeon_first_clear(account_id,boss_type,stage,claimed_at,challenge_id) values (:account,:boss,:stage,:cleared,:challenge)")
            .params(mapOf("account" to accountId, "boss" to boss.name, "stage" to stage, "cleared" to Timestamp.from(clearedAt), "challenge" to challengeId)).update()
        jdbc.sql("insert into gem_dungeon_progress(account_id,boss_type,highest_cleared_stage) values (:account,:boss,:stage) on conflict(account_id,boss_type) do update set highest_cleared_stage=greatest(gem_dungeon_progress.highest_cleared_stage,excluded.highest_cleared_stage)")
            .params(mapOf("account" to accountId, "boss" to boss.name, "stage" to stage)).update()
    }

    private fun assertNoRewardOrTicketConsumption(accountId: UUID) {
        assertEquals(3, jdbc.sql("select tickets from gem_account_state where account_id=:account")
            .param("account", accountId).query(Int::class.java).single())
        assertEquals(0L, jdbc.sql("select coalesce(sum(quantity),0) from inventory_stack where account_id=:account and item_id='GEM_BOX'")
            .param("account", accountId).query(Long::class.java).single())
        assertEquals(0L, jdbc.sql("select count(*) from gem_dungeon_first_clear where account_id=:account")
            .param("account", accountId).query(Long::class.java).single())
    }

    /** 실제 API 는 재료 선택을 마치기 전 모든 요청을 막는다. HTTP 로 들어가는 시험만 이 관문을 통과한다. */
    private fun chooseMaterial(accountId: UUID) {
        val request = post("/api/v1/material-preference")
            .header("Idempotency-Key", UUID.randomUUID().toString())
            .header("Origin", "http://localhost:5173")
            .sessionAttr("accountId", accountId)
            .contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(mapOf("materialType" to "POTATO")))
        sessionCookies[accountId]?.takeIf { it.isNotEmpty() }?.let { request.cookie(*it) }
        mvc.perform(request).andExpect(status().isOk)
    }

    /** 실제 GET 경로로 티켓 수를 읽는다. 컨트롤러부터 서비스까지 쓰기가 없다는 것을 함께 확인한다. */
    private fun readTickets(accountId: UUID, path: String): Int {
        val request = get(path).sessionAttr("accountId", accountId).accept(MediaType.APPLICATION_JSON)
        sessionCookies[accountId]?.takeIf { it.isNotEmpty() }?.let { request.cookie(*it) }
        val response = mvc.perform(request).andExpect(status().isOk).andReturn().response.contentAsString
        return mapper.readTree(response).at("/data/tickets").asInt()
    }

    /** 티켓 행을 시험이 원하는 상태로 놓는다. 이제 조회가 행을 만들어 주지 않는다. */
    private fun seedTickets(accountId: UUID, tickets: Int, lastTicketAt: Instant) {
        jdbc.sql("insert into gem_account_state(account_id,tickets,last_ticket_at) values (:account,:tickets,:time) on conflict(account_id) do update set tickets=excluded.tickets,last_ticket_at=excluded.last_ticket_at")
            .params(mapOf("account" to accountId, "tickets" to tickets, "time" to Timestamp.from(lastTicketAt))).update()
    }

    private fun storedTickets(accountId: UUID): Pair<Int, Instant> = jdbc.sql("select tickets,last_ticket_at from gem_account_state where account_id=:account")
        .param("account", accountId).query { row, _ -> row.getInt("tickets") to row.getTimestamp("last_ticket_at").toInstant() }.single()

    private fun ticketRowCount(accountId: UUID): Long = jdbc.sql("select count(*) from gem_account_state where account_id=:account")
        .param("account", accountId).query(Long::class.java).single()

    /** [count] 개의 요청을 같은 순간에 풀어 놓고 성공 여부와 실패 사유를 모아 돌려준다. */
    private fun <T> inParallel(count: Int, call: () -> T): List<Pair<T?, String?>> {
        val executor = Executors.newFixedThreadPool(count)
        val ready = CountDownLatch(count)
        val start = CountDownLatch(1)
        val futures = (1..count).map {
            executor.submit<Pair<T?, String?>> {
                ready.countDown()
                check(start.await(10, TimeUnit.SECONDS)) { "dungeon workers did not start together" }
                try {
                    call() to null
                } catch (exception: RuntimeException) {
                    null to (exception.message ?: exception::class.simpleName)
                }
            }
        }
        check(ready.await(10, TimeUnit.SECONDS)) { "dungeon workers were not ready" }
        start.countDown()
        return try {
            futures.map { it.get(30, TimeUnit.SECONDS) }
        } finally {
            executor.shutdown()
        }
    }

    private fun signup(): UUID {
        val result = mvc.perform(post("/api/v1/auth/signup")
            .header("Idempotency-Key", UUID.randomUUID().toString())
            .header("Origin", "http://localhost:5173")
            .contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(mapOf("email" to "dungeon-${UUID.randomUUID()}@test.local", "password" to "password123", "nickname" to "dungeon-${UUID.randomUUID().toString().take(8)}"))))
            .andExpect(status().isOk).andReturn()
        val accountId = UUID.fromString(mapper.readTree(result.response.contentAsString).at("/data/accountId").asText())
        // 실제 GET 을 태우는 시험은 가입이 내려준 세션 쿠키를 그대로 들고 가야 한다.
        sessionCookies[accountId] = result.response.cookies
        return accountId
    }

    private fun unlock(accountId: UUID) {
        jdbc.sql("insert into stage_progress(account_id,stage_id,unlocked,first_cleared_at,highest_clear_count,content_version) values (:account,'stage.01-05',true,now(),1,'test') on conflict(account_id,stage_id) do update set unlocked=true,first_cleared_at=coalesce(stage_progress.first_cleared_at,excluded.first_cleared_at),highest_clear_count=greatest(stage_progress.highest_clear_count,1)")
            .param("account", accountId).update()
    }

}
