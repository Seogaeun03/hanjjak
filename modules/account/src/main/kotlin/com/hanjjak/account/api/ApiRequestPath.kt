package com.hanjjak.account.api

import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.server.PathContainer
import org.springframework.http.server.RequestPath

/**
 * 경로 기반 보안 검사는 Spring MVC 라우터가 실제로 사용하는 경로 위에서만 한다.
 *
 * 원시 `requestURI` 문자열을 정규 문자열과 직접 비교하면 `/api/v1/battles/cycl%65s` 처럼
 * 같은 핸들러로 라우팅되는 다른 표기가 검사를 그대로 통과한다. 라우터와 같은
 * [RequestPath] 파서를 써서 세그먼트마다 한 번씩만 디코딩하면 검사와 라우팅이 같은 값을 본다.
 *
 * 판단 근거 SSOT: docs/50-architecture/networking.md
 */
object ApiRequestPath {
    const val API_PREFIX = "/api/"
    const val PLAYER_API_PREFIX = "/api/v1/"
    const val ADMIN_API_PREFIX = "/api/admin/v1/"

    /**
     * @param canonical 라우터와 동일하게 세그먼트마다 한 번씩만 디코딩한 경로.
     * @param ambiguous 정규화 방식에 따라 가리키는 핸들러가 달라질 수 있는 경로.
     *   이 경로는 해석을 더 진행하지 않고 요청 초기에 거부한다.
     */
    data class Resolved(val canonical: String, val ambiguous: Boolean)

    fun resolve(request: HttpServletRequest): Resolved {
        val raw = request.requestURI.orEmpty()
        val parsed = runCatching { RequestPath.parse(raw, request.contextPath.orEmpty()) }.getOrNull()
            ?: return Resolved(raw, ambiguous = true)
        val segments = parsed.pathWithinApplication().elements().filterIsInstance<PathContainer.PathSegment>()
        val decoded = segments.map(PathContainer.PathSegment::valueToMatch)
        val canonical = if (decoded.isEmpty()) "/" else decoded.joinToString("/", prefix = "/")
        return Resolved(canonical, ambiguous = isAmbiguous(raw, segments, decoded))
    }

    /** 원시 경로 또는 정규 경로 중 하나라도 API 접두사에 걸리면 가드를 적용한다. */
    fun guarded(request: HttpServletRequest, resolved: Resolved, prefix: String): Boolean =
        resolved.canonical.startsWith(prefix) || request.requestURI.orEmpty().startsWith(prefix)

    private fun isAmbiguous(
        raw: String,
        segments: List<PathContainer.PathSegment>,
        decoded: List<String>,
    ): Boolean {
        if (raw.isEmpty()) return true
        // 제어 문자, 경로 파라미터(`;`), 역슬래시는 컨테이너·프록시마다 해석이 갈린다.
        if (raw.any { it.code < 0x20 || it.code == 0x7f } || ';' in raw || '\\' in raw) return true
        // 빈 세그먼트는 파서마다 유지·삭제가 갈려서 접두사 검사와 라우팅이 어긋날 수 있다.
        if ("//" in raw) return true
        if (segments.any { it.parameters().isNotEmpty() }) return true
        // 디코딩 결과가 구분자·상대 경로·또 다른 인코딩으로 바뀌면 해석이 한 번에 끝나지 않는다.
        // 여기서 거부하므로 어디에서도 경로를 두 번 디코딩하지 않는다.
        return decoded.any { it == "." || it == ".." || it.isEmpty() || '/' in it || '\\' in it || '%' in it }
    }
}
