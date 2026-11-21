package com.hanjjak.marketbenchmark

import org.postgresql.PGConnection
import java.io.ByteArrayInputStream
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.sql.Connection
import java.sql.DriverManager
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import kotlin.math.max
import kotlin.math.min
import kotlin.random.Random

/**
 * Production-like order book fixture plus plan measurement for the unified market tables.
 *
 * The HTTP load benchmark in [runSingle] measures contention on a single hot instrument. Index plan work needs the
 * opposite shape: a book that is wide (many instruments), deep (many price levels on the hot instruments) and old
 * (a long closed-order and trade tail). Writing that through the API would take hours, so the fixture is seeded
 * straight into PostgreSQL with COPY while honouring every `market_order` check constraint.
 */

internal data class OrderBookIndexConfig(
    val dbUrl: String,
    val dbUser: String,
    val dbPassword: String,
    val accounts: Int,
    val instruments: Int,
    val activeOrders: Int,
    val closedOrders: Int,
    val trades: Int,
    val expiredActiveRatio: Double,
    val seed: Long,
    val label: String,
    val repetitions: Int,
    val writeSamples: Int,
    val readConcurrency: Int,
    val readSeconds: Long,
    val outputPath: String,
) {
    companion object {
        fun from(args: Array<String>, env: Map<String, String>): OrderBookIndexConfig {
            val values = mutableMapOf<String, String>()
            var index = 0
            while (index < args.size) {
                val key = args[index]
                require(key.startsWith("--")) { "expected --key at ${args[index]}" }
                require(index + 1 < args.size) { "missing value for $key" }
                values[key.removePrefix("--")] = args[index + 1]
                index += 2
            }
            fun value(key: String, default: String): String = values[key] ?: env[key.uppercase().replace('-', '_')] ?: default
            return OrderBookIndexConfig(
                dbUrl = value("db-url", env["DB_URL"] ?: "jdbc:postgresql://localhost:5432/hanjjak"),
                dbUser = value("db-user", env["DB_USER"] ?: "hanjjak"),
                dbPassword = value("db-password", env["DB_PASSWORD"] ?: "local-only"),
                accounts = value("seed-accounts", "5000").toInt(),
                instruments = value("seed-instruments", "300").toInt(),
                activeOrders = value("seed-active-orders", "60000").toInt(),
                closedOrders = value("seed-closed-orders", "400000").toInt(),
                trades = value("seed-trades", "800000").toInt(),
                expiredActiveRatio = value("seed-expired-active-ratio", "0.005").toDouble(),
                seed = value("seed", "20260917").toLong(),
                label = value("label", "baseline"),
                repetitions = value("repetitions", "25").toInt(),
                writeSamples = value("write-samples", "2000").toInt(),
                readConcurrency = value("read-concurrency", "16").toInt(),
                readSeconds = value("read-seconds", "20").toLong(),
                outputPath = value("output-path", ""),
            )
        }
    }

    fun connect(): Connection = DriverManager.getConnection(dbUrl, dbUser, dbPassword)
}

internal const val ORDER_BOOK_FIXTURE_PREFIX = "orderbook-index-bench"
private const val SECONDS_PER_DAY = 86_400L

/** Instruments are weighted so the first ones carry most of the book, as live trading concentrates on few items. */
private fun instrumentWeights(count: Int): DoubleArray {
    val weights = DoubleArray(count) { 1.0 / (it + 1.0) }
    val total = weights.sum()
    for (i in weights.indices) weights[i] /= total
    return weights
}

private fun allocate(total: Int, weights: DoubleArray): IntArray {
    val counts = IntArray(weights.size) { (total * weights[it]).toInt() }
    var remainder = total - counts.sum()
    var cursor = 0
    while (remainder > 0) {
        counts[cursor % counts.size]++
        cursor++
        remainder--
    }
    return counts
}

private fun midPrice(instrumentIndex: Int): Long = 50L + (instrumentIndex * 137L) % 40_000L

private fun Instant.copyText(): String = this.toString()

private fun copyInto(connection: Connection, table: String, columns: String, rows: StringBuilder) {
    if (rows.isEmpty()) return
    val copyManager = connection.unwrap(PGConnection::class.java).copyAPI
    copyManager.copyIn(
        "copy $table($columns) from stdin with (format csv)",
        ByteArrayInputStream(rows.toString().toByteArray(StandardCharsets.UTF_8)),
    )
    rows.setLength(0)
}

