package com.hanjjak.admin.application

import org.h2.jdbcx.JdbcDataSource
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import java.awt.Color
import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import javax.imageio.ImageIO
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CosmeticDraftServiceTest {
    private val now = Instant.parse("2026-10-01T12:00:00Z")
    private val clock = Clock.fixed(now, ZoneOffset.UTC)
    private val dataSource = JdbcDataSource().apply { setURL("jdbc:h2:mem:${System.nanoTime()};MODE=PostgreSQL;DB_CLOSE_DELAY=-1") }
    private val jdbc = JdbcClient.create(dataSource)
    private val operatorId = UUID.randomUUID()
    private val service: CosmeticDraftService

    init {
        jdbc.sql(
            """
            create table admin_operator(operator_id uuid primary key);
            create table admin_cosmetic_studio_set(
              set_id uuid primary key,name varchar(120) not null,concept_media_type varchar(32) not null,
              concept_data varbinary not null,concept_render_data varbinary not null,status varchar(16) not null,
              completed_frames integer not null,total_frames integer not null,job_cursor integer not null,
              current_slot varchar(16),current_motion varchar(16),error varchar,lease_token uuid,
              lease_until timestamp with time zone,created_by uuid,created_at timestamp with time zone not null,
              updated_at timestamp with time zone not null);
            create table admin_cosmetic_studio_frame(
              frame_id varchar(48) not null,set_id uuid not null,slot varchar(16) not null,motion varchar(16) not null,
              frame integer not null,png_data varbinary not null,review varchar(16) not null,revision integer not null,
              width integer not null,height integer not null,created_at timestamp with time zone not null,
              updated_at timestamp with time zone not null,primary key(set_id,frame_id),unique(set_id,slot,motion,frame));
            """.trimIndent(),
        ).update()
        jdbc.sql("insert into admin_operator(operator_id) values (:id)").param("id", operatorId).update()
        service = configuredService("https://byok.example/v1", "test-key")
    }

    @Test
    fun `invalid BYOK configuration rejects creation without enqueueing work`() {
        val invalid = listOf(
            "" to "test-key", "   " to "test-key", "not-a-url" to "test-key",
            "ftp://byok.example" to "test-key", "https://user:pass@byok.example" to "test-key",
            "https://byok.example:99999" to "test-key", "https://byok.example/#secret" to "test-key",
            "https://byok.example" to "", "https://byok.example" to " \t ",
            "https://byok.example" to "key\nvalue",
        )
        for ((url, key) in invalid) {
            val unavailable = configuredService(url, key)
            assertEquals(CosmeticStudioByok.ERROR_CODE, assertFailsWith<IllegalArgumentException> {
                unavailable.create("No credentials", conceptPng(), operatorId)
            }.message)
            assertTrue(unavailable.list().isEmpty())
            assertFalse(unavailable.processOneFrame())
        }
    }

    @Test
    fun `worker after credential removal stops persisted work without another frame`() {
        for (alreadyRunning in listOf(false, true)) {
            val draft = service.create("Credentials removed", conceptPng(), operatorId)
            val id = UUID.fromString(draft.id)
            if (alreadyRunning) assertTrue(service.processOneFrame())
            val unavailable = configuredService("", "")
            assertTrue(unavailable.processOneFrame())
            val stopped = unavailable.detail(id)
            assertEquals("failed", stopped.status)
            assertEquals(CosmeticStudioByok.ERROR_CODE, stopped.error)
            assertEquals(if (alreadyRunning) 1 else 0, stopped.completedFrames)
            assertEquals(stopped.completedFrames, stopped.frames.size)
            assertEquals(null, stopped.currentSlot)
            assertEquals(null, stopped.currentMotion)
            assertFalse(unavailable.processOneFrame())
            assertFalse(service.processOneFrame())
        }
    }

    @Test
    fun `unconfigured regeneration leaves frame revision and review unchanged`() {
        val id = UUID.fromString(service.create("Preserve review", conceptPng(), operatorId).id)
        assertTrue(service.processOneFrame())
        service.cancel(id)
        service.review(id, "HEAD:rest:1", "rejected")
        val unavailable = configuredService("https://byok.example", "")
        assertEquals(CosmeticStudioByok.ERROR_CODE, assertFailsWith<IllegalArgumentException> {
            unavailable.regenerate(id, "HEAD:rest:1")
        }.message)
        val frame = service.detail(id).frames.single()
        assertEquals(0, frame.revision)
        assertEquals("rejected", frame.review)
    }

    private fun configuredService(url: String, key: String) = CosmeticDraftService(
        jdbc, CosmeticDraftRenderer(), clock, DataSourceTransactionManager(dataSource), CosmeticStudioByok(url, key),
    )

    @Test
    fun `each atomic tick persists artifact with monotonic progress and cancel ends at frame boundary`() {
        val draft = service.create("Cancel at boundary", conceptPng(), operatorId)
        val id = UUID.fromString(draft.id)
        assertTrue(service.processOneFrame())
        val running = service.detail(id)
        assertEquals("running", running.status)
        assertEquals(1, running.completedFrames)
        assertEquals(1, running.frames.size)
        val png = service.frameImage(id, running.frames.single().id).bytes
        assertTrue(png.size > 8)
        assertEquals(listOf(137, 80, 78, 71, 13, 10, 26, 10), png.take(8).map { it.toInt() and 0xff })
        val cancelling = service.cancel(id)
        assertEquals("cancelled", cancelling.status)
        assertEquals(1, cancelling.completedFrames)
        assertFalse(service.processOneFrame())
        val cancelled = service.detail(id)
        assertEquals("cancelled", cancelled.status)
        assertEquals(1, cancelled.frames.size)
        assertEquals(1, cancelled.completedFrames)
        assertEquals(null, cancelled.currentSlot)
        assertFalse(service.processOneFrame())
        assertEquals(1, service.detail(id).completedFrames)
    }

    @Test
    fun `regeneration advances revision invalidates selected review and preserves neighboring frame`() {
        val draft = service.create("Revision boundary", conceptPng(), operatorId)
        repeat(CosmeticDraftService.TOTAL_FRAMES) { assertTrue(service.processOneFrame()) }
        val id = UUID.fromString(draft.id)
        val originalFrames = service.detail(id).frames
        val selected = originalFrames.first { it.id == "HEAD:rest:1" }
        val neighbor = originalFrames.first { it.id == "HEAD:rest:2" }
        val reviewed = service.review(id, selected.id, "approved")
        assertEquals("approved", reviewed.frames.first { it.id == selected.id }.review)
        val regenerated = service.regenerate(id, selected.id)
        val after = regenerated.frames.first { it.id == selected.id }
        assertEquals(1, after.revision)
        assertEquals("pending", after.review)
        assertTrue(after.url.endsWith("?revision=1"))
        assertEquals(neighbor.revision, regenerated.frames.first { it.id == neighbor.id }.revision)
        assertEquals(neighbor.url, regenerated.frames.first { it.id == neighbor.id }.url)
        assertEquals(CosmeticDraftService.TOTAL_FRAMES, regenerated.completedFrames)
        assertEquals("completed", regenerated.status)
    }

    @Test
    fun `malformed and unsupported concept payloads are rejected before durable enqueue`() {
        assertEquals("COSMETIC_STUDIO_IMAGE_FORMAT_UNSUPPORTED", assertFailsWith<IllegalArgumentException> {
            service.create("bad", byteArrayOf(1, 2, 3), operatorId)
        }.message)
        assertTrue(service.list().isEmpty())
    }

    private fun conceptPng(): ByteArray {
        val source = BufferedImage(16, 16, BufferedImage.TYPE_INT_ARGB)
        val graphics = source.createGraphics()
        graphics.color = Color(240, 40, 70, 220)
        graphics.fillRect(2, 2, 12, 12)
        graphics.dispose()
        return ByteArrayOutputStream().also { ImageIO.write(source, "png", it) }.toByteArray()
    }
}
