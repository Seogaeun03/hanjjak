package com.hanjjak.mail.application

import com.hanjjak.mail.domain.MailMessage
import com.hanjjak.mail.domain.MailReward
import java.time.Instant
import java.util.UUID

data class SettlementMailRequest(val accountId: UUID, val tradeId: UUID, val riceAmount: Long)

interface MailRepository {
    data class StoredCommand(val commandId: UUID, val fingerprint: String, val resultJson: String)

    fun stateVersion(accountId: UUID): Long
    fun command(accountId: UUID, idempotencyKey: UUID): StoredCommand?
    fun saveCommand(commandId: UUID, accountId: UUID, idempotencyKey: UUID, fingerprint: String, resultJson: String)
    fun createSettlementMail(accountId: UUID, tradeId: UUID, riceAmount: Long): UUID

    /** 게시 시각이 지난 관리자 메시지 중 이 계정에 아직 만들어지지 않은 개인 우편을 만든다. */
    fun materializeAdminMails(accountId: UUID, now: Instant): Int = 0

    /**
     * 정산 메일 여러 건을 한 번에 만든다. 반환 순서는 입력 순서와 같다.
     * 기본 구현은 한 건씩 만든다. 왕복을 줄이려는 구현만 재정의한다.
     */
    fun createSettlementMails(requests: List<SettlementMailRequest>): List<UUID> =
        requests.map { createSettlementMail(it.accountId, it.tradeId, it.riceAmount) }
    fun list(accountId: UUID, claimable: Boolean?, cursor: Instant?, type: String?, limit: Int): List<MailMessage>
    fun count(accountId: UUID, claimable: Boolean?, type: String?): Long = 0
    fun lockClaimable(accountId: UUID, mailId: UUID): MailMessage?
    fun lockClaimableAll(accountId: UUID, type: String?): List<MailMessage>
    fun markClaimed(mailIds: List<UUID>, claimedAt: Instant)

    /** 지워지지 않은 내 우편 한 건을 잠근다. 읽음·삭제는 모두 이 잠금 위에서 이뤄진다. */
    fun lockOwned(accountId: UUID, mailId: UUID): MailMessage?
    fun markRead(mailId: UUID, readAt: Instant)
    fun markDeleted(mailId: UUID, deletedAt: Instant)
}

/**
 * 우편에 매달린 아이템·보석·치장을 실제 소유로 옮긴다.
 *
 * 한 칸이라도 모자라면 아무것도 지급하지 않고 `INVENTORY_CAPACITY_EXCEEDED` 로 실패한다.
 * 절반만 받고 나머지가 사라지는 편보다, 가방을 정리하고 다시 누르는 편이 설명하기 쉽다.
 */
fun interface MailRewardGranter {
    fun grant(accountId: UUID, rewards: List<MailReward>)
}
