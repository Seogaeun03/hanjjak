package com.hanjjak.admin.api

import com.hanjjak.admin.application.EventLifecycleService
import com.hanjjak.admin.domain.AdminPrincipal
import com.hanjjak.admin.infrastructure.AdminAuditRepository
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.CacheControl
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RestController
import java.time.Clock
import java.time.Instant
import java.time.LocalTime
import java.util.UUID

@RestController
class EventLifecycleController(
    private val lifecycle: EventLifecycleService,
    private val audit: AdminAuditRepository,
    private val clock: Clock,
) {
    data class Envelope<T>(val requestId: UUID, val serverTime: Instant, val stateVersion: Long, val data: T)
    data class UpdateRequest(
        val startsAt: Instant?,
        val endsAt: Instant?,
        val dailyRestrictionEnabled: Boolean = false,
        val dailyRestrictionStartsAt: LocalTime? = null,
        val dailyRestrictionEndsAt: LocalTime? = null,
        val expectedVersion: Long,
        val reason: String = "",
    )

    @GetMapping("/api/v1/event-lifecycle")
    fun publicState(): ResponseEntity<Envelope<EventLifecycleService.Snapshot>> = success(UUID.randomUUID(), lifecycle.snapshot(clock.instant()))

    @GetMapping("/api/admin/v1/event-lifecycle")
    fun adminState(request: HttpServletRequest): ResponseEntity<Envelope<EventLifecycleService.Snapshot>> = success(requestId(request), lifecycle.snapshot(clock.instant()))

    @PutMapping("/api/admin/v1/event-lifecycle")
    fun update(
        @RequestHeader("Idempotency-Key") key: UUID,
        @RequestBody body: UpdateRequest,
        request: HttpServletRequest,
    ): ResponseEntity<Envelope<EventLifecycleService.UpdateResult>> {
        val principal = principal(request)
        val requestId = requestId(request)
        return try {
            val result = lifecycle.update(
                principal.operatorId, principal.username, key, body.expectedVersion,
                body.startsAt, body.endsAt, body.dailyRestrictionEnabled,
                body.dailyRestrictionStartsAt, body.dailyRestrictionEndsAt, body.reason,
            )
            audit.record(
                AdminAuditRepository.Record(
                    clock.instant(), principal.operatorId, principal.username, "UPDATE_EVENT_LIFECYCLE",
                    "EVENT_LIFECYCLE", lifecycle.serviceId, "SUCCEEDED", requestId, remoteAddress(request), true,
                    body.reason.trim(), result.before.toString(), result.after.toString(), key,
                ),
            )
            success(requestId, result)
        } catch (exception: RuntimeException) {
            audit.recordFailure(
                AdminAuditRepository.Record(
                    clock.instant(), principal.operatorId, principal.username, "UPDATE_EVENT_LIFECYCLE",
                    "EVENT_LIFECYCLE", lifecycle.serviceId, "FAILED", requestId, remoteAddress(request), true,
                    body.reason.trim(), idempotencyKey = key,
                ),
            )
            throw exception
        }
    }
    private fun success(requestId: UUID, data: EventLifecycleService.Snapshot): ResponseEntity<Envelope<EventLifecycleService.Snapshot>> = ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(Envelope(requestId, clock.instant(), data.version, data))

    private fun success(requestId: UUID, data: EventLifecycleService.UpdateResult): ResponseEntity<Envelope<EventLifecycleService.UpdateResult>> = ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(Envelope(requestId, clock.instant(), data.after.version, data))
    private fun principal(request: HttpServletRequest): AdminPrincipal = request.getAttribute(AdminAccessFilter.PRINCIPAL_ATTRIBUTE) as? AdminPrincipal
        ?: throw IllegalArgumentException("ADMIN_AUTHENTICATION_REQUIRED")
    private fun requestId(request: HttpServletRequest): UUID = request.getAttribute(AdminAccessFilter.REQUEST_ID_ATTRIBUTE) as? UUID ?: UUID.randomUUID()
    private fun remoteAddress(request: HttpServletRequest): String = request.remoteAddr.orEmpty().ifBlank { "unknown" }
}
