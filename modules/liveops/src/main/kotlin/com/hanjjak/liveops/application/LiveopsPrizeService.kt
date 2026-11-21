package com.hanjjak.liveops.application

import com.hanjjak.liveops.domain.LiveopsContent
import org.springframework.stereotype.Service
import java.time.Instant
import java.util.UUID

@Service
class LiveopsPrizeService(
    private val repository: LiveopsRepository,
    private val notice: LiveopsPrizeNotice,
) {
    /**
     * 경품을 줄 수 있는지 본다. 기간·재고·계정 이력 셋을 모두 통과해야 한다.
     *
     * 재고 행을 잠근 채로 읽으므로, 같은 트랜잭션 안에서 방금 올린 `claimed` 와 방금 넣은
     * 당첨 행을 다음 회차가 그대로 본다. 10연차 안의 두 번째 당첨이 여기서 막힌다.
     *
     * 잠그기 전에 반드시 존재를 보장한다(`ensurePrizeStock` 은 이미 있으면 손대지 않는다).
     * 이 행은 지금 `LiveopsConfiguration` 의 `ApplicationRunner` 가 앱 기동 시 한 번만
     * 만든다. 그 시점 이후로 행이 없어질 이유가 production 에는 없어야 하지만, 있다면
     * "재고 없음 재고 0" 으로 조용히 반올림하는 대신 여기서 항상 만들어 두는 쪽이 안전하다
     * — `lockPrizeStock` 자체는 없는 행을 조용히 통과시키지 않고 계속 예외를 던진다.
     */
    fun isGrantable(content: LiveopsContent, prizeId: String, accountId: UUID, now: Instant): Boolean {
        if (!content.isOpenAt(now)) return false
        repository.ensurePrizeStock(content.eventId, prizeId, content.prizeOf(prizeId).stock)
        val stock = repository.lockPrizeStock(content.eventId, prizeId)
        if (stock.claimed >= stock.total) return false
        return repository.countPrizeWins(content.eventId, prizeId, accountId) < content.prizeOf(prizeId).perAccountLimit
    }

    /**
     * 당첨을 확정한다. [isGrantable] 을 통과한 직후에만 부른다.
     *
     * 유니크 제약에 걸리면 재고 행 잠금을 들고도 두 번 들어왔다는 뜻이라 불변 조건이 깨진
     * 것이다. 여기서 쌀로 조용히 바꾸지 않고 트랜잭션을 되돌린다. 플레이어는 같은
     * `commandId` 로 다시 눌러 깨끗한 결과를 받고, 운영은 로그로 사고를 본다.
     */
    fun award(content: LiveopsContent, prizeId: String, accountId: UUID, drawId: UUID, now: Instant): UUID {
        val winId = UUID.randomUUID()
        check(repository.insertPrizeWin(winId, content.eventId, prizeId, accountId, drawId, now)) { "LIVEOPS_PRIZE_AWARD_CONFLICT" }
        repository.incrementPrizeClaimed(content.eventId, prizeId)
        notice.notify(accountId, content.prizeOf(prizeId).displayName, winId, now)
        return winId
    }
}
