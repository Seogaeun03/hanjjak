package com.hanjjak.mail.application

import com.hanjjak.mail.domain.Banner
import com.hanjjak.mail.domain.BannerTone
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class BannerServiceTest {
    private val accountId = UUID.randomUUID()
    private val now = Instant.parse("2026-09-17T03:00:00Z")
    private val repository = MemoryBanners()
    private val service = BannerService(repository, Clock.fixed(now, ZoneOffset.UTC))

    @Test
    fun `shows every banner whose window is open right now`() {
        val live = repository.add("점검 안내", now.minusSeconds(60), now.plusSeconds(600))
        repository.add("지난 이벤트", now.minusSeconds(600), now.minusSeconds(60))
        repository.add("예고", now.plusSeconds(600), now.plusSeconds(1200))
        assertEquals(listOf(live), service.list(accountId).items.map { it.bannerId })
    }

    /* 내린 배너는 기간이 남아 있어도 더는 걸리지 않는다. */
    @Test
    fun `hides a banner the operator took down early`() {
        val banner = repository.add("오타", now.minusSeconds(60), now.plusSeconds(600))
        repository.revoke(banner)
        assertTrue(service.list(accountId).items.isEmpty())
    }

    /* 닫기는 닫은 사람의 화면에서만 끝난다. 아직 안 본 사람에게는 그대로 남는다. */
    @Test
    fun `dismissing hides the banner from this viewer only`() {
        val banner = repository.add("점검 안내", now.minusSeconds(60), now.plusSeconds(600))
        service.dismiss(accountId, banner)
        assertTrue(service.list(accountId).items.isEmpty())
        assertTrue(service.list(UUID.randomUUID()).items.isNotEmpty())
    }

    /* 화면이 같은 요청을 두 번 보내도 처음 닫은 시각이 답이다. */
    @Test
    fun `keeps the first time a banner was dismissed`() {
        val banner = repository.add("점검 안내", now.minusSeconds(60), now.plusSeconds(600))
        val first = service.dismiss(accountId, banner)
        assertEquals(first.dismissedAt, service.dismiss(accountId, banner).dismissedAt)
    }

    @Test
    fun `refuses to touch a banner whose window has closed`() {
        val expired = repository.add("지난 이벤트", now.minusSeconds(600), now.minusSeconds(60))
        assertEquals("BANNER_NOT_FOUND", assertFailsWith<IllegalArgumentException> { service.dismiss(accountId, expired) }.message)
    }

    /* 배너가 화면 위를 다 먹지 않도록, 겹쳐도 최신 것부터 정해진 개수까지만 내려준다. */
    @Test
    fun `caps how many banners stack at once`() {
        repeat(BannerService.MAX_BANNERS + 2) { index ->
            repository.add("공지 $index", now.minusSeconds((10 - index).toLong()), now.plusSeconds(600))
        }
        assertEquals(BannerService.MAX_BANNERS, service.list(accountId).items.size)
    }

    private class MemoryBanners : BannerRepository {
        private data class Row(val banner: Banner, val publishedAt: Instant, var revokedAt: Instant?)

        private val rows = mutableListOf<Row>()
        private val dismissals = mutableMapOf<Pair<UUID, UUID>, Instant>()

        fun add(message: String, publishedAt: Instant, expiresAt: Instant): UUID {
            val bannerId = UUID.randomUUID()
            rows += Row(Banner(bannerId, message, BannerTone.INFO, expiresAt), publishedAt, null)
            return bannerId
        }

        fun revoke(bannerId: UUID) {
            rows.first { it.banner.bannerId == bannerId }.revokedAt = Instant.EPOCH
        }

        override fun visible(accountId: UUID, now: Instant, limit: Int): List<Banner> = rows
            .filter { open(it, now) && (it.banner.bannerId to accountId) !in dismissals }
            .sortedByDescending { it.publishedAt }
            .take(limit)
            .map { it.banner }

        override fun exists(bannerId: UUID, now: Instant): Boolean = rows.any { it.banner.bannerId == bannerId && open(it, now, ignoreRevoked = true) }

        override fun markDismissed(bannerId: UUID, accountId: UUID, dismissedAt: Instant) {
            dismissals.putIfAbsent(bannerId to accountId, dismissedAt)
        }

        private fun open(row: Row, now: Instant, ignoreRevoked: Boolean = false): Boolean =
            !row.publishedAt.isAfter(now) && row.banner.expiresAt.isAfter(now) && (ignoreRevoked || row.revokedAt == null)
    }
}
