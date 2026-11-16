package com.blockcolc.preview.world

import androidx.compose.runtime.*

/** UI-owned selection and reading surface. Neither field is a domain command;
 * a new database/generation retires both, while route changes preserve the axis. */
class NativeWorldInteractionState {
    var selected by mutableStateOf<String?>(null);private set
    var memory by mutableStateOf<String?>(null);private set
    var resetVersion by mutableLongStateOf(0);private set
    var indoors by mutableStateOf(false);private set
    fun toggleInterior(){indoors=!indoors;memory=null}
    private var session:Pair<String,Long>?=null
    private var available=emptySet<String>()
    fun scene(database:String,generation:Long,ids:List<String>){
        val next=database to generation
        if(session!=null&&session!=next){selected=null;memory=null;indoors=false;resetVersion++}
        session=next;available=ids.toSet()
        if(selected !in available)selected=null
        if(memory !in available)memory=null
    }
    fun pick(id:String){if(id in available){indoors=false;selected=id;memory=id}}
    fun focusWithoutMemory(id:String?){if(id==null||id in available){selected=id;memory=null}}
    fun closeMemory(){memory=null}
    fun resetView(){resetVersion++}
    fun resetMap(){selected=null;memory=null;resetVersion++}
}
