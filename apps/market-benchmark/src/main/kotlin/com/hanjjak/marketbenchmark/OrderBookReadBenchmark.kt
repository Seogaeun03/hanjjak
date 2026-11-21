package com.hanjjak.marketbenchmark

import java.nio.file.Files
import java.nio.file.Path
import java.sql.Connection
import java.sql.DriverManager
import java.time.Instant
import java.util.Collections
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * 주문장 공용 조회가 정말 DB 병목인지 먼저 재는 부하 시험이다.
 *
 * 캐시를 넣기 전과 넣은 뒤에 같은 조건으로 돌려서 조회 DB 호출 수, p50/p95, 처리량,
 * 그리고 같은 시간에 도는 주문 등록 지연이 어떻게 달라지는지 비교한다.
 * 읽기만 재면 등록이 느려지는 것을 놓치므로 혼합 구간을 함께 둔다.
 */
data class ReadConfig(
    val apiBaseUrl: String,
    val dbUrl: String,
    val dbUser: String,
    val dbPassword: String,
    val runId: String,
    val itemId: String,
    val makers: Int,
    val readers: Int,
    val priceLevels: Int,
    val ordersPerLevel: Int,
    val levels: Int,
    val concurrency: Int,
    val totalRequests: Int,
    val mutationConcurrency: Int,
    val mutationRequests: Int,
    val warmupRequests: Int,
    val seedTrades: Int,
    val timeoutSeconds: Long,
    val password: String,
    val outputPath: String,
) {
    companion object {
        fun from(args: Array<String>): ReadConfig {
            val values = mutableMapOf<String, String>()
            var index = 0
            while (index < args.size) {
                val key = args[index]
                require(key.startsWith("--")) { "expected --key at ${args[index]}" }
                require(index + 1 < args.size) { "missing value for $key" }
                values[key.removePrefix("--")] = args[index + 1]
                index += 2
            }
            fun text(key: String, fallback: String) = values[key] ?: fallback
            fun number(key: String, fallback: Int) = values[key]?.toInt() ?: fallback
            return ReadConfig(
                apiBaseUrl = text("api-base-url", "http://127.0.0.1:8080"),
                dbUrl = text("db-url", "jdbc:postgresql://localhost:5432/hanjjak"),
                dbUser = text("db-user", "hanjjak"),
                dbPassword = text("db-password", "local-only"),
                runId = text("run-id", "orderbook-read-${timestamp()}"),
                itemId = text("item-id", "CORN_M4"),
                makers = number("makers", 8),
                readers = number("readers", 20),
                priceLevels = number("price-levels", 12),
                ordersPerLevel = number("orders-per-level", 3),
                levels = number("levels", 5),
                concurrency = number("concurrency", 20),
                totalRequests = number("total-requests", 600),
                mutationConcurrency = number("mutation-concurrency", 4),
                mutationRequests = number("mutation-requests", 60),
                warmupRequests = number("warmup-requests", 60),
                seedTrades = number("seed-trades", 20),
                timeoutSeconds = values["timeout-seconds"]?.toLong() ?: 300L,
                password = text("password", "Benchmark123!"),
                outputPath = text("output-path", ""),
            )
        }
    }
}

/** 한 구간에서 나온 지연 표본을 요약한다. */
data class PhaseLatency(
    val label: String,
    val sent: Int,
    val completed: Int,
    val success: Int,
    val failure: Int,
    val wallMillis: Long,
    val p50: Long,
    val p95: Long,
    val p99: Long,
    val maxMillis: Long,
    val throughputPerSecond: Double,
    val errorCodes: Map<String, Int>,
)

/** pg_stat_statements에서 뽑은 SQL 한 종류의 호출 수와 누적 실행 시간이다. */
data class QueryStat(val category: String, val calls: Long, val totalExecMillis: Double, val query: String)

private const val CATEGORY_INSTRUMENT = "instrument"
private const val CATEGORY_DEPTH = "depth"
private const val CATEGORY_RECENT_TRADES = "recentTrades"
private const val CATEGORY_STATE_VERSION = "stateVersion"
private const val CATEGORY_OTHER = "other"

/** 주문장 조회 한 번이 실제로 어떤 SQL을 몇 번 부르는지 나눈다. */
internal fun categorizeOrderBookQuery(query: String): String {
    val normalized = query.lowercase()
    return when {
        "from market_instrument where instrument_id" in normalized && "update" !in normalized -> CATEGORY_INSTRUMENT
        "group by limit_unit_price" in normalized -> CATEGORY_DEPTH
        "from market_trade where instrument_id" in normalized && "order by filled_at desc" in normalized -> CATEGORY_RECENT_TRADES
        "state_version from account" in normalized -> CATEGORY_STATE_VERSION
        else -> CATEGORY_OTHER
    }
}

