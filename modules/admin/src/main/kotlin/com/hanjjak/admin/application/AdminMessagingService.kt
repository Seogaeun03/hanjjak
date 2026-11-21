package com.hanjjak.admin.application

import com.fasterxml.jackson.core.type.TypeReference
import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.cosmetics.domain.CosmeticsContent
import com.hanjjak.gems.domain.GemOption
import com.hanjjak.gems.domain.GemRules
import com.hanjjak.inventory.application.ItemCatalog
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.sql.Timestamp
import java.time.Clock
import java.time.Instant
import java.util.UUID

/**
 * 운영자가 보내는 공지와 우편을 만든다.
 *
 * 공지와 우편 캠페인은 원본 한 행으로 남는다. 우편의 읽음·삭제·수령 상태만 받는 사람마다
 * 한 행씩 분리한다. 게시 뒤 가입한 계정도 전체 캠페인의 개인 행을 조회 시점에 받는다.
 */
@Service
class AdminMessagingService(
    private val jdbc: JdbcClient,
    private val itemCatalog: ItemCatalog,
    private val cosmetics: CosmeticsContent,
    private val mapper: ObjectMapper,
    private val clock: Clock,
) {
    enum class TargetMode { ALL, ACCOUNT, ACCOUNTS }
    /** TICKET 은 치장 뽑기권이다. 가방이 아니라 캐릭터 잔액으로 들어가므로 고를 항목이 없다. */
    enum class RewardKind { ITEM, GEM, COSMETIC, COSMETIC_CHOICE, TICKET }
    enum class HistoryKind { NOTICE, MAIL }

    data class RewardInput(
        val kind: RewardKind,
        val quantity: Long,
        val itemId: String? = null,
        val cosmeticId: String? = null,
        val cosmeticIds: List<String>? = null,
        val gemLevel: Int? = null,
        val gemOption: GemOption? = null,
        /** 보낼 때의 이름을 굳혀 둔다. 받는 화면은 콘텐츠 카탈로그를 다시 뒤지지 않아도 된다. */
        val displayName: String? = null,
    )

    data class SendResult(
        val sendId: UUID,
        val kind: HistoryKind,
        val title: String,
        val recipientCount: Int,
        val replayed: Boolean = false,
    )

    data class HistoryEntry(
        val id: UUID,
        val kind: HistoryKind,
        val title: String,
        val body: String?,
        val targetMode: TargetMode,
        val targetAccountId: UUID?,
        val recipientCount: Int,
        val riceAmount: Long,
        val rewards: List<RewardInput>,
        val publishedAt: Instant?,
        val expiresAt: Instant?,
        val reason: String,
        val createdAt: Instant,
    )

    private data class StoredCommand(val fingerprint: String, val resultJson: String)

    @Transactional
    fun sendNotice(
        operatorId: UUID,
        senderName: String,
        idempotencyKey: UUID,
        title: String,
        body: String,
        publishedAt: Instant?,
        expiresAt: Instant?,
        reason: String,
    ): SendResult {
        val cleanTitle = requireTitle(title)
        val cleanBody = requireBody(body)
        val cleanReason = requireReason(reason)
        val now = clock.instant()
        val start = publishedAt ?: now
        require(expiresAt == null || expiresAt.isAfter(start)) { "ADMIN_NOTICE_WINDOW_INVALID" }
        // 지문은 운영자가 **보낸** 것만으로 만든다. 시작 시각을 비우고 보냈을 때 서버가 채운
        // `now` 를 여기 섞으면, 똑같은 요청을 다시 보내도 지문이 매번 달라져 재시도가 재생 대신
        // 키 재사용으로 거절된다. 멱등 키가 막으려던 바로 그 상황에서 못 쓰게 되는 셈이다.
        val fingerprint = fingerprint("notice", cleanTitle, cleanBody, publishedAt?.toString() ?: "NOW", expiresAt?.toString() ?: "OPEN", cleanReason)
        replay(operatorId, idempotencyKey, fingerprint)?.let { return it }

        val noticeId = UUID.randomUUID()
        jdbc.sql("insert into admin_notice(notice_id,title,body,sender_name,operator_id,published_at,expires_at,reason,created_at) values (:notice,:title,:body,:sender,:operator,:published,:expires,:reason,:now)")
            .params(
                mapOf(
                    "notice" to noticeId, "title" to cleanTitle, "body" to cleanBody, "sender" to senderName,
                    "operator" to operatorId, "published" to Timestamp.from(start),
                    "expires" to expiresAt?.let(Timestamp::from), "reason" to cleanReason, "now" to Timestamp.from(now),
                ),
            ).update()
        return SendResult(noticeId, HistoryKind.NOTICE, cleanTitle, 0)
            .also { save(operatorId, idempotencyKey, fingerprint, it, now) }
    }

    @Transactional
    fun sendMail(
        operatorId: UUID,
        senderName: String,
        idempotencyKey: UUID,
        targetMode: TargetMode,
        targetAccountId: UUID?,
        title: String,
        body: String,
        riceAmount: Long,
        rewards: List<RewardInput>,
        reason: String,
        publishedAt: Instant? = null,
        expiresAt: Instant? = null,
        targetAccountIds: List<UUID> = emptyList(),
    ): SendResult {
        val cleanTitle = requireTitle(title)
        val cleanBody = requireBody(body)
        val cleanReason = requireReason(reason)
        require(riceAmount >= 0) { "INVALID_RICE_AMOUNT" }
        require(
            when (targetMode) {
                TargetMode.ALL -> targetAccountId == null && targetAccountIds.isEmpty()
                TargetMode.ACCOUNT -> targetAccountId != null && targetAccountIds.isEmpty()
                TargetMode.ACCOUNTS -> targetAccountId == null && targetAccountIds.isNotEmpty()
            },
        ) { "ADMIN_MESSAGE_TARGET_INVALID" }
        val requestedAccountIds = when (targetMode) {
            TargetMode.ALL -> emptyList()
            TargetMode.ACCOUNT -> listOf(requireNotNull(targetAccountId))
            TargetMode.ACCOUNTS -> targetAccountIds.distinct().sortedBy(UUID::toString)
        }
        val normalized = normalize(rewards)
        val rewardsJson = mapper.writeValueAsString(normalized)
        val now = clock.instant()
        val start = publishedAt ?: now
        require(expiresAt == null || expiresAt.isAfter(start)) { "ADMIN_MAIL_WINDOW_INVALID" }
        val fingerprint = fingerprint(
            "mail", targetMode.name, requestedAccountIds.joinToString(",") { it.toString() }.ifEmpty { "ALL" }, cleanTitle, cleanBody,
            riceAmount.toString(), rewardsJson, publishedAt?.toString() ?: "NOW", expiresAt?.toString() ?: "OPEN", cleanReason,
        )
        replay(operatorId, idempotencyKey, fingerprint)?.let { return it }

        val recipients = when (targetMode) {
            TargetMode.ACCOUNT, TargetMode.ACCOUNTS -> requireAccounts(requestedAccountIds)
            TargetMode.ALL -> jdbc.sql("select id from account where deleted_at is null order by id")
                .query(UUID::class.java).list()
        }
        val sendId = UUID.randomUUID()
        val status = if (riceAmount > 0 || normalized.isNotEmpty()) "PENDING" else "NONE"
        if (!start.isAfter(now)) recipients.chunked(INSERT_CHUNK).forEach { chunk ->
            insertMails(chunk, sendId, status, cleanTitle, cleanBody, senderName, riceAmount, rewardsJson, start)
        }

        jdbc.sql("insert into admin_mail_send(send_id,operator_id,target_mode,target_account_id,title,body,sender_name,rice_amount,rewards_json,recipient_count,published_at,expires_at,reason,created_at) values (:send,:operator,:mode,:target,:title,:body,:sender,:rice,cast(:rewards as jsonb),:count,:published,:expires,:reason,:now)")
            .params(
                mapOf(
                    "send" to sendId, "operator" to operatorId, "mode" to targetMode.name, "target" to targetAccountId,
                    "title" to cleanTitle, "body" to cleanBody, "sender" to senderName,
                    "rice" to riceAmount, "rewards" to rewardsJson, "count" to recipients.size,
                    "published" to Timestamp.from(start), "expires" to expiresAt?.let(Timestamp::from),
                    "reason" to cleanReason, "now" to Timestamp.from(now),
                ),
            ).update()
        if (targetMode == TargetMode.ACCOUNTS) {
            recipients.chunked(INSERT_CHUNK).forEach { chunk ->
                val values = chunk.indices.joinToString(",") { index -> "(:send,:account$index)" }
                val params = mutableMapOf<String, Any>("send" to sendId)
                chunk.forEachIndexed { index, accountId -> params["account$index"] = accountId }
                jdbc.sql("insert into admin_mail_send_recipient(send_id,account_id) values $values")
                    .params(params).update()
            }
        }
        // 즉시 도착한 우편만 현재 화면의 상태를 갱신한다. 예약 우편은 개인 행을 만드는 조회가 갱신한다.
        if (!start.isAfter(now)) bumpStateVersions(recipients)
        return SendResult(sendId, HistoryKind.MAIL, cleanTitle, recipients.size)
            .also { save(operatorId, idempotencyKey, fingerprint, it, now) }
    }

    @Transactional(readOnly = true)
    fun history(limit: Int = 50): List<HistoryEntry> {
        val capped = limit.coerceIn(1, 200)
        val notices = jdbc.sql("select notice_id,title,body,published_at,expires_at,reason,created_at from admin_notice order by created_at desc limit :limit")
            .param("limit", capped)
            .query { row, _ ->
                HistoryEntry(
                    row.getObject("notice_id", UUID::class.java), HistoryKind.NOTICE, row.getString("title"), row.getString("body"),
                    TargetMode.ALL, null, 0, 0, emptyList(),
                    row.getTimestamp("published_at").toInstant(), row.getTimestamp("expires_at")?.toInstant(),
                    row.getString("reason"), row.getTimestamp("created_at").toInstant(),
                )
            }.list()
        val mails = jdbc.sql("select send_id,target_mode,target_account_id,title,body,rice_amount,rewards_json::text as rewards_json,recipient_count,published_at,expires_at,reason,created_at from admin_mail_send order by created_at desc limit :limit")
            .param("limit", capped)
            .query { row, _ ->
                HistoryEntry(
                    row.getObject("send_id", UUID::class.java), HistoryKind.MAIL, row.getString("title"), row.getString("body"),
                    TargetMode.valueOf(row.getString("target_mode")), row.getObject("target_account_id", UUID::class.java),
                    row.getInt("recipient_count"), row.getLong("rice_amount"), readRewards(row.getString("rewards_json")),
                    row.getTimestamp("published_at").toInstant(), row.getTimestamp("expires_at")?.toInstant(),
                    row.getString("reason"), row.getTimestamp("created_at").toInstant(),
                )
            }.list()
        return (notices + mails).sortedByDescending { it.createdAt }.take(capped)
    }

    private fun insertMails(
        recipients: List<UUID>,
        sendId: UUID,
        status: String,
        title: String,
        body: String,
        senderName: String,
        riceAmount: Long,
        rewardsJson: String,
        now: Instant,
    ) {
        val values = recipients.indices.joinToString(",") { index ->
            "(:mail$index,:account$index,'ADMIN_GIFT',:rice,:status,:claimed,:now,:title,:body,:sender,cast(:rewards as jsonb),:send)"
        }
        val params = mutableMapOf<String, Any?>(
            // claimed 는 아직 살아 있는 구버전이 읽는 칸이다. 받을 것이 없는 안내문이
            // 구버전 화면에서 "받기" 단추를 달고 나오지 않도록 받은 것으로 적어 둔다.
            "rice" to riceAmount, "status" to status, "claimed" to (status == "NONE"),
            "now" to Timestamp.from(now), "title" to title,
            "body" to body, "sender" to senderName, "rewards" to rewardsJson, "send" to sendId,
        )
        recipients.forEachIndexed { index, accountId ->
            params["mail$index"] = UUID.randomUUID()
            params["account$index"] = accountId
        }
        jdbc.sql("insert into mail_message(mail_id,account_id,type,rice_amount,reward_status,claimed,created_at,title,body,sender_name,rewards_json,send_id) values $values")
            .params(params).update()
    }

    private fun bumpStateVersions(recipients: List<UUID>) {
        recipients.chunked(INSERT_CHUNK).forEach { chunk ->
            jdbc.sql("update account set state_version=state_version+1 where id in (:ids)").param("ids", chunk).update()
        }
    }

    /**
     * 같은 보상이 여러 줄로 오면 하나로 합친다. 운영자가 실수로 두 줄을 넣어도 받는 쪽에서는
     * 한 줄로 보이는 편이 낫고, 멱등 지문도 줄 순서에 흔들리지 않는다.
     */
    private fun normalize(rewards: List<RewardInput>): List<RewardInput> = rewards
        .map { reward ->
            require(reward.quantity > 0) { "INVALID_QUANTITY" }
            when (reward.kind) {
                RewardKind.ITEM -> {
                    val definition = itemCatalog.require(requireNotNull(reward.itemId) { "INVALID_ITEM" })
                    require(definition.stackable) { "ADMIN_MESSAGE_ITEM_NOT_STACKABLE" }
                    reward.copy(cosmeticIds = null, displayName = definition.displayName)
                }
                RewardKind.GEM -> {
                    val level = requireNotNull(reward.gemLevel) { "INVALID_GEM_ADJUSTMENT" }
                    val option = requireNotNull(reward.gemOption) { "INVALID_GEM_OPTION" }
                    require(level in 1..7) { "INVALID_GEM_ADJUSTMENT" }
                    require(option in GemRules.optionsFor(level).map { it.first }) { "INVALID_GEM_OPTION" }
                    reward.copy(cosmeticIds = null, displayName = "${level}단계 ${option.label} 보석")
                }
                RewardKind.COSMETIC -> {
                    val cosmeticId = requireNotNull(reward.cosmeticId) { "COSMETIC_NOT_FOUND" }
                    val definition = cosmetics.cosmetics.firstOrNull { it.id == cosmeticId }
                        ?: throw IllegalArgumentException("COSMETIC_NOT_FOUND")
                    reward.copy(cosmeticIds = null, displayName = definition.displayName ?: definition.id)
                }
                RewardKind.COSMETIC_CHOICE -> {
                    require(reward.quantity == 1L) { "INVALID_QUANTITY" }
                    val cosmeticIds = reward.cosmeticIds.orEmpty().distinct()
                    require(cosmeticIds.size in 2..6) { "COSMETIC_CHOICE_OPTIONS_INVALID" }
                    val definitions = cosmeticIds.map { cosmeticId ->
                        cosmetics.cosmetics.firstOrNull { it.id == cosmeticId }
                            ?: throw IllegalArgumentException("COSMETIC_NOT_FOUND")
                    }
                    require(definitions.all { !it.gachaEligible && it.setId == null }) { "COSMETIC_CHOICE_NOT_EVENT_ONLY" }
                    reward.copy(
                        itemId = null, cosmeticId = null, cosmeticIds = cosmeticIds,
                        gemLevel = null, gemOption = null, displayName = "이벤트 치장 선택권",
                    )
                }
                /* 고를 항목이 없다. 운영자가 실수로 채워 넣은 칸은 지워 지문이 흔들리지 않게 한다. */
                RewardKind.TICKET -> reward.copy(
                    itemId = null, cosmeticId = null, cosmeticIds = null, gemLevel = null, gemOption = null,
                    displayName = "치장 뽑기권",
                )
            }
        }
            .groupBy { listOf(it.kind, it.itemId, it.cosmeticId, it.cosmeticIds, it.gemLevel, it.gemOption) }
            .map { (_, group) -> group.first().copy(quantity = group.sumOf { it.quantity }) }
            .sortedWith(
                compareBy(
                    { it.kind },
                    { it.itemId ?: it.cosmeticId ?: "" },
                    { it.gemLevel ?: 0 },
                    { it.gemOption?.name ?: "" },
                ),
            )
            .also { normalized ->
                normalized.filter { it.kind == RewardKind.COSMETIC }.forEach { reward ->
                    require(reward.quantity <= Int.MAX_VALUE) { "INVALID_QUANTITY" }
                    val definition = cosmetics.cosmetics.first { it.id == reward.cosmeticId }
                    require(definition.setId != null || reward.quantity == 1L) { "INVALID_QUANTITY" }
                }
                val choice = normalized.singleOrNull { it.kind == RewardKind.COSMETIC_CHOICE }
                require(choice == null || (normalized.size == 1 && choice.quantity == 1L)) {
                    "COSMETIC_CHOICE_MUST_BE_EXCLUSIVE"
                }
            }

    private fun requireAccount(accountId: UUID): UUID = jdbc.sql("select id from account where id=:account and deleted_at is null")
        .param("account", accountId)
        .query(UUID::class.java)
        .optional()
        .orElseThrow { IllegalArgumentException("ADMIN_ACCOUNT_NOT_FOUND") }

    private fun requireAccounts(accountIds: List<UUID>): List<UUID> {
        require(accountIds.isNotEmpty()) { "ADMIN_MESSAGE_TARGET_INVALID" }
        val existing = accountIds.chunked(INSERT_CHUNK).flatMap { chunk ->
            jdbc.sql("select id from account where deleted_at is null and id in (:accounts) order by id")
                .param("accounts", chunk)
                .query(UUID::class.java).list()
        }
        require(existing.size == accountIds.size) { "ADMIN_ACCOUNT_NOT_FOUND" }
        return existing
    }

    private fun requireTitle(value: String): String = value.trim().also { require(it.length in 1..120) { "ADMIN_MESSAGE_TITLE_REQUIRED" } }
    private fun requireBody(value: String): String = value.trim().also { require(it.length in 1..2000) { "ADMIN_MESSAGE_BODY_REQUIRED" } }
    private fun requireReason(value: String): String = value.trim().also { require(it.length in 3..500) { "ADMIN_USER_REASON_REQUIRED" } }

    private fun replay(operatorId: UUID, idempotencyKey: UUID, fingerprint: String): SendResult? {
        val stored = jdbc.sql("select fingerprint,result_json from admin_message_command where operator_id=:operator and idempotency_key=:key")
            .params(mapOf("operator" to operatorId, "key" to idempotencyKey))
            .query { row, _ -> StoredCommand(row.getString("fingerprint"), row.getString("result_json")) }
            .optional().orElse(null) ?: return null
        require(stored.fingerprint == fingerprint) { "IDEMPOTENCY_KEY_REUSED" }
        return mapper.readValue(stored.resultJson, SendResult::class.java).copy(replayed = true)
    }

    private fun save(operatorId: UUID, idempotencyKey: UUID, fingerprint: String, result: SendResult, now: Instant) {
        jdbc.sql("insert into admin_message_command(operator_id,idempotency_key,fingerprint,result_json,created_at) values (:operator,:key,:fingerprint,:result,:now)")
            .params(
                mapOf(
                    "operator" to operatorId, "key" to idempotencyKey, "fingerprint" to fingerprint,
                    "result" to mapper.writeValueAsString(result), "now" to Timestamp.from(now),
                ),
            ).update()
    }

    private fun readRewards(json: String?): List<RewardInput> = json?.takeIf { it.isNotBlank() }
        ?.let { mapper.readValue(it, object : TypeReference<List<RewardInput>>() {}) }
        ?: emptyList()

    /** 제목이 본문으로 흘러 넘쳐 같은 지문이 나오지 않도록, 글에 쓰이지 않는 문자로 칸을 나눈다. */
    private fun fingerprint(vararg parts: String): String = sha256(parts.joinToString(SEPARATOR))

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(StandardCharsets.UTF_8))
        .joinToString("") { "%02x".format(it) }

    private companion object {
        const val INSERT_CHUNK = 500
        val SEPARATOR = Char(0).toString()
    }
}
