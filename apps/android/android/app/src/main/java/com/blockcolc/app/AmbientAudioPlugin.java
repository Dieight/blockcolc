package com.blockcolc.app;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import java.io.*;
import java.security.MessageDigest;
import org.json.*;

@CapacitorPlugin(name="AmbientAudio")
public final class AmbientAudioPlugin extends Plugin {
    static final int MAX_BYTES=64*1024*1024,MAX_FILES=8;
    static final String PREFS="blockcolc_ambient_audio",KEY="imports";
    @PluginMethod public void configure(PluginCall call){
        JSArray sources=call.getArray("sources",new JSArray());
        Intent intent=new Intent(getContext(),AmbientAudioService.class).putExtra("sources",sources.toString())
            .putExtra("volume",Math.max(0,Math.min(100,call.getInt("volume",30))));
        try {if(sources.length()==0){getContext().stopService(intent);call.resolve();return;}
            ContextCompat.startForegroundService(getContext(),intent);call.resolve();
        }catch(RuntimeException error){call.reject("Audio playback is unavailable","AUDIO_START_FAILED");}
    }
    @PluginMethod public void list(PluginCall call){JSObject value=new JSObject();value.put("items",readImports());call.resolve(value);}
    @PluginMethod public void importAudio(PluginCall call){
        if(readImports().length()>=MAX_FILES){call.reject("At most eight audio files","AUDIO_LIBRARY_FULL");return;}
        FocusIntegrityPlugin.setProductSystemUiOpen(true);
        try{startActivityForResult(call,new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("audio/*").addCategory(Intent.CATEGORY_OPENABLE),"picked");}
        catch(RuntimeException error){FocusIntegrityPlugin.setProductSystemUiOpen(false);call.reject("Cannot open audio picker","AUDIO_PICK_FAILED");}
    }
    @ActivityCallback private void picked(PluginCall call,ActivityResult result){
        FocusIntegrityPlugin.setProductSystemUiOpen(false);if(call==null)return;
        Uri uri=result.getData()==null?null:result.getData().getData();
        if(result.getResultCode()!=Activity.RESULT_OK||uri==null){JSObject value=new JSObject();value.put("cancelled",true);call.resolve(value);return;}
        bridge.execute(()->readAudio(call,uri));
    }
    private void readAudio(PluginCall call,Uri uri){
        File temporary=null;
        try{
            File folder=new File(getContext().getFilesDir(),"ambient-imports");if(!folder.isDirectory()&&!folder.mkdirs())throw new IOException();
            temporary=File.createTempFile("import-",".part",folder);
            MessageDigest digest=MessageDigest.getInstance("SHA-256");int bytes=0;
            try(InputStream input=getContext().getContentResolver().openInputStream(uri);OutputStream output=new FileOutputStream(temporary)){
                if(input==null)throw new IOException();byte[] buffer=new byte[32768];int n;
                while((n=input.read(buffer))!=-1){bytes+=n;if(bytes>MAX_BYTES)throw new IOException("limit");digest.update(buffer,0,n);output.write(buffer,0,n);}
            }
            long duration;MediaMetadataRetriever media=new MediaMetadataRetriever();
            try{media.setDataSource(temporary.getAbsolutePath());
                if(!"yes".equals(media.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO)))throw new IOException("audio");
                duration=Long.parseLong(media.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION));}
            finally{media.release();}
            if(duration<=0||duration>3*60*60*1000)throw new IOException("duration");
            StringBuilder hash=new StringBuilder();for(byte b:digest.digest())hash.append(String.format(java.util.Locale.ROOT,"%02x",b));String id=hash.toString();
            File saved=new File(folder,id);if(!saved.exists()&&!temporary.renameTo(saved))throw new IOException();
            String name="Imported audio";
            try(Cursor cursor=getContext().getContentResolver().query(uri,new String[]{OpenableColumns.DISPLAY_NAME},null,null,null)){
                if(cursor!=null&&cursor.moveToFirst())name=cursor.getString(0);
            }
            name=name==null?"Imported audio":name.replaceAll("[\\p{Cntrl}]","");if(name.length()>80)name=name.substring(0,80);
            JSONObject item=new JSONObject().put("id",id).put("name",name).put("bytes",bytes).put("durationMs",duration);
            JSONArray items=readImports();boolean existing=false;for(int i=0;i<items.length();i++)if(id.equals(items.getJSONObject(i).optString("id")))existing=true;
            if(!existing){if(items.length()>=MAX_FILES)throw new IOException();items.put(item);if(!getContext().getSharedPreferences(PREFS,0).edit().putString(KEY,items.toString()).commit())throw new IOException();}
            JSObject value=new JSObject();value.put("cancelled",false);value.put("item",item);call.resolve(value);
        }catch(Exception error){call.reject("Choose a supported audio file (64 MiB / 3 hours maximum)","AUDIO_IMPORT_FAILED");}
        finally{if(temporary!=null&&temporary.exists())temporary.delete();}
    }
    @PluginMethod public void remove(PluginCall call){
        String id=call.getString("id","");if(!id.matches("[a-f0-9]{64}")){call.reject("Invalid audio id");return;}
        JSONArray old=readImports(),next=new JSONArray();for(int i=0;i<old.length();i++){JSONObject item=old.optJSONObject(i);if(item!=null&&!id.equals(item.optString("id")))next.put(item);}
        if(!getContext().getSharedPreferences(PREFS,0).edit().putString(KEY,next.toString()).commit()){call.reject("Audio library was not saved");return;}
        new File(new File(getContext().getFilesDir(),"ambient-imports"),id).delete();call.resolve();
    }
    private JSONArray readImports(){try{return new JSONArray(getContext().getSharedPreferences(PREFS,0).getString(KEY,"[]"));}catch(JSONException error){return new JSONArray();}}
}
