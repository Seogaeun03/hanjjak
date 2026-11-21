package com.hanjjak.account.infrastructure

import com.hanjjak.account.application.SsafyAffiliation
import com.hanjjak.account.application.SsafyAffiliationLookup
import com.hanjjak.account.application.SsafyAffiliationRegion
import com.hanjjak.account.application.SsafyAffiliationRegionReason
import com.hanjjak.account.application.SsafyAffiliationRepository
import com.hanjjak.account.application.SsafyAffiliationVerificationStatus
import com.hanjjak.account.application.SsafyRegion
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Repository
import org.springframework.transaction.annotation.Transactional
import java.sql.Types
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.UUID

@Repository
class JdbcSsafyAffiliationRepository(
    private val jdbc: JdbcClient,
) : SsafyAffiliationRepository {
    @Transactional
    override fun apply(
        accountId: UUID,
        lookup: SsafyAffiliationLookup,
        attemptStartedAt: Instant,
        completedAt: Instant,
    ) {
        jdbc.sql("select id from account where id=:account for update")
            .param("account", accountId)
            .query(UUID::class.java)
            .single()
        val previousAttempt = jdbc.sql("select last_attempted_at from ssafy_affiliation_profile where account_id=:account")
            .param("account", accountId)
            .query(OffsetDateTime::class.java)
            .optional()
            .orElse(null)
            ?.toInstant()

        if (previousAttempt != null && !attemptStartedAt.isAfter(previousAttempt)) return
        val scan = lookup.scan
        if (scan == null) {
            applyFailure(accountId, attemptStartedAt)
            return
        }
        scan.cohorts.forEach { cohort -> upsertEvidence(accountId, COHORT, cohort.toString(), completedAt) }
        scan.regions.forEach { region -> upsertEvidence(accountId, REGION, region.name, completedAt) }
        val cohortHistory = evidence(accountId, COHORT).map(String::toInt).sorted()
        val regionHistory = evidence(accountId, REGION).map(SsafyRegion::valueOf).toSet()
        val currentCohort = scan.cohorts.maxOrNull()
        val regionDecision = decideRegion(currentCohort, regionHistory)
        val status = if (currentCohort == null) {
            SsafyAffiliationVerificationStatus.NO_SUPPORTED_GROUP
        } else {
            SsafyAffiliationVerificationStatus.VERIFIED
        }
        val statement = jdbc.sql(
            """
            insert into ssafy_affiliation_profile(
                account_id,current_cohort,multiple_cohorts,region,region_reason,verification_status,
                last_attempted_at,last_verified_at,scan_version
            ) values (:account,:cohort,:multiple,:region,:reason,:status,:attempted,:verified,1)
            on conflict(account_id) do update set
                current_cohort=excluded.current_cohort,
                multiple_cohorts=excluded.multiple_cohorts,
                region=excluded.region,
                region_reason=excluded.region_reason,
                verification_status=excluded.verification_status,
                last_attempted_at=excluded.last_attempted_at,
                last_verified_at=excluded.last_verified_at,
                scan_version=ssafy_affiliation_profile.scan_version+1
            """.trimIndent(),
        )
            .param("account", accountId)
            .param("multiple", cohortHistory.size > 1)
            .param("reason", regionDecision.second.name)
            .param("status", status.name)
            .param("attempted", utc(attemptStartedAt))
            .param("verified", utc(completedAt))
        if (currentCohort == null) statement.param("cohort", null, Types.INTEGER) else statement.param("cohort", currentCohort)
        if (regionDecision.first == null) statement.param("region", null, Types.VARCHAR) else statement.param("region", regionDecision.first!!.name)
        statement.update()
    }

    override fun find(accountId: UUID): SsafyAffiliation? {
        val profile = jdbc.sql(
            """
            select current_cohort,multiple_cohorts,region,region_reason,verification_status,last_attempted_at,last_verified_at
            from ssafy_affiliation_profile where account_id=:account
            """.trimIndent(),
        ).param("account", accountId).query { row, _ ->
            ProfileRow(
                currentCohort = row.getObject("current_cohort", Integer::class.java)?.toInt(),
                multipleCohorts = row.getBoolean("multiple_cohorts"),
                region = row.getString("region")?.let(SsafyAffiliationRegion::valueOf),
                regionReason = row.getString("region_reason")?.let(SsafyAffiliationRegionReason::valueOf),
                verificationStatus = SsafyAffiliationVerificationStatus.valueOf(row.getString("verification_status")),
                lastAttemptedAt = row.getObject("last_attempted_at", OffsetDateTime::class.java).toInstant(),
                lastVerifiedAt = row.getObject("last_verified_at", OffsetDateTime::class.java)?.toInstant(),
            )
        }.optional().orElse(null) ?: return null
        return SsafyAffiliation(
            currentCohort = profile.currentCohort,
            cohortHistory = evidence(accountId, COHORT).map(String::toInt).sorted(),
            multipleCohorts = profile.multipleCohorts,
            region = profile.region,
            regionReason = profile.regionReason,
            verificationStatus = profile.verificationStatus,
            lastAttemptedAt = profile.lastAttemptedAt,
            lastVerifiedAt = profile.lastVerifiedAt,
        )
    }

    private fun applyFailure(accountId: UUID, attemptStartedAt: Instant) {
        val updated = jdbc.sql(
            """
            update ssafy_affiliation_profile
            set verification_status='STALE',last_attempted_at=:attempted,scan_version=scan_version+1
            where account_id=:account
            """.trimIndent(),
        ).params(mapOf("account" to accountId, "attempted" to utc(attemptStartedAt))).update()
        if (updated == 0) {
            jdbc.sql(
                """
                insert into ssafy_affiliation_profile(
                    account_id,current_cohort,multiple_cohorts,region,region_reason,verification_status,
                    last_attempted_at,last_verified_at,scan_version
                ) values (:account,null,false,null,null,'UNVERIFIED',:attempted,null,1)
                """.trimIndent(),
            ).params(mapOf("account" to accountId, "attempted" to utc(attemptStartedAt))).update()
        }
    }

    private fun upsertEvidence(accountId: UUID, type: String, value: String, observedAt: Instant) {
        jdbc.sql(
            """
            insert into ssafy_affiliation_evidence(account_id,evidence_type,evidence_value,first_observed_at,last_observed_at)
            values (:account,:type,:value,:observed,:observed)
            on conflict(account_id,evidence_type,evidence_value) do update
            set last_observed_at=greatest(ssafy_affiliation_evidence.last_observed_at,excluded.last_observed_at)
            """.trimIndent(),
        ).params(
            mapOf(
                "account" to accountId,
                "type" to type,
                "value" to value,
                "observed" to utc(observedAt),
            ),
        ).update()
    }

    private fun evidence(accountId: UUID, type: String): List<String> = jdbc.sql(
        "select evidence_value from ssafy_affiliation_evidence where account_id=:account and evidence_type=:type",
    ).params(mapOf("account" to accountId, "type" to type)).query(String::class.java).list()

    private fun decideRegion(
        currentCohort: Int?,
        history: Set<SsafyRegion>,
    ): Pair<SsafyAffiliationRegion?, SsafyAffiliationRegionReason> = when {
        currentCohort == null -> null to SsafyAffiliationRegionReason.NO_SUPPORTED_GROUP
        history.isEmpty() -> SsafyAffiliationRegion.UNDETERMINED to SsafyAffiliationRegionReason.NO_REGION_GROUP
        history.size > 1 -> SsafyAffiliationRegion.UNDETERMINED to SsafyAffiliationRegionReason.MULTIPLE_REGIONS
        else -> SsafyAffiliationRegion.fromEvidence(history.single()) to SsafyAffiliationRegionReason.SINGLE_REGION
    }

    private fun utc(value: Instant): OffsetDateTime = OffsetDateTime.ofInstant(value, ZoneOffset.UTC)

    private data class ProfileRow(
        val currentCohort: Int?,
        val multipleCohorts: Boolean,
        val region: SsafyAffiliationRegion?,
        val regionReason: SsafyAffiliationRegionReason?,
        val verificationStatus: SsafyAffiliationVerificationStatus,
        val lastAttemptedAt: Instant,
        val lastVerifiedAt: Instant?,
    )

    private companion object {
        const val COHORT = "COHORT"
        const val REGION = "REGION"
    }
}
