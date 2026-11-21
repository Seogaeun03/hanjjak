package com.hanjjak.gems.api

import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.gems.application.GemRollSource
import com.hanjjak.gems.application.GemService
import com.hanjjak.gems.application.SecureGemRollSource
import com.hanjjak.gems.application.GemDungeonPlayerProvider
import com.hanjjak.gems.application.GemDungeonService
import com.hanjjak.gems.domain.GemDungeonCatalog
import com.hanjjak.gems.domain.GemDungeonPolicy
import org.springframework.beans.factory.annotation.Value
import org.springframework.core.io.ResourceLoader
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.jdbc.core.simple.JdbcClient
import java.time.Clock

@Configuration
class GemConfiguration {
    /**
     * Applied v2 defaults: one boss per KST hour, one ticket every hour, at most 5 tickets held.
     * The former applied v1 and the original beta resource stay selectable through explicit
     * properties so replay, comparison, and rollback never depend on remembering old values.
     */
    @Bean fun gemDungeonPolicy(
        @Value("\${hanjjak.gem-dungeon.rotation-period-seconds:3600}") rotationPeriodSeconds: Long,
        @Value("\${hanjjak.gem-dungeon.ticket.regen-seconds:3600}") ticketRegenSeconds: Long,
        @Value("\${hanjjak.gem-dungeon.ticket.max-stock:3}") ticketMaxStock: Int,
        @Value("\${hanjjak.gem-dungeon.ticket.initial-grant:3}") ticketInitialGrant: Int,
        @Value("\${hanjjak.gem-dungeon.content-resource:classpath:gem-dungeons/gem-dungeons-v2.json}") contentResource: String,
        @Value("\${hanjjak.gem-dungeon.content-authority:applied}") contentAuthority: String,
    ) = GemDungeonPolicy(rotationPeriodSeconds, ticketRegenSeconds, ticketMaxStock, ticketInitialGrant, contentResource, contentAuthority)

    /** 추첨원을 조립 지점에서 보이게 둔다. SkillConfiguration.skillRollSource 와 같은 모양이고,
     *  통합 테스트가 이 빈을 갈아끼워 뽑히는 값을 고정할 수 있게 하는 자리이기도 하다. */
    @Bean fun gemRollSource(): GemRollSource = SecureGemRollSource()
    @Bean fun gemService(jdbc: JdbcClient, mapper: ObjectMapper, clock: Clock, inventory: com.hanjjak.inventory.application.InventoryInstanceService, policy: GemDungeonPolicy, rollSource: GemRollSource) = GemService(jdbc, mapper, clock, inventory, policy, rollSource)
    @Bean fun gemDungeonCatalog(mapper: ObjectMapper, resources: ResourceLoader, policy: GemDungeonPolicy): GemDungeonCatalog =
        resources.getResource(policy.contentResource).inputStream.use { GemDungeonCatalog.load(mapper, it, policy.contentAuthority) }
    @Bean fun gemDungeonService(jdbc: JdbcClient, mapper: ObjectMapper, clock: Clock, gems: GemService, players: GemDungeonPlayerProvider, catalog: GemDungeonCatalog, inventory: com.hanjjak.inventory.application.InventoryReservationService, repository: com.hanjjak.inventory.application.InventoryRepository, history: com.hanjjak.battle.application.BattleHistoryRecorder, policy: GemDungeonPolicy, seeds: com.hanjjak.sim.CombatSeedSource) =
        GemDungeonService(jdbc, mapper, clock, gems, players, catalog, inventory, repository, history, policy, seeds)
}
