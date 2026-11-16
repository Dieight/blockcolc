package com.blockcolc.world

import org.json.JSONObject
import kotlin.math.*

data class NativeCoordinates(val latitude:Double,val longitude:Double) {
    init {require(latitude.isFinite()&&latitude in -90.0..90.0&&longitude.isFinite()&&longitude in -180.0..180.0)}
}
data class NativeCelestialPosition(val azimuthDeg:Double,val altitudeDeg:Double,val distance:Double?=null,val parallacticAngle:Double?=null)
data class NativeLunarIllumination(val fraction:Double,val phase:Double,val angleDeg:Double,val waxing:Boolean)

/** SunCalc 2.x position/illumination calculation, adapted under BSD-2-Clause.
 * See licenses/suncalc-bsd.txt. Only its finite Meeus coefficient series is a
 * build-time resource; arbitrary times/locations are calculated here in Kotlin.
 * Ephemeris, UI theme and the business calendar remain separate inputs. */
object NativeEphemeris {
    private const val RAD=PI/180
    private data class Equatorial(val ra:Double,val dec:Double,val distance:Double=0.0)
    private val series by lazy {
        val text=checkNotNull(javaClass.getResourceAsStream("/native-ephemeris-series.json")).use{stream->
            val bytes=stream.readBytes();require(bytes.size<=32*1024);bytes.toString(Charsets.UTF_8)}
        val value=JSONObject(text);require(value.getInt("schema")==1&&value.getString("sourceSha").matches(Regex("[a-f0-9]{64}")))
        fun array(key:String,size:Int)=value.getJSONArray(key).let{a->require(a.length()==size);IntArray(size){i->val n=a.get(i);require(n is Number&&n.toDouble()==n.toInt().toDouble());n.toInt()}}
        array("moonLon",360) to array("moonLat",300)
    }
    private fun days(time:Long):Double {require(time in -8_640_000_000_000_000L..8_640_000_000_000_000L);return time/86400000.0-.5+2440588-2451545}
    private fun tt(d:Double):Double {
        val y=2000+d/365.2425
        val delta=when {
            y<1920->{val t=y-1900;-2.79+t*(1.494119+t*(-.0598939+t*(.0061966-t*.000197)))}
            y<1941->{val t=y-1920;21.20+t*(.84493+t*(-.076100+t*.0020936))}
            y<1961->{val t=y-1950;29.07+t*(.407+t*(-1.0/233+t/2547))}
            y<1986->{val t=y-1975;45.45+t*(1.067+t*(-1.0/260-t/718))}
            y<2005->{val t=y-2000;63.86+t*(.3345+t*(-.060374+t*(.0017275+t*(.000651814+t*.00002373599))))}
            y<2050->{val t=y-2000;62.92+t*(.32217+t*.005589)}
            else->{val t=(y-1820)/100;-20+32*t*t-.5628*(2150-y)}
        }
        return d+delta/86400
    }
    private fun sun(d:Double):Equatorial {
        val t=d/36525;val l0=RAD*(280.46646+t*(36000.76983+t*.0003032));val m=RAD*(357.52911+t*(35999.05029-t*.0001537))
        val sm=sin(m);val cm=cos(m)
        val c=RAD*((1.914602-t*(.004817+t*.000014))*sm+(.019993-.000101*t)*2*sm*cm+.000289*sm*(3-4*sm*sm))
        val om=RAD*(125.04-1934.136*t);val l=l0+c-RAD*(.00569+.00478*sin(om))
        val e=RAD*(23.439291-t*(.0130042+t*(.00000016-t*.000000504)))+RAD*.00256*cos(om)
        return Equatorial(atan2(cos(e)*sin(l),cos(l)),asin(sin(e)*sin(l)))
    }
    private fun moon(d:Double):Equatorial {
        val t=d/36525
        val lp=218.3164477+t*(481267.88123421+t*(-.0015786+t*(1.0/538841-t/65194000)))
        val dd=297.8501921+t*(445267.1114034+t*(-.0018819+t*(1.0/545868-t/113065000)))
        val m=357.5291092+t*(35999.0502909+t*(-.0001536+t/24490000))
        val mp=134.9633964+t*(477198.8675055+t*(.0087414+t*(1.0/69699-t/14712000)))
        val f=93.2720950+t*(483202.0175233+t*(-.0036539+t*(-1.0/3526000+t/863310000)))
        val a1=119.75+131.849*t;val a2=53.09+479264.290*t;val a3=313.45+481266.484*t
        val e=1-t*(.002516+t*.0000074);val dr=RAD*dd;val mr=RAD*m;val mpr=RAD*mp;val fr=RAD*f
        var sl=0.0;var sr=0.0;var sb=0.0;val (lon,lat)=series
        for(i in lon.indices step 6){val mm=lon[i+1];val arg=lon[i]*dr+mm*mr+lon[i+2]*mpr+lon[i+3]*fr;val factor=when(abs(mm)){1->e;2->e*e;else->1.0}
            sl+=lon[i+4]*factor*sin(arg);sr+=lon[i+5]*factor*cos(arg)}
        for(i in lat.indices step 5){val mm=lat[i+1];val arg=lat[i]*dr+mm*mr+lat[i+2]*mpr+lat[i+3]*fr;val factor=when(abs(mm)){1->e;2->e*e;else->1.0};sb+=lat[i+4]*factor*sin(arg)}
        val a1r=RAD*a1;val lpr=RAD*lp
        sl+=3958*sin(a1r)+1962*sin(lpr-fr)+318*sin(RAD*a2)
        sb+= -2235*sin(lpr)+382*sin(RAD*a3)+175*sin(a1r-fr)+175*sin(a1r+fr)+127*sin(lpr-mpr)-115*sin(lpr+mpr)
        val om=RAD*(125.04452-1934.136261*t);val ls=RAD*(280.4665+36000.7698*t);val lm=RAD*(218.3165+481267.8813*t)
        val dpsi=(-17.20*sin(om)-1.32*sin(2*ls)-.23*sin(2*lm)+.21*sin(2*om))/3600
        val deps=(9.20*cos(om)+.57*cos(2*ls)+.10*cos(2*lm)-.09*cos(2*om))/3600
        val eps=RAD*(23.439291-t*(.0130042+t*(.00000016-t*.000000504))+deps)
        val l=RAD*(lp+sl/1e6+dpsi);val b=RAD*(sb/1e6)
        return Equatorial(atan2(sin(l)*cos(eps)-tan(b)*sin(eps),cos(l)),asin(sin(b)*cos(eps)+cos(b)*sin(eps)*sin(l)),385000.56+sr/1000)
    }
    private fun altitude(h:Double,phi:Double,dec:Double)=asin(sin(phi)*sin(dec)+cos(phi)*cos(dec)*cos(h))
    private fun azimuth(h:Double,phi:Double,dec:Double)=(atan2(sin(h),cos(h)*sin(phi)-tan(dec)*cos(phi))/RAD+540)%360
    private fun refraction(altitude:Double):Double {val h=max(0.0,altitude);return .0002967/tan(h+.00312536/(h+.08901179))}
    fun sunPosition(time:Long,coordinates:NativeCoordinates):NativeCelestialPosition {
        val d=days(time);val c=sun(tt(d));val h=RAD*(280.46061837+360.98564736629*d)+RAD*coordinates.longitude-c.ra
        val phi=RAD*coordinates.latitude;val alt=altitude(h,phi,c.dec)
        return NativeCelestialPosition(azimuth(h,phi,c.dec),(alt+refraction(alt))/RAD)
    }
    fun moonPosition(time:Long,coordinates:NativeCoordinates):NativeCelestialPosition {
        val d=days(time);val c=moon(tt(d));val h=RAD*(280.46061837+360.98564736629*d)+RAD*coordinates.longitude-c.ra
        val phi=RAD*coordinates.latitude;val geo=altitude(h,phi,c.dec);val alt=geo-asin(6378.14/c.distance*cos(geo))
        val pa=atan2(sin(h),tan(phi)*cos(c.dec)-sin(c.dec)*cos(h))
        return NativeCelestialPosition(azimuth(h,phi,c.dec),(alt+refraction(alt))/RAD,c.distance,pa/RAD)
    }
    fun illumination(time:Long):NativeLunarIllumination {
        val d=tt(days(time));val s=sun(d);val m=moon(d)
        val phi=acos(sin(s.dec)*sin(m.dec)+cos(s.dec)*cos(m.dec)*cos(s.ra-m.ra))
        val inc=atan2(149598000*sin(phi),m.distance-149598000*cos(phi))
        val angle=atan2(cos(s.dec)*sin(s.ra-m.ra),sin(s.dec)*cos(m.dec)-cos(s.dec)*sin(m.dec)*cos(s.ra-m.ra));val waxing=angle<0
        val phase=.5+.5*inc*(if(waxing)-1 else 1)/PI
        return NativeLunarIllumination(((1+cos(inc))/2).coerceIn(0.0,1.0),((phase%1)+1)%1,angle/RAD,waxing)
    }
}
