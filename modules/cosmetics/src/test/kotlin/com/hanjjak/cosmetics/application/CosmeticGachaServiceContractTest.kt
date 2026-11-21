package com.hanjjak.cosmetics.application

import com.hanjjak.cosmetics.domain.*
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class CosmeticGachaServiceContractTest {
    private val account = UUID.fromString("11111111-1111-1111-1111-111111111111")
    private val content = CosmeticsContent(
        "cosmetics-v2-placeholder", 5_000,
        mapOf(CosmeticGrade.NORMAL to 500_000, CosmeticGrade.RARE to 350_000, CosmeticGrade.EPIC to 140_000, CosmeticGrade.LEGENDARY to 10_000),
        CosmeticGrade.entries.associateWith { listOf(1, 2, 3, 4, 5) },
        listOf(
            CosmeticDefinition("cosmetic-1", null, null, CosmeticGrade.NORMAL, CosmeticSlot.HEAD, "set-1"),
            CosmeticDefinition("cosmetic-face-1", null, null, CosmeticGrade.NORMAL, CosmeticSlot.FACE, null),
            CosmeticDefinition("cosmetic-face-2", null, null, CosmeticGrade.NORMAL, CosmeticSlot.FACE, null),
            CosmeticDefinition("cosmetic-loose-head", null, null, CosmeticGrade.NORMAL, CosmeticSlot.HEAD, null),
            CosmeticDefinition("cosmetic-2", null, null, CosmeticGrade.RARE, CosmeticSlot.TOP, "set-1"),
            CosmeticDefinition("cosmetic-3", null, null, CosmeticGrade.EPIC, CosmeticSlot.BOTTOM, "set-1"),
            CosmeticDefinition("cosmetic-4", null, null, CosmeticGrade.LEGENDARY, CosmeticSlot.CAPE, "set-1"),
            CosmeticDefinition("cosmetic-5", null, null, CosmeticGrade.LEGENDARY, CosmeticSlot.HEAD, "set-2"),
            CosmeticDefinition("cosmetic-6", null, null, CosmeticGrade.LEGENDARY, CosmeticSlot.HEAD, "set-3"),
            CosmeticDefinition("cosmetic-7", null, null, CosmeticGrade.LEGENDARY, CosmeticSlot.HEAD, "set-4"),
            CosmeticDefinition("cosmetic-event", null, null, CosmeticGrade.RARE, CosmeticSlot.TOP, null, gachaEligible = false),
        ),
        listOf(
            SetDefinition("set-1", null, CosmeticGrade.LEGENDARY, "banner-1", "box-1", mapOf(CosmeticSlot.CAPE to "cosmetic-4"), emptyMap()),
            SetDefinition("set-2", null, CosmeticGrade.LEGENDARY, null, null, mapOf(CosmeticSlot.HEAD to "cosmetic-5"), emptyMap()),
            SetDefinition("set-3", null, CosmeticGrade.LEGENDARY, null, null, mapOf(CosmeticSlot.HEAD to "cosmetic-6"), emptyMap()),
            SetDefinition("set-4", null, CosmeticGrade.LEGENDARY, null, null, mapOf(CosmeticSlot.HEAD to "cosmetic-7"), emptyMap()),
        ),
    )

    private class Repository(initialStates: List<CosmeticState> = emptyList()) : CosmeticsRepository {
        private val states = initialStates.associateByTo(mutableMapOf()) { it.cosmeticId }
        override fun stateVersion(accountId: UUID) = 1L
        override fun findStates(accountId: UUID) = states.values.toList()
        override fun findStatesForUpdate(accountId: UUID) = findStates(accountId)
        override fun findStateForUpdate(accountId: UUID, cosmeticId: String) = states[cosmeticId]
        override fun lockAccount(accountId: UUID) = Unit
        override fun saveState(state: CosmeticState) { states[state.cosmeticId] = state }
        override fun findEquipment(accountId: UUID) = emptyList<EquipmentSlot>()
        override fun saveEquipment(accountId: UUID, slot: CosmeticSlot, cosmeticId: String?) = Unit
        override fun findColor(accountId: UUID): String? = chosenColor
        override fun saveColor(accountId: UUID, color: String?) { chosenColor = color }
        var chosenColor: String? = null
    }

    private class Wallet : CosmeticsWallet {
        val openedBoxes = mutableListOf<String>()
        override fun balance(accountId: UUID) = CosmeticsWallet.Balance(100_000, 0, true)
        override fun balanceForUpdate(accountId: UUID) = CosmeticsWallet.Balance(100_000, 0, true)
        override fun milestone(accountId: UUID, bannerId: String, boxItemId: String) = CosmeticsWallet.Milestone(0, 0, 0)
        override fun debit(accountId: UUID, rice: Long, tickets: Long, sourceId: UUID) = Unit
        override fun addDraws(accountId: UUID, bannerId: String, count: Int) = Unit
        override fun claimBoxes(accountId: UUID, bannerId: String, boxItemId: String, count: Long) = 0L
        override fun openBox(accountId: UUID, boxItemId: String) { openedBoxes += boxItemId }
        override fun preflightCreditTicketsLocked(accountId: UUID, amount: Long) = Unit
        override fun creditTicketsLocked(accountId: UUID, amount: Long, sourceId: UUID) = Unit
    }

    private class FixedEntropy(override val isAvailable: Boolean) : DrawEntropy {
        override fun issue(accountId: UUID, bannerId: String, count: Int, contentVersion: String) = DrawEntropy.Issued(
            HmacDrawEntropy.ALGORITHM_VERSION, "test-key", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", DrawRandom(ByteArray(32) { 9 }),
        )
    }

    @Test
    fun `unavailable entropy blocks banner and draw without touching wallet`() {
        val service = CosmeticGachaService(CosmeticsService(Repository(), content, Wallet()), Wallet(), FixedEntropy(false))
        assertEquals("GACHA_CONTENT_UNAVAILABLE", assertFailsWith<IllegalArgumentException> { service.banners(account) }.message)
        assertEquals("GACHA_CONTENT_UNAVAILABLE", assertFailsWith<IllegalArgumentException> { service.draw(account, "banner-1", 1, UUID.randomUUID()) }.message)
    }

    @Test
    fun `draw uses server entropy and preserves result count`() {
        val service = CosmeticGachaService(CosmeticsService(Repository(), content, Wallet()), Wallet(), FixedEntropy(true))
        val response = service.draw(account, "banner-1", 10, UUID.randomUUID())
        assertEquals(10, response.results.size)
        assertEquals(50_000, response.riceCost)
    }

    @Test
    fun `banner detail exposes exact per-item probability denominator`() {
        val service = CosmeticGachaService(CosmeticsService(Repository(), content, Wallet()), Wallet(), FixedEntropy(true))
        val detail = service.detail(account, "banner-1")
        val normal = detail.pool.filter { it.grade == CosmeticGrade.NORMAL }

        assertTrue(normal.all { it.probabilityNumerator == 500_000 })
        assertTrue(normal.all { it.probabilityDenominator == 4_000_000L })
    }

    @Test
    fun `shared gacha banner exposes every active legendary cosmetic`() {
        val service = CosmeticGachaService(CosmeticsService(Repository(), content, Wallet()), Wallet(), FixedEntropy(true))

        val legendaryPool = service.detail(account, "banner-1").pool.filter { it.grade == CosmeticGrade.LEGENDARY }

        assertEquals(listOf("cosmetic-4", "cosmetic-5", "cosmetic-6", "cosmetic-7"), legendaryPool.map { it.cosmeticId })
        assertTrue(legendaryPool.all { it.probabilityDenominator == 4_000_000L })
    }

    @Test
    fun `acquired cosmetics outside the collection disappear from banner detail while set cosmetics remain`() {
        val repository = Repository(listOf(CosmeticState(account, "cosmetic-loose-head", 1, 0, 0)))
        val wallet = Wallet()
        val service = CosmeticGachaService(CosmeticsService(repository, content, wallet), wallet, FixedEntropy(true))

        val normalPool = service.detail(account, "banner-1").pool.filter { it.grade == CosmeticGrade.NORMAL }

        assertEquals(listOf("cosmetic-1", "cosmetic-face-1", "cosmetic-face-2"), normalPool.map { it.cosmeticId })
        assertTrue(normalPool.all { it.probabilityDenominator == 3_000_000L })
    }

    @Test
    fun `event only cosmetics never enter the shared gacha pool`() {
        val service = CosmeticGachaService(CosmeticsService(Repository(), content, Wallet()), Wallet(), FixedEntropy(true))

        assertTrue(service.detail(account, "banner-1").pool.none { it.cosmeticId == "cosmetic-event" })
    }

    @Test
    fun `ten draw cannot award any cosmetic outside the collection more than once`() {
        val normalOnly = content.copy(gradeProbabilities = CosmeticGrade.entries.associateWith { if (it == CosmeticGrade.NORMAL) 1_000_000 else 0 })
        val wallet = Wallet()
        val service = CosmeticGachaService(CosmeticsService(Repository(), normalOnly, wallet), wallet, FixedEntropy(true))

        val response = service.draw(account, "banner-1", 10, UUID.randomUUID())
        val looseResults = response.results.filter { result ->
            normalOnly.cosmetics.single { it.id == result.cosmeticId }.setId == null
        }

        assertEquals(looseResults.map { it.cosmeticId }.distinct(), looseResults.map { it.cosmeticId })
        assertTrue(looseResults.all { it.isNew })
        assertTrue(response.results.filter { it.cosmeticId == "cosmetic-1" }.size > 1)
    }

    @Test
    fun `actual legendary draw can return cosmetics outside the banner metadata set`() {
        val legendaryOnly = content.copy(gradeProbabilities = CosmeticGrade.entries.associateWith { if (it == CosmeticGrade.LEGENDARY) 1_000_000 else 0 })
        val service = CosmeticGachaService(CosmeticsService(Repository(), legendaryOnly, Wallet()), Wallet(), FixedEntropy(true))

        val response = service.draw(account, "banner-1", 10, UUID.randomUUID())

        assertTrue(response.results.all { it.grade == CosmeticGrade.LEGENDARY && it.cosmeticId in setOf("cosmetic-4", "cosmetic-5", "cosmetic-6", "cosmetic-7") })
        assertTrue(response.results.any { it.cosmeticId != "cosmetic-4" })
    }

    @Test
    fun `selector box accepts a legendary cosmetic from any legendary set`() {
        val wallet = Wallet()
        val service = CosmeticGachaService(CosmeticsService(Repository(), content, wallet), wallet, FixedEntropy(true))

        val result = service.openBox(account, "box-1", "cosmetic-5")

        assertEquals(listOf("box-1"), wallet.openedBoxes)
        assertEquals(1, result.states.single { it.cosmeticId == "cosmetic-5" }.registeredQuantity)
    }

    @Test
    fun `selector box rejects a non legendary cosmetic without consuming the box`() {
        val wallet = Wallet()
        val service = CosmeticGachaService(CosmeticsService(Repository(), content, wallet), wallet, FixedEntropy(true))

        assertEquals("INVALID_SELECTOR_COSMETIC", assertFailsWith<IllegalArgumentException> {
            service.openBox(account, "box-1", "cosmetic-2")
        }.message)
        assertEquals(emptyList(), wallet.openedBoxes)
    }
}
