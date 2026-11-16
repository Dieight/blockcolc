package com.blockcolc.storage.android

import android.content.Context
import android.database.DatabaseErrorHandler
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteBlobTooBigException
import android.database.sqlite.SQLiteOpenHelper
import com.blockcolc.storage.SqlDatabase
import com.blockcolc.storage.SqlSession
import com.blockcolc.storage.SqlReadStamp
import com.blockcolc.storage.StateSchema
import com.blockcolc.storage.StorageCorruption

/** App-private SQLite; no access to the formal App's database, files or ContentProviders. */
class AndroidStateDatabase(context: Context, name: String = "p2-state.db") : SqlDatabase {
    private var rollbackVersion=0L
    private val helper = object : SQLiteOpenHelper(context.applicationContext, name, null, StateSchema.VERSION,
        DatabaseErrorHandler { throw StorageCorruption("SQLite corruption: retain the database for explicit recovery") }) {
        override fun onConfigure(db: SQLiteDatabase) { db.setForeignKeyConstraintsEnabled(true) }
        override fun onCreate(db: SQLiteDatabase) { StateSchema.create(Session(db)) }
        override fun onUpgrade(db: SQLiteDatabase, old: Int, new: Int) { StateSchema.upgrade(Session(db), old, new) }
        override fun onDowngrade(db: SQLiteDatabase, old: Int, new: Int) { throw StorageCorruption("Unsupported SQLite downgrade $old -> $new; data retained") }
    }.also { it.setWriteAheadLoggingEnabled(true) }
    // SQLiteOpenHelper is lazy; construction itself does not perform disk IO.
    @Synchronized override fun <T> transaction(block: (SqlSession) -> T): T {
        val db = helper.writableDatabase
        db.beginTransactionNonExclusive()
        var successful=false
        try { val result = block(Session(db){rollbackVersion}); db.setTransactionSuccessful(); successful=true; return result }
        finally {
            try { db.endTransaction() }catch(error:Throwable){rollbackVersion++;throw error}
            finally {if(!successful)rollbackVersion++}
        }
    }
    @Synchronized override fun close() { helper.close() }
    private class Session(val db: SQLiteDatabase,val rolledBack:()->Long={0L}) : SqlSession {
        override fun readStamp():SqlReadStamp {
            check(db.inTransaction())
            // TEMP belongs to the pinned physical connection, not the helper
            // or the database filename. A pool reconnect gets a new identity.
            db.execSQL("CREATE TEMP TABLE IF NOT EXISTS blockcolc_read_connection (nonce TEXT NOT NULL)")
            db.execSQL("INSERT INTO temp.blockcolc_read_connection(nonce) SELECT ? WHERE NOT EXISTS (SELECT 1 FROM temp.blockcolc_read_connection)",arrayOf(java.util.UUID.randomUUID().toString()))
            fun number(sql:String)=db.compileStatement(sql).use{it.simpleQueryForLong()}
            val nonce=db.compileStatement("SELECT nonce FROM temp.blockcolc_read_connection").use{it.simpleQueryForString()}
            return SqlReadStamp(nonce,number("PRAGMA main.data_version"),number("SELECT total_changes()"),
                number("PRAGMA main.schema_version"),rolledBack(),number("PRAGMA temp.schema_version"))
        }
        override fun execute(sql: String, args: List<Any?>): Int {
            db.compileStatement(sql).use { statement ->
                args.forEachIndexed { i, value -> when (value) {
                    null -> statement.bindNull(i + 1)
                    is String -> statement.bindString(i + 1, value)
                    is Byte, is Short, is Int, is Long -> statement.bindLong(i + 1, (value as Number).toLong())
                    is Float, is Double -> statement.bindDouble(i + 1, (value as Number).toDouble())
                    else -> error("Unsupported SQL argument")
                } }
                statement.execute()
            }
            return if (sql.trimStart().startsWith("CREATE", true)) 0 else db.compileStatement("SELECT changes()").use { it.simpleQueryForLong().toInt() }
        }
        override fun largeText(sql:String,args:List<Any?>):String {
            require(sql.trimStart().startsWith("SELECT",true))
            val inner=sql.trim().removeSuffix(";");val bindings=args.map{it?.toString()}.toTypedArray()
            val names=db.rawQuery(sql,bindings).use{it.columnNames.toList()};require(names.size==1)
            fun statement(query:String)=db.compileStatement(query).also{stmt->bindings.forEachIndexed{i,value->if(value==null)stmt.bindNull(i+1)else stmt.bindString(i+1,value)}}
            val quoted="\""+names.single().replace("\"","\"\"")+"\""
            check(statement("SELECT COUNT(*) FROM ($inner)").use{it.simpleQueryForLong()}==1L){"Expected exactly one text cell"}
            check(statement("SELECT typeof($quoted) FROM ($inner)").use{it.simpleQueryForString()}=="text"){"Expected non-null SQLite text"}
            return statement(sql).use{checkNotNull(it.simpleQueryForString())}
        }
        override fun blueprintBody(sha:String):String {
            // The schema guarantees at most one row. Check the actual SQLite
            // type and read the full body in one scalar statement.
            return db.compileStatement("SELECT CASE WHEN typeof(canonical)='text' THEN canonical END FROM blueprint_assets WHERE sha=?").use{
                it.bindString(1,sha)
                checkNotNull(it.simpleQueryForString()){"Invalid blueprint text"}
            }
        }
        override fun largeTextRows(sql:String,args:List<Any?>):List<List<String>> {
            require(sql.trimStart().startsWith("SELECT",true))
            val inner=sql.trim().removeSuffix(";");val bindings=args.map{it?.toString()}.toTypedArray()
            // Reading column names does not fill a CursorWindow. The large
            // cells themselves use scalar statements in this same transaction.
            val names=db.rawQuery(sql,bindings).use{it.columnNames.toList()}
            require(names.isNotEmpty()&&names.toSet().size==names.size)
            fun statement(query:String)=db.compileStatement(query).also{stmt->bindings.forEachIndexed{i,value->if(value==null)stmt.bindNull(i+1)else stmt.bindString(i+1,value)}}
            require(names.size<=32)
            val quoted=names.map{"\""+it.replace("\"","\"\"")+"\""}
            val limit=262144/names.size
            val bounded=quoted.joinToString(","){"CASE WHEN length(CAST($it AS BLOB))>$limit THEN NULL ELSE $it END AS $it"}
            // Batch ordinary cells; only oversized cells use a scalar read.
            // This avoids thousands of OFFSET statements for small history
            // blocks while keeping each CursorWindow row below 256 KiB.
            return db.rawQuery("SELECT $bounded FROM ($inner)",bindings).use{cursor->buildList{
                var row=0
                while(cursor.moveToNext()){
                    add(quoted.indices.map{i->if(!cursor.isNull(i)){
                        check(cursor.getType(i)==Cursor.FIELD_TYPE_STRING){"Expected non-null SQLite text"};cursor.getString(i)
                    }else{
                        check(statement("SELECT typeof(${quoted[i]}) FROM ($inner) LIMIT 1 OFFSET $row").use{it.simpleQueryForString()}=="text"){"Expected non-null SQLite text"}
                        statement("SELECT ${quoted[i]} FROM ($inner) LIMIT 1 OFFSET $row").use{checkNotNull(it.simpleQueryForString())}
                    }})
                    row++
                }
            }}
        }
        override fun query(sql: String, args: List<Any?>): List<List<Any?>> {
            val bindings=args.map { it?.toString() }.toTypedArray()
            return db.rawQuery(sql,bindings).use { cursor ->
                try{buildList { while (cursor.moveToNext()) add((0 until cursor.columnCount).map { i -> when (cursor.getType(i)) {
                    Cursor.FIELD_TYPE_NULL -> null; Cursor.FIELD_TYPE_INTEGER -> cursor.getLong(i)
                    Cursor.FIELD_TYPE_FLOAT -> cursor.getDouble(i); Cursor.FIELD_TYPE_STRING -> cursor.getString(i)
                    else -> error("Unexpected SQLite blob")
                } }) }}catch(error:SQLiteBlobTooBigException){
                    // A blueprint or merged-root manifest can exceed the OS
                    // CursorWindow even when well inside our archive budget.
                    // Scalar SQLiteStatement reads do not use that row window.
                    // Keep this on the same enclosing transaction/snapshot;
                    // do not raise a global cursor/memory limit or truncate it.
                    require(sql.trimStart().startsWith("SELECT",true))
                    val names=cursor.columnNames.toList();require(names.toSet().size==names.size)
                    val inner=sql.trim().removeSuffix(";")
                    fun statement(query:String)=db.compileStatement(query).also{stmt->bindings.forEachIndexed{i,value->if(value==null)stmt.bindNull(i+1)else stmt.bindString(i+1,value)}}
                    val count=statement("SELECT COUNT(*) FROM ($inner)").use{it.simpleQueryForLong()}
                    require(count in 0..Int.MAX_VALUE.toLong())
                    List(count.toInt()){row->names.map{name->
                        val quoted="\""+name.replace("\"","\"\"")+"\""
                        val suffix=" FROM ($inner) LIMIT 1 OFFSET $row"
                        when(statement("SELECT typeof($quoted)"+suffix).use{it.simpleQueryForString()}){
                            "null"->null
                            "text"->statement("SELECT $quoted"+suffix).use{it.simpleQueryForString()}
                            "integer"->statement("SELECT $quoted"+suffix).use{it.simpleQueryForLong()}
                            "real"->db.rawQuery("SELECT $quoted"+suffix,bindings).use{single->check(single.moveToFirst());single.getDouble(0)}
                            else->error("Unexpected SQLite blob")
                        }
                    }}
                }
            }
        }
    }
}