internal fun seedOrderBookFixture(config: OrderBookIndexConfig) {
    val random = Random(config.seed)
    val now = Instant.now()
    config.connect().use { connection ->
        connection.autoCommit = false
        connection.createStatement().use { statement ->
            statement.execute("set synchronous_commit = off")
        }
        clearFixture(connection)

        val accountIds = (0 until config.accounts).map { stableUuid("$ORDER_BOOK_FIXTURE_PREFIX:account:$it") }
        val accountRows = StringBuilder()
        accountIds.forEachIndexed { index, id ->
            val createdAt = now.minus(120L * SECONDS_PER_DAY - index.toLong(), ChronoUnit.SECONDS)
            accountRows.append(id).append(',')
                .append("$ORDER_BOOK_FIXTURE_PREFIX-$index@benchmark.local").append(',')
                .append(",1,").append(createdAt.copyText()).append(",,,false\n")
        }
        copyInto(connection, "account", "id,email,password_hash,state_version,created_at,deleted_at,login_email,game_master", accountRows)

        val instrumentIds = (0 until config.instruments).map { stableUuid("$ORDER_BOOK_FIXTURE_PREFIX:instrument:$it") }
        val instrumentRows = StringBuilder()
        instrumentIds.forEachIndexed { index, id ->
            val itemId = "${ORDER_BOOK_FIXTURE_PREFIX.uppercase().replace('-', '_')}_${index.toString().padStart(4, '0')}"
            instrumentRows.append(id).append(',')
                .append(itemId).append(',')
                .append(itemId).append(',')
                .append("벤치 품목 $index").append(',')
                .append("MATERIAL").append(',')
                .append("{}").append(',')
                .append("ACTIVE").append(",1,")
                .append(now.copyText()).append(',').append(now.copyText()).append('\n')
        }
        copyInto(
            connection,
            "market_instrument",
            "instrument_id,canonical_key,item_id,display_name,category,attributes,status,revision,created_at,updated_at",
            instrumentRows,
        )
        connection.commit()

        val weights = instrumentWeights(config.instruments)
        val activePerInstrument = allocate(config.activeOrders, weights)
        val closedPerInstrument = allocate(config.closedOrders, weights)
        val tradesPerInstrument = allocate(config.trades, weights)

        val orderColumns = "order_id,account_id,instrument_id,side,time_in_force,initial_quantity,filled_quantity," +
            "remaining_quantity,limit_unit_price,reserved_rice,status,priority_at,created_at,updated_at,expires_at," +
            "display_name_snapshot,instance_ids"
        val orderRows = StringBuilder()
        var orderSequence = 0
        var expiredSeeded = 0
        val totalOrders = config.activeOrders + config.closedOrders
        // The order-registration transaction also writes market_order_mutation_history and reads it back for the
        // abuse-rate check, so the fixture has to remember who owns each order to rebuild that history.
        val orderAccountIndex = IntArray(totalOrders)
        val orderInstrumentIndex = IntArray(totalOrders)
        val orderCreatedEpoch = LongArray(totalOrders)
        val orderSideBuy = BooleanArray(totalOrders)

        fun appendOrder(
            instrumentIndex: Int,
            side: String,
            price: Long,
            initial: Long,
            filled: Long,
            remaining: Long,
            status: String,
            createdAt: Instant,
            expiresAt: Instant,
        ) {
            val sequence = orderSequence++
            val orderId = stableUuid("$ORDER_BOOK_FIXTURE_PREFIX:order:$sequence")
            val accountIndex = random.nextInt(accountIds.size)
            val accountId = accountIds[accountIndex]
            orderAccountIndex[sequence] = accountIndex
            orderInstrumentIndex[sequence] = instrumentIndex
            orderCreatedEpoch[sequence] = createdAt.epochSecond
            orderSideBuy[sequence] = side == "BUY"
            val reserved = if (side == "BUY") remaining * price else 0L
            orderRows.append(orderId).append(',').append(accountId).append(',').append(instrumentIds[instrumentIndex]).append(',')
                .append(side).append(",GTC,").append(initial).append(',').append(filled).append(',').append(remaining).append(',')
                .append(price).append(',').append(reserved).append(',').append(status).append(',')
                .append(createdAt.copyText()).append(',').append(createdAt.copyText()).append(',').append(createdAt.copyText()).append(',')
                .append(expiresAt.copyText()).append(',')
                .append("벤치 품목 $instrumentIndex").append(',').append("{}").append('\n')
        }

        for (instrumentIndex in 0 until config.instruments) {
            val mid = midPrice(instrumentIndex)
            val active = activePerInstrument[instrumentIndex]
            for (n in 0 until active) {
                val side = if (n % 2 == 0) "SELL" else "BUY"
                // Depth falls off away from the touch, so levels are drawn from a geometric-ish offset.
                val offset = (1 + (random.nextDouble() * random.nextDouble() * 400)).toLong()
                val price = if (side == "SELL") min(999_999L, mid + offset) else max(10L, mid - offset)
                val initial = 1L + random.nextInt(200)
                val filled = if (random.nextInt(10) == 0) initial / 2 else 0L
                val remaining = initial - filled
                val status = if (filled > 0) "PARTIALLY_FILLED" else "ACTIVE"
                val createdAt = now.minus(random.nextLong(1, 14 * SECONDS_PER_DAY), ChronoUnit.SECONDS)
                val expiresAt = if (random.nextDouble() < config.expiredActiveRatio) {
                    // The expiry scheduler runs continuously but is never exactly caught up, so keep a small backlog
                    // of rows that are still ACTIVE with a past expires_at. Everything else must expire in the future,
                    // otherwise the fixture would hand the order book a backlog the scheduler would never allow.
                    expiredSeeded++
                    now.minus(random.nextLong(1, 3600), ChronoUnit.SECONDS)
                } else {
                    now.plus(random.nextLong(60, 14 * SECONDS_PER_DAY), ChronoUnit.SECONDS)
                }
                appendOrder(instrumentIndex, side, price, initial, filled, remaining, status, createdAt, expiresAt)
                if (orderRows.length > 4_000_000) copyInto(connection, "market_order", orderColumns, orderRows)
            }
            val closed = closedPerInstrument[instrumentIndex]
            for (n in 0 until closed) {
                val side = if (n % 2 == 0) "SELL" else "BUY"
                val offset = (1 + (random.nextDouble() * random.nextDouble() * 400)).toLong()
                val price = if (side == "SELL") min(999_999L, mid + offset) else max(10L, mid - offset)
                val initial = 1L + random.nextInt(200)
                val status = when (random.nextInt(10)) {
                    in 0..5 -> "FILLED"
                    in 6..8 -> "CANCELLED"
                    else -> "EXPIRED"
                }
                val filled = if (status == "FILLED") initial else random.nextLong(0, initial)
                val createdAt = now.minus(random.nextLong(1, 90 * SECONDS_PER_DAY), ChronoUnit.SECONDS)
                appendOrder(instrumentIndex, side, price, initial, filled, 0L, status, createdAt, createdAt.plus(7L * SECONDS_PER_DAY, ChronoUnit.SECONDS))
                if (orderRows.length > 4_000_000) copyInto(connection, "market_order", orderColumns, orderRows)
            }
        }
        copyInto(connection, "market_order", orderColumns, orderRows)
        connection.commit()

        val mutationColumns = "mutation_id,account_id,instrument_id,order_id,side,mutation_type,command_id,created_at"
        val mutationRows = StringBuilder()
        var mutationSequence = 0
        for (sequence in 0 until orderSequence) {
            val createdAt = Instant.ofEpochSecond(orderCreatedEpoch[sequence])
            val orderId = stableUuid("$ORDER_BOOK_FIXTURE_PREFIX:order:$sequence")
            val side = if (orderSideBuy[sequence]) "BUY" else "SELL"
            // Every order is created once; roughly a third of them are also amended or cancelled later.
            val mutations = if (random.nextInt(3) == 0) listOf("CREATE", if (random.nextBoolean()) "UPDATE" else "CANCEL") else listOf("CREATE")
            mutations.forEachIndexed { offset, type ->
                val id = stableUuid("$ORDER_BOOK_FIXTURE_PREFIX:mutation:${mutationSequence++}")
                mutationRows.append(id).append(',').append(accountIds[orderAccountIndex[sequence]]).append(',')
                    .append(instrumentIds[orderInstrumentIndex[sequence]]).append(',').append(orderId).append(',')
                    .append(side).append(',').append(type).append(',').append(UUID.randomUUID()).append(',')
                    .append(createdAt.plusSeconds(offset * 30L).copyText()).append('\n')
            }
            if (mutationRows.length > 4_000_000) copyInto(connection, "market_order_mutation_history", mutationColumns, mutationRows)
        }
        copyInto(connection, "market_order_mutation_history", mutationColumns, mutationRows)
        connection.commit()

        val tradeColumns = "trade_id,listing_id,buyer_account_id,seller_account_id,item_id,quantity,unit_price," +
            "total_price,fee,settlement_amount,filled_at,buy_order_id,maker_order_id,taker_order_id,instrument_id,display_name_snapshot"
        val tradeRows = StringBuilder()
        var tradeSequence = 0
        for (instrumentIndex in 0 until config.instruments) {
            val mid = midPrice(instrumentIndex)
            val itemId = "${ORDER_BOOK_FIXTURE_PREFIX.uppercase().replace('-', '_')}_${instrumentIndex.toString().padStart(4, '0')}"
            for (n in 0 until tradesPerInstrument[instrumentIndex]) {
                val tradeId = stableUuid("$ORDER_BOOK_FIXTURE_PREFIX:trade:${tradeSequence++}")
                val buyer = accountIds[random.nextInt(accountIds.size)]
                val seller = accountIds[random.nextInt(accountIds.size)]
                val quantity = 1L + random.nextInt(50)
                val price = max(10L, mid + random.nextLong(-30, 30))
                val total = quantity * price
                val fee = total / 100
                val filledAt = now.minus(random.nextLong(1, 90 * SECONDS_PER_DAY), ChronoUnit.SECONDS)
                tradeRows.append(tradeId).append(",,").append(buyer).append(',').append(seller).append(',').append(itemId).append(',')
                    .append(quantity).append(',').append(price).append(',').append(total).append(',').append(fee).append(',')
                    .append(total - fee).append(',').append(filledAt.copyText()).append(",,,,")
                    .append(instrumentIds[instrumentIndex]).append(',').append("벤치 품목 $instrumentIndex").append('\n')
                if (tradeRows.length > 4_000_000) copyInto(connection, "market_trade", tradeColumns, tradeRows)
            }
        }
        copyInto(connection, "market_trade", tradeColumns, tradeRows)
        connection.commit()

        connection.autoCommit = true
        connection.createStatement().use { statement ->
            statement.execute("analyze account")
            statement.execute("analyze market_instrument")
            statement.execute("analyze market_order")
            statement.execute("analyze market_order_mutation_history")
            statement.execute("analyze market_trade")
        }
        println(
            "order book fixture seeded accounts=${config.accounts} instruments=${config.instruments} " +
                "orders=$orderSequence mutations=$mutationSequence trades=$tradeSequence expiredActive=$expiredSeeded",
        )
    }
}

