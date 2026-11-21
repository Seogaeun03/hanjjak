package com.hanjjak.mail.application

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import com.hanjjak.mail.domain.MailMessage
import com.hanjjak.mail.domain.MailReward
import com.hanjjak.mail.domain.MailRewardKind
import com.hanjjak.mail.domain.MailRewardStatus
import com.hanjjak.wallet.application.WalletDebitEntry
import com.hanjjak.wallet.application.WalletRepository
import com.hanjjak.wallet.application.WalletService
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

class MailServiceTest {
    private val accountId = UUID.randomUUID()
    private val clock = Clock.fixed(Instant.parse("2026-09-15T03:00:00Z"), ZoneOffset.UTC)
    private val repository = MemoryMails()
    private val wallet = WalletService(MemoryWallet())
    private val granted = mutableListOf<MailReward>()
    private var capacityExceeded = false
    /* 서비스가 명령 결과를 JSON으로 굳혀 두므로, 실제 서버와 같은 모듈을 얹은 매퍼를 쓴다. */
    private val mapper = ObjectMapper().registerKotlinModule().registerModule(JavaTimeModule())
    private val service = MailService(repository, wallet, mapper, clock) { _, rewards ->
        require(!capacityExceeded) { "INVENTORY_CAPACITY_EXCEEDED" }
        granted += rewards
    }

    private val potato = MailReward(MailRewardKind.ITEM, 3, itemId = "item.potato", displayName = "감자")

    @Test
    fun `reading a mail stamps the first time it was opened and keeps it`() {
        val mail = repository.add(notice())
        val first = service.read(accountId, mail)
        val second = service.read(accountId, mail)
        assertEquals(clock.instant(), first.readAt)
        assertEquals(first.readAt, second.readAt)
    }

    /* 안 받은 보상이 달린 우편은 지울 수 없다. 먼저 받아야 지운다. */
    @Test
    fun `refuses to delete a mail whose reward is still waiting`() {
        val mail = repository.add(gift(rewards = listOf(potato)))
        val failure = assertFailsWith<IllegalArgumentException> { service.delete(accountId, mail) }
        assertEquals("MAIL_REWARD_NOT_CLAIMED", failure.message)
        assertNull(repository.rows.getValue(mail).let { repository.deleted[mail] })
    }

    @Test
    fun `deletes a mail that carries nothing to claim`() {
        val mail = repository.add(notice())
        service.delete(accountId, mail)
        assertEquals(clock.instant(), repository.deleted[mail])
        assertTrue(service.list(accountId, null, null).items.none { it.mailId == mail })
    }

    @Test
    fun `deletes a mail once its reward has been taken`() {
        val mail = repository.add(gift(rewards = listOf(potato)))
        service.claim(accountId, UUID.randomUUID(), mail)
        service.delete(accountId, mail)
        assertEquals(clock.instant(), repository.deleted[mail])
    }

    @Test
    fun `claiming hands the attached rewards over and credits the rice`() {
        val mail = repository.add(gift(rice = 500, rewards = listOf(potato)))
        val result = service.claim(accountId, UUID.randomUUID(), mail).result
        assertEquals(listOf(potato), granted)
        assertEquals(500, result.riceAmount)
        assertEquals(500, result.walletBalance)
        assertEquals(MailRewardStatus.CLAIMED, repository.rows.getValue(mail).rewardStatus)
    }

    /* 가방이 가득 차면 그 우편은 그대로 남는다. 절반만 받고 나머지가 사라지지 않는다. */
    @Test
    fun `leaves the mail untouched when the bag has no room`() {
        val mail = repository.add(gift(rewards = listOf(potato)))
        capacityExceeded = true
        val failure = assertFailsWith<IllegalArgumentException> { service.claim(accountId, UUID.randomUUID(), mail) }
        assertEquals("INVENTORY_CAPACITY_EXCEEDED", failure.message)
        assertEquals(MailRewardStatus.PENDING, repository.rows.getValue(mail).rewardStatus)
    }

