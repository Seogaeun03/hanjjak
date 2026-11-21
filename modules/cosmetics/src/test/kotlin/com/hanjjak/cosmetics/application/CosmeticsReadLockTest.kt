package com.hanjjak.cosmetics.application

import com.hanjjak.cosmetics.domain.*
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/**
 * 치장 조회는 잠금 없는 잔액·해금 조회만 쓰고, 뽑기·등록·장착·수령은 기존 계정 잠금과
 * 잠금 읽기를 그대로 쓴다는 것을 고정한다. 저장소·지갑 호출을 순서까지 기록해 확인한다.
 */
class CosmeticsReadLockTest {
    private val account = UUID.fromString("22222222-2222-2222-2222-222222222222")
    private val content = CosmeticsContent(
        "cosmetics-lock-test", 5_000,
        mapOf(CosmeticGrade.NORMAL to 500_000, CosmeticGrade.RARE to 350_000, CosmeticGrade.EPIC to 140_000, CosmeticGrade.LEGENDARY to 10_000),
        CosmeticGrade.entries.associateWith { listOf(1, 2, 3, 4, 5) },
        listOf(
            CosmeticDefinition("cosmetic-1", null, null, CosmeticGrade.NORMAL, CosmeticSlot.HEAD, "set-1"),
            CosmeticDefinition("cosmetic-2", null, null, CosmeticGrade.RARE, CosmeticSlot.TOP, "set-1"),
            CosmeticDefinition("cosmetic-3", null, null, CosmeticGrade.EPIC, CosmeticSlot.BOTTOM, "set-1"),
            CosmeticDefinition("cosmetic-4", null, null, CosmeticGrade.LEGENDARY, CosmeticSlot.CAPE, "set-1"),
        ),
        listOf(
            SetDefinition(
                "set-1", null, CosmeticGrade.LEGENDARY, "banner-1", "box-1", mapOf(CosmeticSlot.CAPE to "cosmetic-4"),
                mapOf(1 to listOf(StatEffect("attackPercent", 25, EffectUnit.BASIS_POINTS))),
            ),
        ),
    )

    private class RecordingRepository : CosmeticsRepository {
        val calls = mutableListOf<String>()
        private val states = mutableMapOf<String, CosmeticState>()
        private var color: String? = null
        override fun stateVersion(accountId: UUID): Long { calls += "stateVersion"; return 7L }
        override fun findStates(accountId: UUID): List<CosmeticState> { calls += "findStates"; return states.values.toList() }
        override fun findStatesForUpdate(accountId: UUID): List<CosmeticState> { calls += "findStatesForUpdate"; return states.values.toList() }
        override fun findStateForUpdate(accountId: UUID, cosmeticId: String): CosmeticState? { calls += "findStateForUpdate"; return states[cosmeticId] }
        override fun lockAccount(accountId: UUID) { calls += "lockAccount" }
        override fun saveState(state: CosmeticState) { calls += "saveState"; states[state.cosmeticId] = state }
        override fun findEquipment(accountId: UUID): List<EquipmentSlot> { calls += "findEquipment"; return emptyList() }
        override fun saveEquipment(accountId: UUID, slot: CosmeticSlot, cosmeticId: String?) { calls += "saveEquipment" }
        override fun findColor(accountId: UUID): String? { calls += "findColor"; return color }
        override fun saveColor(accountId: UUID, color: String?) { calls += "saveColor"; this.color = color }
        fun seed(state: CosmeticState) { states[state.cosmeticId] = state }
    }

    private class RecordingWallet(var rice: Long = 100_000, var tickets: Long = 0, private val unlocked: Boolean = true) : CosmeticsWallet {
        val calls = mutableListOf<String>()
        val openedBoxes = mutableListOf<String>()
        var recordedDraws = 0
        private var claimedBoxes = 0L
        override fun balance(accountId: UUID): CosmeticsWallet.Balance { calls += "balance"; return snapshot() }
        override fun balanceForUpdate(accountId: UUID): CosmeticsWallet.Balance { calls += "balanceForUpdate"; return snapshot() }
        override fun milestone(accountId: UUID, bannerId: String, boxItemId: String) = CosmeticsWallet.Milestone(400, claimedBoxes, 0)
        override fun debit(accountId: UUID, rice: Long, tickets: Long, sourceId: UUID) {
            calls += "debit"
            require(this.tickets >= tickets && this.rice >= rice) { "INSUFFICIENT_GACHA_FUNDS" }
            this.tickets -= tickets
            this.rice -= rice
        }
        override fun addDraws(accountId: UUID, bannerId: String, count: Int) { calls += "addDraws"; recordedDraws += count }
        override fun claimBoxes(accountId: UUID, bannerId: String, boxItemId: String, count: Long): Long {
            calls += "claimBoxes"
            claimedBoxes += count
            return 2 - claimedBoxes
        }
        override fun openBox(accountId: UUID, boxItemId: String) { calls += "openBox"; openedBoxes += boxItemId }
        override fun preflightCreditTicketsLocked(accountId: UUID, amount: Long) = Unit
        override fun creditTicketsLocked(accountId: UUID, amount: Long, sourceId: UUID) = Unit
        private fun snapshot() = CosmeticsWallet.Balance(rice, tickets, unlocked)
    }

    private class FixedEntropy : DrawEntropy {
        override val isAvailable = true
        override fun issue(accountId: UUID, bannerId: String, count: Int, contentVersion: String) = DrawEntropy.Issued(
            HmacDrawEntropy.ALGORITHM_VERSION, "test-key", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", DrawRandom(ByteArray(32) { 9 }),
        )
    }

