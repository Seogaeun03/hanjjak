package com.hanjjak.cosmetics.application

import com.hanjjak.cosmetics.domain.*
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class CosmeticsServiceTest {
    private val account = UUID.randomUUID()
    private val setSlots = listOf(CosmeticSlot.HEAD, CosmeticSlot.TOP, CosmeticSlot.BOTTOM, CosmeticSlot.GLOVES, CosmeticSlot.SHOES, CosmeticSlot.CAPE)
    private val definitions = setSlots.mapIndexed { index, slot ->
        CosmeticDefinition("cosmetic-${String.format("%03d", index + 61)}", null, null, CosmeticGrade.LEGENDARY, slot, "cosmetic-set-11")
    }
    private val thresholds = CosmeticGrade.entries.associateWith { grade ->
        if (grade == CosmeticGrade.LEGENDARY) listOf(1, 2, 3, 5, 10) else listOf(1, 100, 200, 300, 400)
    }
    private val content = CosmeticsContent(
        "catalog-v2", 5_000, CosmeticGrade.entries.associateWith { 250_000 }, thresholds, definitions,
        listOf(SetDefinition("cosmetic-set-11", null, CosmeticGrade.LEGENDARY, "cosmetic-banner-01", "cosmetic-selector-box-01", definitions.associate { it.slot to it.id },
            mapOf(1 to listOf(StatEffect("attackPercent", 25, EffectUnit.BASIS_POINTS))))),
    )
    private class MemoryRepository(private val account: UUID) : CosmeticsRepository {
        var state = CosmeticState(account, "cosmetic-061", 1, 5, 0)
        var equipment: String? = "cosmetic-061"
        var allStates: List<CosmeticState>? = null
        val equipmentBySlot = mutableMapOf<CosmeticSlot, String?>()
        var writes = 0
        override fun stateVersion(accountId: UUID) = 42L
        override fun lockAccount(accountId: UUID) = Unit
        override fun findStates(accountId: UUID) = allStates ?: listOf(state)
        override fun findStatesForUpdate(accountId: UUID) = findStates(accountId)
        override fun findStateForUpdate(accountId: UUID, cosmeticId: String) = state.takeIf { it.cosmeticId == cosmeticId }
        override fun saveState(state: CosmeticState) {
            if (allStates == null) this.state = state
            else allStates = allStates!!.map { if (it.cosmeticId == state.cosmeticId) state else it }
            writes++
        }
        override fun findEquipment(accountId: UUID) = if (equipmentBySlot.isEmpty()) listOf(EquipmentSlot(account, CosmeticSlot.HEAD, equipment)) else equipmentBySlot.map { (slot, cosmeticId) -> EquipmentSlot(account, slot, cosmeticId) }
        override fun saveEquipment(accountId: UUID, slot: CosmeticSlot, cosmeticId: String?) { equipment = cosmeticId; equipmentBySlot[slot] = cosmeticId; writes++ }
        override fun findColor(accountId: UUID): String? = chosenColor
        override fun saveColor(accountId: UUID, color: String?) { chosenColor = color }
        var chosenColor: String? = null
    }
    private class Wallet(private val unlocked: Boolean) : CosmeticsWallet {
        override fun balance(accountId: UUID) = CosmeticsWallet.Balance(0, 0, unlocked)
        override fun balanceForUpdate(accountId: UUID) = CosmeticsWallet.Balance(0, 0, unlocked)
        override fun milestone(accountId: UUID, bannerId: String, boxItemId: String) = CosmeticsWallet.Milestone(0, 0, 0)
        override fun debit(accountId: UUID, rice: Long, tickets: Long, sourceId: UUID) = error("not used")
        override fun addDraws(accountId: UUID, bannerId: String, count: Int) = error("not used")
        override fun claimBoxes(accountId: UUID, bannerId: String, boxItemId: String, count: Long): Long = error("not used")
        override fun openBox(accountId: UUID, boxItemId: String) = error("not used")
        override fun preflightCreditTicketsLocked(accountId: UUID, amount: Long) = error("not used")
        override fun creditTicketsLocked(accountId: UUID, amount: Long, sourceId: UUID) = error("not used")
    }

    @Test
    fun `locked account can read display catalog but collection and commands fail before asset changes`() {
        val repository = MemoryRepository(account)
        val service = CosmeticsService(repository, content, Wallet(false))
        assertEquals(content.version, service.catalog(account).data.contentVersion)
        val operations = listOf<() -> Any>(
            { service.versionedCollection(account) },
            { service.register(account, "cosmetic-061", RegistrationMode.UNTIL_NEXT_STAR) },
            { service.equip(account, CosmeticSlot.HEAD, null) }, { service.receive(account, "cosmetic-061") },
        )
        operations.forEach { action -> assertEquals("COSMETICS_LOCKED", assertFailsWith<IllegalArgumentException> { action() }.message) }
        assertEquals(0, repository.writes)
        assertEquals(1, repository.state.registeredQuantity)
        assertEquals("cosmetic-061", repository.equipment)
        assertEquals(emptyList(), service.snapshotForCombat(account).totalEffects)
    }

    @Test
    fun `catalog includes nullable metadata and generic effects with matching collection version`() {
        val service = CosmeticsService(MemoryRepository(account), content, Wallet(true))
        val catalog = service.catalog(account)
        val collection = service.versionedCollection(account)
        assertEquals(42L, catalog.stateVersion)
        assertEquals(42L, collection.stateVersion)
        assertEquals("catalog-v2", catalog.data.contentVersion)
        assertEquals(catalog.data.contentVersion, collection.data.contentVersion)
        assertEquals(6, catalog.data.cosmetics.size)
        assertEquals(null, catalog.data.cosmetics.first().displayName)
        assertEquals(null, catalog.data.cosmetics.first().imageUrl)
        assertEquals(listOf(StatEffect("attackPercent", 25, EffectUnit.BASIS_POINTS)), catalog.data.sets.single().effects[1])
        assertEquals("NOT_OWNED", collection.data.states.first { it.cosmeticId == "cosmetic-066" }.upgradeDisabledReason)
    }

    @Test
    fun `registration uses the owned cosmetic grade thresholds`() {
        val repository = MemoryRepository(account).apply { state = state.copy(registeredQuantity = 2) }
        val service = CosmeticsService(repository, content, Wallet(true))
        service.register(account, "cosmetic-061", RegistrationMode.UNTIL_NEXT_STAR)
        assertEquals(3, repository.state.registeredQuantity)
        assertEquals(4, repository.state.unregisteredQuantity)
    }

    @Test
    fun `cosmetics outside the collection reject acquisition after the first`() {
        val loose = CosmeticDefinition("cosmetic-loose-head", null, null, CosmeticGrade.NORMAL, CosmeticSlot.HEAD, null)
        val looseContent = content.copy(cosmetics = content.cosmetics + loose)
        val repository = MemoryRepository(account).apply {
            state = CosmeticState(account, loose.id, 1, 0, 0)
        }
        val service = CosmeticsService(repository, looseContent, Wallet(true))

        val error = assertFailsWith<IllegalArgumentException> { service.receive(account, loose.id) }

        assertEquals("COSMETIC_ALREADY_OWNED", error.message)
        assertEquals(1, repository.state.registeredQuantity)
        assertEquals(0, repository.state.unregisteredQuantity)
        assertEquals(0, repository.writes)
    }

    @Test
    fun `bulk registration upgrades every eligible cosmetic once and reports the actual count`() {
        val repository = MemoryRepository(account).apply {
            allStates = listOf(
                CosmeticState(account, "cosmetic-061", 1, 1, 0),
                CosmeticState(account, "cosmetic-062", 2, 1, 0),
                CosmeticState(account, "cosmetic-063", 1, 1, 1),
                CosmeticState(account, "cosmetic-064", 10, 3, 0),
            )
        }
        val service = CosmeticsService(repository, content, Wallet(true))

        val result = service.bulkRegisterUntilNextStar(account)

        assertEquals(2, result.upgradedCount)
        assertEquals(2, result.collection.states.first { it.cosmeticId == "cosmetic-061" }.registeredQuantity)
        assertEquals(3, result.collection.states.first { it.cosmeticId == "cosmetic-062" }.registeredQuantity)
        assertEquals(1, result.collection.states.first { it.cosmeticId == "cosmetic-063" }.registeredQuantity)
        assertEquals(10, result.collection.states.first { it.cosmeticId == "cosmetic-064" }.registeredQuantity)
        assertEquals(2, repository.writes)
    }

}
