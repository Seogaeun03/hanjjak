package com.hanjjak.mail.application

import com.hanjjak.mail.domain.Notice
import java.time.Instant
import java.util.UUID

interface NoticeRepository {
    /** 지금 노출 기간이 열려 있고 이 계정이 지우지 않은 공지만 최신순으로 준다. */
    fun visible(accountId: UUID, now: Instant, limit: Int): List<Notice>
    fun unreadCount(accountId: UUID, now: Instant): Int
    fun exists(noticeId: UUID, now: Instant): Boolean
    fun readAt(noticeId: UUID, accountId: UUID): Instant?
    fun markRead(noticeId: UUID, accountId: UUID, readAt: Instant)
    fun markDeleted(noticeId: UUID, accountId: UUID, deletedAt: Instant)
}
