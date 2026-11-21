package com.hanjjak.gameapi

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

@SpringBootTest
@Testcontainers(disabledWithoutDocker = true)
class QaBugReportIntegrationTest {
    @Autowired lateinit var jdbc: JdbcClient
    @Autowired lateinit var controller: QaBugReportController

    /* 사진은 선택이라 대부분의 신고가 이 경로로 들어온다. 비어 있는 두 값이 bytea 와
       varchar 컬럼에 닿을 때 형식을 알려 주지 않으면 드라이버가 입력을 거부한다. */
    @Test
    fun `report without a screenshot is stored`() {
        val account = account()
        val response = controller.create(UUID.randomUUID(), request(), session(account))

        val reportId = response.body!!.data.reportId
        val row = jdbc.sql("select description, image_media_type, image_data from qa_bug_report where report_id=:id")
            .param("id", reportId)
            .query { rs, _ -> Triple(rs.getString(1), rs.getString(2), rs.getBytes(3)) }
            .single()
        assertEquals("전투 화면에서 보상이 두 번 보입니다", row.first)
        assertNull(row.second)
        assertNull(row.third)
    }

    @Test
    fun `report with a screenshot keeps the image bytes`() {
        val account = account()
        val response = controller.create(
            UUID.randomUUID(),
            request(imageDataUrl = "data:image/png;base64,AQID"),
            session(account),
        )

        val row = jdbc.sql("select image_media_type, image_data from qa_bug_report where report_id=:id")
            .param("id", response.body!!.data.reportId)
            .query { rs, _ -> rs.getString(1) to rs.getBytes(2) }
            .single()
        assertEquals("image/png", row.first)
        assertEquals(listOf<Byte>(1, 2, 3), row.second.toList())
    }

    /* 같은 열쇠로 두 번 보내도 신고는 하나다. 전송 중 끊겨 다시 보내는 일이 흔하다. */
    @Test
    fun `the same idempotency key files one report`() {
        val account = account()
        val key = UUID.randomUUID()
        val first = controller.create(key, request(), session(account))
        val again = controller.create(key, request(), session(account))

        assertEquals(first.body!!.data.reportId, again.body!!.data.reportId)
        assertEquals(
            1,
            jdbc.sql("select count(*) from qa_bug_report where reporter_account_id=:a").param("a", account)
                .query(Int::class.java).single(),
        )
    }

    private fun request(imageDataUrl: String? = null) = QaBugReportRequest(
        description = "전투 화면에서 보상이 두 번 보입니다",
        pageUrl = "https://hanjjak.example/battle",
        userAgent = "test-agent",
        viewportWidth = 1600,
        viewportHeight = 900,
        imageDataUrl = imageDataUrl,
    )

    private fun session(account: UUID) = MockHttpSession().apply { setAttribute("accountId", account) }

    private fun account(): UUID {
        val account = UUID.randomUUID()
        jdbc.sql("insert into account(id,email,password_hash,state_version,created_at) values (:a,:email,'test',1,now())")
            .params(mapOf("a" to account, "email" to "$account@test.local")).update()
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
