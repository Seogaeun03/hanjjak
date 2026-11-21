package com.hanjjak.admin.api

import com.hanjjak.admin.domain.AdminPermission
import com.hanjjak.admin.infrastructure.AdminAuditRepository
import com.hanjjak.liveops.application.LiveopsAdminOverview
import com.hanjjak.liveops.application.LiveopsAdminService
import com.hanjjak.liveops.application.LiveopsWinView
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.CacheControl
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*
import java.time.Clock
import java.time.Instant
import java.util.UUID

@RestController
@RequestMapping("/api/admin/v1/liveops")
class AdminLiveopsController(
    private val liveops: LiveopsAdminService,
    private val audit: AdminAuditRepository,
    private val clock: Clock,
) {
    data class Envelope<T>(val requestId: UUID, val serverTime: Instant, val stateVersion: Long, val data: T)
    data class HaltRequest(val reason: String)
    data class WinUpdateRequest(val status: String, val operatorNote: String? = null)

    @GetMapping("/{eventId}")
    fun overview(@PathVariable eventId: String, request: HttpServletRequest): ResponseEntity<Envelope<LiveopsAdminOverview>> =
        audited(request, "LIVEOPS_READ_OVERVIEW", "LIVEOPS_EVENT", eventId) { liveops.overview(eventId) }

    @PostMapping("/{eventId}/halt")
    fun halt(@PathVariable eventId: String, @RequestBody body: HaltRequest, request: HttpServletRequest): ResponseEntity<Envelope<LiveopsAdminOverview>> =
        audited(request, "LIVEOPS_HALT", "LIVEOPS_EVENT", eventId) { liveops.halt(eventId, body.reason, principal(request).username) }

    @PostMapping("/{eventId}/resume")
    fun resume(@PathVariable eventId: String, request: HttpServletRequest): ResponseEntity<Envelope<LiveopsAdminOverview>> =
        audited(request, "LIVEOPS_RESUME", "LIVEOPS_EVENT", eventId) { liveops.resume(eventId, principal(request).username) }

    @PatchMapping("/wins/{winId}")
    fun updateWin(@PathVariable winId: UUID, @RequestBody body: WinUpdateRequest, request: HttpServletRequest): ResponseEntity<Envelope<LiveopsWinView>> =
        audited(request, "LIVEOPS_UPDATE_WIN", "LIVEOPS_PRIZE_WIN", winId.toString()) { liveops.updateWin(winId, body.status, body.operatorNote) }

    private fun <T> audited(request: HttpServletRequest, action: String, target: String, targetId: String?, operation: () -> T): ResponseEntity<Envelope<T>> {
        val principal = principal(request)
        require(AdminPermission.LIVEOPS_MANAGE in principal.permissions) { "ADMIN_PERMISSION_DENIED" }
        return try {
            val result = operation()
            record(request, action, target, targetId, "SUCCEEDED")
            success(requestId(request), result)
        } catch (error: RuntimeException) {
            record(request, action, target, targetId, "FAILED")
            throw error
        }
    }

    private fun record(request: HttpServletRequest, action: String, target: String, id: String?, outcome: String) {
        val principal = principal(request)
        audit.record(
            AdminAuditRepository.Record(
                clock.instant(), principal.operatorId, principal.username, action, target, id, outcome,
                requestId(request), request.remoteAddr, mutation = request.method != "GET",
            ),
        )
    }

    private fun principal(request: HttpServletRequest) =
        request.getAttribute(AdminAccessFilter.PRINCIPAL_ATTRIBUTE) as? com.hanjjak.admin.domain.AdminPrincipal
            ?: throw IllegalArgumentException("ADMIN_AUTHENTICATION_REQUIRED")

    private fun requestId(request: HttpServletRequest) =
        request.getAttribute(AdminAccessFilter.REQUEST_ID_ATTRIBUTE) as? UUID ?: UUID.randomUUID()

    private fun <T> success(id: UUID, data: T) =
        ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Envelope(id, clock.instant(), 0, data))
}
