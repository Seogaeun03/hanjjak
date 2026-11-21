package com.hanjjak.mail.infrastructure

import com.hanjjak.mail.application.NoticeRepository
import com.hanjjak.mail.domain.Notice
import org.springframework.jdbc.core.simple.JdbcClient
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID

/**
 * 공지 원본은 한 행뿐이고 계정별 상태 행은 읽거나 지울 때 비로소 생긴다.
 * 그래서 `left join` 이 맞다 — 상태가 없는 공지는 "안 읽었고 지우지도 않은" 공지다.
 */
class JdbcNoticeRepository(private val jdbc: JdbcClient) : NoticeRepository {
    override fun visible(accountId: UUID, now: Instant, limit: Int): List<Notice> = jdbc.sql(
        """
        select n.notice_id,n.title,n.body,n.sender_name,n.published_at,n.expires_at,s.read_at
        from admin_notice n
        left join admin_notice_state s on s.notice_id=n.notice_id and s.account_id=:account
        where n.published_at<=:now and (n.expires_at is null or n.expires_at>:now) and s.deleted_at is null
        order by n.published_at desc, n.notice_id desc
        limit :limit
        """.trimIndent(),
    )
        .params(mapOf("account" to accountId, "now" to Timestamp.from(now), "limit" to limit))
        .query { row, _ ->
            Notice(
                noticeId = row.getObject("notice_id", UUID::class.java),
                title = row.getString("title"),
                body = row.getString("body"),
                senderName = row.getString("sender_name"),
                publishedAt = row.getTimestamp("published_at").toInstant(),
                expiresAt = row.getTimestamp("expires_at")?.toInstant(),
                readAt = row.getTimestamp("read_at")?.toInstant(),
            )
        }
        .list()

    override fun unreadCount(accountId: UUID, now: Instant): Int = jdbc.sql(
        """
        select count(*) from admin_notice n
        left join admin_notice_state s on s.notice_id=n.notice_id and s.account_id=:account
        where n.published_at<=:now and (n.expires_at is null or n.expires_at>:now)
          and s.deleted_at is null and s.read_at is null
        """.trimIndent(),
    )
        .params(mapOf("account" to accountId, "now" to Timestamp.from(now)))
        .query(Int::class.java).single()

    override fun exists(noticeId: UUID, now: Instant): Boolean = jdbc.sql(
        "select count(*) from admin_notice where notice_id=:notice and published_at<=:now and (expires_at is null or expires_at>:now)",
    )
        .params(mapOf("notice" to noticeId, "now" to Timestamp.from(now)))
        .query(Long::class.java).single() > 0

    override fun readAt(noticeId: UUID, accountId: UUID): Instant? = jdbc.sql("select read_at from admin_notice_state where notice_id=:notice and account_id=:account")
        .params(mapOf("notice" to noticeId, "account" to accountId))
        .query { row, _ -> row.getTimestamp("read_at")?.toInstant() }
        .optional().orElse(null)

    override fun markRead(noticeId: UUID, accountId: UUID, readAt: Instant) {
        jdbc.sql(
            """
            insert into admin_notice_state(notice_id,account_id,read_at) values (:notice,:account,:readAt)
            on conflict (notice_id,account_id) do update set read_at=coalesce(admin_notice_state.read_at,:readAt)
            """.trimIndent(),
        )
            .params(mapOf("notice" to noticeId, "account" to accountId, "readAt" to Timestamp.from(readAt)))
            .update()
    }

    /** 지운 공지는 읽은 것으로도 친다. 안 읽은 배지에 지운 공지가 계속 남으면 끌 방법이 없다. */
    override fun markDeleted(noticeId: UUID, accountId: UUID, deletedAt: Instant) {
        jdbc.sql(
            """
            insert into admin_notice_state(notice_id,account_id,read_at,deleted_at) values (:notice,:account,:at,:at)
            on conflict (notice_id,account_id) do update
              set deleted_at=coalesce(admin_notice_state.deleted_at,:at), read_at=coalesce(admin_notice_state.read_at,:at)
            """.trimIndent(),
        )
            .params(mapOf("notice" to noticeId, "account" to accountId, "at" to Timestamp.from(deletedAt)))
            .update()
    }
}
