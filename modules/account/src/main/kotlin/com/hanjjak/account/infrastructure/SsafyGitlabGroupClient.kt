package com.hanjjak.account.infrastructure

import com.fasterxml.jackson.databind.JsonNode
import com.hanjjak.account.application.SocialLoginProperties
import org.springframework.http.HttpHeaders
import org.springframework.stereotype.Component
import org.springframework.web.client.RestClient
import org.springframework.web.util.UriComponentsBuilder
import java.net.URI

@Component
class SsafyGitlabGroupClient(
    private val properties: SocialLoginProperties,
    restClientBuilder: RestClient.Builder,
) {
    private val restClient = restClientBuilder.build()

    fun fullPaths(accessToken: String): Set<String> {
        val configuration = properties.providers[SSAFY_PROVIDER_ID]
            ?: throw IllegalArgumentException("SOCIAL_PROVIDER_DISABLED")
        val groupsUri = configuration.groupsUri.takeIf(String::isNotBlank)
            ?: throw IllegalArgumentException("SOCIAL_PROVIDER_DISABLED")
        val origin = URI.create(groupsUri)
        var next: URI? = pageUri(groupsUri, 1)
        val visited = hashSetOf<String>()
        val groups = linkedMapOf<Long, String>()
        var pageCount = 0

        while (next != null) {
            require(sameOrigin(origin, next)) { "SSAFY_GROUP_RESPONSE_INVALID" }
            require(visited.add(next.toString())) { "SSAFY_GROUP_RESPONSE_INVALID" }
            require(++pageCount <= MAX_PAGES) { "SSAFY_GROUP_RESPONSE_INVALID" }
            val response = restClient.get()
                .uri(next)
                .headers { it.setBearerAuth(accessToken) }
                .accept(org.springframework.http.MediaType.APPLICATION_JSON)
                .retrieve()
                .toEntity(JsonNode::class.java)
            val body = response.body ?: throw IllegalArgumentException("SSAFY_GROUP_RESPONSE_INVALID")
            require(body.isArray) { "SSAFY_GROUP_RESPONSE_INVALID" }
            body.forEach { group ->
                val id = group.path("id").takeIf(JsonNode::isIntegralNumber)?.longValue()
                    ?: throw IllegalArgumentException("SSAFY_GROUP_RESPONSE_INVALID")
                val fullPath = group.path("full_path").takeIf(JsonNode::isTextual)?.textValue()?.takeIf(String::isNotBlank)
                    ?: throw IllegalArgumentException("SSAFY_GROUP_RESPONSE_INVALID")
                groups[id] = fullPath
            }
            next = nextUri(response.headers, groupsUri)
        }
        return groups.values.toSet()
    }

    private fun nextUri(headers: HttpHeaders, groupsUri: String): URI? {
        val nextPage = headers.getFirst(NEXT_PAGE_HEADER)
        if (!nextPage.isNullOrBlank()) {
            val page = nextPage.toIntOrNull()?.takeIf { it > 0 }
                ?: throw IllegalArgumentException("SSAFY_GROUP_RESPONSE_INVALID")
            return pageUri(groupsUri, page)
        }
        val link = headers.getFirst(HttpHeaders.LINK).orEmpty()
        val target = LINK_ENTRY.findAll(link)
            .firstOrNull { it.groupValues[2].equals("next", ignoreCase = true) }
            ?.groupValues?.get(1)
            ?: return null
        return URI.create(target)
    }

    private fun pageUri(groupsUri: String, page: Int): URI = UriComponentsBuilder.fromUriString(groupsUri)
        .replaceQueryParam("all_available", false)
        .replaceQueryParam("per_page", PAGE_SIZE)
        .replaceQueryParam("page", page)
        .build(true)
        .toUri()

    private fun sameOrigin(expected: URI, actual: URI): Boolean =
        expected.scheme.equals(actual.scheme, ignoreCase = true) &&
            expected.host.equals(actual.host, ignoreCase = true) &&
            effectivePort(expected) == effectivePort(actual)

    private fun effectivePort(uri: URI): Int = when {
        uri.port >= 0 -> uri.port
        uri.scheme.equals("https", ignoreCase = true) -> 443
        uri.scheme.equals("http", ignoreCase = true) -> 80
        else -> -1
    }

    private companion object {
        const val SSAFY_PROVIDER_ID = "ssafy-gitlab"
        const val NEXT_PAGE_HEADER = "X-Next-Page"
        const val PAGE_SIZE = 100
        const val MAX_PAGES = 100
        val LINK_ENTRY = Regex("<([^>]+)>\\s*;\\s*rel=\\\"([^\\\"]+)\\\"")
    }
}
