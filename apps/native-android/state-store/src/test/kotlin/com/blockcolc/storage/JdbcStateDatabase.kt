package com.blockcolc.storage

import java.nio.file.Path
import java.sql.Connection
import java.sql.DriverManager

/** Actual SQLite, not a map pretending to offer transaction/locking behavior. */
internal class JdbcStateDatabase(path: Path, create: Boolean = true) : SqlDatabase {
    private val connection: Connection = DriverManager.getConnection("jdbc:sqlite:$path")
    init {
        connection.createStatement().use { it.execute("PRAGMA journal_mode=WAL"); it.execute("PRAGMA busy_timeout=10000"); it.execute("PRAGMA foreign_keys=ON") }
        if (create) transaction { StateSchema.create(it) }
    }
    @Synchronized override fun <T> transaction(block: (SqlSession) -> T): T {
        connection.createStatement().use { it.execute("BEGIN IMMEDIATE") }
        try { val result = block(Session(connection)); connection.createStatement().use { it.execute("COMMIT") }; return result }
        catch (e: Throwable) { connection.createStatement().use { it.execute("ROLLBACK") }; throw e }
    }
    override fun close() { connection.close() }
    private class Session(val connection: Connection) : SqlSession {
        override fun execute(sql: String, args: List<Any?>): Int = connection.prepareStatement(sql).use { s -> args.forEachIndexed { i, v -> s.setObject(i + 1, v) }; s.executeUpdate() }
        override fun query(sql: String, args: List<Any?>): List<List<Any?>> = connection.prepareStatement(sql).use { s ->
            args.forEachIndexed { i, v -> s.setObject(i + 1, v) }; s.executeQuery().use { rows -> buildList {
                while (rows.next()) add((1..rows.metaData.columnCount).map { rows.getObject(it) })
            } }
        }
    }
}
