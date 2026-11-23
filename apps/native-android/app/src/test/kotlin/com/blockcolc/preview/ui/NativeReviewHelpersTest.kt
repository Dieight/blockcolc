package com.blockcolc.preview.ui

import org.junit.Assert.*
import org.junit.Test

class NativeReviewHelpersTest {
    @Test fun segmentsWrapIntoTheFewestBalancedRows(){
        // Everything fits: one row.
        assertEquals(listOf(5),nativeSegmentRows(5){true})
        // Five lighting tiers that fit three per row become 3 + 2, not a stack.
        assertEquals(listOf(3,2),nativeSegmentRows(5){it<=3})
        // Four options that fit two per row become 2 + 2.
        assertEquals(listOf(2,2),nativeSegmentRows(4){it<=2})
        // Seven weather choices, three per row: earlier rows take the remainder.
        assertEquals(listOf(3,2,2),nativeSegmentRows(7){it<=3})
        // Nothing shares a row: one complete option per row.
        assertEquals(listOf(1,1,1),nativeSegmentRows(3){it<=1})
        assertEquals(listOf(1,1,1),nativeSegmentRows(3){false})
        for(count in 1..9)for(limit in 1..count){
            val rows=nativeSegmentRows(count){it<=limit}
            assertEquals(count,rows.sum())
            assertTrue(rows.max()<=limit)
            assertTrue(rows.max()-rows.min()<=1)
        }
    }

    @Test fun pixelCellsUseWholeDevicePixelsAndStayCentred(){
        // The 12 columns fit inside all 55px at 2.75x.
        assertEquals(4f,nativePixelCell(55f/12),0f)
        assertEquals(4f,nativePixelCell(52.5f/12),0f)
        assertEquals(5f,nativePixelCell(60f/12),0f)
        // Below one pixel per cell the fraction is kept rather than vanishing.
        assertEquals(.5f,nativePixelCell(.5f),0f)
        assertEquals(4f,nativePixelOrigin(55f,48f),0f)
        assertEquals(4f,nativePixelOrigin(56f,48f),0f)
    }

    @Test fun dateDraftsAcceptOnlyRealDates(){
        assertEquals(NativeDateDraft(2026,12,16),nativeDateDraft("2026","12","16",true))
        assertNull(nativeDateDraft("2027","2","29",true))
        assertNull(nativeDateDraft("26","1","1",true))
        assertNull(nativeDateDraft("2026","13","1",true))
        assertNull(nativeDateDraft("2026","","1",true))
        // A repeating date (birthday) has no year, so 29 February is allowed.
        assertEquals(NativeDateDraft(null,2,29),nativeDateDraft(null,"2","29",false))
        assertNull(nativeDateDraft(null,"4","31",false))
        assertEquals(java.time.LocalDate.of(2026,12,16),NativeDateDraft(2026,12,16).date)
        assertNull(NativeDateDraft(null,5,20).date)
    }

    @Test fun friendCodesSurviveSpacingCaseAndSurroundingText(){
        val code="K7Q2AB9DC4EF8A3B1C".replace('K','A').replace('Q','B')
        assertTrue(isFriendCode(code))
        assertEquals(code,normalizeFriendCode(code.lowercase().chunked(6).joinToString(" - ")))
        assertEquals("${code.substring(0,6)} ${code.substring(6,12)} ${code.substring(12)}",groupedFriendCode(code))
        assertEquals(code,pastedFriendCode("我的方块钟好友码：${groupedFriendCode(code)}"))
        assertEquals(code,pastedFriendCode("Code: ${code.lowercase()}"))
        assertEquals(code,pastedFriendCode("code $code"))
        assertNull(pastedFriendCode("A$code"))
        assertNull(pastedFriendCode("${groupedFriendCode(code)} ABCDEF"))
        assertNull(pastedFriendCode("$code / ${code.reversed()}"))
        assertFalse(isFriendCode(code.dropLast(1)))
        assertFalse(isFriendCode(code.dropLast(1)+"G"))
        assertFalse(isFriendCode(normalizeFriendCode("好友码")))
    }
}
