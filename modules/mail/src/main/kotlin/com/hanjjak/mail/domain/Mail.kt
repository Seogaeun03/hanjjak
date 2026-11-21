package com.hanjjak.mail.domain

import java.time.Instant
import java.util.UUID

enum class MailRewardKind { ITEM, GEM, COSMETIC, COSMETIC_CHOICE, TICKET }

/**
 * 우편에 매달린 보상 한 줄. 종류마다 채우는 칸이 다르다 — 아이템은 `itemId`,
 * 보석은 `gemLevel`·`gemOption`, 치장은 `cosmeticId`. 치장 뽑기권(TICKET)은 채울 칸이
 * 수량뿐이다 — 가방이 아니라 캐릭터의 뽑기권 잔액으로 바로 들어가기 때문이다. 쌀도
 * 지갑으로 바로 들어가므로 여기에 담지 않고 우편의 `riceAmount` 를 쓴다.
 */
data class MailReward(
    val kind: MailRewardKind,
    val quantity: Long,
    val itemId: String? = null,
    val cosmeticId: String? = null,
    /** COSMETIC_CHOICE가 허용하는 선택지. 수령 요청이 이 중 하나를 고른다. */
    val cosmeticIds: List<String>? = null,
    val gemLevel: Int? = null,
    val gemOption: String? = null,
    /** 보낼 때의 이름을 그대로 굳혀 둔다. 콘텐츠가 개편돼도 받는 화면의 글자는 흔들리지 않는다. */
    val displayName: String? = null,
    /** 도감 등록 단계 없이 바로 착용 가능하게 지급한다. */
    val autoRegister: Boolean = false,
)

/** 받을 것이 없는 우편(NONE)과 아직 안 받은 우편(PENDING)은 다르다. 예전 `claimed` 한 칸으로는 구분되지 않았다. */
enum class MailRewardStatus { NONE, PENDING, CLAIMED }

data class MailMessage(
    val mailId: UUID,
    val accountId: UUID,
    val type: String,
    val riceAmount: Long,
    val rewardStatus: MailRewardStatus,
    val createdAt: Instant,
    val claimedAt: Instant?,
    val title: String? = null,
    val body: String? = null,
    val senderName: String? = null,
    val readAt: Instant? = null,
    val rewards: List<MailReward> = emptyList(),
)

data class MailPage(val items: List<MailMessage>, val nextCursor: String?, val totalItems: Long)
data class MailClaimResult(
    val mailId: UUID,
    val riceAmount: Long,
    val claimedAt: Instant,
    val walletBalance: Long,
    val rewards: List<MailReward> = emptyList(),
)
data class MailClaimAllResult(
    val claimedMailIds: List<UUID>,
    val totalRiceAmount: Long,
    val walletBalance: Long,
    val rewards: List<MailReward> = emptyList(),
)
data class MailReadResult(val mailId: UUID, val readAt: Instant)
data class MailDeleteResult(val mailId: UUID, val deletedAt: Instant)
data class MailCommandResult<T>(val commandId: UUID, val idempotencyKey: UUID, val status: String = "SUCCEEDED", val result: T)