/**
 * Row-by-row deletion is not an option here: `market_trade.maker_order_id` and `taker_order_id` are unindexed
 * foreign keys, so every deleted order triggers a sequential scan of the trade table. Truncating the market tables
 * as a group is the only teardown that finishes, and the fixture refuses to run when the database holds rows it did
 * not create, so it can never truncate somebody's real data.
 */
private fun clearFixture(connection: Connection) {
    val foreignRows = connection.createStatement().use { statement ->
        statement.executeQuery(
            """
            select (select count(*) from market_order where display_name_snapshot not like '벤치 품목 %' and display_name_snapshot<>'벤치 쓰기측정')
                 + (select count(*) from market_trade where display_name_snapshot is distinct from null and display_name_snapshot not like '벤치 품목 %')
                 + (select count(*) from market_instrument where canonical_key not like '${ORDER_BOOK_FIXTURE_PREFIX.uppercase().replace('-', '_')}%')
            """.trimIndent(),
        ).use { rows -> rows.next(); rows.getLong(1) }
    }
    check(foreignRows == 0L) {
        "refusing to seed: the market tables hold $foreignRows rows this fixture did not create. " +
            "Point --db-url at a throwaway benchmark database."
    }
    val group = referencingClosure(connection, setOf("market_instrument", "market_order", "market_trade"))
    connection.createStatement().use { statement ->
        println("clearing fixture tables: ${group.sorted().joinToString(",")}")
        statement.execute("truncate ${group.joinToString(",")}")
        statement.execute("delete from account where email like '$ORDER_BOOK_FIXTURE_PREFIX-%@benchmark.local'")
    }
    connection.commit()
}

