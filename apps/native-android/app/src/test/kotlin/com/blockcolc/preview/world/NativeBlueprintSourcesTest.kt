package com.blockcolc.preview.world

import com.blockcolc.domain.StrictJson
import com.blockcolc.presentation.WorldAssetKind
import com.blockcolc.presentation.WorldBlueprintReference
import com.blockcolc.world.generation.BlueprintSnapshot
import com.blockcolc.world.generation.BuiltinBlueprintCatalog
import org.junit.Assert.*
import org.junit.Test

class NativeBlueprintSourcesTest {
    private class RenderCache:BlueprintRenderCache {
        val entries=mutableMapOf<Pair<String,Boolean>,BlueprintSnapshot>()
        var offers=0
        override fun read(sourceSha:String,decoration:Boolean,cancelled:()->Boolean)=entries[sourceSha to decoration]
        override fun offer(sourceSha:String,decoration:Boolean,blueprint:BlueprintSnapshot) {
            offers++
            entries[sourceSha to decoration]=blueprint
        }
    }

    @Test fun diskCandidatesStayBoundToTheContentAndRoleAndDoNotMaskCorruptPackagedAssets() {
        val catalog=BuiltinBlueprintCatalog.load()
        val entry=catalog.entries.first{it.category=="native"}
        val builtin=WorldBlueprintReference(entry.id,WorldAssetKind.BUILTIN)
        val cache=RenderCache()
        fun sources()=NativeBlueprintSources(catalog,renderCache=cache)
        val original=sources().resolve(builtin,false)
        assertSame(original,sources().resolve(builtin,false))
        assertEquals(1,cache.offers)
        val corrupt=BuiltinBlueprintCatalog.load{name->
            val bytes=checkNotNull(BuiltinBlueprintCatalog::class.java.classLoader?.getResourceAsStream(name)).use{it.readBytes()}
            if(name=="native-blueprints/${entry.sha256}.json")bytes[bytes.lastIndex]=0
            bytes
        }
        assertThrows(IllegalArgumentException::class.java){NativeBlueprintSources(corrupt,renderCache=cache).resolve(builtin,false)}

        val first=builtin.copy(kind=WorldAssetKind.EMBEDDED,embeddedCanonical=StrictJson.render(original.json().put("title","Saved source")))
        val changed=first.copy(embeddedCanonical=StrictJson.render(original.json().put("title","Updated source")))
        val embedded=sources().resolve(first,false)
        assertSame(embedded,sources().resolve(first,false))
        val rewritten=sources().resolve(changed,false)
        assertEquals("Updated source",rewritten.title)
        assertEquals(3,cache.offers)
        assertThrows(IllegalArgumentException::class.java){sources().resolve(first.copy(id="wrong"),false)}
        assertThrows(IllegalArgumentException::class.java){sources().resolve(first.copy(id="wrong"),true)}
        assertEquals(3,cache.offers)
    }

    @Test fun fallbackQualificationAndContentIdentityCannotCrossBuildingAndRewardRoles() {
        val catalog=BuiltinBlueprintCatalog.load();val sources=NativeBlueprintSources(catalog)
        val native=catalog.entries.first{it.category=="native"};val holiday=catalog.entries.first{it.category=="holiday"}
        val reference=WorldBlueprintReference(native.id,WorldAssetKind.BUILTIN)
        val first=sources.resolve(reference,false);assertSame(first,sources.resolve(reference,false))
        assertEquals("builtin-unknown-placeholder",sources.resolve(WorldBlueprintReference(holiday.id,WorldAssetKind.BUILTIN),false).id)
        val reward=WorldBlueprintReference(holiday.id,WorldAssetKind.HOLIDAY,holidayId=holiday.holidayId,year=2026)
        assertEquals(holiday.id,sources.resolve(reward,true).id)
        assertThrows(IllegalArgumentException::class.java){sources.resolve(reward,false)}
        assertThrows(IllegalArgumentException::class.java){sources.resolve(reference,true)}
        assertThrows(IllegalArgumentException::class.java){sources.resolve(reward.copy(holidayId="different"),true)}
        val altered=first.json().put("title","Another frozen source")
        val embedded=WorldBlueprintReference(first.id,WorldAssetKind.EMBEDDED,StrictJson.render(altered))
        assertNotSame(first,sources.resolve(embedded,false))
        assertThrows(IllegalArgumentException::class.java){sources.resolve(embedded.copy(id="wrong"),false)}
        sources.clear();assertEquals(0,sources.stats.entries);assertEquals(0L,sources.stats.estimatedRetainedBytes)
    }

    @Test fun anOversizedOrCorruptKnownSourceIsNotSilentlyReplacedAndCachingCanBeDisabled() {
        val catalog=BuiltinBlueprintCatalog.load();val entry=catalog.entries.first{it.category=="supplemental"&&it.bounds.maxX-it.bounds.minX>=12}
        val raw=catalog.content(entry.id).json()
        val embedded=WorldBlueprintReference(entry.id,WorldAssetKind.EMBEDDED,StrictJson.render(raw))
        val sources=NativeBlueprintSources(catalog,maximumEntries=1)
        sources.resolve(embedded,false)
        assertThrows(IllegalArgumentException::class.java){sources.resolve(embedded,true)}
        val corrupted=BuiltinBlueprintCatalog.load { name ->
            val bytes=BuiltinBlueprintCatalog::class.java.classLoader!!.getResourceAsStream(name)!!.use{it.readBytes()}
            if(name.endsWith(entry.sha256+".json"))bytes.copyOf().also{it[0]=0}else bytes
        }
        assertThrows(IllegalArgumentException::class.java){NativeBlueprintSources(corrupted).resolve(WorldBlueprintReference(entry.id,WorldAssetKind.BUILTIN),false)}
        val disabled=NativeBlueprintSources(catalog,0)
        assertNotSame(disabled.resolve(embedded,false),disabled.resolve(embedded,false))
        assertEquals(0,disabled.stats.entries)
    }
}
