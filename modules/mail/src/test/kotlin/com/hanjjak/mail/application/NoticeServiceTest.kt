package com.hanjjak.mail.application

import com.hanjjak.mail.domain.Notice
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class NoticeServiceTest {
    private val accountId = UUID.randomUUID()
    private val now = Instant.parse("2026-09-15T03:00:00Z")
    private val repository = MemoryNotices()
    private val service = NoticeService(repository, Clock.fixed(now, ZoneOffset.UTC))

    /* 공지는 계정마다 복제되지 않는다. 기간만 열려 있으면 늦게 온 사람도 그대로 본다. */
    @Test
    fun `shows every notice whose window is open right now`() {
        val live = repository.add("점검 안내", now.minusSeconds(60), null)
        repository.add("지난 이벤트", now.minusSeconds(600), now.minusSeconds(60))
        repository.add("예고", now.plusSeconds(600), null)
        assertEquals(listOf(live), service.list(accountId).items.map { it.noticeId })
    }

    @Test
    fun `counts only what this reader has not opened`() {
        val first = repository.add("하나", now.minusSeconds(60), null)
        repository.add("둘", now.minusSeconds(30), null)
        assertEquals(2, service.list(accountId).unreadCount)
        service.read(accountId, first)
        assertEquals(1, service.list(accountId).unreadCount)
    }

    @Test
    fun `keeps the first time a notice was opened`() {
        val notice = repository.add("하나", now.minusSeconds(60), null)
        val first = service.read(accountId, notice)
        assertEquals(first.readAt, service.read(accountId, notice).readAt)
    }

    /* 지운 공지는 지운 사람에게서만 사라지고, 안 읽음 배지에도 남지 않는다. */
    @Test
    fun `deleting hides the notice from this reader only`() {
        val notice = repository.add("하나", now.minusSeconds(60), null)
        service.delete(accountId, notice)
        assertTrue(service.list(accountId).items.isEmpty())
        assertEquals(0, service.list(accountId).unreadCount)
        assertTrue(service.list(UUID.randomUUID()).items.isNotEmpty())
    }

    @Test
    fun `refuses to touch a notice whose window has closed`() {
        val expired = repository.add("지난 이벤트", now.minusSeconds(600), now.minusSeconds(60))
        assertEquals("NOTICE_NOT_FOUND", assertFailsWith<IllegalArgumentException> { service.read(accountId, expired) }.message)
    }

    private class MemoryNotices : NoticeRepository {
        private data class Row(val notice: Notice, val expiresAt: Instant?)
        private data class State(val readAt: Instant?, val deletedAt: Instant?)

        private val rows = linkedMapOf<UUID, Row>()
        private val states = mutableMapOf<Pair<UUID, UUID>, State>()

        fun add(title: String, publishedAt: Instant, expiresAt: Instant?): UUID {
            val id = UUID.randomUUID()
            rows[id] = Row(Notice(id, title, "본문", "운영자", publishedAt, expiresAt, null), expiresAt)
            return id
        }

        private fun open(row: Row, now: Instant) =
            !row.notice.publishedAt.isAfter(now) && (row.expiresAt == null || row.expiresAt.isAfter(now))

        override fun visible(accountId: UUID, now: Instant, limit: Int) = rows.values
            .filter { open(it, now) && states[it.notice.noticeId to accountId]?.deletedAt == null }
            .sortedByDescending { it.notice.publishedAt }
            .take(limit)
            .map { it.notice.copy(readAt = states[it.notice.noticeId to accountId]?.readAt) }

        override fun unreadCount(accountId: UUID, now: Instant) = visible(accountId, now, Int.MAX_VALUE).count { it.readAt == null }

        override fun exists(noticeId: UUID, now: Instant) = rows[noticeId]?.let { open(it, now) } ?: false

        override fun readAt(noticeId: UUID, accountId: UUID) = states[noticeId to accountId]?.readAt

        override fun markRead(noticeId: UUID, accountId: UUID, readAt: Instant) {
            val key = noticeId to accountId
            val current = states[key]
            states[key] = State(current?.readAt ?: readAt, current?.deletedAt)
        }

        override fun markDeleted(noticeId: UUID, accountId: UUID, deletedAt: Instant) {
            val key = noticeId to accountId
            val current = states[key]
            states[key] = State(current?.readAt ?: deletedAt, current?.deletedAt ?: deletedAt)
        }
    }
}