/** TRUNCATE refuses to leave a dangling reference, so the target set has to be closed over every referencing table. */
private fun referencingClosure(connection: Connection, seeds: Set<String>): Set<String> {
    val closure = seeds.toMutableSet()
    var frontier = seeds
    while (frontier.isNotEmpty()) {
        val next = mutableSetOf<String>()
        connection.prepareStatement(
            """
            select distinct c.conrelid::regclass::text
            from pg_constraint c
            where c.contype='f' and c.confrelid::regclass::text = any(?)
            """.trimIndent(),
        ).use { statement ->
            statement.setArray(1, connection.createArrayOf("text", frontier.toTypedArray()))
            statement.executeQuery().use { rows ->
                while (rows.next()) {
                    val table = rows.getString(1)
                    if (closure.add(table)) next += table
                }
            }
        }
        frontier = next
    }
    return closure
}

internal data class PlanProbe(val name: String, val sql: String)

/** The probe SQL mirrors [com.hanjjak.market.infrastructure.JdbcOrderBookRepository] one to one. */
internal fun orderBookProbes(hotInstrument: UUID, coldInstrument: UUID, account: UUID, busyAccount: UUID, price: Long, now: Instant): List<PlanProbe> {
    val nowLiteral = "timestamptz '${now}'"
    fun candidates(instrument: UUID, ordering: String, priceClause: String, side: String, quantity: Long) = """
        with ranked as (
          select order_id,
            sum(remaining_quantity) over (order by $ordering rows between unbounded preceding and current row) - remaining_quantity as quantity_before
          from market_order
          where instrument_id='$instrument' and account_id<>'$account' and side='$side'
            and status in ('ACTIVE','PARTIALLY_FILLED') and $priceClause
            and (expires_at is null or expires_at>$nowLiteral)
        )
        select o.*
        from market_order o join ranked r using(order_id)
        where r.quantity_before<$quantity
        order by $ordering
    """.trimIndent()
    return listOf(
        PlanProbe(
            "match-candidates-buy-taker-hot",
            candidates(hotInstrument, "limit_unit_price,priority_at,order_id", "limit_unit_price<=${price + 200}", "SELL", 500),
        ),
        PlanProbe(
            "match-candidates-sell-taker-hot",
            candidates(hotInstrument, "limit_unit_price desc,priority_at,order_id", "limit_unit_price>=${max(10L, price - 200)}", "BUY", 500),
        ),
        PlanProbe(
            "match-candidates-buy-taker-cold",
            candidates(coldInstrument, "limit_unit_price,priority_at,order_id", "limit_unit_price<=999999", "SELL", 500),
        ),
        PlanProbe(
            "depth-sell-hot",
            """
            select limit_unit_price,sum(remaining_quantity) total_quantity,
              coalesce(sum(remaining_quantity) filter(where account_id='$account'),0) my_quantity
            from market_order where instrument_id='$hotInstrument' and side='SELL' and status in ('ACTIVE','PARTIALLY_FILLED') and expires_at>$nowLiteral
            group by limit_unit_price order by limit_unit_price limit 20
            """.trimIndent(),
        ),
        PlanProbe(
            "price-levels-buy-hot",
            """
            with grouped as (
              select limit_unit_price as unit_price,
                sum(remaining_quantity) as total_quantity,
                coalesce(sum(remaining_quantity) filter (where account_id='$account'),0) as my_quantity
              from market_order
              where instrument_id='$hotInstrument' and side='BUY'
                and status in ('ACTIVE','PARTIALLY_FILLED') and expires_at>$nowLiteral
              group by limit_unit_price
            ), accumulated as (
              select unit_price,total_quantity,my_quantity,
                sum(total_quantity) over (order by unit_price desc rows between unbounded preceding and current row) as cumulative_quantity,
                sum(total_quantity - my_quantity) over (order by unit_price desc rows between unbounded preceding and current row) as cumulative_other_quantity
              from grouped
            )
            select unit_price,total_quantity,cumulative_quantity,my_quantity,cumulative_other_quantity
            from accumulated
            where 1=1
            order by unit_price desc
            limit 50
            """.trimIndent(),
        ),
        PlanProbe(
            "price-level-count-buy-hot",
            "select count(distinct limit_unit_price) from market_order where instrument_id='$hotInstrument' and side='BUY' and status in ('ACTIVE','PARTIALLY_FILLED') and expires_at>$nowLiteral",
        ),
        PlanProbe(
            "recent-trades-hot",
            "select trade_id,quantity,unit_price,total_price,filled_at from market_trade where instrument_id='$hotInstrument' order by filled_at desc,trade_id desc limit 50",
        ),
        PlanProbe(
            "my-orders-active",
            """
            select o.*,i.item_id,i.display_name from market_order o join market_instrument i using(instrument_id)
            where o.account_id='$busyAccount' and o.status in ('ACTIVE','PARTIALLY_FILLED')
            order by o.created_at desc,o.order_id desc limit 20
            """.trimIndent(),
        ),
        PlanProbe(
            "my-orders-closed",
            """
            select o.*,i.item_id,i.display_name from market_order o join market_instrument i using(instrument_id)
            where o.account_id='$busyAccount' and o.status in ('FILLED','CANCELLED','EXPIRED')
            order by o.created_at desc,o.order_id desc limit 20
            """.trimIndent(),
        ),
        PlanProbe(
            "my-orders-count-closed",
            "select count(*) from market_order o where o.account_id='$busyAccount' and o.status in ('FILLED','CANCELLED','EXPIRED')",
        ),
        PlanProbe(
            "order-mutation-rate-check",
            "select count(*) from market_order_mutation_history where account_id='$busyAccount' and created_at>$nowLiteral - interval '1 hour'",
        ),
        PlanProbe(
            "expired-instrument-ids",
            """
            select distinct instrument_id
            from (
              select instrument_id
              from market_order
              where status in ('ACTIVE','PARTIALLY_FILLED') and expires_at<=$nowLiteral
              order by expires_at,order_id
              limit 200
            ) expired
            order by instrument_id
            """.trimIndent(),
        ),
        PlanProbe(
            "lock-expired-orders-hot",
            """
            select *
            from market_order
            where instrument_id='$hotInstrument' and status in ('ACTIVE','PARTIALLY_FILLED') and expires_at<=$nowLiteral
            order by expires_at,order_id
            limit 200
            """.trimIndent(),
        ),
    )
}

