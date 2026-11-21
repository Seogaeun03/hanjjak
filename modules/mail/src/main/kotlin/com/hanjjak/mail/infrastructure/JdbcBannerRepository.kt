package com.hanjjak.mail.infrastructure

import com.hanjjak.mail.application.BannerRepository
import com.hanjjak.mail.domain.Banner
import com.hanjjak.mail.domain.BannerTone
import org.springframework.jdbc.core.simple.JdbcClient
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID

/**
 * 닫음 행은 닫을 때 비로소 생긴다. 그래서 `not exists` 가 맞다 — 행이 없는 배너는
 * "아직 안 닫은" 배너다.
 */
class JdbcBannerRepository(private val jdbc: JdbcClient) : BannerRepository {
    override fun visible(accountId: UUID, now: Instant, limit: Int): List<Banner> = jdbc.sql(
        """
        select b.banner_id,b.message,b.tone,b.expires_at
        from admin_banner b
        where b.published_at<=:now and b.expires_at>:now and b.revoked_at is null
          and not exists (select 1 from admin_banner_dismissal d where d.banner_id=b.banner_id and d.account_id=:account)
        order by b.published_at desc, b.banner_id desc
        limit :limit
        """.trimIndent(),
    )
        .params(mapOf("account" to accountId, "now" to Timestamp.from(now), "limit" to limit))
        .query { row, _ ->
            Banner(
                bannerId = row.getObject("banner_id", UUID::class.java),
                message = row.getString("message"),
                tone = BannerTone.valueOf(row.getString("tone")),
                expiresAt = row.getTimestamp("expires_at").toInstant(),
            )
        }
        .list()

    /** 내려간 배너도 닫을 수 있어야 한다. 화면에서 사라지기 전에 누른 사람이 오류를 볼 이유가 없다. */
    override fun exists(bannerId: UUID, now: Instant): Boolean = jdbc.sql(
        "select count(*) from admin_banner where banner_id=:banner and published_at<=:now and expires_at>:now",
    )
        .params(mapOf("banner" to bannerId, "now" to Timestamp.from(now)))
        .query(Long::class.java).single() > 0

    override fun markDismissed(bannerId: UUID, accountId: UUID, dismissedAt: Instant) {
        jdbc.sql(
            """
            insert into admin_banner_dismissal(banner_id,account_id,dismissed_at) values (:banner,:account,:at)
            on conflict (banner_id,account_id) do nothing
            """.trimIndent(),
        )
            .params(mapOf("banner" to bannerId, "account" to accountId, "at" to Timestamp.from(dismissedAt)))
            .update()
    }
}
