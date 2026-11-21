package com.hanjjak.liveops.api

import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.liveops.application.FakeLiveopsRepository
import org.springframework.boot.DefaultApplicationArguments
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * 배포 스위치(`LIVEOPS_ENABLED`) 시험이다.
 *
 * 같은 브랜치가 본섭(`game-1`)과 이벤트 서버(`event-2026-09`)에 함께 배포되고 서버마다 DB 가
 * 따로다. 끄지 못하면 양쪽이 각자 실물 경품을 내보낸다 — 싸이버거 기프티콘 재고 5 개가 서버마다
 * 생겨 최대 10 개가 나간다. 그래서 "꺼진 서버에서는 기간이 절대 열리지 않는다"와 "꺼진 서버에는
 * 경품 예산 행을 만들지 않는다" 두 가지를 여기서 고정한다.
 *
 * 실제 콘텐츠 JSON 은 game-api 의 classpath 에만 올라온다(`resources.srcDir(packages/game-content/...)`).
 * 여기서는 같은 경로에 둔 시험용 픽스처를 읽는다. 단언은 픽스처의 숫자를 쓰지 않고 읽어 온
 * 콘텐츠에서 가져오므로, 픽스처 값이 실제 콘텐츠와 달라져도 이 시험의 의미는 그대로다.
 */
class LiveopsConfigurationTest {
    private val configuration = LiveopsConfiguration()
    private val mapper = ObjectMapper()

    private fun content(enabled: Boolean, testWindowOpen: Boolean = false) =
        configuration.liveopsContent(mapper, enabled, testWindowOpen)

    private fun seed(enabled: Boolean): FakeLiveopsRepository {
        val repository = FakeLiveopsRepository()
        val loaded = content(enabled)
        configuration.liveopsSeed(loaded, repository, enabled).run(DefaultApplicationArguments())
        return repository
    }

    @Test
    fun `켜면 콘텐츠의 기간을 그대로 쓴다`() {
        val loaded = content(enabled = true)

        assertTrue(loaded.isOpenAt(loaded.startsAt), "시작 시각에는 열려 있어야 한다")
        assertFalse(loaded.isOpenAt(loaded.endsAt), "종료 경계는 배타적이다")
    }

    /* 끈 서버에서 "언젠가는 열리는" 기간이 남아 있으면, 그 날짜가 오는 순간 본섭에서도 이벤트가
       시작된다. 콘텐츠가 어떤 날짜를 들고 있든 열리지 않아야 한다. */
    @Test
    fun `끄면 콘텐츠 기간과 무관하게 어떤 시각에도 열리지 않는다`() {
        val enabled = content(enabled = true)
        val disabled = content(enabled = false)

        for (at in listOf(enabled.startsAt, enabled.startsAt.plusSeconds(1), enabled.endsAt.minusSeconds(1), Instant.now())) {
            assertFalse(disabled.isOpenAt(at), "$at 에 열리면 안 된다")
        }
    }

    /* 시험용 기간 개방 스위치가 배포 스위치를 이기면, 어딘가에서 테스트 프로퍼티가 새는 순간
       꺼 둔 서버가 열린다. 끄기가 항상 이겨야 한다. */
    @Test
    fun `끄기가 시험용 기간 개방보다 우선한다`() {
        val disabled = content(enabled = false, testWindowOpen = true)

        assertFalse(disabled.isOpenAt(Instant.now()), "끈 서버는 시험 스위치로도 열리면 안 된다")
    }

    @Test
    fun `켜면 경품 재고를 콘텐츠의 재고만큼 시딩한다`() {
        val loaded = content(enabled = true)
        val prize = loaded.prizes.single()

        val repository = seed(enabled = true)

        assertEquals(prize.stock, repository.readPrizeStock(loaded.eventId, prize.prizeId).total)
    }

    /* 기간만 닫고 행을 남겨 두면, 나중에 누군가 그 서버의 기간을 열었을 때 곧바로 실물 경품이
       나간다. 예산 행 자체가 생기지 않아야 한다. */
    @Test
    fun `끄면 경품 재고 행을 만들지 않는다`() {
        val loaded = content(enabled = true)
        val prize = loaded.prizes.single()

        val repository = seed(enabled = false)

        assertEquals(0, repository.readPrizeStock(loaded.eventId, prize.prizeId).total, "끈 서버에 경품 예산 행이 생기면 안 된다")
    }
}
