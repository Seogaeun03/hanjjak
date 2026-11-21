package com.hanjjak.gameapi

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.liveops.application.LiveopsCatalog
import com.hanjjak.liveops.application.LiveopsRepository
import jakarta.servlet.http.Cookie
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * LiveopsGachaController 를 실제 HTTP 로 태우는 시험이다. 기존 [LiveopsGachaIntegrationTest] 는
 * `gacha.draw(...)`/`state.state(...)` 를 직접 불러 컨트롤러를 건너뛰었기 때문에, 컨트롤러가
 * Envelope 을 만들며 `stateVersion(accountId)` 를 draw() 보다 먼저 읽어 버리는 인자 순서 버그를
 * 어떤 시험도 잡아내지 못했다. 여기서는 MockMvc 로 컨트롤러까지 통째로 태워 그 버그를 고정한다.
 *
 * 계정은 [GemDungeonIntegrationTest]·[ProgressionCosmeticsReadLockIntegrationTest] 와 같은 방식으로
 * 실제 `/api/v1/auth/signup` 을 태워 만든다. 이 앱은 spring-session-jdbc 로 세션을 영속화하고,
 * `ApiRequestGuardFilter` 가 `account_active_session` 에 등록된 세션인지도 함께 확인한다
 * (`AccountSessionRegistry.isActive`) — 계정 행만 SQL 로 직접 넣고 `.sessionAttr(...)` 로 세션
 * 속성을 흉내 내면 이 등록이 없어 필터가 세션을 무효화해 버린다. 그래서 실제 가입 응답이 내려준
 * 세션 쿠키를 그대로 들고 가야 한다. 티켓만 [LiveopsRepository] 로 직접 시딩한다.
 */
@GameApiIntegrationTest
class LiveopsGachaHttpTest {
    @Autowired private lateinit var mvc: MockMvc
    @Autowired private lateinit var mapper: ObjectMapper
    @Autowired private lateinit var catalog: LiveopsCatalog
    @Autowired private lateinit var repository: LiveopsRepository

    private val eventId get() = catalog.current().eventId
    private val sessionCookies = mutableMapOf<UUID, Array<Cookie>>()

    @Test
    fun `상태 조회가 이벤트 식별자·일일 상한·확률표를 전부 내려 준다`() {
        val accountId = signup()

        val body = getState(accountId)

        assertEquals(eventId, body.at("/data/eventId").asText())
        /* 리터럴이 아니라 콘텐츠에서 가져온다. 여기서 보려는 것은 "상한이 40이다"가 아니라
           "엔드포인트가 설정된 상한을 그대로 내려준다"이고, 실제 값은 JsonLiveopsContentTest 가 고정한다. */
        assertEquals(catalog.current().accrual.dailyCap, body.at("/data/dailyCap").asLong())
        assertTrue(body.at("/data/outcomes").isArray)
        assertTrue(body.at("/data/outcomes").size() > 0, "확률표가 비어 있으면 안 된다")
    }

    /**
     * 이 시험이 바로 3차 리뷰 지적(Finding 1)을 고정하는 자리다. draw() 는 쌀·치장권·경품 지급 중
     * 무엇이 나오든 account.state_version 을 반드시 올리므로(치장 뽑기권 단독 지급도 이제
     * `CharacterLiveopsCosmeticTicketCredit` 이 직접 올린다), 응답의 stateVersion 은 직전 GET 이
     * 본 값보다 커야 한다 — 단 한 번의 뽑기로 충분하다. 인자 순서 버그가 있는 컨트롤러
     * (state_version 을 draw() 보다 먼저 읽는 버전)로 되돌리면 이 단언이 실패한다 — 사람이 손으로
     * 확인했다(아래 3차 리뷰 지적 반영 절 참고).
     */
    @Test
    fun `단발 뽑기 응답의 stateVersion 이 직전 GET 값보다 커야 한다`() {
        val accountId = signup()
        repository.creditTickets(eventId, accountId, 1)

        val versionBefore = getState(accountId).at("/stateVersion").asLong()
        val response = draw(accountId, UUID.randomUUID(), 1)
        val versionAfter = response.at("/stateVersion").asLong()

        assertTrue(versionAfter > versionBefore, "draw() 응답은 뽑기 뒤 상태 버전을 돌려줘야 한다(after=$versionAfter, before=$versionBefore)")
    }

