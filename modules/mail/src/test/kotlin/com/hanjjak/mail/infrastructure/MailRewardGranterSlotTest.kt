package com.hanjjak.mail.infrastructure

import com.hanjjak.cosmetics.domain.CosmeticDefinition
import com.hanjjak.cosmetics.domain.CosmeticGrade
import com.hanjjak.cosmetics.domain.CosmeticSlot
import com.hanjjak.cosmetics.domain.CosmeticsContent
import com.hanjjak.gems.domain.GemOption
import com.hanjjak.inventory.application.InventoryRepository
import com.hanjjak.inventory.application.InventoryReservationService
import com.hanjjak.inventory.application.ItemCatalog
import com.hanjjak.inventory.domain.INVENTORY_MAX_SLOTS
import com.hanjjak.inventory.domain.InventoryInstance
import com.hanjjak.inventory.domain.InventorySlots
import com.hanjjak.inventory.domain.InventoryStack
import com.hanjjak.inventory.infrastructure.StaticItemCatalog
import com.hanjjak.mail.domain.MailReward
import com.hanjjak.mail.domain.MailRewardKind
import org.springframework.jdbc.core.simple.JdbcClient
import org.h2.jdbcx.JdbcDataSource
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

/**
 * 보석 지급이 가방 칸을 어떻게 쓰는지만 본다. 같은 보석은 한 칸에 겹쳐 놓여야 하고,
 * 칸이 모자라면 한 개도 만들지 않아야 한다.
 */
class MailRewardGranterSlotTest {
    private val accountId = UUID.randomUUID()
    private val catalog: ItemCatalog = StaticItemCatalog()
    private val jdbc = JdbcClient.create(JdbcDataSource().apply { setURL("jdbc:h2:mem:${System.nanoTime()};MODE=PostgreSQL;NON_KEYWORDS=VALUE,OPTION;DB_CLOSE_DELAY=-1") })
    private val repository = MemoryInventory(catalog)
    private val cosmetics = CosmeticsContent(
        "test",
        5_000,
        CosmeticGrade.entries.associateWith { 250_000 },
        CosmeticGrade.entries.associateWith { listOf(1, 2, 3, 4, 5) },
        listOf(
            CosmeticDefinition("cosmetic-001", "가죽경갑 모자", null, CosmeticGrade.NORMAL, CosmeticSlot.HEAD, "cosmetic-set-01"),
            CosmeticDefinition("cosmetic-177", "긱시크안경", null, CosmeticGrade.NORMAL, CosmeticSlot.FACE, null),
        ),
        emptyList(),
    )
    private val granter = JdbcMailRewardGranter(
        jdbc, repository, InventoryReservationService(repository, catalog),
        Clock.fixed(Instant.parse("2026-09-15T03:00:00Z"), ZoneOffset.UTC),
        cosmetics,
    )

    init {
        jdbc.sql("create table gem_instance(gem_id uuid primary key,account_id uuid,level integer,option varchar,value integer,locked boolean,content_version varchar,created_at timestamp with time zone)").update()
        jdbc.sql("create table cosmetic_collection_state(account_id uuid,cosmetic_id varchar,registered_quantity integer,unregistered_quantity integer,reserved_quantity integer,primary key(account_id,cosmetic_id))").update()
        jdbc.sql("create table character(account_id uuid primary key,cosmetic_ticket_balance bigint not null default 0)").update()
        jdbc.sql("insert into character(account_id,cosmetic_ticket_balance) values (:account,0)").param("account", accountId).update()
    }

    private fun gem(quantity: Long, level: Int = 2, option: GemOption = GemOption.FLAT_ATTACK) =
        MailReward(MailRewardKind.GEM, quantity, gemLevel = level, gemOption = option.name)

    private fun ticketBalance(): Long = jdbc.sql("select cosmetic_ticket_balance from character where account_id=:account")
        .param("account", accountId).query(Long::class.java).single()

    /* 한 번에 받은 같은 보석 다섯 개가 다섯 칸을 차지하면 안 된다. */
    @Test
    fun `identical gems granted together share one slot`() {
        granter.grant(accountId, listOf(gem(5)))
        assertEquals(5, repository.instances(accountId).size)
        assertEquals(1, InventorySlots.instanceSlots(repository.instances(accountId)))
    }

    @Test
    fun `gems keep filling the slot a previous mail opened`() {
        granter.grant(accountId, listOf(gem(2)))
        granter.grant(accountId, listOf(gem(3)))
        assertEquals(1, InventorySlots.instanceSlots(repository.instances(accountId)))
    }

    /* 한 칸에는 99개까지다. 100개는 두 칸을 연다. */
    @Test
    fun `a hundred gems spill into a second slot`() {
        granter.grant(accountId, listOf(gem(100)))
        assertEquals(2, InventorySlots.instanceSlots(repository.instances(accountId)))
    }

    @Test
    fun `different options never share a slot`() {
        granter.grant(accountId, listOf(gem(1, option = GemOption.FLAT_ATTACK), gem(1, option = GemOption.FLAT_HP)))
        assertEquals(2, InventorySlots.instanceSlots(repository.instances(accountId)))
    }

    /* 자리가 없으면 한 개도 만들지 않는다. 절반만 받는 일은 없다. */
    @Test
    fun `a full bag rejects the whole grant`() {
        repeat(INVENTORY_MAX_SLOTS) { repository.addInstance(InventoryInstance(UUID.randomUUID(), accountId, "GEM_BOX", false, it.toLong())) }
        val failure = assertFailsWith<IllegalArgumentException> { granter.grant(accountId, listOf(gem(1))) }
        assertEquals("INVENTORY_CAPACITY_EXCEEDED", failure.message)
        assertEquals(INVENTORY_MAX_SLOTS, repository.instances(accountId).size)
    }