    /* 전부 아니면 전무는 한 통 단위다. 아이템 한 통이 막혀도 쌀만 든 우편은 들어온다. */
    @Test
    fun `claim all skips only the mails that do not fit`() {
        val rice = repository.add(gift(rice = 300))
        val items = repository.add(gift(rewards = listOf(potato)))
        capacityExceeded = true
        val result = service.claimAll(accountId, UUID.randomUUID()).result
        assertEquals(listOf(rice), result.claimedMailIds)
        assertEquals(300, result.totalRiceAmount)
        assertEquals(MailRewardStatus.PENDING, repository.rows.getValue(items).rewardStatus)
    }

    @Test
    fun `market settlement scope lists and claims only settlement mail`() {
        val adminGift = repository.add(gift(rewards = listOf(potato)))
        val settlement = repository.add(settlement(rice = 900))

        val page = service.list(accountId, true, null, type = "MARKET_SETTLEMENT")
        assertEquals(listOf(settlement), page.items.map { it.mailId })

        val result = service.claimAll(accountId, UUID.randomUUID(), type = "MARKET_SETTLEMENT").result
        assertEquals(listOf(settlement), result.claimedMailIds)
        assertEquals(900, result.totalRiceAmount)
        assertEquals(MailRewardStatus.PENDING, repository.rows.getValue(adminGift).rewardStatus)
        assertTrue(repository.materializedAt.isEmpty())
    }

    @Test
    fun `cosmetic choice grants exactly the selected event cosmetic`() {
        val choice = MailReward(
            MailRewardKind.COSMETIC_CHOICE, 1,
            cosmeticIds = listOf("cosmetic-188", "cosmetic-189", "cosmetic-190"),
            displayName = "싸피 후드집업 선택권",
        )
        val mail = repository.add(gift(rewards = listOf(choice)))

        service.claim(accountId, UUID.randomUUID(), mail, "cosmetic-189")

        assertEquals(MailRewardKind.COSMETIC, granted.single().kind)
        assertEquals("cosmetic-189", granted.single().cosmeticId)
        assertTrue(granted.single().autoRegister)
    }

    @Test
    fun `cosmetic choice requires a valid selection and claim all leaves it pending`() {
        val choice = MailReward(MailRewardKind.COSMETIC_CHOICE, 1, cosmeticIds = listOf("cosmetic-188", "cosmetic-189", "cosmetic-190"))
        val mail = repository.add(gift(rewards = listOf(choice)))

        assertEquals("MAIL_REWARD_SELECTION_REQUIRED", assertFailsWith<IllegalArgumentException> {
            service.claim(accountId, UUID.randomUUID(), mail)
        }.message)
        assertEquals("MAIL_REWARD_SELECTION_INVALID", assertFailsWith<IllegalArgumentException> {
            service.claim(accountId, UUID.randomUUID(), mail, "cosmetic-001")
        }.message)
        assertEquals(emptyList(), service.claimAll(accountId, UUID.randomUUID()).result.claimedMailIds)
        assertEquals(MailRewardStatus.PENDING, repository.rows.getValue(mail).rewardStatus)
    }

    @Test
    fun `replays the stored result when the same claim key arrives twice`() {
        val mail = repository.add(gift(rice = 100))
        val key = UUID.randomUUID()
        val first = service.claim(accountId, key, mail)
        val second = service.claim(accountId, key, mail)
        assertEquals(first.result.mailId, second.result.mailId)
        assertEquals(1, repository.commands.size)
    }

    @Test
    fun `list hides what the reader has thrown away`() {
        val kept = repository.add(notice())
        val thrown = repository.add(notice())
        service.delete(accountId, thrown)
        assertEquals(listOf(kept), service.list(accountId, null, null).items.map { it.mailId })
    }

    @Test
    fun `count materializes due admin mail before counting`() {
        service.count(accountId, null)
        assertEquals(listOf(clock.instant()), repository.materializedAt)
    }

    @Test
    fun `claim all materializes due admin mail before locking rewards`() {
        service.claimAll(accountId, UUID.randomUUID())
        assertEquals(listOf(clock.instant()), repository.materializedAt)
    }

    private fun notice() = MailMessage(
        UUID.randomUUID(), accountId, "ADMIN_GIFT", 0, MailRewardStatus.NONE, clock.instant(), null,
        title = "점검 안내", body = "오늘 점검이 있습니다.", senderName = "운영자",
    )