    @Test
    fun `같은 멱등 키 재요청이 같은 결과를 돌려주고 티켓을 다시 쓰지 않는다`() {
        val accountId = signup()
        repository.creditTickets(eventId, accountId, 3)
        val key = UUID.randomUUID()

        val first = draw(accountId, key, 1)
        val second = draw(accountId, key, 1)

        assertEquals(first.at("/data"), second.at("/data"), "재요청은 같은 뽑기 결과를 돌려줘야 한다")
        assertEquals(2L, repository.ticketBalance(eventId, accountId), "재요청이 티켓을 또 쓰면 안 된다")
    }

    private fun getState(accountId: UUID): JsonNode {
        val request = get("/api/v1/liveops/$eventId").accept(MediaType.APPLICATION_JSON)
        sessionCookies[accountId]?.takeIf { it.isNotEmpty() }?.let { request.cookie(*it) }
        val response = mvc.perform(request).andExpect(status().isOk).andReturn().response.contentAsString
        return mapper.readTree(response)
    }

    private fun draw(accountId: UUID, idempotencyKey: UUID, count: Int): JsonNode {
        val request = post("/api/v1/liveops/$eventId/draws")
            .header("Idempotency-Key", idempotencyKey.toString())
            .header("Origin", "http://localhost:5173")
            .contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(mapOf("count" to count)))
        sessionCookies[accountId]?.takeIf { it.isNotEmpty() }?.let { request.cookie(*it) }
        val response = mvc.perform(request).andExpect(status().isOk).andReturn().response.contentAsString
        return mapper.readTree(response)
    }

    /** GemDungeonIntegrationTest.signup() 과 같은 모양이다: 실제 가입 경로로 계정을 만들고
     * 그 응답이 내려준 세션 쿠키를 들고 있다가 뒤이은 요청마다 그대로 실어 보낸다. 이어서
     * 재료를 고른다 — MaterialSelectionGate 가 인증·재료선택 경로를 뺀 나머지 모든 player API
     * 요청을 가로막고, 재료 선택 전이면 MATERIAL_SELECTION_REQUIRED 로 거절하기 때문에,
     * 재료를 고르지 않으면 liveops 엔드포인트도 열리지 않는다. */
    private fun signup(): UUID {
        val unique = UUID.randomUUID()
        val result = mvc.perform(
            post("/api/v1/auth/signup")
                .header("Idempotency-Key", UUID.randomUUID().toString())
                .header("Origin", "http://localhost:5173")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    mapper.writeValueAsString(
                        mapOf(
                            "email" to "liveops-http-$unique@test.local",
                            "password" to "password123",
                            "nickname" to "lvh-${unique.toString().take(8)}",
                        ),
                    ),
                ),
        ).andExpect(status().isOk).andReturn()
        val accountId = UUID.fromString(mapper.readTree(result.response.contentAsString).at("/data/accountId").asText())
        sessionCookies[accountId] = result.response.cookies
        chooseMaterial(accountId)
        return accountId
    }

    private fun chooseMaterial(accountId: UUID) {
        val request = post("/api/v1/material-preference")
            .header("Idempotency-Key", UUID.randomUUID().toString())
            .header("Origin", "http://localhost:5173")
            .contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(mapOf("materialType" to "POTATO")))
        sessionCookies[accountId]?.takeIf { it.isNotEmpty() }?.let { request.cookie(*it) }
        mvc.perform(request).andExpect(status().isOk)
    }
}
