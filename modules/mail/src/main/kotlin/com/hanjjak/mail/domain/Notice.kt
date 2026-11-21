package com.hanjjak.mail.domain

import java.time.Instant
import java.util.UUID

/**
 * 공지는 계정마다 복제하지 않는다. 원본 한 건을 두고 사람별로는 읽음·삭제만 따로 남기므로,
 * 노출 기간이 열려 있는 동안에는 나중에 가입한 사람에게도 그대로 보인다.
 */
data class Notice(
    val noticeId: UUID,
    val title: String,
    val body: String,
    val senderName: String,
    val publishedAt: Instant,
    val expiresAt: Instant?,
    val readAt: Instant?,
)

data class NoticePage(val items: List<Notice>, val unreadCount: Int)
data class NoticeReadResult(val noticeId: UUID, val readAt: Instant)
data class NoticeDeleteResult(val noticeId: UUID, val deletedAt: Instant)