internal data class ProbeResult(val name: String, val plan: String, val timingsMs: List<Double>) {
    val p50: Double get() = percentile(50.0)
    val p95: Double get() = percentile(95.0)
    private fun percentile(p: Double): Double {
        if (timingsMs.isEmpty()) return 0.0
        val sorted = timingsMs.sorted()
        val rank = Math.ceil(p / 100.0 * sorted.size).toInt().coerceIn(1, sorted.size)
        return sorted[rank - 1]
    }
}

internal fun runOrderBookIndexMeasurement(config: OrderBookIndexConfig) {
    config.connect().use { connection ->
        connection.autoCommit = true
        val hot = fixtureInstrument(connection, 0)
        val cold = fixtureInstrument(connection, config.instruments / 2)
        val account = fixtureAccount(connection)
        val busyAccount = busiestAccount(connection)
        val price = midPrice(0)
        val now = Instant.now()

        val probes = orderBookProbes(hot, cold, account, busyAccount, price, now)
        fun run(): List<ProbeResult> = probes.map { probe ->
            // Warm the shared buffers first so the comparison measures plan shape, not cold cache luck.
            repeat(3) { connection.createStatement().use { it.execute(probe.sql) } }
            val timings = (1..config.repetitions).map {
                val started = System.nanoTime()
                connection.createStatement().use { statement -> statement.execute(probe.sql) }
                (System.nanoTime() - started) / 1_000_000.0
            }
            val plan = connection.createStatement().use { statement ->
                statement.executeQuery("explain (analyze, buffers) ${probe.sql}").use { rows ->
                    buildString { while (rows.next()) appendLine(rows.getString(1)) }
                }
            }
            ProbeResult(probe.name, plan.trimEnd(), timings)
        }

        val results = run()
        val writes = measureWriteCost(connection, hot, account, config.writeSamples)
        // A covering index only pays off while the visibility map says the pages are all-visible. Re-running the
        // probes straight after a write burst, with no VACUUM in between, is the state the live order book is
        // actually in, so an index-only plan that survives only on a freshly vacuumed table has to show up here.
        val postWriteResults = run()
        // Only the hot-instrument order book reads are worth loading: they are the ones the covering payload changes.
        val loadProbes = probes.filter { it.name.endsWith("-hot") && !it.name.startsWith("lock-expired") }
        val readLoad = measureReadLoad(config, loadProbes, config.readConcurrency, config.readSeconds)
        val sizes = indexSizes(connection)

        val report = buildString {
            appendLine("# order book index measurement — label=${config.label}")
            appendLine("captured_at=${Instant.now()}")
            appendLine("hot_instrument=$hot cold_instrument=$cold probe_account=$account busy_account=$busyAccount")
            appendLine("repetitions=${config.repetitions} write_samples=${config.writeSamples}")
            appendLine()
            appendLine("## table and index sizes")
            sizes.forEach { appendLine(it) }
            appendLine()
            appendLine("## hot order book read load (${config.readConcurrency} connections, ${config.readSeconds}s)")
            appendLine("probes=${loadProbes.joinToString(",") { it.name }}")
            appendLine(
                "requests=${readLoad.requests} throughput=${"%.1f".format(readLoad.throughput)}req/s " +
                    "p50=${"%.3f".format(readLoad.p50)}ms p95=${"%.3f".format(readLoad.p95)}ms p99=${"%.3f".format(readLoad.p99)}ms",
            )
            appendLine()
            appendLine("## write cost (ms)")
            writes.forEach { (name, stats) -> appendLine("$name p50=${"%.3f".format(stats.first)} p95=${"%.3f".format(stats.second)}") }
            appendLine()
            appendLine("## read probes")
            results.forEach { result ->
                appendLine("### ${result.name}")
                appendLine("p50=${"%.3f".format(result.p50)}ms p95=${"%.3f".format(result.p95)}ms")
                appendLine("```")
                appendLine(result.plan)
                appendLine("```")
                appendLine()
            }
            appendLine("## read probes after a ${config.writeSamples}-order write burst (no VACUUM)")
            postWriteResults.forEach { result ->
                appendLine("### post-write ${result.name}")
                appendLine("p50=${"%.3f".format(result.p50)}ms p95=${"%.3f".format(result.p95)}ms")
                appendLine("```")
                appendLine(result.plan)
                appendLine("```")
                appendLine()
            }
        }
        print(report)
        if (config.outputPath.isNotBlank()) {
            val path = Path.of(config.outputPath)
            path.parent?.let(Files::createDirectories)
            Files.writeString(path, report, StandardCharsets.UTF_8)
            println("report written to ${path.toAbsolutePath()}")
        }
    }
}

