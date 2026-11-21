package com.hanjjak.admin.api

import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.admin.application.AdminMessagingService
import com.hanjjak.admin.domain.AdminPrincipal
import com.hanjjak.admin.infrastructure.AdminAuditRepository
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.CacheControl
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.time.Clock
import java.time.Instant
import java.util.UUID

@RestController
@RequestMapping("/api/admin/v1/messaging")
class AdminMessagingController(
    private val messaging: AdminMessagingService,
    private val audit: AdminAuditRepository,
    private val mapper: ObjectMapper,
    private val clock: Clock,
) {
    data class Envelope<T>(val requestId: UUID, val serverTime: Instant, val stateVersion: Long, val data: T)

    data class NoticeRequest(
        val title: String,
        val body: String,
        val publishedAt: Instant? = null,
        val expiresAt: Instant? = null,
        val reason: String = "",
    )

    data class MailRequest(
        val targetMode: AdminMessagingService.TargetMode,
        val targetAccountId: UUID? = null,
        val targetAccountIds: List<UUID> = emptyList(),
        val title: String,
        val body: String,
        val riceAmount: Long = 0,
        val rewards: List<AdminMessagingService.RewardInput> = emptyList(),
        val publishedAt: Instant? = null,
        val expiresAt: Instant? = null,
        val reason: String = "",
    )

    @GetMapping("/history")
    fun history(@RequestParam(required = false) limit: Int?, request: HttpServletRequest): ResponseEntity<Envelope<List<AdminMessagingService.HistoryEntry>>> =
        success(requestId(request), messaging.history(limit ?: 50))

    @PostMapping("/notices")
    fun notice(
        @RequestHeader("Idempotency-Key") key: UUID,
        @RequestBody body: NoticeRequest,
        request: HttpServletRequest,
    ) = send(request, key, "SEND_ADMIN_NOTICE", body.reason) { principal ->
        messaging.sendNotice(principal.operatorId, principal.displayName, key, body.title, body.body, body.publishedAt, body.expiresAt, body.reason)
    }

    @PostMapping("/mails")
    fun mail(
        @RequestHeader("Idempotency-Key") key: UUID,
        @RequestBody body: MailRequest,
        request: HttpServletRequest,
    ) = send(request, key, "SEND_ADMIN_MAIL", body.reason) { principal ->
        messaging.sendMail(
            principal.operatorId, principal.displayName, key, body.targetMode, body.targetAccountId,
            body.title, body.body, body.riceAmount, body.rewards, body.reason, body.publishedAt, body.expiresAt, body.targetAccountIds,
        )
    }

    /** 성공이든 실패든 한 줄 남긴다. 전체 발송은 되돌릴 수 없으니 누가 무엇을 보냈는지가 남아야 한다. */
    private fun send(
        request: HttpServletRequest,
        key: UUID,
        action: String,
        reason: String,
        operation: (AdminPrincipal) -> AdminMessagingService.SendResult,
    ): ResponseEntity<Envelope<AdminMessagingService.SendResult>> {
        val principal = principal(request)
        val requestId = requestId(request)
        return try {
            val result = operation(principal)
            audit.record(
                AdminAuditRepository.Record(
                    clock.instant(), principal.operatorId, principal.username, action, "MESSAGE", result.sendId.toString(), "SUCCEEDED",
                    requestId, remoteAddress(request), true, reason.trim(), null, mapper.writeValueAsString(result), key,
                ),
            )
            success(requestId, result)
        } catch (exception: RuntimeException) {
            audit.recordFailure(
                AdminAuditRepository.Record(
                    clock.instant(), principal.operatorId, principal.username, action, "MESSAGE", "-", "FAILED",
                    requestId, remoteAddress(request), true, reason.trim(), idempotencyKey = key,
                ),
            )
            throw exception
        }
    }

    private fun <T> success(requestId: UUID, data: T): ResponseEntity<Envelope<T>> = ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(Envelope(requestId, clock.instant(), 0, data))

    private fun principal(request: HttpServletRequest): AdminPrincipal = request.getAttribute(AdminAccessFilter.PRINCIPAL_ATTRIBUTE) as? AdminPrincipal
        ?: throw IllegalArgumentException("ADMIN_AUTHENTICATION_REQUIRED")
    private fun requestId(request: HttpServletRequest): UUID = request.getAttribute(AdminAccessFilter.REQUEST_ID_ATTRIBUTE) as? UUID ?: UUID.randomUUID()
    private fun remoteAddress(request: HttpServletRequest): String = request.remoteAddr.orEmpty().ifBlank { "unknown" }
}