private class StatementStats(private val config: ReadConfig) {
    private fun connect(): Connection = DriverManager.getConnection(config.dbUrl, config.dbUser, config.dbPassword)

    fun reset() = connect().use { connection ->
        connection.createStatement().use { it.execute("select pg_stat_statements_reset()") }
    }

    fun snapshot(): List<QueryStat> = connect().use { connection ->
        connection.createStatement().use { statement ->
            statement.executeQuery(
                """
                select query, calls, total_exec_time
                from pg_stat_statements
                where dbid = (select oid from pg_database where datname = current_database())
                order by calls desc
                """.trimIndent(),
            ).use { rows ->
                val stats = mutableListOf<QueryStat>()
                while (rows.next()) {
                    val query = rows.getString(1)
                    stats += QueryStat(categorizeOrderBookQuery(query), rows.getLong(2), rows.getDouble(3), query)
                }
                stats
            }
        }
    }
}

fun runOrderBookReadBenchmark(args: Array<String>) {
    val config = ReadConfig.from(args)
    println("order-book read benchmark runId=${config.runId} base=${config.apiBaseUrl} concurrency=${config.concurrency} total=${config.totalRequests}")
    val startedAt = Instant.now()

    DriverManager.getConnection(config.dbUrl, config.dbUser, config.dbPassword).use { connection ->
        connection.autoCommit = false
        resetItemData(connection, config.itemId)
        connection.commit()
    }

    // 별명은 계정마다 유일해야 한다. 실행마다 다른 꼬리표를 붙여 이전 실행과 부딪히지 않게 한다.
    val tag = UUID.randomUUID().toString().replace("-", "").take(6)
    val material = config.itemId.toMaterialType()
    val makers = (1..config.makers).map { index ->
        ApiSession(config.apiBaseUrl).also {
            it.accountId = it.signupOrLogin("${config.runId}-maker-$index@example.com", config.password, "mk$tag-$index", material)
        }
    }
    val readers = (1..config.readers).map { index ->
        ApiSession(config.apiBaseUrl).also {
            it.accountId = it.signupOrLogin("${config.runId}-reader-$index@example.com", config.password, "rd$tag-$index", material)
        }
    }

    // 주문을 낼 수 있게 재고와 쌀을 넉넉히 넣는다. 부족해서 실패하면 지연이 아니라 오류를 재게 된다.
    DriverManager.getConnection(config.dbUrl, config.dbUser, config.dbPassword).use { connection ->
        connection.autoCommit = false
        (makers + readers).forEachIndexed { index, session ->
            upsertInventory(connection, session.accountId, config.itemId, 5_000_000, 0, index + 1L)
            upsertWallet(connection, session.accountId, 5_000_000_000)
        }
        connection.commit()
    }

    val instrumentId = DriverManager.getConnection(config.dbUrl, config.dbUser, config.dbPassword).use { connection ->
        connection.prepareStatement("select instrument_id from market_instrument where item_id=? and status='ACTIVE'").use { statement ->
            statement.setString(1, config.itemId)
            statement.executeQuery().use { rows ->
                require(rows.next()) { "market instrument missing for ${config.itemId}" }
                rows.getObject(1, UUID::class.java)
            }
        }
    }

    // 파는 쪽은 1000부터 위로, 사는 쪽은 990부터 아래로 깔아 서로 걸치지 않게 한다.
    val sellBase = 1000L
    val buyBase = 990L
    fun place(session: ApiSession, side: String, price: Long, quantity: Long) {
        val body = "{\"instrumentId\":\"$instrumentId\",\"side\":\"$side\",\"timeInForce\":\"GTC\",\"quantity\":$quantity,\"limitUnitPrice\":$price}"
        val result = session.postJson("/api/v1/market/orders", body)
        require(result.statusCode in 200..299) { "$side order failed status=${result.statusCode} body=${result.body}" }
    }

    var placed = 0
    repeat(config.priceLevels) { level ->
        repeat(config.ordersPerLevel) { slot ->
            val maker = makers[(level * config.ordersPerLevel + slot) % makers.size]
            place(maker, "SELL", sellBase + level * 10L, 100L + slot)
            place(maker, "BUY", buyBase - level * 10L, 100L + slot)
            placed += 2
        }
    }
    // 조회자도 자기 주문을 갖고 있어야 계정별 myQuantity가 서로 달라진다.
    readers.forEachIndexed { index, reader ->
        place(reader, "SELL", sellBase + (index % config.priceLevels) * 10L, 10L + index)
        place(reader, "BUY", buyBase - (index % config.priceLevels) * 10L, 10L + index)
        placed += 2
    }

    // 최근 거래가 비어 있으면 조회 비용을 과소평가한다. 실제 체결을 조금 만들어 둔다.
    repeat(config.seedTrades) { index ->
        val taker = readers[index % readers.size]
        val body = "{\"instrumentId\":\"$instrumentId\",\"side\":\"BUY\",\"timeInForce\":\"IOC\",\"quantity\":1,\"limitUnitPrice\":${sellBase + config.priceLevels * 10L}}"
        taker.postJson("/api/v1/market/orders", body)
    }
    println("seeded orders=$placed trades=${config.seedTrades} instrument=$instrumentId")

    val readPath = "/api/v1/market/order-books/$instrumentId?levels=${config.levels}"
    val stats = StatementStats(config)

    fun readOnce(session: ApiSession): Triple<Int, Long, String?> {
        val start = System.nanoTime()
        return try {
            val response = session.getJson(readPath)
            val millis = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start)
            val error = if (response.statusCode in 200..299) null else extractString(response.body, "code") ?: "HTTP_${response.statusCode}"
            Triple(response.statusCode, millis, error)
        } catch (error: Exception) {
            Triple(0, TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start), error.javaClass.simpleName)
        }
    }

    // 워밍업은 계측에서 뺀다. JIT와 커넥션 풀이 덥혀지기 전 값이 섞이면 p95가 거짓으로 커진다.
    repeat(config.warmupRequests) { index -> readOnce(readers[index % readers.size]) }

    fun runPhase(label: String, mutating: Boolean): Pair<PhaseLatency, PhaseLatency?> {
        stats.reset()
        val readResults = Collections.synchronizedList(mutableListOf<Triple<Int, Long, String?>>())
        val mutationResults = Collections.synchronizedList(mutableListOf<Triple<Int, Long, String?>>())
        val pool = Executors.newVirtualThreadPerTaskExecutor()
        val gate = CountDownLatch(1)
        val mutationCount = if (mutating) config.mutationRequests else 0
        val readWorkers = minOf(config.concurrency, config.totalRequests)
        val mutationWorkers = if (mutating) minOf(config.mutationConcurrency, mutationCount) else 0
        val done = CountDownLatch(readWorkers + mutationWorkers)

        // 한 번에 전부 던지면 동시성이 아니라 순간 폭주를 재게 된다.
        // 일꾼 수를 동시성으로 고정하고 각자 남은 몫을 집어 가는 닫힌 고리로 돈다.
        val readRemaining = AtomicInteger(config.totalRequests)
        repeat(readWorkers) { worker ->
            pool.execute {
                gate.await()
                var issued = 0
                while (readRemaining.getAndDecrement() > 0) {
                    readResults += readOnce(readers[(worker + issued * readWorkers) % readers.size])
                    issued++
                }
                done.countDown()
            }
        }
        val mutationRemaining = AtomicInteger(mutationCount)
        repeat(mutationWorkers) { worker ->
            pool.execute {
                gate.await()
                var issued = 0
                while (mutationRemaining.getAndDecrement() > 0) {
                    val maker = makers[(worker + issued * mutationWorkers) % makers.size]
                    val start = System.nanoTime()
                    val result = try {
                        // 등록이 돌아야 revision이 실제로 오르고 조회가 낡은 값을 쥐는지 드러난다.
                        val price = sellBase + ((worker + issued) % config.priceLevels) * 10L
                        val body = "{\"instrumentId\":\"$instrumentId\",\"side\":\"SELL\",\"timeInForce\":\"GTC\",\"quantity\":1,\"limitUnitPrice\":$price}"
                        val response = synchronized(maker) { maker.postJson("/api/v1/market/orders", body) }
                        val millis = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start)
                        val error = if (response.statusCode in 200..299) null else extractString(response.body, "code") ?: "HTTP_${response.statusCode}"
                        Triple(response.statusCode, millis, error)
                    } catch (error: Exception) {
                        Triple(0, TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start), error.javaClass.simpleName)
                    }
                    mutationResults += result
                    issued++
                }
                done.countDown()
            }
        }

        val wallStart = System.nanoTime()
        gate.countDown()
        val completed = done.await(config.timeoutSeconds, TimeUnit.SECONDS)
        val wallMillis = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - wallStart)
        pool.shutdownNow()
        require(completed) { "$label timed out reads=${readResults.size}/${config.totalRequests}" }

        fun summarize(tag: String, rows: List<Triple<Int, Long, String?>>, sent: Int): PhaseLatency {
            val sorted = rows.map { it.second }.sorted()
            val success = rows.count { it.first in 200..299 }
            return PhaseLatency(
                label = tag,
                sent = sent,
                completed = rows.size,
                success = success,
                failure = rows.size - success,
                wallMillis = wallMillis,
                p50 = percentile(sorted, 0.50),
                p95 = percentile(sorted, 0.95),
                p99 = percentile(sorted, 0.99),
                maxMillis = sorted.lastOrNull() ?: 0L,
                throughputPerSecond = if (wallMillis == 0L) 0.0 else rows.size * 1000.0 / wallMillis,
                errorCodes = rows.mapNotNull { it.third }.groupingBy { it }.eachCount(),
            )
        }
        val readSummary = summarize("$label:read", readResults, config.totalRequests)
        return readSummary to if (mutating) summarize("$label:mutation", mutationResults, mutationCount) else null
    }

    val readOnly = runPhase("readOnly", mutating = false)
    val readOnlyStats = stats.snapshot()
    val mixed = runPhase("mixed", mutating = true)
    val mixedStats = stats.snapshot()

    val json = buildString {
        append("{\n")
        append("  \"runId\": \"${config.runId}\",\n")
        append("  \"startedAt\": \"$startedAt\",\n")
        append("  \"finishedAt\": \"${Instant.now()}\",\n")
        append("  \"instrumentId\": \"$instrumentId\",\n")
        append("  \"config\": {\"makers\": ${config.makers}, \"readers\": ${config.readers}, \"priceLevels\": ${config.priceLevels}, \"ordersPerLevel\": ${config.ordersPerLevel}, \"levels\": ${config.levels}, \"concurrency\": ${config.concurrency}, \"totalRequests\": ${config.totalRequests}, \"mutationRequests\": ${config.mutationRequests}, \"seededOrders\": $placed},\n")
        append("  \"phases\": [\n")
        val phases = listOfNotNull(readOnly.first, readOnly.second, mixed.first, mixed.second)
        phases.forEachIndexed { index, phase ->
            append("    {\"label\": \"${phase.label}\", \"sent\": ${phase.sent}, \"completed\": ${phase.completed}, \"success\": ${phase.success}, \"failure\": ${phase.failure}, \"wallMillis\": ${phase.wallMillis}, \"p50\": ${phase.p50}, \"p95\": ${phase.p95}, \"p99\": ${phase.p99}, \"max\": ${phase.maxMillis}, \"throughputPerSecond\": ${"%.2f".format(phase.throughputPerSecond)}, \"errorCodes\": {${phase.errorCodes.entries.joinToString(", ") { "\"${it.key}\": ${it.value}" }}}}")
            append(if (index == phases.size - 1) "\n" else ",\n")
        }
        append("  ],\n")
        fun appendStats(name: String, rows: List<QueryStat>, reads: Int, last: Boolean) {
            val grouped = rows.filter { it.category != CATEGORY_OTHER }
                .groupBy { it.category }
                .mapValues { (_, values) -> values.sumOf { it.calls } to values.sumOf { it.totalExecMillis } }
            val readCalls = grouped.values.sumOf { it.first }
            append("  \"$name\": {\n")
            append("    \"readRequests\": $reads,\n")
            append("    \"orderBookQueryCalls\": $readCalls,\n")
            append("    \"orderBookQueryCallsPerRead\": ${"%.3f".format(if (reads == 0) 0.0 else readCalls.toDouble() / reads)},\n")
            append("    \"byCategory\": {${grouped.entries.joinToString(", ") { "\"${it.key}\": {\"calls\": ${it.value.first}, \"totalExecMillis\": ${"%.2f".format(it.value.second)}}" }}},\n")
            append("    \"topQueries\": [${rows.sortedByDescending { it.calls }.take(8).joinToString(", ") { "{\"calls\": ${it.calls}, \"totalExecMillis\": ${"%.2f".format(it.totalExecMillis)}, \"category\": \"${it.category}\", \"query\": \"${escape(it.query.take(160))}\"}" }}]\n")
            append(if (last) "  }\n" else "  },\n")
        }
        appendStats("readOnlyDb", readOnlyStats, config.totalRequests, last = false)
        appendStats("mixedDb", mixedStats, config.totalRequests, last = true)
        append("}\n")
    }

    println(json)
    if (config.outputPath.isNotBlank()) {
        val path = Path.of(config.outputPath)
        path.parent?.let { Files.createDirectories(it) }
        Files.writeString(path, json)
        println("wrote ${path.toAbsolutePath()}")
    }
}
