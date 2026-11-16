package com.blockcolc.preview.ui

import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color

/** Fully specified semantic palette: leaving Material roles at their defaults
 * leaks unrelated purple tracks/containers into otherwise green controls. */
internal object NativePalette {
    val dark=darkColorScheme(
        primary=Color(0xff6fce96),onPrimary=Color(0xff0e1512),primaryContainer=Color(0xff1f3329),onPrimaryContainer=Color(0xffe6efe9),inversePrimary=Color(0xff276749),
        secondary=Color(0xff6fce96),onSecondary=Color(0xff0e1512),secondaryContainer=Color(0xff1f3329),onSecondaryContainer=Color(0xffe6efe9),
        tertiary=Color(0xff6fce96),onTertiary=Color(0xff0e1512),tertiaryContainer=Color(0xff1f3329),onTertiaryContainer=Color(0xffe6efe9),
        background=Color(0xff0e1512),onBackground=Color(0xffe6efe9),surface=Color(0xff17211c),onSurface=Color(0xffe6efe9),
        surfaceVariant=Color(0xff1f3329),onSurfaceVariant=Color(0xffafc0b3),surfaceTint=Color(0xff6fce96),
        inverseSurface=Color(0xfff3f5f2),inverseOnSurface=Color(0xff17211c),outline=Color(0xff38473d),outlineVariant=Color(0xff2c3a31),scrim=Color.Black,
        error=Color(0xffff8a8a),onError=Color(0xff350b0b),errorContainer=Color(0xff4b1e1e),onErrorContainer=Color(0xffffdad6),
        surfaceBright=Color(0xff293a31),surfaceDim=Color(0xff0e1512),surfaceContainer=Color(0xff17211c),
        surfaceContainerLowest=Color(0xff0a100d),surfaceContainerLow=Color(0xff122019),surfaceContainerHigh=Color(0xff1b2921),surfaceContainerHighest=Color(0xff24362b)
    )
    val light=lightColorScheme(
        primary=Color(0xff276749),onPrimary=Color.White,primaryContainer=Color(0xffdfece3),onPrimaryContainer=Color(0xff17211c),inversePrimary=Color(0xff6fce96),
        secondary=Color(0xff276749),onSecondary=Color.White,secondaryContainer=Color(0xffdfece3),onSecondaryContainer=Color(0xff17211c),
        tertiary=Color(0xff276749),onTertiary=Color.White,tertiaryContainer=Color(0xffdfece3),onTertiaryContainer=Color(0xff17211c),
        background=Color(0xfff3f5f2),onBackground=Color(0xff17211c),surface=Color.White,onSurface=Color(0xff17211c),
        surfaceVariant=Color(0xffdfece3),onSurfaceVariant=Color(0xff58635d),surfaceTint=Color(0xff276749),
        inverseSurface=Color(0xff17211c),inverseOnSurface=Color(0xffe6efe9),outline=Color(0xffaeb8b1),outlineVariant=Color(0xffd7ddd8),scrim=Color.Black,
        error=Color(0xffb4232c),onError=Color.White,errorContainer=Color(0xfffee2e2),onErrorContainer=Color(0xff7f1d1d),
        surfaceBright=Color.White,surfaceDim=Color(0xffd7ddd8),surfaceContainer=Color(0xffedf1ed),
        surfaceContainerLowest=Color.White,surfaceContainerLow=Color(0xfff3f5f2),surfaceContainerHigh=Color(0xffe5ece5),surfaceContainerHighest=Color(0xffdfece3)
    )
}
