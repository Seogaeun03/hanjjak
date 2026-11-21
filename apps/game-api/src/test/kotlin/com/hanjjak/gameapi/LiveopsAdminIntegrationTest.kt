package com.hanjjak.gameapi

import com.hanjjak.account.application.LiveopsAccrualLifecycle
import com.hanjjak.liveops.application.LiveopsAdminService
import com.hanjjak.liveops.application.LiveopsCatalog
import com.hanjjak.liveops.application.LiveopsGachaService
import com.hanjjak.liveops.application.LiveopsRepository
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.jdbc.core.simple.JdbcClient
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

@GameApiIntegrationTest
class LiveopsAdminIntegrationTest {
    @Autowired private lateinit var jdbc: JdbcClient
    @Autowired private lateinit var catalog: LiveopsCatalog
    @Autowired private lateinit var repository: LiveopsRepository
    @Autowired private lateinit var gacha: LiveopsGachaService
    @Autowired private lateinit var admin: LiveopsAdminService
    @Autowired private lateinit var accrual: LiveopsAccrualLifecycle

    private val eventId get() = catalog.current().eventId

    private fun newAccount(): UUID {
        val accountId = UUID.randomUUID()
        jdbc.sql("insert into account(id,email,password_hash,state_version,created_at) values (:id,:email,'x',1,now())")
            .params(mapOf("id" to accountId, "email" to "liveops-admin-$accountId@example.com")).update()
        jdbc.sql("insert into character(id,account_id,level,experience,rice,nickname) values (:character,:account,1,0,0,:nickname)")
            .params(mapOf("character" to UUID.randomUUID(), "account" to accountId, "nickname" to "lva-${accountId.toString().take(8)}")).update()
        return accountId
    }

    @Test
    fun `현황이 회차 단위로 결과 분포를 센다`() {
        val accountId = newAccount()
        repository.creditTickets(eventId, accountId, 10)
        gacha.draw(accountId, eventId, 10, UUID.randomUUID())
        val overview = admin.overview(eventId)
        assertTrue(overview.drawCount >= 1)
        // 뽑기 한 행이 열 회차를 담으므로 분포 합은 행 수가 아니라 회차 수다.
        assertTrue(overview.outcomeCounts.values.sum() >= 10, "분포 합 ${overview.outcomeCounts}")
        assertTrue(overview.outcomeCounts.keys.all { it in setOf("RICE", "COSMETIC_TICKET", "GEM_BOX", "PRIZE") }, "분포 종류 ${overview.outcomeCounts.keys}")
        assertTrue(overview.ticketsOutstanding >= 0)
        assertEquals(1, overview.prizes.size)
    }

    private fun accrualRowCount(accountId: UUID): Long = jdbc.sql(
        "select count(*) from liveops_ticket_accrual where event_id=:event and account_id=:account",
    ).params(mapOf("event" to eventId, "account" to accountId)).query(Long::class.java).single()

    /* 서비스가 진짜 시스템 시계를 주입받아 시계를 앞당길 수 없다. 대신 방금 찍힌
       last_tick_at 을 뒤로 물려 다음 하트비트가 큰 간격을 본 것처럼 만든다.
       60초 상한(maxHeartbeatGapSeconds)을 확실히 넘기도록 65초를 물린다. */
    private fun backdateLastTick(accountId: UUID, seconds: Long) {
        jdbc.sql(
            "update liveops_ticket_accrual set last_tick_at = last_tick_at - (:seconds * interval '1 second') where event_id=:event and account_id=:account",
        ).params(mapOf("seconds" to seconds, "event" to eventId, "account" to accountId)).update()
    }

    @Test
    fun `비상정지와 재개가 즉시 반영된다`() {
        val accountId = newAccount()
        repository.creditTickets(eventId, accountId, 2)
        val halted = admin.halt(eventId, "경품 확인 필요", "test-operator")
        var resumed = halted
        try {
            assertTrue(halted.halted)
            assertTrue(runCatching { gacha.draw(accountId, eventId, 1, UUID.randomUUID()) }.isFailure)

            // 정지가 뽑기만이 아니라 적립도 막는지 본다 — halted 인 동안은 기준 행조차 생기지 않는다.
            accrual.accrueForHeartbeat(accountId)
            assertEquals(0, accrualRowCount(accountId), "정지 중에는 적립 기준 행조차 생기지 않는다")
            assertEquals(2, repository.ticketBalance(eventId, accountId), "정지 중에는 티켓이 붙지 않는다")
        } finally {
            resumed = admin.resume(eventId, "test-operator")
        }

        assertFalse(resumed.halted)
        gacha.draw(accountId, eventId, 1, UUID.randomUUID())
        assertEquals(1, repository.ticketBalance(eventId, accountId))

        /* 재개 후 적립이 실제로 도는지 본다. 적립은 180초 문턱에 60초 상한·10초 문턱을 두고
           있어 하트비트 한 번으로는 아무것도 쌓이지 않는다(첫 호출은 기준점만 만든다, 간격 0).
           서비스가 주입받는 Clock 은 systemUTC 라 여기서 앞당길 수 없으므로, 대신 DB 에 저장된
           last_tick_at 을 65초씩 뒤로 물려 다음 하트비트가 큰 간격(상한 60초에 걸림)을 본 것처럼
           만든다. 60초 x 3 = 180초로 티켓 한 장이 붙는 문턱을 정확히 채운다. */
        accrual.accrueForHeartbeat(accountId)
        repeat(3) {
            backdateLastTick(accountId, 65)
            accrual.accrueForHeartbeat(accountId)
        }
        assertEquals(2, repository.ticketBalance(eventId, accountId), "재개 후에는 적립이 다시 돌아 티켓이 붙는다")
    }

