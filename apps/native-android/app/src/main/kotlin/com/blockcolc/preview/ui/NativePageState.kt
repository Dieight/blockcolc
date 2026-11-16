package com.blockcolc.preview.ui

import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.runtime.*

internal val LocalNativePageScroll=staticCompositionLocalOf<ScrollState?>{null}

/** All four pages remain composed. Keyed rememberSaveable state belongs to
 * that retained page; no reusable-content registry resets it on activation.
 * Activation controls effects, not the lifetime of scroll, disclosures or drafts.
 * Replacing a workspace changes identity; ordinary navigation never does. */
@Composable internal fun NativePageState(identity:String,scroll:ScrollState,memory:NativePageMemory,content:@Composable ()->Unit)=key(identity){
    CompositionLocalProvider(LocalNativePageScroll provides scroll,LocalNativePageMemory provides memory){
        Box(Modifier.fillMaxSize().testTag("native-page-${identity.substringAfterLast('/')}")){content()}
    }
}
