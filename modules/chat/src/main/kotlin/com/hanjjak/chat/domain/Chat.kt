package com.hanjjak.chat.domain

import java.time.Instant
import java.util.UUID

enum class ChatIntent { SELL, BUY }
enum class ChatPostStatus { ACTIVE, CLOSED, EXPIRED, DELETED }

data class ChatMessage(
    val messageId: UUID,
    val accountId: UUID,
    val nickname: String,
    val primaryMaterialType: String? = null,
    val body: String,
    val createdAt: Instant,
    val eventId: UUID,
    // 보낸 사람의 현재 GM 여부. 메시지 행에 저장하지 않고 읽을 때마다 계정에서 가져오므로
    // 권한을 회수하면 과거 메시지의 배지도 같이 사라진다.
    val gameMaster: Boolean = false,
    // 현재 계정 칭호. 메시지에 복사하지 않아 교체·해제가 과거 메시지에도 즉시 반영된다.
    val chatTitle: String? = null,
    // 관리자가 지정한 칭호 색상. null이면 기존 주력 재료색을 사용한다.
    val chatTitleColor: String? = null,
)

data class ChatBoardPost(
    val postId: UUID,
    val accountId: UUID,
    val nickname: String,
    val intent: ChatIntent,
    val itemId: String,
    val quantity: Long,
    val unitPrice: Long?,
    val body: String,
    val status: ChatPostStatus,
    val createdAt: Instant,
    val expiresAt: Instant,
)

data class ChatPage(val items: List<ChatMessage>, val nextCursor: String?, val unreadCount: Int)
data class ChatBoardPage(val items: List<ChatBoardPost>, val nextCursor: String?)
data class ChatSendRequest(val body: String)
data class ChatSendResult(val message: ChatMessage, val filterStatus: String = "ALLOW")
data class ChatReportRequest(val reason: String)
data class ChatReportResult(val reportId: UUID, val status: String)
data class ChatBlockResult(val accountId: UUID, val blocked: Boolean)
data class ChatBoardPostRequest(val intent: ChatIntent, val itemId: String, val quantity: Long, val unitPrice: Long?, val body: String)
data class ChatBoardPostResult(val post: ChatBoardPost, val filterStatus: String = "ALLOW")
data class ChatBoardCloseResult(val postId: UUID, val status: String)
data class ChatCommandResult<T>(val commandId: UUID, val idempotencyKey: UUID, val status: String = "SUCCEEDED", val result: T)
