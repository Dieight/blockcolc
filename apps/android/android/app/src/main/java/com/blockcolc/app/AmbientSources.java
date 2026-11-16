package com.blockcolc.app;

/** One selected recording and an optional weather-driven rain layer. */
final class AmbientSources {
    static boolean builtin(String source) {
        return "shore-waves".equals(source) || "forest-birds".equals(source);
    }
    static String asset(String source) {
        return builtin(source) ? "public/audio/" + source + ".ogg" : null;
    }
    static String rainAsset(int layer){
        if(layer<0||layer>1)throw new IllegalArgumentException("Invalid rain layer");
        return "public/audio/"+(layer==0?"rain-light":"rain-heavy")+".ogg";
    }
    static boolean valid(String[] sources) {
        if (sources == null || sources.length > 2) return false;
        int main = 0, rain = 0;
        for (String source : sources) {
            if ("rain".equals(source)) rain++;
            else if (builtin(source)
                || source != null && source.matches("[a-f0-9]{64}")) main++;
            else return false;
        }
        return main <= 1 && rain <= 1;
    }
}
