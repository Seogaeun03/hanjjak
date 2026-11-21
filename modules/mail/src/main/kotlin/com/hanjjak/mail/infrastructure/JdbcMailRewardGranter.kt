package com.hanjjak.mail.infrastructure

import com.hanjjak.cosmetics.domain.CosmeticState
import com.hanjjak.cosmetics.domain.CosmeticsContent
import com.hanjjak.cosmetics.domain.CosmeticsRules
import com.hanjjak.gems.domain.GemOption
import com.hanjjak.gems.domain.GemRules
import com.hanjjak.inventory.application.InventoryRepository
import com.hanjjak.inventory.application.InventoryReservationService
import com.hanjjak.inventory.domain.INVENTORY_MAX_SLOTS
import com.hanjjak.inventory.domain.InventoryInstance
import com.hanjjak.inventory.domain.InventorySlots
import com.hanjjak.inventory.domain.ItemReward
import com.hanjjak.mail.application.MailRewardGranter
import com.hanjjak.mail.domain.MailReward
import com.hanjjak.mail.domain.MailRewardKind
import org.springframework.jdbc.core.simple.JdbcClient
import java.sql.Timestamp
import java.time.Clock
import java.util.UUID

/**
 * 우편 보상을 실제 소유로 옮긴다.
 *
 * 쓰기는 한 줄도 하기 전에 필요한 칸을 모두 세어 본다. 아이템 스택과 보석 묶음이 같은
 * 200칸을 나눠 쓰므로, 아이템만 따로 검사하면 보석을 넣을 자리가 없다는 것을 뒤늦게 알게 된다.
 */
