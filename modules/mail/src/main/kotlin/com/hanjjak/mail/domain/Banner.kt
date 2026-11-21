package com.hanjjak.mail.domain

import java.time.Instant
import java.util.UUID

/** 배너의 결. 화면은 이 값으로 색을 고르고, 문장은 운영자가 쓴 그대로 보여 준다. */
enum class BannerTone { INFO, EVENT, WARNING }

/**
 * 화면 맨 위에 한 줄로 끼어드는 운영 알림.
 *
 * 공지와 달리 읽음을 세지 않는다. 배너는 열려 있는 동안 계속 보이는 것이 목적이고,
 * 사람별로 남는 상태는 "닫았는지" 하나뿐이다.
 */
data class Banner(
    val bannerId: UUID,
    val message: String,
    val tone: BannerTone,
    val expiresAt: Instant,
)

data class BannerPage(val items: List<Banner>)
data class BannerDismissResult(val bannerId: UUID, val dismissedAt: Instant)
