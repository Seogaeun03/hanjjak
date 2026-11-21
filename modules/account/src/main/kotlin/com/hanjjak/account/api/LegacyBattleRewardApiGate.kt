package com.hanjjak.account.api

import com.fasterxml.jackson.databind.ObjectMapper
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.slf4j.LoggerFactory
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication
import org.springframework.context.annotation.Configuration
import org.springframework.core.Ordered
import org.springframework.core.annotation.AnnotatedElementUtils
import org.springframework.http.MediaType
import org.springframework.web.method.HandlerMethod
import org.springframework.web.servlet.HandlerInterceptor
import org.springframework.web.servlet.config.annotation.InterceptorRegistry
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer
import java.time.Clock
import java.util.UUID

/**
 * 레거시 즉시 보상 핸들러의 마지막 방어선.
 *
 * 필터의 경로 검사와 달리 이 검사는 URL 표기를 전혀 보지 않는다. 라우팅이 끝난 뒤
 * [HandlerMethod] 에 [LegacyBattleRewardApi] 가 붙어 있는지만 확인하므로, 필터가 놓치는
 * 표기가 생기더라도 컨트롤러의 보상 로직과 트랜잭션에 진입하기 전에 막힌다.
 */
class LegacyBattleRewardApiGate(
    private val properties: ApiSecurityProperties,
    private val objectMapper: ObjectMapper,
    private val clock: Clock,
) : HandlerInterceptor {
    override fun preHandle(request: HttpServletRequest, response: HttpServletResponse, handler: Any): Boolean {
        if (properties.legacyBattleRewardApiEnabled) return true
        val handlerMethod = handler as? HandlerMethod ?: return true
        if (!isLegacyBattleRewardHandler(handlerMethod)) return true

        auditLogger.warn(
            "Blocked legacy battle reward handler accountId={} handler={} path={} remoteAddress={}",
            request.getSession(false)?.getAttribute("accountId") as? UUID,
            handlerMethod.shortLogMessage,
            ApiRequestPath.resolve(request).canonical,
            request.remoteAddr.orEmpty().ifBlank { "unknown" },
        )
        response.status = HttpServletResponse.SC_FORBIDDEN
        response.contentType = MediaType.APPLICATION_JSON_VALUE
        objectMapper.writeValue(
            response.outputStream,
            ApiRequestGuardFilter.ErrorEnvelope(
                UUID.randomUUID(),
                clock.instant(),
                CODE,
                "error.${CODE.lowercase().replace('_', '.')}",
                false,
            ),
        )
        return false
    }

    private fun isLegacyBattleRewardHandler(handler: HandlerMethod): Boolean =
        handler.hasMethodAnnotation(LegacyBattleRewardApi::class.java) ||
            AnnotatedElementUtils.hasAnnotation(handler.beanType, LegacyBattleRewardApi::class.java)

    private companion object {
        const val CODE = "BATTLE_COMPATIBILITY_API_DISABLED"
        val auditLogger = LoggerFactory.getLogger(LegacyBattleRewardApiGate::class.java)
    }
}

@Configuration
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
class LegacyBattleRewardApiGateConfiguration(
    private val properties: ApiSecurityProperties,
    private val objectMapper: ObjectMapper,
    private val clock: Clock,
) : WebMvcConfigurer {
    override fun addInterceptors(registry: InterceptorRegistry) {
        // 경로 패턴을 걸지 않는다. 표기와 무관하게 모든 핸들러를 대상으로 삼아야 한다.
        registry.addInterceptor(LegacyBattleRewardApiGate(properties, objectMapper, clock))
            .order(Ordered.HIGHEST_PRECEDENCE)
    }
}