    @Test
    fun `정지 사유가 비면 거부한다`() {
        assertEquals("HALT_REASON_REQUIRED", runCatching { admin.halt(eventId, "  ", "test-operator") }.exceptionOrNull()?.message)
    }

    @Test
    fun `당첨 상태를 전이시킨다`() {
        // 재고를 충분히 두고 경품이 확실히 나올 때까지 돌리는 대신, 당첨 행을 직접 만든다.
        // 여기서 보려는 것은 추첨이 아니라 운영자의 상태 전이다.
        val accountId = newAccount()
        val prizeId = catalog.current().prizes.single().prizeId
        val drawId = UUID.randomUUID()
        repository.saveDraw(drawId, eventId, accountId, UUID.randomUUID(), catalog.current().contentVersion, "{\"lines\":[]}", java.time.Instant.now())
        val winId = UUID.randomUUID()
        assertTrue(repository.insertPrizeWin(winId, eventId, prizeId, accountId, drawId, java.time.Instant.now()))
        val updated = admin.updateWin(winId, "CONTACTED", "전화 연결됨")
        assertEquals("CONTACTED", updated.status)
        assertEquals("전화 연결됨", updated.operatorNote)
        assertEquals("INVALID_WIN_STATUS", runCatching { admin.updateWin(winId, "SHIPPED", null) }.exceptionOrNull()?.message)
        assertEquals("LIVEOPS_PRIZE_WIN_NOT_FOUND", runCatching { admin.updateWin(UUID.randomUUID(), "VOIDED", null) }.exceptionOrNull()?.message)
    }

    private fun newWin(): UUID {
        val accountId = newAccount()
        val prizeId = catalog.current().prizes.single().prizeId
        val drawId = UUID.randomUUID()
        repository.saveDraw(drawId, eventId, accountId, UUID.randomUUID(), catalog.current().contentVersion, "{\"lines\":[]}", java.time.Instant.now())
        val winId = UUID.randomUUID()
        assertTrue(repository.insertPrizeWin(winId, eventId, prizeId, accountId, drawId, java.time.Instant.now()))
        return winId
    }

    @Test
    fun `당첨 상태 전이는 정해진 순서만 허용한다`() {
        // 허용된 전이: PENDING -> CONTACTED -> FULFILLED. 종결 상태 이후로는 아무것도 못 간다.
        val allowed = newWin()
        assertEquals("CONTACTED", admin.updateWin(allowed, "CONTACTED", null).status)
        assertEquals("FULFILLED", admin.updateWin(allowed, "FULFILLED", null).status)
        assertEquals(
            "LIVEOPS_PRIZE_WIN_INVALID_TRANSITION",
            runCatching { admin.updateWin(allowed, "VOIDED", null) }.exceptionOrNull()?.message,
            "FULFILLED 는 종결 상태라 VOIDED 로도 못 간다",
        )

        // 되돌리는 전이: CONTACTED 를 거친 당첨을 다시 PENDING 으로 되돌릴 수 없다.
        val backwards = newWin()
        admin.updateWin(backwards, "CONTACTED", null)
        assertEquals(
            "LIVEOPS_PRIZE_WIN_INVALID_TRANSITION",
            runCatching { admin.updateWin(backwards, "PENDING", null) }.exceptionOrNull()?.message,
        )

        // 건너뛰는 전이: PENDING 에서 CONTACTED 를 거치지 않고 FULFILLED 로 바로 갈 수 없다.
        val skip = newWin()
        assertEquals(
            "LIVEOPS_PRIZE_WIN_INVALID_TRANSITION",
            runCatching { admin.updateWin(skip, "FULFILLED", null) }.exceptionOrNull()?.message,
        )
    }
}
