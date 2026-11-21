package com.hanjjak.mail.api

import com.hanjjak.mail.application.BannerService
import com.hanjjak.mail.application.MailService
import com.hanjjak.mail.domain.BannerDismissResult
import com.hanjjak.mail.domain.BannerPage
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
@RequestMapping("/api/v1/banners")
class BannerController(private val banners: BannerService, private val mails: MailService, private val clock: Clock) {
    data class Envelope<T>(val requestId: UUID, val serverTime: Instant, val stateVersion: Long, val data: T)

    @GetMapping
    fun list(session: HttpSession): ResponseEntity<Envelope<BannerPage>> {
        val accountId = accountId(session)
        return success(accountId, banners.list(accountId))
    }

    @PostMapping("/{bannerId}/dismiss")
    fun dismiss(@PathVariable bannerId: UUID, session: HttpSession): ResponseEntity<Envelope<BannerDismissResult>> {
        val accountId = accountId(session)
        return success(accountId, banners.dismiss(accountId, bannerId))
    }

    private fun accountId(session: HttpSession): UUID = session.getAttribute("accountId") as? UUID
        ?: throw IllegalArgumentException("AUTHENTICATION_REQUIRED")

    private fun <T> success(accountId: UUID, data: T): ResponseEntity<Envelope<T>> = ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(Envelope(UUID.randomUUID(), clock.instant(), mails.stateVersion(accountId), data))
}
