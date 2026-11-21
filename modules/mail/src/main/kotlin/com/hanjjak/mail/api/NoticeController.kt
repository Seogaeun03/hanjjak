package com.hanjjak.mail.api

import com.hanjjak.mail.application.MailService
import com.hanjjak.mail.application.NoticeService
import com.hanjjak.mail.domain.NoticeDeleteResult
import com.hanjjak.mail.domain.NoticePage
import com.hanjjak.mail.domain.NoticeReadResult
import jakarta.servlet.http.HttpSession
import org.springframework.http.CacheControl
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.time.Clock
import java.time.Instant
import java.util.UUID

@RestController
@RequestMapping("/api/v1/notices")
class NoticeController(private val notices: NoticeService, private val mails: MailService, private val clock: Clock) {
    data class Envelope<T>(val requestId: UUID, val serverTime: Instant, val stateVersion: Long, val data: T)

    @GetMapping
    fun list(session: HttpSession): ResponseEntity<Envelope<NoticePage>> {
        val accountId = accountId(session)
        return success(accountId, notices.list(accountId))
    }

    @PostMapping("/{noticeId}/read")
    fun read(@PathVariable noticeId: UUID, session: HttpSession): ResponseEntity<Envelope<NoticeReadResult>> {
        val accountId = accountId(session)
        return success(accountId, notices.read(accountId, noticeId))
    }

    @PostMapping("/{noticeId}/delete")
    fun delete(@PathVariable noticeId: UUID, session: HttpSession): ResponseEntity<Envelope<NoticeDeleteResult>> {
        val accountId = accountId(session)
        return success(accountId, notices.delete(accountId, noticeId))
    }

    private fun accountId(session: HttpSession): UUID = session.getAttribute("accountId") as? UUID
        ?: throw IllegalArgumentException("AUTHENTICATION_REQUIRED")

    private fun <T> success(accountId: UUID, data: T): ResponseEntity<Envelope<T>> = ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(Envelope(UUID.randomUUID(), clock.instant(), mails.stateVersion(accountId), data))
}
