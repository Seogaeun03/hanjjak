package com.hanjjak.gameapi

import com.hanjjak.sim.CombatSeedSource
import com.hanjjak.sim.SecureCombatSeedSource
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration

/**
 * One server owned seed source for every simulated fight: stage battles, battle sessions, the
 * arena, gem dungeons and raids. Declared at the composition root next to the gacha entropy so the
 * modules stay free of a randomness policy of their own.
 */
@Configuration
class CombatSeedConfiguration {
    @Bean
    fun combatSeedSource(): CombatSeedSource = SecureCombatSeedSource()
}
