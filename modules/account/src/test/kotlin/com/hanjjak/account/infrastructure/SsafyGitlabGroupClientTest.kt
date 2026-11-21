package com.hanjjak.account.infrastructure

import com.hanjjak.account.application.SocialLoginProperties
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.test.web.client.MockRestServiceServer
import org.springframework.test.web.client.match.MockRestRequestMatchers.header
import org.springframework.test.web.client.match.MockRestRequestMatchers.method
import org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo
import org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess
import org.springframework.web.client.RestClient
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class SsafyGitlabGroupClientTest {
    private val properties = SocialLoginProperties(
        providers = mapOf(
            "ssafy-gitlab" to SocialLoginProperties.Provider(
                groupsUri = "https://lab.ssafy.com/api/v4/groups",
            ),
        ),
    )

    @Test
    fun `reads every group page and deduplicates by group id`() {
        val builder = RestClient.builder()
        val server = MockRestServiceServer.bindTo(builder).build()
        val client = SsafyGitlabGroupClient(properties, builder)
        server.expect(requestTo("https://lab.ssafy.com/api/v4/groups?all_available=false&per_page=100&page=1"))
            .andExpect(method(HttpMethod.GET))
            .andExpect(header("Authorization", "Bearer callback-token"))
            .andRespond(
                withSuccess(
                    """[{"id":15,"full_path":"s15"},{"id":1503,"full_path":"s15/b03"}]""",
                    MediaType.APPLICATION_JSON,
                ).header("X-Next-Page", "2"),
            )
        server.expect(requestTo("https://lab.ssafy.com/api/v4/groups?all_available=false&per_page=100&page=2"))
            .andExpect(method(HttpMethod.GET))
            .andRespond(
                withSuccess(
                    """[{"id":1503,"full_path":"s15/b03"},{"id":1401,"full_path":"s14/a01"}]""",
                    MediaType.APPLICATION_JSON,
                ).header("X-Next-Page", ""),
            )

        assertEquals(setOf("s15", "s15/b03", "s14/a01"), client.fullPaths("callback-token"))
        server.verify()
    }

    @Test
    fun `rejects an external next page before sending the token`() {
        val builder = RestClient.builder()
        val server = MockRestServiceServer.bindTo(builder).build()
        val client = SsafyGitlabGroupClient(properties, builder)
        server.expect(requestTo("https://lab.ssafy.com/api/v4/groups?all_available=false&per_page=100&page=1"))
            .andRespond(
                withSuccess("[]", MediaType.APPLICATION_JSON)
                    .header("Link", "<https://attacker.example/groups?page=2>; rel=\"next\""),
            )

        val error = assertFailsWith<IllegalArgumentException> { client.fullPaths("callback-token") }

        assertEquals("SSAFY_GROUP_RESPONSE_INVALID", error.message)
        server.verify()
    }
}
