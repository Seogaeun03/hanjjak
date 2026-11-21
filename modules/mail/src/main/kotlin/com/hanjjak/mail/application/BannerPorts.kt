package com.hanjjak.mail.application

import com.hanjjak.mail.domain.Banner
import java.time.Instant
import java.util.UUID

interface BannerRepository {
    /** 지금 노출 기간이 열려 있고, 내려가지 않았고, 이 계정이 닫지 않은 배너만 최신순으로 준다. */
    fun visible(accountId: UUID, now: Instant, limit: Int): List<Banner>
    fun exists(bannerId: UUID, now: Instant): Boolean
    fun markDismissed(bannerId: UUID, accountId: UUID, dismissedAt: Instant)
}
