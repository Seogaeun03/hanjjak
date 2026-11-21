package com.hanjjak.account.application

import java.util.UUID

interface AuthenticationSessionLifecycle {
    fun closeForPasswordReset(accountId: UUID)
}

interface GameSessionLifecycle {
    fun replaceForLogin(accountId: UUID)
    fun closeForLogout(accountId: UUID)
    fun closeForPasswordReset(accountId: UUID)
}

interface OfflineRewardLifecycle {
    fun startForSession(accountId: UUID, gameSessionId: UUID) {}
    fun touchForSession(accountId: UUID, gameSessionId: UUID, heartbeatAt: java.time.Instant) {}
    fun markDisconnectedForAccount(accountId: UUID, disconnectedAt: java.time.Instant) {}
    fun cancelForSession(accountId: UUID, gameSessionId: UUID) {}
    fun cancelForAccount(accountId: UUID) {}
    fun freezeForSession(accountId: UUID, gameSessionId: UUID, reason: String) {}
    fun freezeForAccount(accountId: UUID, reason: String) {}
    fun freezeAll(endedAt: java.time.Instant, reason: String) {}
    fun freezeAllExcept(endedAt: java.time.Instant, reason: String, excludedAccountIds: Set<UUID>) {
        freezeAll(endedAt, reason)
    }
}

/**
 * 접속 중 이벤트 티켓 적립. 기본 구현은 아무것도 하지 않는다.
 *
 * 이벤트 모듈이 없거나 꺼져 있어도 세션 생명주기가 그대로 돌아야 해서 기본값을 무동작으로 둔다.
 * 시각을 인자로 받지 않는 것은 의도적이다. 구현이 서버 `Clock` 만 읽어야 클라이언트가 보낸
 * 시각이 적립에 닿을 길이 없다.
 */
interface LiveopsAccrualLifecycle {
    fun accrueForHeartbeat(accountId: java.util.UUID) {}
}
