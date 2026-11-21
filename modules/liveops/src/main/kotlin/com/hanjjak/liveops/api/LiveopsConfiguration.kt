package com.hanjjak.liveops.api

import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.liveops.application.LiveopsCatalog
import com.hanjjak.liveops.application.LiveopsRepository
import com.hanjjak.liveops.domain.LiveopsContent
import com.hanjjak.liveops.infrastructure.JdbcLiveopsRepository
import com.hanjjak.liveops.infrastructure.JsonLiveopsContent
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.ApplicationRunner
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.jdbc.core.simple.JdbcClient
import java.time.Instant

@Configuration
class LiveopsConfiguration {
    companion object {
        /** 이벤트를 끈 서버가 쓰는 기간. `require(startsAt.isBefore(endsAt))` 를 만족하면서 어떤 시각에도 열리지 않는다. */
        private val DISABLED_STARTS_AT: Instant = Instant.parse("1970-01-01T00:00:00Z")
        private val DISABLED_ENDS_AT: Instant = Instant.parse("1970-01-01T00:00:01Z")
    }

    /**
     * 이벤트를 켤지 정하는 배포 스위치(`LIVEOPS_ENABLED`). 기본값은 꺼짐이다.
     *
     * 같은 브랜치가 본섭(`game-1`)과 이벤트 서버(`event-2026-09`)에 함께 배포되고 서버마다 DB 가
     * 따로다. 끄지 않으면 양쪽이 각자 실물 경품을 내보낸다 — 싸이버거 기프티콘 재고 5 개가 서버마다
     * 생겨 최대 10 개가 나간다. 기본값을 꺼짐으로 두어, 켜는 쪽에서 명시적으로 켜게 한다.
     *
     * 테스트 전용 기간 개방 스위치. 기본값은 꺼짐이라 운영에서는 콘텐츠 날짜가 그대로 산다.
     *
     * 이것이 없으면 경품 경합·재고 소진 통합 테스트가 "오늘이 이벤트 기간인가" 에 따라
     * 의미를 잃는다. 기간 밖에서는 경품이 아예 안 나오므로 잠금이 깨져 있어도 통과한다.
     * `hanjjak.offline-reward.test-*` 와 같은 자리의 같은 성격의 속성이다.
     */
    @Bean
    fun liveopsContent(
        mapper: ObjectMapper,
        @Value("\${hanjjak.liveops.enabled:false}") enabled: Boolean,
        @Value("\${hanjjak.liveops.test-window-open:false}") testWindowOpen: Boolean,
    ): LiveopsContent {
        val loaded = JsonLiveopsContent(
            requireNotNull(javaClass.getResourceAsStream("/liveops/hunt-ticket-gacha.json")) { "liveops content missing" },
            mapper,
        ).content
        /* 기간을 닫아 두면 적립·경품 지급·상태 API 가 한꺼번에 막힌다. 웹의 이벤트 단추도
           open=false 를 보고 스스로 숨으므로 클라이언트에는 따로 스위치가 필요 없다. */
        if (!enabled) return loaded.copy(startsAt = DISABLED_STARTS_AT, endsAt = DISABLED_ENDS_AT)
        if (!testWindowOpen) return loaded
        return loaded.copy(
            startsAt = Instant.parse("2000-01-01T00:00:00Z"),
            endsAt = Instant.parse("2100-01-01T00:00:00Z"),
        )
    }

    @Bean
    fun liveopsCatalog(content: LiveopsContent): LiveopsCatalog = LiveopsCatalog(content)

    @Bean
    fun liveopsRepository(jdbc: JdbcClient): LiveopsRepository = JdbcLiveopsRepository(jdbc)

    /**
     * 재고와 스위치 행을 만든다. 이미 있으면 건드리지 않는다.
     *
     * 총량을 덮어쓰면 운영자가 DB 에서 조정한 경품 예산이 재시작마다 조용히 되돌아간다.
     *
     * 끈 서버에는 경품 예산 행 자체를 만들지 않는다. 기간만 닫아 두면 행은 남고, 나중에 누군가
     * 그 서버의 기간을 열었을 때 곧바로 실물 경품이 나갈 수 있다.
     */
    @Bean
    fun liveopsSeed(
        content: LiveopsContent,
        repository: LiveopsRepository,
        @Value("\${hanjjak.liveops.enabled:false}") enabled: Boolean,
    ) = ApplicationRunner {
        if (enabled) {
            repository.ensureSwitch(content.eventId)
            content.prizes.forEach { repository.ensurePrizeStock(content.eventId, it.prizeId, it.stock) }
        }
    }
}
