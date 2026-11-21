package com.hanjjak.gems.application

import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.gems.domain.*
import com.hanjjak.sim.*
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.transaction.annotation.Transactional
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.sql.ResultSet
import java.sql.Timestamp
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

open class GemDungeonService(
    private val jdbc: JdbcClient,
    private val mapper: ObjectMapper,
    private val clock: Clock,
    private val gems: GemService,
    private val players: GemDungeonPlayerProvider,
    private val catalog: GemDungeonCatalog,
    private val inventory: com.hanjjak.inventory.application.InventoryReservationService,
    private val inventoryRepository: com.hanjjak.inventory.application.InventoryRepository,
    private val history: com.hanjjak.battle.application.BattleHistoryRecorder,
    private val policy: GemDungeonPolicy = GemDungeonPolicy(),
    private val seeds: com.hanjjak.sim.CombatSeedSource = com.hanjjak.sim.SecureCombatSeedSource(),
) {
    private data class StoredCommand(val fingerprint: String, val resultJson: String)
    private data class ChallengeRow(
        val challengeId: UUID,
        val boss: GemPreset,
        val stage: Int,
        val status: GemDungeonChallengeStatus,
        val minimumCompleteAt: Instant,
        val expiresAt: Instant,
        val rewardGemBoxes: Long,
        val contentVersion: String,
        val battleJson: String,
    )
    private data class RankingRow(
        val accountId: UUID,
        val boss: GemPreset,
        val rank: Int,
        val nickname: String,
        val stage: Int,
        val clearedAt: Instant,
    )
    private val kst = ZoneId.of("Asia/Seoul")

    @Transactional
    open fun today(accountId: UUID, requestedBoss: GemPreset? = null): GemDungeonToday {
        lockAccount(accountId)
        requireUnlocked(accountId)
        expireActive(accountId)
        val testAccess = hasTestAccess(accountId)
        val boss = resolveBoss(requestedBoss, testAccess)
        val progress = progress(accountId)
        val highest = progress.first { it.boss == boss }.highestClearedStage
        val nextStage = (highest + 1).takeIf { it <= catalog.maxStage }
        val sweepStage = highest.takeIf { it > 0 }
        // 티켓은 읽어서 계산할 뿐이다. 던전 화면을 열어 보는 것으로 티켓 행이 잠기거나 바뀌지 않는다.
        val tickets = policy.ticketBalance(readGemTickets(jdbc, accountId), clock.instant())
        return GemDungeonToday(
            boss = boss,
            tickets = tickets.tickets,
            secondsUntilNextTicket = tickets.secondsUntilNextTicket,
            progress = progress,
            nextChallengeStage = nextStage,
            sweepStage = sweepStage,
            nextChallengeRewardGemBoxes = nextStage?.let(GemDungeonRewards::firstClear),
            sweepRewardGemBoxesPerTicket = sweepStage?.let(GemDungeonRewards::sweepPerTicket),
            activeChallenge = active(accountId)?.let(::view),
            testBossSelectionEnabled = testAccess,
            rankings = rankings(accountId),
        )
    }

    @Transactional
    open fun start(accountId: UUID, idempotencyKey: UUID, requestedBoss: GemPreset? = null): GemDungeonChallengeView = command(
        accountId,
        idempotencyKey,
        "gem-dungeon\u0000start\u0000${requestedBoss?.name ?: "TODAY"}",
        GemDungeonChallengeView::class.java,
    ) {
        requireUnlocked(accountId)
        expireActive(accountId)
        require(active(accountId) == null) { "GEM_DUNGEON_ACTIVE_CHALLENGE" }
        holdTicket(accountId)
        val boss = resolveBoss(requestedBoss, hasTestAccess(accountId))
        val highest = progress(accountId).first { it.boss == boss }.highestClearedStage
        val stage = highest + 1
        require(stage <= catalog.maxStage) { "GEM_DUNGEON_ALL_STAGES_CLEARED" }
        val challengeId = UUID.randomUUID()
        val definition = catalog.require(boss, stage)
        val base = players.snapshot(accountId, boss)
        val player = base.player
        val skills = base.skills
        val seed = seeds.nextSeed()
        val battle = DungeonCombatSimulator.simulate(
            DungeonCombatInput(
                catalog.contentVersion,
                seed,
                if (boss == GemPreset.SURVIVAL) DungeonMode.SURVIVE else DungeonMode.DEFEAT_BOSS,
                player,
                skills,
                DungeonBossStats(
                    definition.bossHp,
                    definition.bossAttack,
                    definition.defense,
                    catalog.durationTicks,
                    definition.strikeDamage,
                    definition.strikeIntervalTicks,
                    definition.damageFloorBasisPoints,
                ),
            ),
        )
        val now = clock.instant()
        val minimumCompleteAt = now.plusMillis(battle.elapsedTicks * 100L)
        val expiresAt = minimumCompleteAt.plusSeconds(catalog.completionWindowSeconds)
        val reward = if (battle.success) GemDungeonRewards.firstClear(stage) else 0L
        val presetSnapshot = presetGemIds(accountId, boss)
        jdbc.sql(
            """insert into gem_dungeon_challenge(
                challenge_id,account_id,boss_type,stage,kst_date,status,seed,content_version,preset_snapshot,player_snapshot,battle_result,reward_gem_boxes,started_at,minimum_complete_at,expires_at
            ) values (:challenge,:account,:boss,:stage,:date,'ACTIVE',:seed,:version,cast(:preset as jsonb),cast(:player as jsonb),cast(:battle as jsonb),:reward,:started,:minimum,:expires)""",
        ).params(
            mapOf(
                "challenge" to challengeId, "account" to accountId, "boss" to boss.name, "stage" to stage,
                "date" to LocalDate.now(clock.withZone(kst)), "seed" to seed, "version" to catalog.contentVersion,
                "preset" to mapper.writeValueAsString(presetSnapshot), "player" to mapper.writeValueAsString(mapOf("player" to player, "skills" to skills)),
                "battle" to mapper.writeValueAsString(battle), "reward" to reward, "started" to dbTime(now),
                "minimum" to dbTime(minimumCompleteAt), "expires" to dbTime(expiresAt),
            ),
        ).update()
        history.dungeonEntered(
            accountId,
            challengeId,
            dungeonId(boss, stage),
            catalog.contentVersion,
            player,
            now,
        )
        reserveRewardCapacity(accountId, challengeId)
        incrementStateVersion(accountId)
        view(challenge(challengeId, accountId, false)!!)
    }

    @Transactional
    open fun complete(accountId: UUID, challengeId: UUID, idempotencyKey: UUID): GemDungeonCompletion = command(
        accountId,
        idempotencyKey,
        "gem-dungeon\u0000complete\u0000$challengeId",
        GemDungeonCompletion::class.java,
    ) {
        val row = challenge(challengeId, accountId, true) ?: throw IllegalArgumentException("GEM_DUNGEON_CHALLENGE_NOT_FOUND")
        if (row.status != GemDungeonChallengeStatus.ACTIVE) return@command GemDungeonCompletion(view(row), gems.state(accountId))
        val now = clock.instant()
        if (now.isAfter(row.expiresAt)) {
            resolveChallenge(row.challengeId, GemDungeonChallengeStatus.EXPIRED, "RELEASED", now)
            incrementStateVersion(accountId)
            return@command GemDungeonCompletion(view(challenge(challengeId, accountId, false)!!), gems.state(accountId))
        }
        require(!now.isBefore(row.minimumCompleteAt)) { "GEM_DUNGEON_COMPLETE_TOO_EARLY" }
        val battle = mapper.readValue(row.battleJson, DungeonCombatResult::class.java)
        if (!battle.success) {
            resolveChallenge(row.challengeId, GemDungeonChallengeStatus.FAILED, "RELEASED", now)
        } else {
            spendTickets(accountId, 1)
            grantGemBoxes(accountId, row.rewardGemBoxes)
            jdbc.sql("insert into gem_dungeon_progress(account_id,boss_type,highest_cleared_stage) values (:account,:boss,:stage) on conflict(account_id,boss_type) do update set highest_cleared_stage=greatest(gem_dungeon_progress.highest_cleared_stage,excluded.highest_cleared_stage)")
                .params(mapOf("account" to accountId, "boss" to row.boss.name, "stage" to row.stage)).update()
            jdbc.sql("insert into gem_dungeon_first_clear(account_id,boss_type,stage,claimed_at,challenge_id) values (:account,:boss,:stage,:now,:challenge) on conflict(account_id,boss_type,stage) do nothing")
                .params(mapOf("account" to accountId, "boss" to row.boss.name, "stage" to row.stage, "now" to dbTime(now), "challenge" to row.challengeId)).update()
            resolveChallenge(row.challengeId, GemDungeonChallengeStatus.SUCCEEDED, "CONSUMED", now)
        }
        history.dungeonReturned(
            accountId,
            row.challengeId,
            dungeonId(row.boss, row.stage),
            if (battle.success) "DUNGEON_CLEARED" else requireNotNull(battle.failureCode),
            now,
        )
        incrementStateVersion(accountId)
        GemDungeonCompletion(view(challenge(challengeId, accountId, false)!!), gems.state(accountId))
    }

    @Transactional
    open fun abort(accountId: UUID, challengeId: UUID, idempotencyKey: UUID): GemDungeonCompletion = command(
        accountId,
        idempotencyKey,
        "gem-dungeon\u0000abort\u0000$challengeId",
        GemDungeonCompletion::class.java,
    ) {
        val row = challenge(challengeId, accountId, true) ?: throw IllegalArgumentException("GEM_DUNGEON_CHALLENGE_NOT_FOUND")
        if (row.status == GemDungeonChallengeStatus.ACTIVE) {
            resolveChallenge(row.challengeId, GemDungeonChallengeStatus.ABORTED, "RELEASED", clock.instant())
            incrementStateVersion(accountId)
            history.dungeonReturned(
                accountId,
                row.challengeId,
                dungeonId(row.boss, row.stage),
                "DUNGEON_ABORTED",
                clock.instant(),
            )
        }
        GemDungeonCompletion(view(challenge(challengeId, accountId, false)!!), gems.state(accountId))
    }

    @Transactional
    open fun sweep(accountId: UUID, idempotencyKey: UUID, request: GemDungeonSweepRequest): GemDungeonSweepResult = command(
        accountId,
        idempotencyKey,
        "gem-dungeon\u0000sweep\u0000${request.count}",
        GemDungeonSweepResult::class.java,
    ) {
        requireUnlocked(accountId)
        expireActive(accountId)
        require(active(accountId) == null) { "GEM_DUNGEON_ACTIVE_CHALLENGE" }
        require(request.count in 1..policy.ticketMaxStock) { "INVALID_GEM_DUNGEON_SWEEP_COUNT" }
        spendTickets(accountId, request.count)
        val boss = todayBoss()
        val stage = progress(accountId).first { it.boss == boss }.highestClearedStage
        require(stage > 0) { "GEM_DUNGEON_SWEEP_LOCKED" }
        requireRewardCapacity(accountId)
        val reward = GemDungeonRewards.sweepPerTicket(stage) * request.count
        grantGemBoxes(accountId, reward)
        incrementStateVersion(accountId)
        GemDungeonSweepResult(boss, stage, request.count, reward, gems.state(accountId))
    }

    private fun reserveRewardCapacity(accountId: UUID, challengeId: UUID) {
        val kind = if (hasGemBoxStack(accountId)) "STACK_RIGHT" else {
            require(inventoryRepository.hasCapacityReservation(accountId, "GEM_BOX") || inventoryRepository.usedSlotCount(accountId) < com.hanjjak.inventory.domain.INVENTORY_MAX_SLOTS) { "INVENTORY_CAPACITY_EXCEEDED" }
            "EMPTY_SLOT"
        }
        jdbc.sql("insert into inventory_capacity_reservation(reservation_id,challenge_id,account_id,item_id,reservation_kind,status,created_at) values (:reservation,:challenge,:account,'GEM_BOX',:kind,'ACTIVE',:now)")
            .params(mapOf("reservation" to UUID.randomUUID(), "challenge" to challengeId, "account" to accountId, "kind" to kind, "now" to dbTime(clock.instant()))).update()
    }

    private fun requireRewardCapacity(accountId: UUID) {
        require(hasGemBoxStack(accountId) || inventoryRepository.hasCapacityReservation(accountId, "GEM_BOX") || inventoryRepository.usedSlotCount(accountId) < com.hanjjak.inventory.domain.INVENTORY_MAX_SLOTS) { "INVENTORY_CAPACITY_EXCEEDED" }
    }

    private fun hasGemBoxStack(accountId: UUID): Boolean = jdbc.sql("select count(*) from inventory_stack where account_id=:account and item_id='GEM_BOX' and quantity>0")
        .param("account", accountId).query(Long::class.java).single() > 0

    private fun resolveChallenge(challengeId: UUID, status: GemDungeonChallengeStatus, reservationStatus: String, now: Instant) {
        jdbc.sql("update gem_dungeon_challenge set status=:status,completed_at=:now where challenge_id=:challenge and status='ACTIVE'")
            .params(mapOf("status" to status.name, "now" to dbTime(now), "challenge" to challengeId)).update()
        jdbc.sql("update inventory_capacity_reservation set status=:status,resolved_at=:now where challenge_id=:challenge and status='ACTIVE'")
            .params(mapOf("status" to reservationStatus, "now" to dbTime(now), "challenge" to challengeId)).update()
    }

    private fun expireActive(accountId: UUID) {
        val now = clock.instant()
        jdbc.sql("select challenge_id from gem_dungeon_challenge where account_id=:account and status='ACTIVE' and expires_at<:now for update")
            .params(mapOf("account" to accountId, "now" to dbTime(now))).query(UUID::class.java).list()
            .forEach { resolveChallenge(it, GemDungeonChallengeStatus.EXPIRED, "RELEASED", now) }
    }

    private fun active(accountId: UUID): ChallengeRow? = jdbc.sql("select * from gem_dungeon_challenge where account_id=:account and status='ACTIVE'")
        .param("account", accountId).query(::mapChallenge).optional().orElse(null)

    private fun challenge(challengeId: UUID, accountId: UUID, lock: Boolean): ChallengeRow? = jdbc.sql("select * from gem_dungeon_challenge where challenge_id=:challenge and account_id=:account${if (lock) " for update" else ""}")
        .params(mapOf("challenge" to challengeId, "account" to accountId)).query(::mapChallenge).optional().orElse(null)

    private fun mapChallenge(row: ResultSet, ignored: Int) = ChallengeRow(
        row.getObject("challenge_id", UUID::class.java),
        GemPreset.valueOf(row.getString("boss_type")),
        row.getInt("stage"),
        GemDungeonChallengeStatus.valueOf(row.getString("status")),
        row.getTimestamp("minimum_complete_at").toInstant(),
        row.getTimestamp("expires_at").toInstant(),
        row.getLong("reward_gem_boxes"),
        row.getString("content_version"),
        row.getString("battle_result"),
    )

    private fun view(row: ChallengeRow) = GemDungeonChallengeView(
        row.challengeId, row.boss, row.stage, row.status, row.minimumCompleteAt, row.expiresAt,
        row.rewardGemBoxes, row.contentVersion, mapper.readValue(row.battleJson, DungeonCombatResult::class.java),
    )

    private fun progress(accountId: UUID): List<GemDungeonProgress> {
        val stored = jdbc.sql("select boss_type,highest_cleared_stage from gem_dungeon_progress where account_id=:account")
            .param("account", accountId).query { row, _ -> GemPreset.valueOf(row.getString("boss_type")) to row.getInt("highest_cleared_stage") }.list().toMap()
        return GemRules.DUNGEON_BOSSES.map { GemDungeonProgress(it, stored[it] ?: 0) }
    }

    private fun rankings(accountId: UUID): Map<GemPreset, GemDungeonRanking> {
        val rows = jdbc.sql(
            """
            with highest_clear as (
                select account_id, boss_type, max(stage) as stage
                from gem_dungeon_first_clear
                group by account_id, boss_type
            ), ranked as (
                select h.account_id,
                       h.boss_type,
                       h.stage,
                       f.claimed_at,
                       c.nickname,
                       row_number() over (
                           partition by h.boss_type
                           order by h.stage desc, f.claimed_at asc, h.account_id asc
                       ) as ranking_position
                from highest_clear h
                join gem_dungeon_first_clear f
                  on f.account_id = h.account_id
                 and f.boss_type = h.boss_type
                 and f.stage = h.stage
                join character c on c.account_id = h.account_id
            )
            select account_id, boss_type, stage, claimed_at, nickname, ranking_position
            from ranked
            where ranking_position <= 5 or account_id = :account
            order by boss_type, ranking_position
            """.trimIndent(),
        ).param("account", accountId).query { row, _ ->
            RankingRow(
                accountId = row.getObject("account_id", UUID::class.java),
                boss = GemPreset.valueOf(row.getString("boss_type")),
                rank = row.getLong("ranking_position").toInt(),
                nickname = row.getString("nickname"),
                stage = row.getInt("stage"),
                clearedAt = row.getTimestamp("claimed_at").toInstant(),
            )
        }.list()
        return listOf(GemPreset.SURVIVAL, GemPreset.BERSERK, GemPreset.ARMORED).associateWith { boss ->
            val bossRows = rows.filter { it.boss == boss }
            fun RankingRow.view() = GemDungeonRankingEntry(rank, nickname, stage, clearedAt)
            GemDungeonRanking(
                topEntries = bossRows.filter { it.rank <= 5 }.map { it.view() },
                myEntry = bossRows.firstOrNull { it.accountId == accountId }?.view(),
            )
        }
    }

    private fun presetGemIds(accountId: UUID, preset: GemPreset): List<UUID> = jdbc.sql("select gem_id from gem_loadout where account_id=:account and preset=:preset order by slot_index")
        .params(mapOf("account" to accountId, "preset" to preset.name)).query(UUID::class.java).list()

    private fun requireUnlocked(accountId: UUID) = require(jdbc.sql("select count(*) from stage_progress where account_id=:account and stage_id='stage.01-05' and first_cleared_at is not null")
        .param("account", accountId).query(Long::class.java).single() > 0) { "GEMS_LOCKED" }

    /**
     * 던전 입장 자격만 확인한다. 티켓은 완료 때 빠지므로 여기서는 한 장도 쓰지 않고, 밀린
     * 충전분만 반영해 둔다.
     */
    private fun holdTicket(accountId: UUID) = settleTickets(accountId, consume = 0, minimum = 1)

    /** 티켓 [count] 장을 같은 transaction 안에서 차감한다. */
    private fun spendTickets(accountId: UUID, count: Int) = settleTickets(accountId, consume = count, minimum = count)

    /**
     * 티켓 상태를 바꾸는 유일한 경로다. 행을 잠그고 → 경과 충전분을 반영하고 → 검증하고 →
     * 차감한 값을 같은 transaction 에 저장한다. 계정 행도 이미 `command` 가 잠가 둔 뒤라,
     * 같은 계정으로 동시에 들어온 소탕·완료는 하나씩 줄을 서서 이 네 단계를 밟는다.
     *
     * 조회는 여기까지 내려오지 않는다. 같은 계산식은 [GemDungeonPolicy.ticketBalance] 가 갖고
     * 있고, 조회는 그 순수 함수만 부른다.
     */
    private fun settleTickets(accountId: UUID, consume: Int, minimum: Int) {
        val now = clock.instant()
        val balance = policy.ticketBalance(lockGemTickets(jdbc, accountId, policy.ticketInitialGrant, now), now)
        require(balance.tickets >= minimum) { "GEM_TICKET_EMPTY" }
        val settled = policy.afterConsuming(balance, consume, now)
        writeGemTickets(jdbc, accountId, settled.tickets, settled.rechargeAnchor)
    }

    private fun todayBoss(): GemPreset = GemRules.bossForSlot(policy.slotIndex(clock.instant()))

    private fun hasTestAccess(accountId: UUID): Boolean = jdbc.sql("select count(*) from gem_dungeon_test_access where account_id=:account")
        .param("account", accountId).query(Long::class.java).single() > 0

    private fun resolveBoss(requestedBoss: GemPreset?, testAccess: Boolean): GemPreset {
        if (requestedBoss == null) return todayBoss()
        require(requestedBoss != GemPreset.MAIN) { "INVALID_GEM_DUNGEON_BOSS" }
        require(testAccess) { "GEM_DUNGEON_TEST_ACCESS_REQUIRED" }
        return requestedBoss
    }

    private fun dungeonId(boss: GemPreset, stage: Int): String = "gem-dungeon.${boss.name.lowercase()}.$stage"

    private fun dbTime(value: Instant): Timestamp = Timestamp.from(value)

    private fun grantGemBoxes(accountId: UUID, quantity: Long) {
        inventory.grantStackOrReject(accountId, "GEM_BOX", quantity)
    }

    private fun lockAccount(accountId: UUID) {
        jdbc.sql("select id from account where id=:account for update").param("account", accountId).query(UUID::class.java)
            .optional().orElseThrow { IllegalArgumentException("AUTHENTICATION_REQUIRED") }
    }

    private fun incrementStateVersion(accountId: UUID): Long = jdbc.sql("update account set state_version=state_version+1 where id=:account returning state_version")
        .param("account", accountId).query(Long::class.java).single()

    private fun <T> command(accountId: UUID, key: UUID, source: String, type: Class<T>, action: () -> T): T {
        lockAccount(accountId)
        val fingerprint = sha256(source)
        commandRow(accountId, key)?.let { existing ->
            require(existing.fingerprint == fingerprint) { "IDEMPOTENCY_KEY_REUSED" }
            return mapper.readValue(existing.resultJson, type)
        }
        val result = action()
        jdbc.sql("insert into gem_command_record(command_id,account_id,idempotency_key,fingerprint,result_json) values (:command,:account,:key,:fingerprint,cast(:result as jsonb))")
            .params(mapOf("command" to UUID.randomUUID(), "account" to accountId, "key" to key, "fingerprint" to fingerprint, "result" to mapper.writeValueAsString(result))).update()
        return result
    }

    private fun commandRow(accountId: UUID, key: UUID): StoredCommand? = jdbc.sql("select fingerprint,result_json::text from gem_command_record where account_id=:account and idempotency_key=:key")
        .params(mapOf("account" to accountId, "key" to key)).query { row, _ -> StoredCommand(row.getString("fingerprint"), row.getString("result_json")) }.optional().orElse(null)

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(StandardCharsets.UTF_8)).joinToString("") { "%02x".format(it) }
}
