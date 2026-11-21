package com.hanjjak.account.application

import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.Instant
import java.util.UUID

@Service
class SocialLoginConnectionService(
    private val identities: SocialIdentityRepository,
    private val affiliations: SsafyAffiliationRepository,
    private val clock: Clock,
) {
    @Transactional
    fun connect(accountId: UUID, provider: SocialProvider, profile: SocialProfile, attemptedAt: Instant) {
        val existingAccount = identities.findAccountId(provider, profile.subject)
        if (existingAccount != null && existingAccount != accountId) {
            throw IllegalArgumentException("SOCIAL_IDENTITY_ALREADY_LINKED")
        }
        if (existingAccount == null) identities.link(accountId, provider, profile.subject, profile.email, clock.instant())
        else identities.touch(provider, profile.subject, profile.email, clock.instant())
        applyAffiliation(accountId, profile.ssafyAffiliation, attemptedAt)
    }

    @Transactional
    fun login(provider: SocialProvider, profile: SocialProfile, attemptedAt: Instant): UUID? {
        val accountId = identities.findAccountId(provider, profile.subject) ?: return null
        identities.touch(provider, profile.subject, profile.email, clock.instant())
        applyAffiliation(accountId, profile.ssafyAffiliation, attemptedAt)
        return accountId
    }

    private fun applyAffiliation(accountId: UUID, lookup: SsafyAffiliationLookup?, attemptedAt: Instant) {
        if (lookup != null) affiliations.apply(accountId, lookup, attemptedAt, clock.instant())
    }
}
