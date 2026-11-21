package com.hanjjak.admin.api

import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.admin.application.AdminBannerService
import com.hanjjak.admin.domain.AdminPrincipal
import com.hanjjak.admin.infrastructure.AdminAuditRepository
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.CacheControl
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.time.Clock
import java.time.Instant
import java.util.UUID

/**
 * `/messaging` 아래에 둔다. 접근 제어가 경로 접두사로 걸려 있어서(`message:send`),
 * 여기서 새 규칙을 만들면 배너만 권한 판단이 갈라진다.
 */
@RestController
@RequestMapping("/api/admin/v1/messaging/banners")
class AdminBannerController(
    private val banners: AdminBannerService,
    private val audit: AdminAuditRepository,
    private val mapper: ObjectMapper,
    private val clock: Clock,
) {
    data class Envelope<T>(val requestId: UUID, val serverTime: Instant, val stateVersion: Long, val data: T)

    data class BannerRequest(
        val message: String,
        val tone: AdminBannerService.Tone = AdminBannerService.Tone.INFO,
        val publishedAt: Instant? = null,
        val expiresAt: Instant,
        val reason: String = "",
    )

    data class RevokeRequest(val reason: String = "")

    @GetMapping
    fun history(@RequestParam(required = false) limit: Int?, request: HttpServletRequest): ResponseEntity<Envelope<List<AdminBannerService.BannerEntry>>> =
        success(requestId(request), banners.history(limit ?: 50))

    @PostMapping
    fun raise(
        @RequestHeader("Idempotency-Key") key: UUID,
        @RequestBody body: BannerRequest,
        request: HttpServletRequest,
    ): ResponseEntity<Envelope<AdminBannerService.RaiseResult>> = recorded(request, "RAISE_ADMIN_BANNER", body.reason, key) { principal ->
        val result = banners.raise(principal.operatorId, key, body.message, body.tone, body.publishedAt, body.expiresAt, body.reason)
        result.bannerId to result
    }

    @PostMapping("/{bannerId}/revoke")
    fun revoke(
        @PathVariable bannerId: UUID,
        @RequestBody(required = false) body: RevokeRequest?,
        request: HttpServletRequest,
    ): ResponseEntity<Envelope<AdminBannerService.RevokeResult>> = recorded(request, "REVOKE_ADMIN_BANNER", body?.reason.orEmpty(), null) {
        val result = banners.revoke(bannerId)
        result.bannerId to result
    }

    /**
     * 성공이든 실패든 한 줄 남긴다. 배너는 모든 화면 위에 걸리므로, 무엇이 언제 걸리고
     * 언제 내려갔는지가 남지 않으면 사용자 문의를 되짚을 수 없다.
     */
    private fun <T> recorded(
        request: HttpServletRequest,
        action: String,
        reason: String,
        key: UUID?,
        operation: (AdminPrincipal) -> Pair<UUID, T>,
    ): ResponseEntity<Envelope<T>> {
        val principal = principal(request)
        val requestId = requestId(request)
        return try {
            val (targetId, result) = operation(principal)
            audit.record(
                AdminAuditRepository.Record(
                    clock.instant(), principal.operatorId, principal.username, action, "BANNER", targetId.toString(), "SUCCEEDED",
                    requestId, remoteAddress(request), true, reason.trim(), null, mapper.writeValueAsString(result), key,
                ),
            )
            success(requestId, result)
        } catch (exception: RuntimeException) {
            audit.recordFailure(
                AdminAuditRepository.Record(
                    clock.instant(), principal.operatorId, principal.username, action, "BANNER", "-", "FAILED",
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
