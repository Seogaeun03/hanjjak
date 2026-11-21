package com.hanjjak.balancelab

import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.liveops.domain.LiveopsContent
import com.hanjjak.liveops.domain.LiveopsDrawResult
import com.hanjjak.liveops.domain.LiveopsDrawTable
import com.hanjjak.liveops.domain.LiveopsOutcomeKind
import com.hanjjak.liveops.infrastructure.JsonLiveopsContent
import kotlin.math.floor
import kotlin.random.Random

data class LiveopsProjection(
    val accounts: Int,
    val days: Int,
    val hoursPerDay: Double,
    val ticketsPerAccountPerDay: Long,
    val ticketsPerAccount: Long,
    val totalDraws: Long,
    val riceGranted: Long,
    val cosmeticTicketsGranted: Long,
    val gemBoxesGranted: Long,
    val prizesAwarded: Long,
    val prizeStock: Long,
    val drawsUntilPrizeExhausted: Long?,
    /** 한 계정이 받은 경품 수의 최댓값. `prize.perAccountLimit` 을 실제로 지켰는지 확인하는 값이다. */
    val maxPrizesPerAccount: Long,
)

fun loadLiveopsContent(): LiveopsContent = JsonLiveopsContent(
    requireNotNull(object {}.javaClass.getResourceAsStream("/v1/liveops/hunt-ticket-gacha.json")) { "liveops content missing" },
    ObjectMapper(),
).content

/**
 * 이벤트 수급을 추정한다.
 *
 * 하루 적립은 접속 시간과 일일 상한 중 작은 쪽이다. 상한이 없으면 24시간 켜 두는 쪽이
 * 압도적으로 유리해지므로, 이 `coerceAtMost` 한 줄이 이벤트 공평성의 전부다.
 */
fun projectLiveops(content: LiveopsContent, accounts: Int, days: Int, hoursPerDay: Double, seed: Long): LiveopsProjection {
    require(accounts > 0 && days > 0 && hoursPerDay > 0) { "INVALID_PROJECTION_INPUT" }
    val earnedPerDay = floor(hoursPerDay * 3_600.0 / content.accrual.secondsPerTicket).toLong()
    val ticketsPerDay = earnedPerDay.coerceAtMost(content.accrual.dailyCap)
    val ticketsPerAccount = ticketsPerDay * days

    val table = LiveopsDrawTable(content)
    /* 난수는 루프 밖에서 하나만 만든다. 회차마다 `Random(seed xor draws)` 로 새로 만들면
       씨앗이 1씩 차이 나는 스트림 수만 개가 되어 분포가 미묘하게 상관된다. 재현성은
       씨앗 하나로 충분하다. */
    val random = Random(seed)
    val prize = content.prizes.single()
    var rice = 0L
    var cosmeticTickets = 0L
    var gemBoxes = 0L
    var awarded = 0L
    var draws = 0L
    var exhaustedAt: Long? = null
    var maxPrizesPerAccount = 0L

    repeat(accounts) {
        /* 실서버(`LiveopsPrizeService`)는 `countPrizeWins(...) < content.prizeOf(prizeId).perAccountLimit` 로
           계정당 한도를 검사한다. 여기서도 같은 값을 읽어야 한도가 바뀌었을 때 조용히 틀린 수치를 내지 않는다. */
        var wonHere = 0L
        repeat(ticketsPerAccount.toInt()) {
            draws += 1
            val grantable = awarded < prize.stock && wonHere < prize.perAccountLimit
            when (val result = table.roll(random, grantable)) {
                is LiveopsDrawResult.Prize -> {
                    awarded += 1
                    wonHere += 1
                    if (awarded == prize.stock && exhaustedAt == null) exhaustedAt = draws
                }
                is LiveopsDrawResult.CosmeticTicket -> cosmeticTickets += result.quantity
                is LiveopsDrawResult.GemBox -> gemBoxes += result.quantity
                is LiveopsDrawResult.Rice -> rice += result.quantity
            }
        }
        if (wonHere > maxPrizesPerAccount) maxPrizesPerAccount = wonHere
    }

    return LiveopsProjection(
        accounts, days, hoursPerDay, ticketsPerDay, ticketsPerAccount,
        draws, rice, cosmeticTickets, gemBoxes, awarded, prize.stock, exhaustedAt,
        maxPrizesPerAccount,
    )
}

fun main(args: Array<String>) {
    val accounts = args.getOrNull(0)?.toIntOrNull() ?: 100
    val days = args.getOrNull(1)?.toIntOrNull() ?: 14
    val hoursPerDay = args.getOrNull(2)?.toDoubleOrNull() ?: 2.0
    val seed = 20260918L
    val content = loadLiveopsContent()
    val projection = projectLiveops(content, accounts, days, hoursPerDay, seed = seed)
    /* 경품칸 확률은 콘텐츠에서 읽는다 — 하드코딩하면 기획이 확률을 바꿔도 표는 그대로 옛 숫자를 찍는다. */
    val prizeMillionths = content.outcomes.first { it.kind == LiveopsOutcomeKind.PRIZE }.millionths
    val expectedPrizes = projection.totalDraws * prizeMillionths / 1_000_000.0

    println("# 접속 티켓 이벤트 수급 추정")
    println()
    println("- 콘텐츠: ${content.contentVersion} (${content.eventId})")
    println("- 입력: 계정 ${projection.accounts}명, ${projection.days}일, 하루 ${projection.hoursPerDay}시간")
    println("- 적립: ${content.accrual.secondsPerTicket}초당 1장, 일일 상한 ${content.accrual.dailyCap}장")
    println()
    println("| 항목 | 값 |")
    println("| --- | ---: |")
    println("| 하루 티켓 | ${projection.ticketsPerAccountPerDay} |")
    println("| 계정당 누적 티켓 | ${projection.ticketsPerAccount} |")
    println("| 전체 뽑기 회차 | ${projection.totalDraws} |")
    println("| 쌀 (계정당) | ${projection.riceGranted / projection.accounts} |")
    println("| 치장 뽑기권 (계정당) | ${projection.cosmeticTicketsGranted / projection.accounts} |")
    println("| 보석함 (계정당) | ${projection.gemBoxesGranted / projection.accounts} |")
    println("| 경품 당첨 기대값 (이론치) | ${"%.1f".format(expectedPrizes)} / ${projection.prizeStock} |")
    println("| 경품 당첨 (seed=$seed 단일 표본) | ${projection.prizesAwarded} / ${projection.prizeStock} |")
    println("| 재고 소진 회차 | ${projection.drawsUntilPrizeExhausted ?: "소진되지 않음"} |")
}
