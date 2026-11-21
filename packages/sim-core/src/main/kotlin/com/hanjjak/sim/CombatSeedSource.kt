package com.hanjjak.sim

import java.security.SecureRandom

/**
 * Server owned combat seed.
 *
 * A seed derived from request input — an `Idempotency-Key`, a command id — is a seed the caller
 * chooses: the simulation and its drop rolls are deterministic and the algorithm is public, so a
 * client can brute-force a key offline until the outcome comes out the way it wants. Seeds are
 * therefore always drawn here.
 *
 * Idempotency is unaffected. Every caller persists the seed it drew (`battle_session.seed`,
 * `arena_battle.seed`, `gem_dungeon_challenge.seed`, `raid_attempt.seed`) or the whole result, and
 * a replayed request returns the stored row instead of simulating again.
 */
fun interface CombatSeedSource {
    fun nextSeed(): Long
}

class SecureCombatSeedSource(private val random: SecureRandom = SecureRandom()) : CombatSeedSource {
    override fun nextSeed(): Long = random.nextLong()
}
