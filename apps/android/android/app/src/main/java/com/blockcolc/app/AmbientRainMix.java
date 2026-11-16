package com.blockcolc.app;

/** Keep in step with ambient-rain-mix.ts; both use the measured 0..1 weather input. */
final class AmbientRainMix {
    static final float MAIN_GAIN=.7f;
    private double accepted=Double.NaN;
    private double[] target={0,0},current={0,0};
    private static boolean finite(double value){return !Double.isNaN(value)&&!Double.isInfinite(value);}
    static double intensity(double value){return finite(value)?Math.max(0,Math.min(1,value)):.3;}
    static double[] gains(double value){
        double strength=intensity(value),t=Math.max(0,Math.min(1,(strength-.16)/.68));
        double blend=t*t*(3-2*t),level=.08+.12*Math.sqrt(strength);
        return new double[]{level*Math.cos(blend*Math.PI/2),level*Math.sin(blend*Math.PI/2)};
    }
    void set(boolean enabled,double value){
        if(!enabled){accepted=Double.NaN;target=new double[]{0,0};return;}
        double next=intensity(value);
        if(finite(accepted)&&Math.abs(next-accepted)<.025)return;
        accepted=next;target=gains(next);
    }
    double[] step(double elapsedMs){
        double dt=finite(elapsedMs)?Math.max(0,Math.min(30000,elapsedMs)):0;
        double alpha=1-Math.exp(-dt/900);
        for(int i=0;i<2;i++)current[i]+=(target[i]-current[i])*alpha;
        return current.clone();
    }
}
