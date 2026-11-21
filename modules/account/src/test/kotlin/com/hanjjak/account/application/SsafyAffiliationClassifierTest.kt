package com.hanjjak.account.application

import kotlin.test.Test
import kotlin.test.assertEquals

class SsafyAffiliationClassifierTest {
    @Test
    fun `classifies every supported region and ignores class number`() {
        val scan = SsafyAffiliationClassifier.classify(
            listOf("s15/a01", "s15/m02", "s15/b03", "s15/c04", "s15/d05", "s15/e06"),
        )

        assertEquals(setOf(15), scan.cohorts)
        assertEquals(SsafyRegion.entries.toSet(), scan.regions)
    }

    @Test
    fun `selects evidence only from exact root and region paths`() {
        val scan = SsafyAffiliationClassifier.classify(
            listOf(
                "s14",
                "S15/B03",
                "s15/b03/project",
                "team-s16",
                "x/s17",
                "s015",
                "s0",
                "s15/z01",
                "s15/b",
                "/s18/a01",
            ),
        )

        assertEquals(setOf(14, 15), scan.cohorts)
        assertEquals(setOf(SsafyRegion.DAEJEON), scan.regions)
    }

    @Test
    fun `deduplicates repeated group paths`() {
        val scan = SsafyAffiliationClassifier.classify(listOf("s15", "s15", "s15/b03", "s15/b03"))

        assertEquals(setOf(15), scan.cohorts)
        assertEquals(setOf(SsafyRegion.DAEJEON), scan.regions)
    }
}