private fun fixtureInstrument(connection: Connection, index: Int): UUID =
    stableUuid("$ORDER_BOOK_FIXTURE_PREFIX:instrument:$index")

private fun fixtureAccount(connection: Connection): UUID = stableUuid("$ORDER_BOOK_FIXTURE_PREFIX:account:0")

/**
 * The write-cost probe leaves its orders behind, all owned by the same account. Those rows must be excluded or the
 * "my orders" probe silently retargets itself at a synthetic account that grows with every run, which makes the
 * before/after comparison meaningless.
 */
private fun busiestAccount(connection: Connection): UUID =
    connection.createStatement().use { statement ->
        statement.executeQuery(
            "select account_id from market_order where display_name_snapshot<>'벤치 쓰기측정' " +
                "group by account_id order by count(*) desc, account_id limit 1",
        ).use { rows ->
            check(rows.next()) { "no seeded orders found; run --mode order-book-seed first" }
            rows.getObject(1, UUID::class.java)
        }
    }

private fun measureWriteCost(connection: Connection, instrumentId: UUID, accountId: UUID, samples: Int): List<Pair<String, Pair<Double, Double>>> {
    fun percentiles(values: List<Double>): Pair<Double, Double> {
        val sorted = values.sorted()
        fun at(p: Double) = sorted[Math.ceil(p / 100.0 * sorted.size).toInt().coerceIn(1, sorted.size) - 1]
        return at(50.0) to at(95.0)
    }

    val createdIds = mutableListOf<UUID>()
    val now = Instant.now()
    val insertTimings = mutableListOf<Double>()
    connection.prepareStatement(
        """
        insert into market_order(order_id,account_id,instrument_id,side,time_in_force,initial_quantity,filled_quantity,
          remaining_quantity,limit_unit_price,reserved_rice,status,priority_at,created_at,updated_at,expires_at,
          display_name_snapshot,instance_ids)
        values (?,?,?,'SELL','GTC',?,0,?,?,0,'ACTIVE',?,?,?,?,'벤치 쓰기측정','{}')
        """.trimIndent(),
    ).use { statement ->
        repeat(samples) { n ->
            val orderId = UUID.randomUUID()
            val quantity = 10L
            val ts = java.sql.Timestamp.from(now.plusSeconds(n.toLong()))
            statement.setObject(1, orderId)
            statement.setObject(2, accountId)
            statement.setObject(3, instrumentId)
            statement.setLong(4, quantity)
            statement.setLong(5, quantity)
            statement.setLong(6, midPrice(0) + 5)
            statement.setTimestamp(7, ts)
            statement.setTimestamp(8, ts)
            statement.setTimestamp(9, ts)
            statement.setTimestamp(10, java.sql.Timestamp.from(now.plus(7, ChronoUnit.DAYS)))
            val started = System.nanoTime()
            statement.executeUpdate()
            insertTimings += (System.nanoTime() - started) / 1_000_000.0
            createdIds += orderId
        }
    }

    val fillTimings = mutableListOf<Double>()
    connection.prepareStatement(
        "update market_order set filled_quantity=5,remaining_quantity=5,status='PARTIALLY_FILLED',updated_at=now() where order_id=?",
    ).use { statement ->
        createdIds.forEach { id ->
            statement.setObject(1, id)
            val started = System.nanoTime()
            statement.executeUpdate()
            fillTimings += (System.nanoTime() - started) / 1_000_000.0
        }
    }

    val cancelTimings = mutableListOf<Double>()
    connection.prepareStatement(
        "update market_order set remaining_quantity=0,status='PARTIALLY_FILLED_CLOSED',updated_at=now() where order_id=?",
    ).use { statement ->
        createdIds.forEach { id ->
            statement.setObject(1, id)
            val started = System.nanoTime()
            statement.executeUpdate()
            cancelTimings += (System.nanoTime() - started) / 1_000_000.0
        }
    }

    // The probe orders are deliberately left behind. Deleting them would fire the market_trade foreign key trigger
    // once per row against unindexed maker_order_id/taker_order_id columns, which sequentially scans a 155MB table
    // per deleted order. They end in PARTIALLY_FILLED_CLOSED, so they sit outside every partial index the order book
    // reads and cannot distort the book; re-seed the fixture for a clean row count.
    return listOf(
        "order-insert" to percentiles(insertTimings),
        "order-fill-update" to percentiles(fillTimings),
        "order-cancel-update" to percentiles(cancelTimings),
    )
}

