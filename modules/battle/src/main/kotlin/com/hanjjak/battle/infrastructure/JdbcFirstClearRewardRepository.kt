package com.hanjjak.battle.infrastructure

import com.fasterxml.jackson.core.type.TypeReference
import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.battle.application.FirstClearRewardRepository
import com.hanjjak.inventory.domain.ItemReward
import org.springframework.jdbc.core.simple.JdbcClient
import java.time.Instant
import java.time.OffsetDateTime
import java.util.UUID

class JdbcFirstClearRewardRepository(
    private val jdbc: JdbcClient,
    private val mapper: ObjectMapper,
) : FirstClearRewardRepository {
    override fun lockAccount(accountId: UUID) {
        jdbc.sql("select id from account where id=:account for update").param("account", accountId).query(UUID::class.java).single()
    }
    override fun findByVersion(accountId: UUID, stageId: String, rewardVersion: String): FirstClearRewardRepository.RewardRow? = jdbc.sql(
        "select reward_id,account_id,stage_id,reward_version,source_id,rice_granted,tickets_granted,unlocked_skill_id,item_status,items_json::text,required_slots,claimed_at from stage_first_clear_reward where account_id=:account and stage_id=:stage and reward_version=:version",
    ).params(mapOf("account" to accountId, "stage" to stageId, "version" to rewardVersion)).query { row, _ -> rowToReward(row) }.optional().orElse(null)

    override fun insert(row: FirstClearRewardRepository.RewardRow): Boolean = jdbc.sql(
        "insert into stage_first_clear_reward(reward_id,account_id,stage_id,reward_version,source_id,rice_granted,tickets_granted,unlocked_skill_id,item_status,items_json,required_slots,claimed_at,created_at) values (:reward,:account,:stage,:version,:source,:rice,:tickets,:skill,:status,cast(:items as jsonb),:slots,:claimed,now()) on conflict(account_id,stage_id,reward_version) do nothing",
    ).params(
        mapOf(
            "reward" to row.rewardId,
            "account" to row.accountId,
            "stage" to row.stageId,
            "version" to row.rewardVersion,
            "source" to row.sourceId,
            "rice" to row.riceGranted,
            "tickets" to row.ticketsGranted,
            "skill" to row.unlockedSkillId,
            "status" to row.itemStatus,
            "items" to mapper.writeValueAsString(row.items),
            "slots" to row.requiredSlots,
            "claimed" to row.claimedAt?.let { OffsetDateTime.ofInstant(it, java.time.ZoneOffset.UTC) },
        ),
    ).update() == 1

    override fun lockReward(accountId: UUID, rewardId: UUID): FirstClearRewardRepository.RewardRow? = jdbc.sql(
        "select reward_id,account_id,stage_id,reward_version,source_id,rice_granted,tickets_granted,unlocked_skill_id,item_status,items_json::text,required_slots,claimed_at from stage_first_clear_reward where account_id=:account and reward_id=:reward for update",
    ).params(mapOf("account" to accountId, "reward" to rewardId)).query { row, _ -> rowToReward(row) }.optional().orElse(null)

    override fun pending(accountId: UUID): List<FirstClearRewardRepository.RewardRow> = jdbc.sql(
        "select reward_id,account_id,stage_id,reward_version,source_id,rice_granted,tickets_granted,unlocked_skill_id,item_status,items_json::text,required_slots,claimed_at from stage_first_clear_reward where account_id=:account and item_status='PENDING' order by created_at,reward_id",
    ).param("account", accountId).query { row, _ -> rowToReward(row) }.list()

    override fun markClaimed(rewardId: UUID, claimedAt: Instant) {
        jdbc.sql("update stage_first_clear_reward set item_status='CLAIMED',claimed_at=:claimed where reward_id=:reward")
            .params(mapOf("reward" to rewardId, "claimed" to OffsetDateTime.ofInstant(claimedAt, java.time.ZoneOffset.UTC))).update()
    }

    override fun claimCommand(accountId: UUID, idempotencyKey: UUID): FirstClearRewardRepository.ClaimCommand? = jdbc.sql(
        "select fingerprint,result_json::text from first_clear_reward_claim_command where account_id=:account and idempotency_key=:key",
    ).params(mapOf("account" to accountId, "key" to idempotencyKey)).query { row, _ -> FirstClearRewardRepository.ClaimCommand(row.getString("fingerprint"), row.getString("result_json")) }.optional().orElse(null)

    /* 계정 행 잠금은 호출자가 이미 들고 있다. 치장 뽑기권은 character 컬럼이라 여기서 바로 올린다.
       bigint 라 현실적으로 넘칠 일은 없지만, 기존 치장 지갑과 같은 가드를 둔다. */
    override fun creditTickets(accountId: UUID, amount: Long) {
        require(amount >= 0) { "INVALID_TICKET_AMOUNT" }
        if (amount == 0L) return
        /* 컬럼에 이미 `>= 0` 제약이 걸려 있고 여기서는 더하기만 한다. 0행이 나오면 잔액 문제가
           아니라 캐릭터 행이 없다는 뜻이므로 그렇게 말한다. */
        val changed = jdbc.sql("update character set cosmetic_ticket_balance=cosmetic_ticket_balance+:amount where account_id=:account")
            .params(mapOf("account" to accountId, "amount" to amount)).update()
        require(changed == 1) { "FIRST_CLEAR_TICKET_GRANT_FAILED" }
    }

    override fun saveClaimCommand(accountId: UUID, idempotencyKey: UUID, rewardId: UUID, fingerprint: String, resultJson: String) {
        jdbc.sql("insert into first_clear_reward_claim_command(account_id,idempotency_key,reward_id,fingerprint,result_json,created_at) values (:account,:key,:reward,:fingerprint,cast(:result as jsonb),now())")
            .params(mapOf("account" to accountId, "key" to idempotencyKey, "reward" to rewardId, "fingerprint" to fingerprint, "result" to resultJson)).update()
    }

    private fun rowToReward(row: java.sql.ResultSet): FirstClearRewardRepository.RewardRow = FirstClearRewardRepository.RewardRow(
        rewardId = row.getObject("reward_id", UUID::class.java),
        accountId = row.getObject("account_id", UUID::class.java),
        stageId = row.getString("stage_id"),
        rewardVersion = row.getString("reward_version"),
        sourceId = row.getObject("source_id", UUID::class.java),
        riceGranted = row.getLong("rice_granted"),
        ticketsGranted = row.getLong("tickets_granted"),
        unlockedSkillId = row.getString("unlocked_skill_id"),
        itemStatus = row.getString("item_status"),
        items = mapper.readValue(row.getString("items_json"), object : TypeReference<List<ItemReward>>() {}),
        requiredSlots = row.getInt("required_slots"),
        claimedAt = row.getObject("claimed_at", OffsetDateTime::class.java)?.toInstant(),
    )
}
