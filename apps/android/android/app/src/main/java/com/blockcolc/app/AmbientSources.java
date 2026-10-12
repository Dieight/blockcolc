package com.blockcolc.app;

/** One selected recording and an optional weather-driven rain layer. */
final class AmbientSources {
    static boolean builtin(String source) {
        return "morning-birdsong".equals(source) || "rain".equals(source);
    }
    static boolean valid(String[] sources) {
        if (sources == null || sources.length > 2) return false;
        int main = 0, rain = 0;
        for (String source : sources) {
            if ("rain".equals(source)) rain++;
            else if ("morning-birdsong".equals(source)
                || source != null && source.matches("[a-f0-9]{64}")) main++;
            else return false;
        }
        return main <= 1 && rain <= 1;
    }
}
