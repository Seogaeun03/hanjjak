package com.hanjjak.account.api

/**
 * 운영 기본값에서 비활성화하는 레거시 즉시 보상 호환 핸들러 표시.
 *
 * 차단 판단을 경로 문자열이 아니라 라우팅이 끝난 핸들러 자체에 건다. 어떤 표기로 들어오든
 * Spring 이 이 핸들러를 고르면 [LegacyBattleRewardApiGate] 가 보상 로직 전에 막는다.
 *
 * 판단 근거 SSOT: docs/50-architecture/networking.md
 */
@Target(AnnotationTarget.FUNCTION, AnnotationTarget.CLASS)
@Retention(AnnotationRetention.RUNTIME)
@MustBeDocumented
annotation class LegacyBattleRewardApi
