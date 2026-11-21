package com.hanjjak.mail.application

import com.hanjjak.mail.domain.BannerDismissResult
import com.hanjjak.mail.domain.BannerPage
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.util.UUID

open class BannerService(private val repository: BannerRepository, private val clock: Clock) {
    @Transactional(readOnly = true)
    open fun list(accountId: UUID): BannerPage = BannerPage(repository.visible(accountId, clock.instant(), MAX_BANNERS))

    /**
     * 닫기는 되돌리지 않는다. 이미 닫은 배너를 다시 닫아도 처음 닫은 시각이 답이다 —
     * 화면이 요청을 두 번 보내도 결과가 같아야 낙관적 갱신이 어긋나지 않는다.
     */
    @Transactional
    open fun dismiss(accountId: UUID, bannerId: UUID): BannerDismissResult {
        require(repository.exists(bannerId, clock.instant())) { "BANNER_NOT_FOUND" }
        val dismissedAt = clock.instant()
        repository.markDismissed(bannerId, accountId, dismissedAt)
        return BannerDismissResult(bannerId, dismissedAt)
    }

    companion object {
        /** 화면 맨 위를 배너가 다 먹는 일은 없어야 한다. 겹치면 최신 것부터 이만큼만 내려준다. */
        const val MAX_BANNERS = 3
    }
}
