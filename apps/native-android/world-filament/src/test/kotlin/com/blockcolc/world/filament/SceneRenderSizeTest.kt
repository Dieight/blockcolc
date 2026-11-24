package com.blockcolc.world.filament

import org.junit.Assert.*
import org.junit.Test

class SceneRenderSizeTest {
    @Test fun densePhonesUseTheSourceWorldBudgetWithoutChangingDisplayGeometry(){
        val actual=SceneRenderSize.forDisplay(1440,3200,3.5f,2f)
        assertEquals(SceneRenderSize(823,1829),actual)
        assertTrue(actual.width.toDouble()*actual.height<1440.0*3200/2)
        assertEquals(1440.0/3200,actual.width.toDouble()/actual.height,.001)
    }
    @Test fun lowerDensityAndExactColourProbesKeepTheirOriginalPixelGrid(){
        assertEquals(SceneRenderSize(720,960),SceneRenderSize.forDisplay(720,960,1f,2f))
        assertEquals(SceneRenderSize(1440,3200),SceneRenderSize.forDisplay(1440,3200,3.5f,2f,true))
        assertEquals(SceneRenderSize(1,1),SceneRenderSize.forDisplay(1,1,4f,1.25f))
    }
    @Test fun pixelStyleKeepsFourDpBlocksOnEveryDensity(){
        fun grid(width:Int,height:Int,density:Float,cellDp:Float=4f)=PixelGrid.forDisplay(width,height,density,cellDp)
        assertEquals(SceneRenderSize(99,219),grid(1080,2400,2.75f).raster)
        assertEquals(SceneRenderSize(90,200),grid(1080,2400,3f).raster)
        assertEquals(SceneRenderSize(90,200),grid(720,1600,2f).raster)
        assertEquals(SceneRenderSize(72,160),grid(1080,2400,3f,cellDp=5f).raster)
        assertEquals(SceneRenderSize(1,1),grid(1,1,.5f,cellDp=.5f).raster)
        val pixel=grid(1080,2400,2.75f).raster;val paper=SceneRenderSize.forDisplay(1080,2400,2.75f,1.5f)
        assertTrue(pixel.width*pixel.height*30<paper.width*paper.height)
    }

    @Test fun cropKeepsEveryInteriorCellExactlySquareAtOddOutputSizes(){
        val grid=PixelGrid.forDisplay(1081,2377,2.625f,4f)
        assertEquals(11,grid.cell)
        fun cellWidths(size:Int,raster:Int,scale:Double,offset:Double):List<Int>{
            val widths=IntArray(raster)
            for(pixel in 0 until size)widths[(((pixel+.5)/size*scale+offset)*raster).toInt()]++
            return widths.toList()
        }
        for(widths in listOf(cellWidths(grid.width,grid.raster.width,grid.scaleX,grid.offsetX),
            cellWidths(grid.height,grid.raster.height,grid.scaleY,grid.offsetY))){
            assertTrue(widths.drop(1).dropLast(1).all{it==grid.cell})
            assertTrue(kotlin.math.abs(widths.first()-widths.last())<=1)
        }
    }
}