    @Test
    fun `cosmetic collection catalog and combat snapshot read without locking any row`() {
        val repository = RecordingRepository()
        val wallet = RecordingWallet()
        val service = CosmeticsService(repository, content, wallet)

        service.versionedCollection(account)
        service.collection(account)
        service.catalog(account)
        service.snapshotForCombat(account)
        service.totalEffects(account)

        assertEquals(listOf("balance", "balance"), wallet.calls)
        assertTrue("lockAccount" !in repository.calls)
        assertTrue("findStateForUpdate" !in repository.calls)
        assertTrue(repository.calls.none { it.startsWith("save") })
    }

    @Test
    fun `gacha banner list and detail read without locking any row`() {
        val repository = RecordingRepository()
        val wallet = RecordingWallet()
        val service = CosmeticGachaService(CosmeticsService(repository, content, wallet), wallet, FixedEntropy())

        val banners = service.banners(account)
        val detail = service.detail(account, "banner-1")

        assertEquals(listOf("balance", "balance"), wallet.calls)
        assertTrue("lockAccount" !in repository.calls)
        assertEquals(listOf("banner-1"), banners.map { it.bannerId })
        assertEquals("banner-1", detail.banner.bannerId)
        assertEquals(100_000, detail.banner.riceBalance)
    }

    @Test
    fun `locked account may read display catalog but still cannot read its collection`() {
        val wallet = RecordingWallet(unlocked = false)
        val service = CosmeticsService(RecordingRepository(), content, wallet)

        assertEquals(content.version, service.catalog(account).data.contentVersion)
        assertEquals("COSMETICS_LOCKED", assertFailsWith<IllegalArgumentException> { service.versionedCollection(account) }.message)
        assertEquals(listOf("balance"), wallet.calls)
    }

    @Test
    fun `register bulk register equip receive and color change lock the account before the locking balance read`() {
        val repository = RecordingRepository().apply { seed(CosmeticState(account, "cosmetic-1", 1, 3, 0)) }
        val wallet = RecordingWallet()
        val service = CosmeticsService(repository, content, wallet)

        service.register(account, "cosmetic-1", RegistrationMode.UNTIL_NEXT_STAR)
        service.bulkRegisterUntilNextStar(account)
        service.equip(account, CosmeticSlot.HEAD, "cosmetic-1")
        service.receive(account, "cosmetic-2")
        service.chooseColor(account, null)

        assertEquals(5, repository.calls.count { it == "lockAccount" })
        assertEquals(5, wallet.calls.count { it == "balanceForUpdate" })
        assertEquals("lockAccount", repository.calls.first())
        assertEquals("balanceForUpdate", wallet.calls.first())
        assertEquals(3, repository.calls.count { it == "findStateForUpdate" })
        assertEquals(1, repository.calls.count { it == "findStatesForUpdate" })
        // 명령이 끝나면서 돌려주는 collection 조회는 잠금 없는 읽기로만 남는다.
        assertEquals(5, wallet.calls.count { it == "balance" })
    }

    @Test
    fun `draw reads the locked balance debits before granting and records the draw count`() {
        val repository = RecordingRepository()
        val wallet = RecordingWallet(rice = 50_000, tickets = 3)
        val service = CosmeticGachaService(CosmeticsService(repository, content, wallet), wallet, FixedEntropy())

        val response = service.draw(account, "banner-1", 10, UUID.randomUUID())

        assertEquals(3, response.ticketCost)
        assertEquals(35_000, response.riceCost)
        assertEquals(10, response.results.size)
        assertEquals(0, wallet.tickets)
        assertEquals(15_000, wallet.rice)
        assertEquals(10, wallet.recordedDraws)
        val payment = wallet.calls.filter { it == "balanceForUpdate" || it == "debit" || it == "addDraws" }
        assertEquals(listOf("balanceForUpdate", "debit"), payment.take(2))
        assertEquals("addDraws", payment.last())
        assertEquals(10, repository.calls.count { it == "lockAccount" })
    }

    @Test
    fun `draw without enough rice grants nothing and leaves the balance untouched`() {
        val repository = RecordingRepository()
        val wallet = RecordingWallet(rice = 1_000, tickets = 0)
        val service = CosmeticGachaService(CosmeticsService(repository, content, wallet), wallet, FixedEntropy())

        assertEquals("INSUFFICIENT_GACHA_FUNDS", assertFailsWith<IllegalArgumentException> {
            service.draw(account, "banner-1", 1, UUID.randomUUID())
        }.message)
        assertEquals(1_000, wallet.rice)
        assertEquals(0, wallet.recordedDraws)
        assertTrue("debit" !in wallet.calls)
        assertTrue("saveState" !in repository.calls)
    }

    @Test
    fun `milestone claim and selector box keep the locking unlock check`() {
        val repository = RecordingRepository()
        val wallet = RecordingWallet()
        val service = CosmeticGachaService(CosmeticsService(repository, content, wallet), wallet, FixedEntropy())

        assertEquals(1, service.claimMilestone(account, "banner-1", 1))
        service.openBox(account, "box-1", "cosmetic-4")

        // 마일스톤 수령 1회, 상자 개봉 1회, 개봉이 부르는 receive 1회.
        assertEquals(3, wallet.calls.count { it == "balanceForUpdate" })
        assertEquals("balanceForUpdate", wallet.calls.first())
        assertEquals(listOf("box-1"), wallet.openedBoxes)
    }
}
