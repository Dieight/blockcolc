package com.blockcolc.preview

import com.blockcolc.domain.DomainDocument
import com.blockcolc.presentation.ClientPreferences
import com.blockcolc.storage.CloudBaseline
import com.blockcolc.storage.RecoveryContext
import com.blockcolc.storage.StateToken

internal data class CloudLocal(val database:String,val token:StateToken,val domain:DomainDocument,val recovery:RecoveryContext,val preferences:ClientPreferences,val baseline:CloudBaseline?)
