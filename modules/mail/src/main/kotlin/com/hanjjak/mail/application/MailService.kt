package com.hanjjak.mail.application

import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.mail.domain.MailClaimAllResult
import com.hanjjak.mail.domain.MailClaimResult
import com.hanjjak.mail.domain.MailCommandResult
import com.hanjjak.mail.domain.MailDeleteResult
import com.hanjjak.mail.domain.MailMessage
import com.hanjjak.mail.domain.MailPage
import com.hanjjak.mail.domain.MailReadResult
import com.hanjjak.mail.domain.MailRewardStatus
import com.hanjjak.mail.domain.MailRewardKind
import com.hanjjak.wallet.application.WalletService
import org.springframework.transaction.annotation.Transactional
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Clock
import java.time.Instant
import java.util.UUID

open class MailService(
    private val repository: MailRepository,
    private val wallet: WalletService,
    private val mapper: ObjectMapper,
    private val clock: Clock,
    private val granter: MailRewardGranter = MailRewardGranter { _, rewards ->
        require(rewards.isEmpty()) { "MAIL_REWARD_GRANTER_MISSING" }
    },
) {
    open fun stateVersion(accountId: UUID): Long = repository.stateVersion(accountId)

    open fun createSettlementMail(accountId: UUID, tradeId: UUID, riceAmount: Long): UUID =
        repository.createSettlementMail(accountId, tradeId, riceAmount)

    /** 정산 메일을 모아서 한 번에 만든다. 구매 트랜잭션의 DB 왕복을 줄이는 용도다. */
    open fun createSettlementMails(requests: List<SettlementMailRequest>): List<UUID> =
        repository.createSettlementMails(requests)

    @Transactional
    open fun list(accountId: UUID, claimable: Boolean?, cursor: Instant?, type: String? = null, limit: Int = 30): MailPage {
        require(limit in 1..30) { "INVALID_LIMIT" }
        if (type != MARKET_SETTLEMENT) repository.materializeAdminMails(accountId, clock.instant())
        val rows = repository.list(accountId, claimable, cursor, type, limit + 1)
        return MailPage(rows.take(limit), rows.getOrNull(limit)?.createdAt?.toString(), repository.count(accountId, claimable, type))
    }
    @Transactional
    open fun count(accountId: UUID, claimable: Boolean?, type: String? = null): Long {
        if (type != MARKET_SETTLEMENT) repository.materializeAdminMails(accountId, clock.instant())
        return repository.count(accountId, claimable, type)
    }

    /** 본문을 펼쳐 본 순간이 읽은 시각이다. 이미 읽은 우편은 처음 읽은 시각을 그대로 둔다. */
    @Transactional
    open fun read(accountId: UUID, mailId: UUID): MailReadResult {
        val mail = repository.lockOwned(accountId, mailId) ?: throw IllegalArgumentException("MAIL_NOT_FOUND")
        mail.readAt?.let { return MailReadResult(mailId, it) }
        val readAt = clock.instant()
        repository.markRead(mailId, readAt)
        return MailReadResult(mailId, readAt)
    }

    /**
     * 아직 받지 않은 보상이 매달려 있으면 지우지 않는다. 지운 뒤에 "보상이 사라졌다"는
     * 문의를 받는 것보다, 먼저 받으라고 막아 두는 편이 낫다.
     */
    @Transactional
    open fun delete(accountId: UUID, mailId: UUID): MailDeleteResult {
        val mail = repository.lockOwned(accountId, mailId) ?: throw IllegalArgumentException("MAIL_NOT_FOUND")
        require(mail.rewardStatus != MailRewardStatus.PENDING) { "MAIL_REWARD_NOT_CLAIMED" }
        val deletedAt = clock.instant()
        repository.markDeleted(mailId, deletedAt)
        return MailDeleteResult(mailId, deletedAt)
    }

    @Transactional
    open fun claim(accountId: UUID, idempotencyKey: UUID, mailId: UUID, selectedCosmeticId: String? = null): MailCommandResult<MailClaimResult> {
        val fingerprint = sha256("mail-claim\u0000$mailId\u0000${selectedCosmeticId ?: ""}")
        repository.command(accountId, idempotencyKey)?.let { existing ->
            require(existing.fingerprint == fingerprint) { "IDEMPOTENCY_KEY_REUSED" }
            return MailCommandResult(existing.commandId, idempotencyKey, result = mapper.readValue(existing.resultJson, MailClaimResult::class.java))
        }
        val mail = repository.lockClaimable(accountId, mailId) ?: throw IllegalArgumentException("MAIL_NOT_CLAIMABLE")
        val rewards = resolveChoice(mail.rewards, selectedCosmeticId)
        val claimedAt = clock.instant()
        granter.grant(accountId, rewards)
        repository.markClaimed(listOf(mailId), claimedAt)
        val balance = if (mail.riceAmount > 0) wallet.credit(accountId, mail.riceAmount, "MAIL_CLAIM", mailId) else wallet.balance(accountId)
        val commandId = UUID.randomUUID()
        val result = MailClaimResult(mailId, mail.riceAmount, claimedAt, balance, rewards)
        repository.saveCommand(commandId, accountId, idempotencyKey, fingerprint, mapper.writeValueAsString(result))
        return MailCommandResult(commandId, idempotencyKey, result = result)
    }

    /**
     * 가방이 모자라 못 받는 우편은 건너뛰고 나머지를 받는다. 전부 아니면 전무는 한 통 단위로만
     * 적용한다 — 쌀만 든 정산 우편이 아이템 한 통 때문에 발이 묶이면 안 되기 때문이다.
     */
    @Transactional
    open fun claimAll(accountId: UUID, idempotencyKey: UUID, type: String? = null): MailCommandResult<MailClaimAllResult> {
        // 범위를 쓰지 않던 기존 명령의 지문은 유지해 배포 전 재시도도 같은 결과를 재생한다.
        val fingerprint = sha256(if (type == null) "mail-claim-all" else "mail-claim-all\u0000$type")
        repository.command(accountId, idempotencyKey)?.let { existing ->
            require(existing.fingerprint == fingerprint) { "IDEMPOTENCY_KEY_REUSED" }
            return MailCommandResult(existing.commandId, idempotencyKey, result = mapper.readValue(existing.resultJson, MailClaimAllResult::class.java))
        }
        val claimedAt = clock.instant()
        if (type != MARKET_SETTLEMENT) repository.materializeAdminMails(accountId, claimedAt)
        val claimed = mutableListOf<MailMessage>()
        val skipped = mutableListOf<UUID>()
        repository.lockClaimableAll(accountId, type).forEach { mail ->
            if (mail.rewards.any { it.kind == MailRewardKind.COSMETIC_CHOICE }) return@forEach
            if (mail.rewards.isEmpty()) {
                claimed += mail
                return@forEach
            }
            runCatching { granter.grant(accountId, mail.rewards) }
                .onSuccess { claimed += mail }
                .onFailure { failure ->
                    if (failure.message != "INVENTORY_CAPACITY_EXCEEDED") throw failure
                    skipped += mail.mailId
                }
        }
        require(claimed.isNotEmpty() || skipped.isEmpty()) { "INVENTORY_CAPACITY_EXCEEDED" }
        val mailIds = claimed.map { it.mailId }
        val totalRice = claimed.sumOf { it.riceAmount }
        repository.markClaimed(mailIds, claimedAt)
        val commandId = UUID.randomUUID()
        val balance = if (totalRice > 0) wallet.credit(accountId, totalRice, "MAIL_CLAIM_ALL", commandId) else wallet.balance(accountId)
        val result = MailClaimAllResult(mailIds, totalRice, balance, claimed.flatMap { it.rewards })
        repository.saveCommand(commandId, accountId, idempotencyKey, fingerprint, mapper.writeValueAsString(result))
        return MailCommandResult(commandId, idempotencyKey, result = result)
    }

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(StandardCharsets.UTF_8)).joinToString("") { "%02x".format(it) }

    private fun resolveChoice(rewards: List<com.hanjjak.mail.domain.MailReward>, selectedCosmeticId: String?): List<com.hanjjak.mail.domain.MailReward> {
        val choices = rewards.filter { it.kind == MailRewardKind.COSMETIC_CHOICE }
        if (choices.isEmpty()) {
            require(selectedCosmeticId == null) { "MAIL_REWARD_SELECTION_NOT_ALLOWED" }
            return rewards
        }
        require(choices.size == 1 && rewards.size == 1) { "INVALID_MAIL_REWARD" }
        val choice = choices.single()
        val selected = requireNotNull(selectedCosmeticId) { "MAIL_REWARD_SELECTION_REQUIRED" }
        require(selected in choice.cosmeticIds.orEmpty()) { "MAIL_REWARD_SELECTION_INVALID" }
        return listOf(
            choice.copy(
                kind = MailRewardKind.COSMETIC,
                cosmeticId = selected,
                cosmeticIds = null,
                displayName = null,
                autoRegister = true,
            ),
        )
    }

    private companion object {
        const val MARKET_SETTLEMENT = "MARKET_SETTLEMENT"
    }
}
