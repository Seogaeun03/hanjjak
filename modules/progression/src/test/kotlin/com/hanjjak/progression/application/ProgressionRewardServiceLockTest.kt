package com.hanjjak.progression.application

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.hanjjak.progression.domain.CharacterProgression
import com.hanjjak.progression.domain.ProgressionGrant
import com.hanjjak.wallet.application.WalletCreditEntry
import com.hanjjak.wallet.application.WalletDebitEntry
import com.hanjjak.wallet.application.WalletRepository
import com.hanjjak.wallet.application.WalletService
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * 조회는 행을 잠그지 않고, 보상 지급은 계정 잠금과 잠금 읽기를 그대로 쓴다는 것을 고정한다.
 * 호출 순서까지 기록해 잠금 없는 읽기가 지급 경로로 새어 들어가지 않게 한다.
 */
class ProgressionRewardServiceLockTest {
    private val account = UUID.randomUUID()

    private class RecordingRepository : ProgressionRepository {
        val calls = mutableListOf<String>()
        var stored = CharacterProgression(1, 0, 0)
        var command: ProgressionRepository.StoredCommand? = null

        override fun lockAccount(accountId: UUID) { calls += "lockAccount" }
        override fun progression(accountId: UUID): CharacterProgression { calls += "progression"; return stored }
        override fun progressionForUpdate(accountId: UUID): CharacterProgression { calls += "progressionForUpdate"; return stored }
        override fun saveProgression(accountId: UUID, progression: CharacterProgression) { calls += "saveProgression"; stored = progression }
        override fun command(accountId: UUID, idempotencyKey: UUID): ProgressionRepository.StoredCommand? = command
        override fun saveCommand(accountId: UUID, idempotencyKey: UUID, fingerprint: String, resultJson: String) {
            calls += "saveCommand"
            command = ProgressionRepository.StoredCommand(fingerprint, resultJson)
        }
    }

    private class RecordingWalletRepository : WalletRepository {
        var balance = 0L
        var locks = 0
        override fun lockBalance(accountId: UUID): Long { locks++; return balance }
        override fun applyDelta(accountId: UUID, delta: Long, sourceType: String, sourceId: UUID, bumpStateVersion: Boolean): Long {
            balance += delta
            return balance
        }
        override fun applyBatchedDebit(accountId: UUID, entries: List<WalletDebitEntry>, bumpStateVersion: Boolean): Long = error("not used")
        override fun applyBatchedCredit(accountId: UUID, entries: List<WalletCreditEntry>, bumpStateVersion: Boolean): Long = error("not used")
    }

    private fun service(repository: RecordingRepository, wallet: WalletRepository = RecordingWalletRepository()) =
        ProgressionRewardService(repository, jacksonObjectMapper(), WalletService(wallet))

    @Test
    fun `current reads progression without locking the account or the character row`() {
        val repository = RecordingRepository().apply { stored = CharacterProgression(3, 4_321, 77) }

        val result = service(repository).current(account)

        assertEquals(listOf("progression"), repository.calls)
        assertEquals(3, result.levelBefore)
        assertEquals(3, result.levelAfter)
        assertEquals(0, result.experienceGained)
        assertEquals(0, result.riceGained)
        assertEquals(77, result.riceBalance)
    }

    @Test
    fun `enemy reward locks the account and reads the locked progression row`() {
        val repository = RecordingRepository()

        val execution = service(repository).grantEnemy(account, UUID.randomUUID(), "stage.01-01", 1, boss = false)

        assertEquals(listOf("lockAccount", "progressionForUpdate", "saveProgression", "saveCommand"), repository.calls)
        assertTrue("progression" !in repository.calls)
        assertTrue(execution.result.experienceGained > 0)
        assertEquals(false, execution.replayed)
    }

    @Test
    fun `offline reward locks the account and reads the locked progression row`() {
        val repository = RecordingRepository()

        service(repository).grantOffline(account, UUID.randomUUID(), ProgressionGrant(120, 30))

        assertEquals(listOf("lockAccount", "progressionForUpdate", "saveProgression", "saveCommand"), repository.calls)
        assertTrue("progression" !in repository.calls)
    }

    @Test
    fun `replayed reward still locks the account before answering from the stored command`() {
        val repository = RecordingRepository()
        val service = service(repository)
        val key = UUID.randomUUID()
        val first = service.grantEnemy(account, key, "stage.01-01", 1, boss = false)
        repository.calls.clear()

        val replay = service.grantEnemy(account, key, "stage.01-01", 1, boss = false)

        assertEquals(listOf("lockAccount"), repository.calls)
        assertEquals(true, replay.replayed)
        assertEquals(first.result, replay.result)
    }
}
