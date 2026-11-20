package com.blockcolc.preview
import com.blockcolc.storage.SqlDatabase
import com.blockcolc.storage.SqlSession
/** Inert port preserving shared call sites. Diagnostic implementation is selected explicitly. */
internal class P2OperationCost {
 fun mark(name:String){}
 companion object {
  fun <T> section(name:String,work:()->T):T=work()
  fun <T> collect(cost:P2OperationCost?,work:()->T):T=work()
 }
}
internal class P2MeasuredDatabase(private val delegate:SqlDatabase):SqlDatabase {
 override fun <T> transaction(block:(SqlSession)->T):T=delegate.transaction(block)
 override fun close()=delegate.close()
}
