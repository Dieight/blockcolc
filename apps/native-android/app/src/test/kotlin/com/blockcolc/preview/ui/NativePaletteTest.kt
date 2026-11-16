package com.blockcolc.preview.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import org.junit.Assert.*
import org.junit.Test

class NativePaletteTest {
    @Test fun bothThemesKeepReadableSemanticPairsAndGlassInk(){
        for(colors in listOf(NativePalette.light,NativePalette.dark)){
            val pairs=listOf(colors.onBackground to colors.background,colors.onSurface to colors.surface,
                colors.onSurfaceVariant to colors.surfaceVariant,colors.onPrimary to colors.primary,colors.onPrimaryContainer to colors.primaryContainer,
                colors.onSecondary to colors.secondary,colors.onSecondaryContainer to colors.secondaryContainer,
                colors.onTertiary to colors.tertiary,colors.onTertiaryContainer to colors.tertiaryContainer,
                colors.onError to colors.error,colors.onErrorContainer to colors.errorContainer,colors.error to colors.surface,
                colors.inverseOnSurface to colors.inverseSurface)
            for((ink,paper)in pairs)assertTrue("Insufficient semantic contrast: $ink on $paper",contrast(ink,paper)>=4.5f)
            assertEquals("Glass descriptions use the same high-contrast ink",colors.onSurface,colors.onSurfaceVariant)
        }
    }
    @Test fun nativeControlsDoNotInheritUnspecifiedMaterialAccentOrContainerRoles(){
        for(colors in listOf(NativePalette.light,NativePalette.dark)){
            assertEquals(colors.primary,colors.secondary);assertEquals(colors.primary,colors.tertiary)
            assertEquals(colors.surfaceVariant,colors.primaryContainer);assertEquals(colors.surfaceVariant,colors.secondaryContainer)
            for(surface in listOf(colors.surfaceBright,colors.surfaceDim,colors.surfaceContainer,colors.surfaceContainerLowest,colors.surfaceContainerLow,colors.surfaceContainerHigh,colors.surfaceContainerHighest))
                assertTrue("Container ink must remain readable",contrast(colors.onSurface,surface)>=4.5f)
        }
    }
    private fun contrast(a:Color,b:Color):Float {val x=a.luminance();val y=b.luminance();return (maxOf(x,y)+.05f)/(minOf(x,y)+.05f)}
}
