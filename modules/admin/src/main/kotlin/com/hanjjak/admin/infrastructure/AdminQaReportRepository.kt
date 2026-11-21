package com.hanjjak.admin.infrastructure

import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Repository
import java.time.Instant
import java.util.UUID

/*
 * 설정 화면에서 보낸 버그 신고를 읽는다. 쓰는 쪽은 게임 API 가 쥐고 있고 여기서는
 * 건드리지 않는다. 사진은 목록에 싣지 않는다 — 한 장이 4MB 까지라 쉰 줄만 담아도
 * 응답이 수백 MB 가 된다. 목록은 사진이 있는지만 알려 주고, 실제 바이트는 한 건씩
 * 따로 내어 준다.
 */
@Repository
class AdminQaReportRepository(private val jdbc: JdbcClient) {
    data class Report(
        val reportId: UUID,
        val reporterAccountId: UUID,
        val reporterNickname: String?,
        val description: String,
        val pageUrl: String,
        val userAgent: String,
        val viewportWidth: Int,
        val viewportHeight: Int,
        val hasImage: Boolean,
        val createdAt: Instant,
    )

    data class Image(val mediaType: String, val bytes: ByteArray)

    fun list(limit: Int): List<Report> = jdbc.sql(
        """
        select r.report_id, r.reporter_account_id, c.nickname, r.description, r.page_url, r.user_agent,
               r.viewport_width, r.viewport_height, r.image_data is not null as has_image, r.created_at
        from qa_bug_report r
        left join character c on c.account_id = r.reporter_account_id
        order by r.created_at desc, r.report_id desc
        limit :limit
        """.trimIndent(),
    ).param("limit", limit).query { rs, _ ->
        Report(
            rs.getObject("report_id", UUID::class.java),
            rs.getObject("reporter_account_id", UUID::class.java),
            rs.getString("nickname"),
            rs.getString("description"),
            rs.getString("page_url"),
            rs.getString("user_agent"),
            rs.getInt("viewport_width"),
            rs.getInt("viewport_height"),
            rs.getBoolean("has_image"),
            rs.getTimestamp("created_at").toInstant(),
        )
    }.list()

    fun image(reportId: UUID): Image? = jdbc.sql(
        "select image_media_type, image_data from qa_bug_report where report_id = :id and image_data is not null",
    ).param("id", reportId).query { rs, _ -> Image(rs.getString("image_media_type"), rs.getBytes("image_data")) }.optional().orElse(null)
}
