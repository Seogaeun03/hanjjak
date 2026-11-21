package com.hanjjak.admin.api

import com.hanjjak.admin.application.AdminChatSettingsService
import com.hanjjak.admin.domain.AdminPermission
import com.hanjjak.admin.domain.AdminPrincipal
import com.hanjjak.admin.infrastructure.AdminAuditRepository
import com.hanjjak.chat.application.ChatRepository
import com.hanjjak.chat.application.ChatReportView
import jakarta.servlet.http.HttpServletRequest
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.http.CacheControl
import org.springframework.http.ResponseEntity
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.bind.annotation.*
import java.time.Clock
import java.time.Instant
import java.util.UUID

@RestController
@RequestMapping("/api/admin/v1/chat")
@ConditionalOnProperty(prefix = "hanjjak.chat", name = ["enabled"], havingValue = "true")
class AdminChatController(
    private val chat: ChatRepository,
    private val settings: AdminChatSettingsService,
    private val audit: AdminAuditRepository,
    private val clock: Clock,
) {
    data class Envelope<T>(val requestId: UUID, val serverTime: Instant, val stateVersion: Long, val data: T)
    data class ModerationResult(val targetId: UUID, val status: String)
    data class SettingsUpdateRequest(val enabled: Boolean, val expectedVersion: Long, val reason: String)

    @GetMapping("/settings")
    fun settings(request: HttpServletRequest): ResponseEntity<Envelope<AdminChatSettingsService.Settings>> {
        val principal = requirePermission(request)
        return try {
            val result = settings.settings()
            audit.record(AdminAuditRepository.Record(clock.instant(), principal.operatorId, principal.username, "CHAT_READ_SETTINGS", "CHAT_SETTINGS", "global", "SUCCEEDED", requestId(request), remoteAddress(request)))
            success(requestId(request), result, result.version)
        } catch (error: RuntimeException) {
            audit.recordFailure(AdminAuditRepository.Record(clock.instant(), principal.operatorId, principal.username, "CHAT_READ_SETTINGS", "CHAT_SETTINGS", "global", "FAILED", requestId(request), remoteAddress(request)))
            throw error
        }
    }
    @PutMapping("/settings")
    @Transactional
    fun updateSettings(
        @RequestHeader("Idempotency-Key") key: UUID,
        @RequestBody body: SettingsUpdateRequest,
        request: HttpServletRequest,
    ): ResponseEntity<Envelope<AdminChatSettingsService.UpdateResult>> {
        val principal = requirePermission(request)
        val requestId = requestId(request)
        return try {
            val result = settings.update(
                principal.operatorId, principal.username, key, body.enabled, body.expectedVersion, body.reason,
                requestId, remoteAddress(request),
            )
            success(requestId, result, result.after.version)
        } catch (error: RuntimeException) {
            audit.recordFailure(
                AdminAuditRepository.Record(
                    clock.instant(), principal.operatorId, principal.username, "UPDATE_CHAT_SETTINGS", "CHAT_SETTINGS", "global", "FAILED",
                    requestId, remoteAddress(request), true, body.reason.trim(), idempotencyKey = key,
                ),
            )
            throw error
        }
    }

    @GetMapping("/reports")
    fun reports(@RequestParam(defaultValue = "50") limit: Int, request: HttpServletRequest): ResponseEntity<Envelope<List<ChatReportView>>> = success(requestId(request), audited(request, "CHAT_READ_REPORTS", "CHAT_REPORT", null, false) { chat.listReports(limit) })

    @PostMapping("/messages/{messageId}/delete")
    fun deleteMessage(@PathVariable messageId: UUID, request: HttpServletRequest): ResponseEntity<Envelope<ModerationResult>> = moderate(request, "CHAT_DELETE_MESSAGE", "CHAT_MESSAGE", messageId) { chat.moderateMessage(messageId) }

    @PostMapping("/board/{postId}/delete")
    fun deleteBoard(@PathVariable postId: UUID, request: HttpServletRequest): ResponseEntity<Envelope<ModerationResult>> = moderate(request, "CHAT_DELETE_BOARD", "CHAT_BOARD_POST", postId) { chat.moderateBoard(postId) }

    @PostMapping("/accounts/{accountId}/ban")
    fun ban(@PathVariable accountId: UUID, @RequestParam(required = false) reason: String?, request: HttpServletRequest): ResponseEntity<Envelope<ModerationResult>> = moderate(request, "CHAT_BAN_ACCOUNT", "ACCOUNT", accountId) { chat.banAccount(accountId, null, reason ?: "ADMIN_MODERATION"); true }

    @DeleteMapping("/accounts/{accountId}/ban")
    fun unban(@PathVariable accountId: UUID, request: HttpServletRequest): ResponseEntity<Envelope<ModerationResult>> = moderate(request, "CHAT_UNBAN_ACCOUNT", "ACCOUNT", accountId) { chat.unbanAccount(accountId); true }

    private fun <T> audited(request: HttpServletRequest, action: String, target: String, id: String?, mutation: Boolean, operation: () -> T): T {
        val principal = requirePermission(request)
        return try {
            val result = operation()
            audit.record(AdminAuditRepository.Record(clock.instant(), principal.operatorId, principal.username, action, target, id, "SUCCEEDED", requestId(request), remoteAddress(request), mutation))
            result
        } catch (error: RuntimeException) {
            audit.recordFailure(AdminAuditRepository.Record(clock.instant(), principal.operatorId, principal.username, action, target, id, "FAILED", requestId(request), remoteAddress(request), mutation))
            throw error
        }
    }
    private fun moderate(request: HttpServletRequest, action: String, target: String, id: UUID, operation: () -> Boolean): ResponseEntity<Envelope<ModerationResult>> {
        val changed = audited(request, action, target, id.toString(), true, operation)
        return success(requestId(request), ModerationResult(id, if (changed) "DELETED" else "NOT_FOUND"))
    }

    private fun requirePermission(request: HttpServletRequest): AdminPrincipal = principal(request).also {
        require(AdminPermission.CHAT_MODERATE in it.permissions) { "ADMIN_PERMISSION_DENIED" }
    }

    private fun principal(request: HttpServletRequest): AdminPrincipal = request.getAttribute(AdminAccessFilter.PRINCIPAL_ATTRIBUTE) as? AdminPrincipal
        ?: throw IllegalArgumentException("ADMIN_AUTHENTICATION_REQUIRED")


    private fun requestId(request: HttpServletRequest) = request.getAttribute(AdminAccessFilter.REQUEST_ID_ATTRIBUTE) as? UUID ?: UUID.randomUUID()
    private fun remoteAddress(request: HttpServletRequest) = request.remoteAddr.orEmpty().ifBlank { "unknown" }
    private fun <T> success(id: UUID, data: T, stateVersion: Long = 0) = ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Envelope(id, clock.instant(), stateVersion, data))
}
