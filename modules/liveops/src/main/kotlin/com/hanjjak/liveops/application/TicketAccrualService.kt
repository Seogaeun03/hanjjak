package com.hanjjak.liveops.application

import com.hanjjak.account.application.LiveopsAccrualLifecycle
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

@Service
class TicketAccrualService(
    private val catalog: LiveopsCatalog,
    private val repository: LiveopsRepository,
    private val clock: Clock,
) : LiveopsAccrualLifecycle {

    @Transactional
    override fun accrueForHeartbeat(accountId: UUID) {
        val content = catalog.current()
        val now: Instant = clock.instant()
        if (!content.isOpenAt(now)) return
        if (repository.isHalted(content.eventId)) return

        val kstDate = LocalDate.ofInstant(now, KST)
        val row = repository.lockOrCreateAccrual(content.eventId, accountId, kstDate, now)
        val policy = content.accrual

        val gap = Duration.between(row.lastTickAt, now).seconds
        /* 문턱 아래면 저장하지 않고 돌아간다. 기준점이 그대로라 흘러간 시간은 다음 하트비트가
           함께 인정한다. 시계가 뒤로 갔을 때(gap 이 음수)도 같은 가지로 빠진다. */
        if (gap < MIN_TICK_SECONDS) return

        if (row.grantedToday >= policy.dailyCap) {
            /* 상한에 닿은 뒤에도 마지막 하트비트 시각은 갱신해 둔다. */
            repository.saveAccrual(content.eventId, accountId, kstDate, 0, row.grantedToday, now)
            return
        }

        val credited = gap.coerceAtMost(policy.maxHeartbeatGapSeconds)
        var accrued = row.accruedSeconds + credited
        var granted = row.grantedToday
        var minted = 0L
        while (accrued >= policy.secondsPerTicket && granted < policy.dailyCap) {
            accrued -= policy.secondsPerTicket
            granted += 1
            minted += 1
        }
        /* 상한에 닿으면 남은 초를 버린다. 들고 있으면 자정 직후에 한 번에 터져 나와
           "하루 40장" 이 사실상 깨진다. */
        if (granted >= policy.dailyCap) accrued = 0

        repository.saveAccrual(content.eventId, accountId, kstDate, accrued, granted, now)
        if (minted > 0) repository.creditTickets(content.eventId, accountId, minted)
    }

    companion object {
        val KST: ZoneId = ZoneId.of("Asia/Seoul")

        /**
         * 이보다 짧은 간격은 인정하지 않는다. 하트비트는 30초 주기라 정상 흐름에는 닿지 않고,
         * `requireActive` 가 여러 API 경로에서 자주 불릴 때 불필요한 저장(쓰기)만 걷어 낸다.
         * 행 잠금은 `lockOrCreateAccrual` 이 이 검사보다 먼저 잡으므로, 잠금 경쟁을 줄이지는 못한다.
         */
        const val MIN_TICK_SECONDS = 10L
    }
}
