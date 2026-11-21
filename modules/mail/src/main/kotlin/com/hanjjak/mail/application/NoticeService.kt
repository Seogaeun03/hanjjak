package com.hanjjak.mail.application

import com.hanjjak.mail.domain.NoticeDeleteResult
import com.hanjjak.mail.domain.NoticePage
import com.hanjjak.mail.domain.NoticeReadResult
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.util.UUID

open class NoticeService(private val repository: NoticeRepository, private val clock: Clock) {
    @Transactional(readOnly = true)
    open fun list(accountId: UUID, limit: Int = MAX_NOTICES): NoticePage {
        require(limit in 1..MAX_NOTICES) { "INVALID_LIMIT" }
        val now = clock.instant()
        return NoticePage(repository.visible(accountId, now, limit), repository.unreadCount(accountId, now))
    }

    @Transactional
    open fun read(accountId: UUID, noticeId: UUID): NoticeReadResult {
        require(repository.exists(noticeId, clock.instant())) { "NOTICE_NOT_FOUND" }
        repository.readAt(noticeId, accountId)?.let { return NoticeReadResult(noticeId, it) }
        val readAt = clock.instant()
        repository.markRead(noticeId, accountId, readAt)
        return NoticeReadResult(noticeId, readAt)
    }

    /** 공지는 원본을 지우지 않는다. 지운 사람의 목록에서만 사라진다. */
    @Transactional
    open fun delete(accountId: UUID, noticeId: UUID): NoticeDeleteResult {
        require(repository.exists(noticeId, clock.instant())) { "NOTICE_NOT_FOUND" }
        val deletedAt = clock.instant()
        repository.markDeleted(noticeId, accountId, deletedAt)
        return NoticeDeleteResult(noticeId, deletedAt)
    }

    companion object { const val MAX_NOTICES = 50 }
}
