package com.hanjjak.account.application

import java.io.Serializable
import java.time.Instant
import java.util.UUID

enum class SsafyRegion(val code: Char) {
    SEOUL('a'),
    SEOUL_MEISTER('m'),
    DAEJEON('b'),
    GWANGJU('c'),
    GUMI('d'),
    BUSAN_ULSAN_GYEONGNAM('e');

    companion object {
        fun fromCode(code: Char): SsafyRegion? = entries.firstOrNull { it.code == code }
    }
}

enum class SsafyAffiliationRegion {
    SEOUL,
    SEOUL_MEISTER,
    DAEJEON,
    GWANGJU,
    GUMI,
    BUSAN_ULSAN_GYEONGNAM,
    UNDETERMINED;

    companion object {
        fun fromEvidence(region: SsafyRegion): SsafyAffiliationRegion = valueOf(region.name)
    }
}

enum class SsafyAffiliationRegionReason {
    SINGLE_REGION,
    MULTIPLE_REGIONS,
    NO_REGION_GROUP,
    NO_SUPPORTED_GROUP,
}

enum class SsafyAffiliationVerificationStatus {
    VERIFIED,
    NO_SUPPORTED_GROUP,
    STALE,
    UNVERIFIED,
}

data class SsafyAffiliationScan(
    val cohorts: Set<Int>,
    val regions: Set<SsafyRegion>,
) : Serializable

data class SsafyAffiliationLookup(
    val scan: SsafyAffiliationScan?,
) : Serializable {
    val succeeded: Boolean get() = scan != null

    companion object {
        fun success(scan: SsafyAffiliationScan) = SsafyAffiliationLookup(scan)
        fun failed() = SsafyAffiliationLookup(null)
    }
}

data class SsafyAffiliation(
    val currentCohort: Int?,
    val cohortHistory: List<Int>,
    val multipleCohorts: Boolean,
    val region: SsafyAffiliationRegion?,
    val regionReason: SsafyAffiliationRegionReason?,
    val verificationStatus: SsafyAffiliationVerificationStatus,
    val lastAttemptedAt: Instant,
    val lastVerifiedAt: Instant?,
)

object SsafyAffiliationClassifier {
    private val cohortPath = Regex("^s([1-9][0-9]*)$")
    private val regionPath = Regex("^s([1-9][0-9]*)/([ambcde])([0-9]+)$")

    fun classify(fullPaths: Iterable<String>): SsafyAffiliationScan {
        val cohorts = linkedSetOf<Int>()
        val regions = linkedSetOf<SsafyRegion>()
        fullPaths.forEach { rawPath ->
            val path = rawPath.lowercase()
            cohortPath.matchEntire(path)?.groupValues?.get(1)?.toIntOrNull()?.let(cohorts::add)
            regionPath.matchEntire(path)?.let { match ->
                match.groupValues[1].toIntOrNull()?.let(cohorts::add)
                SsafyRegion.fromCode(match.groupValues[2].single())?.let(regions::add)
            }
        }
        return SsafyAffiliationScan(cohorts, regions)
    }
}

interface SsafyAffiliationRepository {
    fun apply(
        accountId: UUID,
        lookup: SsafyAffiliationLookup,
        attemptStartedAt: Instant,
        completedAt: Instant,
    )

    fun find(accountId: UUID): SsafyAffiliation?
}
