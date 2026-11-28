package com.blockcolc.preview.ui

import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color

/** Fully specified semantic palette: leaving Material roles at their defaults
 * leaks unrelated purple tracks/containers into otherwise green controls. */
internal object NativePalette {
    val dark=darkColorScheme(
        primary=Color(0xff6fce96),onPrimary=Color(0xff0b0d0c),primaryContainer=Color(0xff181d1a),onPrimaryContainer=Color(0xffefeee9),inversePrimary=Color(0xff256244),
        secondary=Color(0xff6fce96),onSecondary=Color(0xff0b0d0c),secondaryContainer=Color(0xff181d1a),onSecondaryContainer=Color(0xffefeee9),
        tertiary=Color(0xff6fce96),onTertiary=Color(0xff0b0d0c),tertiaryContainer=Color(0xff181d1a),onTertiaryContainer=Color(0xffefeee9),
        background=Color(0xff0b0d0c),onBackground=Color(0xffefeee9),surface=Color(0xff0b0d0c),onSurface=Color(0xffefeee9),
        surfaceVariant=Color(0xff181d1a),onSurfaceVariant=Color(0xffa7b3ab),surfaceTint=Color(0xff6fce96),
        inverseSurface=Color(0xfff6f5f1),inverseOnSurface=Color(0xff151715),outline=Color(0xff3a423d),outlineVariant=Color(0xff222824),scrim=Color.Black,
        error=Color(0xffff8a8a),onError=Color(0xff350b0b),errorContainer=Color(0xff4b1e1e),onErrorContainer=Color(0xffffdad6),
        surfaceBright=Color(0xff222925),surfaceDim=Color(0xff080a09),surfaceContainer=Color(0xff121614),
        surfaceContainerLowest=Color(0xff080a09),surfaceContainerLow=Color(0xff0f1311),surfaceContainerHigh=Color(0xff181d1a),surfaceContainerHighest=Color(0xff1e2420)
    )
    val light=lightColorScheme(
        primary=Color(0xff256244),onPrimary=Color.White,primaryContainer=Color(0xffeae8e1),onPrimaryContainer=Color(0xff151715),inversePrimary=Color(0xff6fce96),
        secondary=Color(0xff256244),onSecondary=Color.White,secondaryContainer=Color(0xffeae8e1),onSecondaryContainer=Color(0xff151715),
        tertiary=Color(0xff256244),onTertiary=Color.White,tertiaryContainer=Color(0xffeae8e1),onTertiaryContainer=Color(0xff151715),
        background=Color(0xfff6f5f1),onBackground=Color(0xff151715),surface=Color(0xfff6f5f1),onSurface=Color(0xff151715),
        surfaceVariant=Color(0xffeae8e1),onSurfaceVariant=Color(0xff535854),surfaceTint=Color(0xff256244),
        inverseSurface=Color(0xff151715),inverseOnSurface=Color(0xfff6f5f1),outline=Color(0xffb5b3ab),outlineVariant=Color(0xffe0ded6),scrim=Color.Black,
        error=Color(0xffb4232c),onError=Color.White,errorContainer=Color(0xfffde8e8),onErrorContainer=Color(0xff7f1d1d),
        surfaceBright=Color(0xfffaf9f6),surfaceDim=Color(0xffe3e1d9),surfaceContainer=Color(0xffefede7),
        surfaceContainerLowest=Color.White,surfaceContainerLow=Color(0xfff6f5f1),surfaceContainerHigh=Color(0xffeae8e1),surfaceContainerHighest=Color(0xffe2e0d8)
    )
}
