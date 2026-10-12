package com.blockcolc.app;
import android.content.Context;
final class PresentationLanguage {
    private PresentationLanguage() {}
    static String text(Context context,String zh,String en){return "en".equals(context.getSharedPreferences("blockcolc_presentation",Context.MODE_PRIVATE).getString("language","zh-CN"))?en:zh;}
}
