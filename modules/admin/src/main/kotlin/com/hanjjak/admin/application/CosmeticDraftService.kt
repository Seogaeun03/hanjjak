package com.hanjjak.admin.application

import com.fasterxml.jackson.annotation.JsonInclude
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.sql.Timestamp
import java.time.Clock
import java.time.Duration
import java.util.UUID

@Service
class CosmeticDraftService(
    private val jdbc: JdbcClient,
    private val renderer: CosmeticDraftRenderer,
    private val clock: Clock,
    transactionManager: PlatformTransactionManager,
    private val byok: CosmeticStudioByok,
) {
    private val transactions = TransactionTemplate(transactionManager)

    data class DraftFrame(
        val id: String,
        val slot: String,
        val motion: String,
        val frame: Int,
        val url: String,
        val review: String,
        val revision: Int,
        val width: Int,
        val height: Int,
    )

    @JsonInclude(JsonInclude.Include.ALWAYS)
    data class DraftSet(
        val id: String,
        val name: String,
        val conceptUrl: String,
        val status: String,
        val completedFrames: Int,
        val totalFrames: Int,
        val currentSlot: String?,
        val currentMotion: String?,
        val error: String?,
        val frames: List<DraftFrame>,
    )

    data class Image(val mediaType: String, val bytes: ByteArray)
    private data class Coordinates(val slot: String, val motion: String, val frame: Int)
    private data class Work(val id: UUID, val lease: UUID, val coordinates: Coordinates)
    private data class SetRow(val name: String, val status: String, val completed: Int, val slot: String?, val motion: String?, val error: String?)
    private data class LockedSet(val status: String, val lease: UUID?)

    fun list(): List<DraftSet> = jdbc.sql("select set_id from admin_cosmetic_studio_set order by created_at desc,set_id desc")
        .query(UUID::class.java).list().map(::load)
    fun create(name: String, bytes: ByteArray, operatorId: UUID): DraftSet {
        byok.requireConfigured()
        val cleanName = name.trim()
        require(cleanName.isNotEmpty() && cleanName.length <= MAX_NAME_LENGTH) { "COSMETIC_STUDIO_NAME_INVALID" }
        val concept = renderer.decodeConcept(bytes)
        val conceptMediaType = concept.mediaType
        val renderBytes = concept.renderBytes
        concept.image.flush()
        val now = Timestamp.from(clock.instant())
        val id = UUID.randomUUID()
        jdbc.sql(
            """
            insert into admin_cosmetic_studio_set(
              set_id,name,concept_media_type,concept_data,concept_render_data,status,completed_frames,total_frames,job_cursor,created_by,created_at,updated_at
            ) values (:id,:name,:mediaType,:bytes,:renderBytes,'queued',0,:total,0,:operator,:now,:now)
            """.trimIndent(),
        ).params(
            mapOf("id" to id, "name" to cleanName, "mediaType" to conceptMediaType, "bytes" to bytes,
                "renderBytes" to renderBytes, "total" to TOTAL_FRAMES, "operator" to operatorId, "now" to now),
        ).update()
        return load(id)
    }

    fun detail(id: UUID): DraftSet = load(id)

    fun cancel(id: UUID): DraftSet {
        transactions.executeWithoutResult {
            val set = lockSet(id)
            when (set.status) {
                "queued" -> updateStatus(id, "cancelled", null)
                "running" -> if (set.lease == null) updateStatus(id, "cancelled", null)
                    else updateStatus(id, "cancelling", set.lease)
                "cancelling", "cancelled" -> Unit
                else -> throw IllegalArgumentException("COSMETIC_STUDIO_CANCEL_NOT_ALLOWED")
            }
        }
        return load(id)
    }

    fun review(id: UUID, frameId: String, review: String): DraftSet {
        require(review in REVIEWS) { "COSMETIC_STUDIO_REVIEW_INVALID" }
        transactions.executeWithoutResult {
            lockSet(id)
            val changed = jdbc.sql(
                "update admin_cosmetic_studio_frame set review=:review,updated_at=:now where set_id=:set and frame_id=:frame and exists (select 1 from admin_cosmetic_studio_set where set_id=:set and status not in ('queued','running','cancelling'))",
            ).params(mapOf("review" to review, "now" to Timestamp.from(clock.instant()), "set" to id, "frame" to frameId)).update()
            require(changed == 1) { "COSMETIC_STUDIO_JOB_BUSY_OR_FRAME_NOT_FOUND" }
        }
        return load(id)
    }

    fun regenerate(id: UUID, frameId: String): DraftSet {
        byok.requireConfigured()
        transactions.executeWithoutResult {
            val set = lockSet(id)
            require(set.status !in ACTIVE_STATUSES) { "COSMETIC_STUDIO_JOB_BUSY" }
            val frame = jdbc.sql(
                "select slot,motion,frame,revision from admin_cosmetic_studio_frame where set_id=:set and frame_id=:frame for update",
            ).params(mapOf("set" to id, "frame" to frameId)).query { row, _ ->
                Coordinates(row.getString("slot"), row.getString("motion"), row.getInt("frame")) to row.getInt("revision")
            }.optional().orElse(null) ?: throw IllegalArgumentException("COSMETIC_STUDIO_FRAME_NOT_FOUND")
            val decoded = renderer.decodeConcept(renderBytes(id))
            val nextRevision = frame.second + 1
            val png = try {
                renderer.render(decoded.image, frame.first.slot, frame.first.motion, frame.first.frame, nextRevision)
            } finally {
                decoded.image.flush()
            }
            jdbc.sql(
                "update admin_cosmetic_studio_frame set png_data=:png,revision=:revision,review='pending',updated_at=:now where set_id=:set and frame_id=:frame",
            ).params(mapOf("png" to png, "revision" to nextRevision, "now" to Timestamp.from(clock.instant()), "set" to id, "frame" to frameId)).update()
        }
        return load(id)
    }

    fun concept(id: UUID): Image = jdbc.sql("select concept_media_type,concept_data from admin_cosmetic_studio_set where set_id=:id")
        .param("id", id).query { row, _ -> Image(row.getString("concept_media_type"), row.getBytes("concept_data")) }
        .optional().orElseThrow { IllegalArgumentException("COSMETIC_STUDIO_SET_NOT_FOUND") }

    fun frameImage(id: UUID, frameId: String): Image = jdbc.sql(
        "select png_data from admin_cosmetic_studio_frame where set_id=:id and frame_id=:frame",
    ).params(mapOf("id" to id, "frame" to frameId))
        .query { row, _ -> Image("image/png", row.getBytes("png_data")) }
        .optional().orElseThrow { IllegalArgumentException("COSMETIC_STUDIO_FRAME_NOT_FOUND") }

    /** Claims and commits at most one artifact per call; the same deterministic tick is used by tests. */
    fun processOneFrame(): Boolean {
        val work = transactions.execute { claimOne() } ?: return false
        try {
            byok.requireConfigured()
        } catch (failure: IllegalArgumentException) {
            fail(work, failure)
            return true
        }
        val decoded = try {
            renderer.decodeConcept(renderBytes(work.id))
        } catch (failure: RuntimeException) {
            fail(work, failure)
            return true
        }
        val png = try {
            renderer.render(decoded.image, work.coordinates.slot, work.coordinates.motion, work.coordinates.frame, 0)
        } catch (failure: RuntimeException) {
            fail(work, failure)
            return true
        } finally {
            decoded.image.flush()
        }
        transactions.executeWithoutResult {
            val current = jdbc.sql(
                "select status,job_cursor from admin_cosmetic_studio_set where set_id=:id and lease_token=:lease for update",
            ).params(mapOf("id" to work.id, "lease" to work.lease))
                .query { row, _ -> row.getString("status") to row.getInt("job_cursor") }.optional().orElse(null)
                ?: return@executeWithoutResult
            if (current.first !in setOf("running", "cancelling") || current.second != coordinatesIndex(work.coordinates)) return@executeWithoutResult
            val now = Timestamp.from(clock.instant())
            val point = work.coordinates
            jdbc.sql(
                """
                insert into admin_cosmetic_studio_frame(frame_id,set_id,slot,motion,frame,png_data,review,revision,width,height,created_at,updated_at)
                values (:frameId,:set,:slot,:motion,:frame,:png,'pending',0,:width,:height,:now,:now)
                """.trimIndent(),
            ).params(
                mapOf("frameId" to frameId(point), "set" to work.id, "slot" to point.slot, "motion" to point.motion,
                    "frame" to point.frame, "png" to png, "width" to CosmeticDraftRenderer.SIZE,
                    "height" to CosmeticDraftRenderer.SIZE, "now" to now),
            ).update()
            val next = current.second + 1
            val status = when {
                current.first == "cancelling" -> "cancelled"
                next == TOTAL_FRAMES -> "completed"
                else -> "running"
            }
            val upcoming = if (status == "running") point else null
            jdbc.sql(
                """
                update admin_cosmetic_studio_set
                set job_cursor=:next,completed_frames=:next,status=:status,current_slot=:slot,current_motion=:motion,
                    lease_token=null,lease_until=null,updated_at=:now
                where set_id=:id and lease_token=:lease
                """.trimIndent(),
            ).params(
                mapOf("next" to next, "status" to status, "slot" to upcoming?.slot, "motion" to upcoming?.motion,
                    "now" to now, "id" to work.id, "lease" to work.lease),
            ).update()
        }
        return true
    }

    @Scheduled(fixedDelayString = "\${hanjjak.cosmetic-studio.worker-delay-ms:250}")
    fun processScheduledFrame() {
        processOneFrame()
    }

    private fun claimOne(): Work? {
        val nowInstant = clock.instant()
        val now = Timestamp.from(nowInstant)
        val candidate = jdbc.sql(
            """
            select set_id,status,job_cursor from admin_cosmetic_studio_set
            where status in ('queued','running','cancelling') and (lease_until is null or lease_until <= :now)
            order by case when status='queued' then 0 else 1 end,created_at,set_id
            limit 1
            for update skip locked
            """.trimIndent(),
        ).param("now", now).query { row, _ ->
            Triple(row.getObject("set_id", UUID::class.java), row.getString("status"), row.getInt("job_cursor"))
        }.optional().orElse(null) ?: return null
        if (candidate.second == "cancelling") {
            updateStatus(candidate.first, "cancelled", null)
            return null
        }
        if (candidate.third >= TOTAL_FRAMES) {
            updateStatus(candidate.first, "completed", null)
            return null
        }
        val point = coordinates(candidate.third)
        val lease = UUID.randomUUID()
        jdbc.sql(
            """
            update admin_cosmetic_studio_set set status='running',current_slot=:slot,current_motion=:motion,
                lease_token=:lease,lease_until=:expiry,updated_at=:now where set_id=:id
            """.trimIndent(),
        ).params(
            mapOf("slot" to point.slot, "motion" to point.motion, "lease" to lease,
                "expiry" to Timestamp.from(nowInstant.plus(LEASE_DURATION)), "now" to now, "id" to candidate.first),
        ).update()
        return Work(candidate.first, lease, point)
    }

    private fun fail(work: Work, failure: RuntimeException) {
        transactions.executeWithoutResult {
            val state = jdbc.sql("select status from admin_cosmetic_studio_set where set_id=:id and lease_token=:lease for update")
                .params(mapOf("id" to work.id, "lease" to work.lease)).query(String::class.java).optional().orElse(null)
                ?: return@executeWithoutResult
            val status = if (state == "cancelling") "cancelled" else "failed"
            val code = failure.message?.takeIf { it.matches(Regex("[A-Z][A-Z0-9_]*")) } ?: "COSMETIC_STUDIO_GENERATION_FAILED"
            jdbc.sql(
                "update admin_cosmetic_studio_set set status=:status,error=:error,current_slot=null,current_motion=null,lease_token=null,lease_until=null,updated_at=:now where set_id=:id and lease_token=:lease",
            ).params(mapOf("status" to status, "error" to if (status == "failed") code else null,
                "now" to Timestamp.from(clock.instant()), "id" to work.id, "lease" to work.lease)).update()
        }
    }

    private fun load(id: UUID): DraftSet = transactions.execute {
        lockSet(id)
        val set = jdbc.sql(
            "select name,status,completed_frames,current_slot,current_motion,error from admin_cosmetic_studio_set where set_id=:id",
        ).param("id", id).query { row, _ ->
            SetRow(row.getString("name"), row.getString("status"), row.getInt("completed_frames"),
                row.getString("current_slot"), row.getString("current_motion"), row.getString("error"))
        }.optional().orElseThrow { IllegalArgumentException("COSMETIC_STUDIO_SET_NOT_FOUND") }
        val frames = jdbc.sql(
            "select frame_id,slot,motion,frame,review,revision,width,height from admin_cosmetic_studio_frame where set_id=:id order by slot,motion,frame",
        ).param("id", id).query { row, _ ->
            val frameId = row.getString("frame_id")
            val revision = row.getInt("revision")
            DraftFrame(frameId, row.getString("slot"), row.getString("motion"), row.getInt("frame"),
                frameUrl(id, frameId, revision), row.getString("review"), revision, row.getInt("width"), row.getInt("height"))
        }.list()
        DraftSet(id.toString(), set.name, "/api/admin/v1/cosmetics/studio/sets/$id/concept", set.status,
            set.completed, TOTAL_FRAMES, set.slot, set.motion, set.error, frames)
    }!!


    private fun renderBytes(id: UUID): ByteArray = jdbc.sql("select concept_render_data from admin_cosmetic_studio_set where set_id=:id")
        .param("id", id).query { row, _ -> row.getBytes("concept_render_data") }.optional()
        .orElseThrow { IllegalArgumentException("COSMETIC_STUDIO_SET_NOT_FOUND") }

    private fun lockSet(id: UUID): LockedSet = jdbc.sql("select status,lease_token from admin_cosmetic_studio_set where set_id=:id for update")
        .param("id", id).query { row, _ -> LockedSet(row.getString("status"), row.getObject("lease_token", UUID::class.java)) }
        .optional().orElseThrow { IllegalArgumentException("COSMETIC_STUDIO_SET_NOT_FOUND") }

    private fun updateStatus(id: UUID, status: String, lease: UUID?) {
        jdbc.sql(
            """
            update admin_cosmetic_studio_set set status=:status,lease_token=:lease,
                lease_until=case when cast(:lease as uuid) is null then null else lease_until end,
                current_slot=case when :status in ('cancelled','completed','failed') then null else current_slot end,
                current_motion=case when :status in ('cancelled','completed','failed') then null else current_motion end,
                updated_at=:now where set_id=:id
            """.trimIndent(),
        ).params(mapOf("status" to status, "lease" to lease, "now" to Timestamp.from(clock.instant()), "id" to id)).update()
    }

    private fun coordinates(index: Int): Coordinates {
        require(index in 0 until TOTAL_FRAMES)
        val perSlot = MOTIONS.sumOf { CosmeticDraftRenderer.MOTION_COUNTS.getValue(it) }
        val slot = SLOTS[index / perSlot]
        var withinSlot = index % perSlot
        for (motion in MOTIONS) {
            val count = CosmeticDraftRenderer.MOTION_COUNTS.getValue(motion)
            if (withinSlot < count) return Coordinates(slot, motion, withinSlot + 1)
            withinSlot -= count
        }
        error("COSMETIC_STUDIO_JOB_CURSOR_INVALID")
    }

    private fun coordinatesIndex(point: Coordinates): Int = SLOTS.indexOf(point.slot) * FRAMES_PER_SLOT +
        MOTIONS.takeWhile { it != point.motion }.sumOf { CosmeticDraftRenderer.MOTION_COUNTS.getValue(it) } + point.frame - 1

    private fun frameId(point: Coordinates) = "${point.slot}:${point.motion}:${point.frame}"
    private fun frameUrl(id: UUID, frameId: String, revision: Int) =
        "/api/admin/v1/cosmetics/studio/sets/$id/frames/$frameId/image?revision=$revision"

    companion object {
        const val TOTAL_FRAMES = 102
        const val MAX_NAME_LENGTH = 120
        const val MAX_UPLOAD_BYTES = CosmeticDraftRenderer.MAX_CONCEPT_BYTES
        private const val FRAMES_PER_SLOT = 17
        private val SLOTS = CosmeticDraftRenderer.SLOTS
        private val MOTIONS = CosmeticDraftRenderer.MOTION_COUNTS.keys.toList()
        private val REVIEWS = setOf("pending", "approved", "rejected")
        private val ACTIVE_STATUSES = setOf("queued", "running", "cancelling")
        private val LEASE_DURATION: Duration = Duration.ofSeconds(30)
    }
}
