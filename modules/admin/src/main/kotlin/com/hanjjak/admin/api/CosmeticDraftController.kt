package com.hanjjak.admin.api

import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.admin.application.CosmeticDraftService
import com.hanjjak.admin.domain.AdminPrincipal
import com.hanjjak.admin.infrastructure.AdminAuditRepository
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.CacheControl
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestPart
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.multipart.MultipartFile
import java.time.Clock
import java.time.Instant
import java.util.UUID

@RestController
@RequestMapping("/api/admin/v1/cosmetics/studio/sets")
class CosmeticDraftController(
    private val drafts: CosmeticDraftService,
    private val audit: AdminAuditRepository,
    private val mapper: ObjectMapper,
    private val clock: Clock,
) {
    data class Envelope<T>(val requestId: UUID, val serverTime: Instant, val stateVersion: Long, val data: T)
    data class ReviewRequest(val review: String)

    @GetMapping
    fun list(request: HttpServletRequest): ResponseEntity<Envelope<List<CosmeticDraftService.DraftSet>>> = success(requestId(request), drafts.list())

    @PostMapping(consumes = [MediaType.MULTIPART_FORM_DATA_VALUE])
    fun create(
        @RequestPart("name") name: String,
        @RequestPart("concept") concept: MultipartFile,
        request: HttpServletRequest,
    ): ResponseEntity<Envelope<CosmeticDraftService.DraftSet>> = recorded(request, "CREATE_COSMETIC_DRAFT_SET", "COSMETIC_DRAFT_SET") { principal ->
        require(!concept.isEmpty && concept.size in 1..CosmeticDraftService.MAX_UPLOAD_BYTES.toLong()) { "COSMETIC_STUDIO_UPLOAD_TOO_LARGE" }
        val result = drafts.create(name, concept.bytes, principal.operatorId)
        result.id to result
    }

    @GetMapping("/{id}")
    fun detail(@PathVariable id: UUID, request: HttpServletRequest): ResponseEntity<Envelope<CosmeticDraftService.DraftSet>> =
        success(requestId(request), drafts.detail(id))

    @PostMapping("/{id}/cancel")
    fun cancel(@PathVariable id: UUID, request: HttpServletRequest): ResponseEntity<Envelope<CosmeticDraftService.DraftSet>> =
        recorded(request, "CANCEL_COSMETIC_DRAFT_SET", id.toString()) { drafts.cancel(id).let { it.id to it } }

    @GetMapping("/{id}/concept")
    fun concept(@PathVariable id: UUID): ResponseEntity<ByteArray> {
        val image = drafts.concept(id)
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentType(MediaType.parseMediaType(image.mediaType)).body(image.bytes)
    }

    @GetMapping("/{id}/frames/{frameId}/image")
    fun frameImage(@PathVariable id: UUID, @PathVariable frameId: String): ResponseEntity<ByteArray> {
        val image = drafts.frameImage(id, frameId)
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentType(MediaType.IMAGE_PNG).body(image.bytes)
    }

    @PostMapping("/{id}/frames/{frameId}/review")
    fun review(
        @PathVariable id: UUID,
        @PathVariable frameId: String,
        @RequestBody body: ReviewRequest,
        request: HttpServletRequest,
    ): ResponseEntity<Envelope<CosmeticDraftService.DraftSet>> = recorded(request, "REVIEW_COSMETIC_DRAFT_FRAME", frameId) {
        val result = drafts.review(id, frameId, body.review)
        result.id to result
    }

    @PostMapping("/{id}/frames/{frameId}/regenerate")
    fun regenerate(
        @PathVariable id: UUID,
        @PathVariable frameId: String,
        request: HttpServletRequest,
    ): ResponseEntity<Envelope<CosmeticDraftService.DraftSet>> = recorded(request, "REGENERATE_COSMETIC_DRAFT_FRAME", frameId) {
        val result = drafts.regenerate(id, frameId)
        result.id to result
    }

    private fun <T> recorded(
        request: HttpServletRequest,
        action: String,
        targetId: String,
        operation: (AdminPrincipal) -> Pair<String, T>,
    ): ResponseEntity<Envelope<T>> {
        val principal = principal(request)
        val id = requestId(request)
        return try {
            val (target, result) = operation(principal)
            audit.record(
                AdminAuditRepository.Record(
                    clock.instant(), principal.operatorId, principal.username, action, "COSMETIC_DRAFT_SET", target,
                    "SUCCEEDED", id, remoteAddress(request), true, null, null, mapper.writeValueAsString(result), null,
                ),
            )
            success(id, result)
        } catch (failure: RuntimeException) {
            audit.recordFailure(
                AdminAuditRepository.Record(
                    clock.instant(), principal.operatorId, principal.username, action, "COSMETIC_DRAFT_SET", targetId,
                    "FAILED", id, remoteAddress(request), true,
                ),
            )
            throw failure
        }
    }

    private fun <T> success(id: UUID, data: T): ResponseEntity<Envelope<T>> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Envelope(id, clock.instant(), 0, data))

    private fun principal(request: HttpServletRequest): AdminPrincipal = request.getAttribute(AdminAccessFilter.PRINCIPAL_ATTRIBUTE) as? AdminPrincipal
        ?: throw IllegalArgumentException("ADMIN_AUTHENTICATION_REQUIRED")
    private fun requestId(request: HttpServletRequest): UUID = request.getAttribute(AdminAccessFilter.REQUEST_ID_ATTRIBUTE) as? UUID ?: UUID.randomUUID()
    private fun remoteAddress(request: HttpServletRequest): String = request.remoteAddr.orEmpty().ifBlank { "unknown" }

    companion object {
        const val MAX_UPLOAD_BYTES = 8 * 1024 * 1024
    }
}
