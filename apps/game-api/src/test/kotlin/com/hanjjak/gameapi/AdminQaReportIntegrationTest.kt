package com.hanjjak.gameapi

import com.hanjjak.admin.infrastructure.AdminQaReportRepository
import com.hanjjak.gameapi.feedback.QaBugReportController
import com.hanjjak.gameapi.feedback.QaBugReportRequest
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.mock.web.MockHttpSession
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.testcontainers.containers.PostgreSQLContainer
import org.testcontainers.junit.jupiter.Container
import org.testcontainers.junit.jupiter.Testcontainers
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

@SpringBootTest
@Testcontainers(disabledWithoutDocker = true)
class AdminQaReportIntegrationTest {
    @Autowired lateinit var jdbc: JdbcClient
    @Autowired lateinit var writer: QaBugReportController
    @Autowired lateinit var reports: AdminQaReportRepository

    /* 운영자가 여는 목록은 유저가 방금 보낸 신고를 그대로 담아야 한다. 닉네임은 계정에
       붙어 있으므로 함께 끌어와, 계정 UUID 만 보고 누군지 찾지 않아도 되게 한다. */
    @Test
    fun `list carries what the player reported along with their nickname`() {
        val account = account("고구마전사")
        writer.create(UUID.randomUUID(), request("전투 화면에서 보상이 두 번 보입니다"), session(account))

        val row = reports.list(50).first { it.reporterAccountId == account }
        assertEquals("전투 화면에서 보상이 두 번 보입니다", row.description)
        assertEquals("고구마전사", row.reporterNickname)
        assertEquals("https://hanjjak.example/battle", row.pageUrl)
        assertEquals(1600, row.viewportWidth)
        assertEquals(900, row.viewportHeight)
        assertTrue(!row.hasImage)
    }

    /* 사진은 목록에 싣지 않는다. 한 장이 4MB 까지라 쉰 줄만 담아도 응답이 감당되지 않는다.
       목록은 있는지만 알리고, 바이트는 고른 한 건에서만 내어 준다. */
    @Test
    fun `screenshots stay out of the list and come back one at a time`() {
        val account = account("감자기사")
        val response = writer.create(UUID.randomUUID(), request("사진 첨부합니다", "data:image/png;base64,AQID"), session(account))
        val reportId = response.body!!.data.reportId

        val row = reports.list(50).first { it.reportId == reportId }
        assertTrue(row.hasImage)

        val image = reports.image(reportId)!!
        assertEquals("image/png", image.mediaType)
        assertEquals(listOf<Byte>(1, 2, 3), image.bytes.toList())
    }

    @Test
    fun `a report without a screenshot has no image to fetch`() {
        val account = account("옥수수정예")
        val reportId = writer.create(UUID.randomUUID(), request("사진 없이 보냅니다"), session(account)).body!!.data.reportId

        assertNull(reports.image(reportId))
    }

    /* 최신 접수가 위에 와야 운영자가 오늘 들어온 것을 먼저 본다. */
    @Test
    fun `the newest report comes first`() {
        val account = account("정렬확인")
        val first = writer.create(UUID.randomUUID(), request("먼저 보낸 신고"), session(account)).body!!.data.reportId
        val second = writer.create(UUID.randomUUID(), request("나중에 보낸 신고"), session(account)).body!!.data.reportId
        jdbc.sql("update qa_bug_report set created_at=case report_id when :first then cast(:firstAt as timestamptz) else cast(:secondAt as timestamptz) end where report_id in (:first,:second)")
            .params(mapOf(
                "first" to first,
                "second" to second,
                "firstAt" to java.sql.Timestamp.from(java.time.Instant.parse("2026-09-22T00:00:00Z")),
                "secondAt" to java.sql.Timestamp.from(java.time.Instant.parse("2026-09-22T00:00:01Z")),
            )).update()

        val mine = reports.list(200).filter { it.reporterAccountId == account }
        assertEquals("나중에 보낸 신고", mine.first().description)
    }

    private fun request(description: String, imageDataUrl: String? = null) = QaBugReportRequest(
        description = description,
        pageUrl = "https://hanjjak.example/battle",
        userAgent = "test-agent",
        viewportWidth = 1600,
        viewportHeight = 900,
        imageDataUrl = imageDataUrl,
    )

    private fun session(account: UUID) = MockHttpSession().apply { setAttribute("accountId", account) }

    private fun account(nickname: String): UUID {
        val account = UUID.randomUUID()
        jdbc.sql("insert into account(id,email,password_hash,state_version,created_at) values (:a,:email,'test',1,now())")
            .params(mapOf("a" to account, "email" to "$account@test.local")).update()
        jdbc.sql("insert into character(id,account_id,level,experience,rice,nickname) values (gen_random_uuid(),:a,1,0,0,:nickname)")
            .params(mapOf("a" to account, "nickname" to nickname)).update()
        return account
    }

    companion object {
        @Container @JvmStatic val postgres = PostgreSQLContainer<Nothing>("postgres:17-alpine")
        @DynamicPropertySource @JvmStatic fun properties(registry: DynamicPropertyRegistry) {
            registry.add("spring.datasource.url", postgres::getJdbcUrl)
            registry.add("spring.datasource.username", postgres::getUsername)
            registry.add("spring.datasource.password", postgres::getPassword)
        }
    }
}
