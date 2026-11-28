package com.blockcolc.preview.world

import androidx.compose.runtime.*

/** UI-owned selection and reading surface. Neither field is a domain command;
 * a new database/generation retires both, while route changes preserve the axis. */
class NativeWorldInteractionState {
    var selected by mutableStateOf<String?>(null);private set
    var memory by mutableStateOf<String?>(null);private set
    var resetVersion by mutableLongStateOf(0);private set
    var indoors by mutableStateOf(false);private set
    var cameraMoved by mutableStateOf(false);private set
    fun toggleInterior(){indoors=!indoors;memory=null;cameraMoved=false}
    fun exitInterior(){if(indoors){indoors=false;memory=null;cameraMoved=false}}
    fun markCameraMoved(){if(!cameraMoved)cameraMoved=true}
    fun clearCameraMoved(){if(cameraMoved)cameraMoved=false}
    private var session:Pair<String,Long>?=null
    private var available=emptySet<String>()
    fun scene(database:String,generation:Long,ids:List<String>){
        val next=database to generation
        if(session!=null&&session!=next){selected=null;memory=null;indoors=false;cameraMoved=false;resetVersion++}
        session=next;available=ids.toSet()
        if(selected !in available)selected=null
        if(memory !in available)memory=null
    }
    fun pick(id:String){if(id in available){indoors=false;selected=id;memory=id;cameraMoved=false}}
    fun focusWithoutMemory(id:String?){if(id==null||id in available){selected=id;memory=null;cameraMoved=false}}
    fun closeMemory(){memory=null}
    fun resetView(){cameraMoved=false;resetVersion++}
    fun resetMap(){selected=null;memory=null;cameraMoved=false;resetVersion++}
}