internal data class ReadLoadResult(val requests: Long, val seconds: Double, val p50: Double, val p95: Double, val p99: Double) {
    val throughput: Double get() = requests / seconds
}

/**
 * Buffer counts from a single-connection EXPLAIN say how much work a plan does, not whether that work is the thing
 * users wait on. The order book is read by every trader at once, so the deciding number is what the matching and
 * book-depth reads cost when [concurrency] connections run them together.
 */
private fun measureReadLoad(config: OrderBookIndexConfig, probes: List<PlanProbe>, concurrency: Int, seconds: Long): ReadLoadResult {
    val deadline = System.nanoTime() + seconds * 1_000_000_000L
    val timings = java.util.Collections.synchronizedList(mutableListOf<Double>())
    val pool = java.util.concurrent.Executors.newFixedThreadPool(concurrency)
    try {
        val started = System.nanoTime()
        (1..concurrency).map { worker ->
            pool.submit {
                config.connect().use { connection ->
                    connection.autoCommit = true
                    var cursor = worker
                    val local = mutableListOf<Double>()
                    while (System.nanoTime() < deadline) {
                        val probe = probes[cursor++ % probes.size]
                        val begin = System.nanoTime()
                        connection.createStatement().use { statement -> statement.execute(probe.sql) }
                        local += (System.nanoTime() - begin) / 1_000_000.0
                    }
                    timings.addAll(local)
                }
            }
        }.forEach { it.get() }
        val elapsed = (System.nanoTime() - started) / 1_000_000_000.0
        val sorted = timings.sorted()
        fun at(p: Double) = sorted[Math.ceil(p / 100.0 * sorted.size).toInt().coerceIn(1, sorted.size) - 1]
        return ReadLoadResult(sorted.size.toLong(), elapsed, at(50.0), at(95.0), at(99.0))
    } finally {
        pool.shutdownNow()
    }
}

private fun indexSizes(connection: Connection): List<String> =
    connection.createStatement().use { statement ->
        statement.executeQuery(
            """
            select c.relname, pg_size_pretty(pg_relation_size(c.oid)) size, pg_relation_size(c.oid) bytes
            from pg_class c join pg_namespace n on n.oid=c.relnamespace
            where n.nspname='public' and (c.relname like 'market_order%' or c.relname like 'market_trade%')
              and c.relkind in ('r','i')
            order by c.relname
            """.trimIndent(),
        ).use { rows ->
            buildList { while (rows.next()) add("${rows.getString(1)} ${rows.getString(2)} (${rows.getLong(3)} bytes)") }
        }
    }