class JdbcMailRewardGranter(
    private val jdbc: JdbcClient,
    private val repository: InventoryRepository,
    private val reservation: InventoryReservationService,
    private val clock: Clock,
    private val cosmeticsContent: CosmeticsContent,
) : MailRewardGranter {
    private data class GemPlacement(
        val level: Int,
        val option: GemOption,
        val slotId: UUID,
        val stackKey: String,
        val locked: Boolean,
        val opensNewSlot: Boolean = false,
    )

    override fun grant(accountId: UUID, rewards: List<MailReward>) {
        if (rewards.isEmpty()) return
        repository.lockAccount(accountId)

        val items = rewards.filter { it.kind == MailRewardKind.ITEM }
            .map { ItemReward(requireNotNull(it.itemId) { "INVALID_MAIL_REWARD" }, it.quantity) }
        val gems = rewards.filter { it.kind == MailRewardKind.GEM }
        val cosmetics = rewards.filter { it.kind == MailRewardKind.COSMETIC }
        val tickets = rewards.filter { it.kind == MailRewardKind.TICKET }.sumOf { it.quantity }

        val plan = items.takeIf { it.isNotEmpty() }?.let { reservation.planStackGrant(accountId, it) }
        require(plan == null || plan.canGrant) { "INVENTORY_CAPACITY_EXCEEDED" }
        val freeSlots = (plan?.let { it.availableSlots - it.requiredSlots }
            ?: (INVENTORY_MAX_SLOTS - repository.usedSlotCount(accountId))).coerceAtLeast(0)

        val placements = planGems(accountId, gems)
        require(placements.count { it.opensNewSlot } <= freeSlots) { "INVENTORY_CAPACITY_EXCEEDED" }

        plan?.let { reservation.applyStackGrant(accountId, it, bumpStateVersion = false) }
        placements.forEach { createGem(accountId, it) }
        cosmetics.forEach { grantCosmetic(accountId, it) }
        grantTickets(accountId, tickets)
        repository.incrementStateVersion(accountId)
    }

    /**
     * 같은 등급·옵션의 보석은 한 칸에 최대 99개까지 겹쳐 놓인다. 이미 열려 있는 칸에 남은
     * 자리부터 채우고, 넘칠 때만 새 칸을 잡는다. 여기서는 새 칸이 몇 개 필요한지만 센다.
     */
    private fun planGems(accountId: UUID, gems: List<MailReward>): List<GemPlacement> {
        if (gems.isEmpty()) return emptyList()
        val instances = repository.instances(accountId)
        val roomBySlot = mutableMapOf<UUID, Int>()
        /* 이번에 새로 여는 칸도 기억해 둔다. 같은 보석 다섯 개가 다섯 칸을 차지하면 안 된다. */
        val openSlotByGroup = mutableMapOf<String, UUID>()
        return gems.flatMap { reward ->
            val level = requireNotNull(reward.gemLevel) { "INVALID_MAIL_REWARD" }
            val option = GemOption.valueOf(requireNotNull(reward.gemOption) { "INVALID_MAIL_REWARD" })
            val value = GemRules.fixedValue(level, option)
            val locked = GemRules.autoLocked(option)
            val itemId = gemItemId(level, option)
            val stackKey = InventorySlots.gemKey(level, option.name, value)
            val group = listOf(itemId, stackKey, locked.toString()).joinToString("/")
            val peers = instances.filter { it.itemId == itemId && it.stackKey == stackKey && it.locked == locked }
            peers.groupingBy { it.inventorySlotId }.eachCount().forEach { (slotId, count) ->
                if (slotId != null) roomBySlot.putIfAbsent(slotId, (InventorySlots.GEM_LIMIT.toInt() - count).coerceAtLeast(0))
            }
            peers.lastOrNull()?.inventorySlotId?.let { openSlotByGroup.putIfAbsent(group, it) }
            (0 until reward.quantity).map {
                val open = openSlotByGroup[group]?.takeIf { slot -> (roomBySlot[slot] ?: 0) > 0 }
                if (open != null) {
                    roomBySlot[open] = roomBySlot.getValue(open) - 1
                    GemPlacement(level, option, open, stackKey, locked)
                } else {
                    // 새 칸을 연다. 뒤따르는 같은 보석은 이 칸의 남은 98자리부터 채운다.
                    val fresh = UUID.randomUUID()
                    roomBySlot[fresh] = InventorySlots.GEM_LIMIT.toInt() - 1
                    openSlotByGroup[group] = fresh
                    GemPlacement(level, option, fresh, stackKey, locked, opensNewSlot = true)
                }
            }
        }
    }

    private fun createGem(accountId: UUID, placement: GemPlacement) {
        val gemId = UUID.randomUUID()
        val value = GemRules.fixedValue(placement.level, placement.option)
        repository.addInstance(
            InventoryInstance(
                gemId, accountId, gemItemId(placement.level, placement.option), false,
                repository.nextAcquiredSequence(accountId), placement.stackKey, placement.slotId, placement.locked,
            ),
        )
        jdbc.sql("insert into gem_instance(gem_id,account_id,level,option,value,locked,content_version,created_at) values (:gem,:account,:level,:option,:value,:locked,'gem-v1-draft',:now)")
            .params(
                mapOf(
                    "gem" to gemId, "account" to accountId, "level" to placement.level, "option" to placement.option.name,
                    "value" to value, "locked" to placement.locked, "now" to Timestamp.from(clock.instant()),
                ),
            ).update()
    }

    /** 치장은 가방 칸을 쓰지 않는다. 최초 한 개는 모든 획득 경로와 같이 즉시 등록한다. */
    private fun grantCosmetic(accountId: UUID, reward: MailReward) {
        val cosmeticId = requireNotNull(reward.cosmeticId) { "INVALID_MAIL_REWARD" }
        val definition = cosmeticsContent.cosmetics.firstOrNull { it.id == cosmeticId }
            ?: throw IllegalArgumentException("COSMETIC_NOT_FOUND")
        require(reward.quantity <= Int.MAX_VALUE) { "INVALID_QUANTITY" }
        val current = jdbc.sql(
            "select registered_quantity,unregistered_quantity,reserved_quantity from cosmetic_collection_state where account_id=:account and cosmetic_id=:cosmetic for update",
        )
            .params(mapOf("account" to accountId, "cosmetic" to cosmeticId))
            .query { row, _ ->
                CosmeticState(
                    accountId,
                    cosmeticId,
                    row.getInt("registered_quantity"),
                    row.getInt("unregistered_quantity"),
                    row.getInt("reserved_quantity"),
                )
            }
            .optional()
            .orElse(null)
        val next = CosmeticsRules.receive(
            current,
            accountId,
            cosmeticId,
            reward.quantity.toInt(),
            allowDuplicates = definition.setId != null,
        ).first
        if (current == null) {
            jdbc.sql(
                "insert into cosmetic_collection_state(account_id,cosmetic_id,registered_quantity,unregistered_quantity,reserved_quantity) values (:account,:cosmetic,:registered,:unregistered,0)",
            )
                .params(mapOf("account" to accountId, "cosmetic" to cosmeticId, "registered" to next.registeredQuantity, "unregistered" to next.unregisteredQuantity))
                .update()
        } else {
            jdbc.sql(
                "update cosmetic_collection_state set registered_quantity=:registered,unregistered_quantity=:unregistered where account_id=:account and cosmetic_id=:cosmetic",
            )
                .params(mapOf("account" to accountId, "cosmetic" to cosmeticId, "registered" to next.registeredQuantity, "unregistered" to next.unregisteredQuantity))
                .update()
        }
    }

    /**
     * 치장 뽑기권은 가방이 아니라 캐릭터 한 칸에 쌓인다. 여러 줄로 와도 한 번에 더해
     * 잔액을 한 번만 건드린다. 캐릭터 행이 없으면 지급할 곳이 없다는 뜻이므로 막는다.
     */
    private fun grantTickets(accountId: UUID, quantity: Long) {
        if (quantity <= 0) return
        val changed = jdbc.sql("update character set cosmetic_ticket_balance=cosmetic_ticket_balance+:quantity where account_id=:account")
            .params(mapOf("account" to accountId, "quantity" to quantity))
            .update()
        require(changed == 1) { "COSMETIC_TICKET_GRANT_FAILED" }
    }

    private fun gemItemId(level: Int, option: GemOption): String = "gem:$level:${option.name.lowercase()}"
}
