package com.blockcolc.preview

import android.os.Bundle
import android.os.Parcel
import androidx.compose.runtime.saveable.SaverScope
import androidx.compose.runtime.saveable.autoSaver
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import com.blockcolc.preview.ui.NativePageMemory
import org.junit.Assert.*
import org.junit.Test

class P3PageMemoryTest {
    @Test fun recreatedConsumersKeepTheirDraftAndSelectionAndParcelRestoresBothNullAndText(){
        val memory=NativePageMemory()
        val original=memory.state("note",TextFieldValue.Saver){TextFieldValue()}
        original.value=TextFieldValue("在中间插入中文",TextRange(3,5))
        assertSame(original,memory.state("note",TextFieldValue.Saver){TextFieldValue("must not replace draft")})
        memory.state<String?>("selected",autoSaver()){null}
        val scope=object:SaverScope{override fun canBeSaved(value:Any)=value is java.io.Serializable}
        val saved=with(NativePageMemory.Saver){scope.save(memory)}!!
        val bundle=Bundle().apply{putSerializable("page",saved as java.io.Serializable)}
        val written=Parcel.obtain();val read=Parcel.obtain()
        try{
            written.writeBundle(bundle);val bytes=written.marshall()
            read.unmarshall(bytes,0,bytes.size);read.setDataPosition(0)
            @Suppress("UNCHECKED_CAST","DEPRECATION")
            val roundTrip=read.readBundle(javaClass.classLoader)!!.getSerializable("page") as Map<String,List<Any?>>
            val restored=NativePageMemory.Saver.restore(roundTrip)!!
            assertEquals(original.value,restored.state("note",TextFieldValue.Saver){TextFieldValue()}.value)
            assertNull(restored.state<String?>("selected",autoSaver()){ "wrong default" }.value)
            assertEquals("new workspace",NativePageMemory().state("note",autoSaver()){ "new workspace" }.value)
        }finally{written.recycle();read.recycle()}
    }
}