    /* 마지막 한 칸에 아이템과 보석이 함께 들어가려 하면 둘 다 거절한다. */
    @Test
    fun `an item and a gem cannot both take the last free slot`() {
        repeat(INVENTORY_MAX_SLOTS - 1) { repository.addInstance(InventoryInstance(UUID.randomUUID(), accountId, "GEM_BOX", false, it.toLong())) }
        val failure = assertFailsWith<IllegalArgumentException> {
            granter.grant(accountId, listOf(MailReward(MailRewardKind.ITEM, 1, itemId = "POTATO_M1"), gem(1)))
        }
        assertEquals("INVENTORY_CAPACITY_EXCEEDED", failure.message)
        assertEquals(0, repository.stacks(accountId).size)
    }

    /* 뽑기권은 가방이 아니라 캐릭터 잔액으로 들어간다. 가방이 꽉 차 있어도 받을 수 있다. */
    @Test
    fun `cosmetic tickets land on the character balance without a bag slot`() {
        repeat(INVENTORY_MAX_SLOTS) { repository.addInstance(InventoryInstance(UUID.randomUUID(), accountId, "GEM_BOX", false, it.toLong())) }
        granter.grant(accountId, listOf(MailReward(MailRewardKind.TICKET, 10)))
        assertEquals(10, ticketBalance())
    }

    /* 여러 줄로 와도 잔액은 한 번만 움직인다. */
    @Test
    fun `ticket rows add up across one grant and across mails`() {
        granter.grant(accountId, listOf(MailReward(MailRewardKind.TICKET, 3), MailReward(MailRewardKind.TICKET, 4)))
        granter.grant(accountId, listOf(MailReward(MailRewardKind.TICKET, 5)))
        assertEquals(12, ticketBalance())
    }

    /* 캐릭터를 만들지 않은 계정에는 지급할 곳이 없다. 조용히 흘려보내지 않는다. */
    @Test
    fun `a missing character rejects the ticket grant`() {
        val stranger = UUID.randomUUID()
        val failure = assertFailsWith<IllegalArgumentException> {
            granter.grant(stranger, listOf(MailReward(MailRewardKind.TICKET, 1)))
        }
        assertEquals("COSMETIC_TICKET_GRANT_FAILED", failure.message)
    }

    @Test
    fun `first cosmetic received by mail is registered and only extra copies stay unregistered`() {
        granter.grant(accountId, listOf(MailReward(MailRewardKind.COSMETIC, 3, cosmeticId = "cosmetic-001")))
        assertEquals(1 to 2, cosmeticState("cosmetic-001"))

        granter.grant(accountId, listOf(MailReward(MailRewardKind.COSMETIC, 2, cosmeticId = "cosmetic-001")))
        assertEquals(1 to 4, cosmeticState("cosmetic-001"))
    }

    @Test
    fun `non-set cosmetic cannot be granted twice by mail`() {
        granter.grant(accountId, listOf(MailReward(MailRewardKind.COSMETIC, 1, cosmeticId = "cosmetic-177")))
        val failure = assertFailsWith<IllegalArgumentException> {
            granter.grant(accountId, listOf(MailReward(MailRewardKind.COSMETIC, 1, cosmeticId = "cosmetic-177")))
        }
        assertEquals("COSMETIC_ALREADY_OWNED", failure.message)
        assertEquals(1 to 0, cosmeticState("cosmetic-177"))
    }

    private fun cosmeticState(cosmeticId: String): Pair<Int, Int> = jdbc.sql(
        "select registered_quantity,unregistered_quantity from cosmetic_collection_state where account_id=:account and cosmetic_id=:cosmetic",
    )
        .params(mapOf("account" to accountId, "cosmetic" to cosmeticId))
        .query { row, _ -> row.getInt("registered_quantity") to row.getInt("unregistered_quantity") }
        .single()

    private class MemoryInventory(private val catalog: ItemCatalog) : InventoryRepository {
        private val stacks = mutableMapOf<String, InventoryStack>()
        private val instances = mutableListOf<InventoryInstance>()
        private var sequence = 0L
        private var version = 1L

        override fun lockAccount(accountId: UUID) = Unit
        override fun stateVersion(accountId: UUID) = version
        override fun incrementStateVersion(accountId: UUID) = ++version
        override fun stacks(accountId: UUID) = stacks.values.toList()
        override fun instances(accountId: UUID) = instances.toList()
        override fun saveStack(stack: InventoryStack) { stacks[stack.itemId] = stack }
        override fun addInstance(instance: InventoryInstance) { instances += instance }
        override fun removeInstances(accountId: UUID, instanceIds: List<UUID>) { instances.removeAll { it.instanceId in instanceIds } }
        override fun setInstancesReserved(accountId: UUID, instanceIds: List<UUID>, reserved: Boolean) = Unit
        override fun transferInstances(fromAccountId: UUID, toAccountId: UUID, instanceIds: List<UUID>, reserved: Boolean) = Unit
        override fun hasCapacityReservation(accountId: UUID, itemId: String) = false
        override fun lockStack(accountId: UUID, itemId: String) = stacks[itemId]
        override fun usedSlotCount(accountId: UUID) = Math.toIntExact(
            stacks.values.sumOf { InventorySlots.stackSlots(it.quantity, catalog.require(it.itemId)) } +
                InventorySlots.instanceSlots(instances),
        )
        override fun nextAcquiredSequence(accountId: UUID) = ++sequence
        override fun rewardCommand(accountId: UUID, idempotencyKey: UUID): InventoryRepository.RewardCommand? = null
        override fun saveRewardCommand(accountId: UUID, idempotencyKey: UUID, fingerprint: String, resultJson: String) = Unit
    }
}
