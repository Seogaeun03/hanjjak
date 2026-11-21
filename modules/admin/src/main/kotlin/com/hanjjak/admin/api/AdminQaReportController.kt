package com.hanjjak.admin.api

import com.hanjjak.admin.domain.AdminPermission
import com.hanjjak.admin.infrastructure.AdminAuditRepository
import com.hanjjak.admin.infrastructure.AdminQaReportRepository
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.CacheControl
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*
import java.time.Clock
import java.time.Instant
import java.util.UUID

/*
 * 유저가 설정 화면에서 보낸 버그 신고를 운영자가 읽는 자리다. 지금까지는 테이블에
 * 쌓이기만 하고 꺼내 볼 길이 없어, DB 에 직접 붙지 않으면 아무도 못 봤다.
 */
@RestController
@RequestMapping("/api/admin/v1/qa")
class AdminQaReportController(
    private val reports: AdminQaReportRepository,
    private val audit: AdminAuditRepository,
    private val clock: Clock,
) {
    data class Envelope<T>(val requestId: UUID, val serverTime: Instant, val stateVersion: Long, val data: T)

    @GetMapping("/reports")
    fun reports(@RequestParam(defaultValue = "50") limit: Int, request: HttpServletRequest): ResponseEntity<Envelope<List<AdminQaReportRepository.Report>>> {
        val principal = principal(request)
        require(AdminPermission.QA_READ in principal.permissions) { "ADMIN_PERMISSION_DENIED" }
        return try {
            val data = reports.list(limit.coerceIn(1, 200))
            record(request, "QA_READ_REPORTS", null, "SUCCEEDED")
            ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Envelope(requestId(request), clock.instant(), 0, data))
        } catch (error: RuntimeException) {
            record(request, "QA_READ_REPORTS", null, "FAILED")
            throw error
        }
    }

    /* 사진은 감싸지 않고 바이트 그대로 내어 준다. 화면이 <img> 로 바로 걸 수 있어야 한다. */
    @GetMapping("/reports/{reportId}/image")
    fun image(@PathVariable reportId: UUID, request: HttpServletRequest): ResponseEntity<ByteArray> {
        val principal = principal(request)
        require(AdminPermission.QA_READ in principal.permissions) { "ADMIN_PERMISSION_DENIED" }
        val image = reports.image(reportId)
        record(request, "QA_READ_REPORT_IMAGE", reportId.toString(), if (image == null) "FAILED" else "SUCCEEDED")
        return image?.let {
            ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentType(MediaType.parseMediaType(it.mediaType)).body(it.bytes)
        } ?: ResponseEntity.notFound().build()
    }

    private fun record(request: HttpServletRequest, action: String, id: String?, outcome: String) {
        val p = principal(request)
        audit.record(AdminAuditRepository.Record(clock.instant(), p.operatorId, p.username, action, "QA_BUG_REPORT", id, outcome, requestId(request), request.remoteAddr, mutation = false))
    }
    private fun principal(request: HttpServletRequest) = request.getAttribute(AdminAccessFilter.PRINCIPAL_ATTRIBUTE) as? com.hanjjak.admin.domain.AdminPrincipal ?: throw IllegalArgumentException("ADMIN_AUTHENTICATION_REQUIRED")
    private fun requestId(request: HttpServletRequest) = request.getAttribute(AdminAccessFilter.REQUEST_ID_ATTRIBUTE) as? UUID ?: UUID.randomUUID()
}