    private fun gift(rice: Long = 0, rewards: List<MailReward> = emptyList()) = MailMessage(
        UUID.randomUUID(), accountId, "ADMIN_GIFT", rice, MailRewardStatus.PENDING, clock.instant(), null,
        title = "보상 지급", body = "받아 가세요.", senderName = "운영자", rewards = rewards,
    )

    private fun settlement(rice: Long) = MailMessage(
        UUID.randomUUID(), accountId, "MARKET_SETTLEMENT", rice, MailRewardStatus.PENDING, clock.instant(), null,
    )

    private class MemoryMails : MailRepository {
        val rows = linkedMapOf<UUID, MailMessage>()
        val deleted = mutableMapOf<UUID, Instant>()
        val commands = mutableMapOf<UUID, MailRepository.StoredCommand>()
        val materializedAt = mutableListOf<Instant>()

        fun add(mail: MailMessage): UUID {
            rows[mail.mailId] = mail
            return mail.mailId
        }

        private fun visible() = rows.values.filter { it.mailId !in deleted }

        override fun stateVersion(accountId: UUID) = 1L
        override fun command(accountId: UUID, idempotencyKey: UUID) = commands[idempotencyKey]
        override fun saveCommand(commandId: UUID, accountId: UUID, idempotencyKey: UUID, fingerprint: String, resultJson: String) {
            commands[idempotencyKey] = MailRepository.StoredCommand(commandId, fingerprint, resultJson)
        }
        override fun createSettlementMail(accountId: UUID, tradeId: UUID, riceAmount: Long) = UUID.randomUUID()
        override fun materializeAdminMails(accountId: UUID, now: Instant): Int {
            materializedAt += now
            return 0
        }
        override fun list(accountId: UUID, claimable: Boolean?, cursor: Instant?, type: String?, limit: Int) = visible()
            .filter { claimable == null || (it.rewardStatus == MailRewardStatus.PENDING) == claimable }
            .filter { type == null || it.type == type }
            .take(limit)
        override fun count(accountId: UUID, claimable: Boolean?, type: String?) = visible()
            .count { mail -> (claimable == null || (mail.rewardStatus == MailRewardStatus.PENDING) == claimable) && (type == null || mail.type == type) }
            .toLong()
        override fun lockClaimable(accountId: UUID, mailId: UUID) = visible()
            .firstOrNull { it.mailId == mailId && it.rewardStatus == MailRewardStatus.PENDING }
        override fun lockClaimableAll(accountId: UUID, type: String?) = visible()
            .filter { it.rewardStatus == MailRewardStatus.PENDING && (type == null || it.type == type) }
        override fun markClaimed(mailIds: List<UUID>, claimedAt: Instant) {
            mailIds.forEach { rows[it] = rows.getValue(it).copy(rewardStatus = MailRewardStatus.CLAIMED, claimedAt = claimedAt) }
        }
        override fun lockOwned(accountId: UUID, mailId: UUID) = visible().firstOrNull { it.mailId == mailId }
        override fun markRead(mailId: UUID, readAt: Instant) {
            rows[mailId] = rows.getValue(mailId).let { if (it.readAt == null) it.copy(readAt = readAt) else it }
        }
        override fun markDeleted(mailId: UUID, deletedAt: Instant) { deleted[mailId] = deletedAt }
    }

    private class MemoryWallet : WalletRepository {
        private val balances = mutableMapOf<UUID, Long>()
        override fun lockBalance(accountId: UUID) = balances.getOrDefault(accountId, 0)
        override fun applyDelta(accountId: UUID, delta: Long, sourceType: String, sourceId: UUID, bumpStateVersion: Boolean): Long {
            val next = lockBalance(accountId) + delta
            balances[accountId] = next
            return next
        }
        override fun applyBatchedDebit(accountId: UUID, entries: List<WalletDebitEntry>, bumpStateVersion: Boolean) =
            applyDelta(accountId, -entries.sumOf { it.amount }, "BATCH", UUID.randomUUID(), bumpStateVersion)
    }
}
