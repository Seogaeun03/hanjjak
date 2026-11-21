package com.hanjjak.liveops.api

import com.hanjjak.liveops.application.LiveopsDrawResponse
import com.hanjjak.liveops.application.LiveopsGachaService
import com.hanjjak.liveops.application.LiveopsStateService
import com.hanjjak.liveops.application.LiveopsStateView
import jakarta.servlet.http.HttpSession
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.time.Clock
import java.time.Instant
import java.util.UUID

@RestController
@RequestMapping("/api/v1/liveops")
class LiveopsGachaController(
    private val state: LiveopsStateService,
    private val gacha: LiveopsGachaService,
    private val jdbc: JdbcClient,
    private val clock: Clock,
) {
    data class Envelope<T>(val requestId: UUID, val serverTime: Instant, val stateVersion: Long, val data: T)
    data class DrawRequest(val count: Int)

    /* state() 는 아무것도 바꾸지 않으므로 상태 버전을 언제 읽든 결과가 같다. draw() 와
       나란히 두어 그쪽의 순서가 우연이 아니라 의도임을 보인다. */
    @GetMapping("/{eventId}")
    fun state(@PathVariable eventId: String, session: HttpSession): Envelope<LiveopsStateView> {
        val accountId = accountId(session)
        return Envelope(UUID.randomUUID(), clock.instant(), stateVersion(accountId), state.state(accountId, eventId))
    }

    /* BattleController 와 같은 방식이다: 계정 상태 버전은 도메인 서비스가 아니라 컨트롤러가
       직접 읽되, draw() 가 이미 끝난 뒤 별도 문장으로 읽는다. draw() 가 쌀·치장권 지급으로
       account.state_version 을 올리는데, Envelope(...) 생성자 인자로 나란히 두면 코틀린이
       왼쪽부터 순서대로 평가해 stateVersion(accountId) 의 SELECT 가 draw() 보다 먼저 실행되어
       버전을 올리기 전 값을 돌려준다. 그래서 draw() 결과를 로컬 변수에 먼저 받아 둔다. */
    @PostMapping("/{eventId}/draws")
    fun draw(
        @PathVariable eventId: String,
        @RequestHeader("Idempotency-Key") idempotencyKey: UUID,
        @RequestBody request: DrawRequest,
        session: HttpSession,
    ): Envelope<LiveopsDrawResponse> {
        val accountId = accountId(session)
        val response = gacha.draw(accountId, eventId, request.count, idempotencyKey)
        return Envelope(UUID.randomUUID(), clock.instant(), stateVersion(accountId), response)
    }

    private fun stateVersion(accountId: UUID): Long = jdbc.sql("select state_version from account where id=:account")
        .param("account", accountId).query(Long::class.java).single()

    private fun accountId(session: HttpSession): UUID =
        session.getAttribute("accountId") as? UUID ?: throw IllegalArgumentException("AUTHENTICATION_REQUIRED")
}
