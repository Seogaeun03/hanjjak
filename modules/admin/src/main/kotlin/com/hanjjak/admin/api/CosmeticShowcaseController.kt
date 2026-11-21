package com.hanjjak.admin.api

import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.admin.application.CosmeticShowcaseService
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
import org.springframework.web.bind.annotation.RestController
import java.time.Clock
import java.time.Instant
import java.util.UUID

@RestController
class CosmeticShowcaseController(
    private val showcase: CosmeticShowcaseService,
    private val audit: AdminAuditRepository,
    private val mapper: ObjectMapper,
    private val clock: Clock,
) {
    data class Envelope<T>(val requestId: UUID, val serverTime: Instant, val stateVersion: Long, val data: T)
    data class UpdateRequest(val selectedSetIds: List<String>, val expectedVersion: Long, val reason: String = "")

    @GetMapping("/api/v1/cosmetic-gacha/showcase")
    fun publicView(): ResponseEntity<Envelope<CosmeticShowcaseService.PublicView>> {
        val view = showcase.publicView()
        return success(UUID.randomUUID(), view.version, view)
    }

    @GetMapping("/api/admin/v1/cosmetics/showcase")
    fun adminView(request: HttpServletRequest): ResponseEntity<Envelope<CosmeticShowcaseService.AdminConfig>> {
        val config = showcase.adminConfig()
        return success(requestId(request), config.version, config)
    }

    @PostMapping("/api/admin/v1/cosmetics/showcase")
    fun update(
        @RequestHeader("Idempotency-Key") key: UUID,
        @RequestBody body: UpdateRequest,
        request: HttpServletRequest,
    ): ResponseEntity<Envelope<CosmeticShowcaseService.UpdateResult>> {
        val principal = principal(request)
        val requestId = requestId(request)
        return try {
            val result = showcase.update(
                principal.operatorId,
                key,
                body.selectedSetIds,
                body.expectedVersion,
                body.reason,
            )
            audit.record(
                AdminAuditRepository.Record(
                    clock.instant(), principal.operatorId, principal.username, "UPDATE_COSMETIC_SHOWCASE",
                    "COSMETIC_SHOWCASE", "default", "SUCCEEDED", requestId, remoteAddress(request), true,
                    body.reason.trim(), mapper.writeValueAsString(result.before), mapper.writeValueAsString(result.after), key,
                ),
            )
            success(requestId, result.after.version, result)
        } catch (exception: RuntimeException) {
            audit.recordFailure(
                AdminAuditRepository.Record(
                    clock.instant(), principal.operatorId, principal.username, "UPDATE_COSMETIC_SHOWCASE",
                    "COSMETIC_SHOWCASE", "default", "FAILED", requestId, remoteAddress(request), true,
                    body.reason.trim(), idempotencyKey = key,
                ),
            )
            throw exception
        }
    }

    private fun <T> success(requestId: UUID, version: Long, data: T): ResponseEntity<Envelope<T>> = ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(Envelope(requestId, clock.instant(), version, data))

    private fun principal(request: HttpServletRequest): AdminPrincipal =
        request.getAttribute(AdminAccessFilter.PRINCIPAL_ATTRIBUTE) as? AdminPrincipal
            ?: throw IllegalArgumentException("ADMIN_AUTHENTICATION_REQUIRED")
    private fun requestId(request: HttpServletRequest): UUID =
        request.getAttribute(AdminAccessFilter.REQUEST_ID_ATTRIBUTE) as? UUID ?: UUID.randomUUID()
    private fun remoteAddress(request: HttpServletRequest): String = request.remoteAddr.orEmpty().ifBlank { "unknown" }
}
