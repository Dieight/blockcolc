package com.blockcolc.world.resource

import java.io.Closeable
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import java.util.Collections
import java.util.Locale
import java.util.zip.CRC32
import java.util.zip.DataFormatException
import java.util.zip.Inflater

data class ResourceArchiveLimits(val maxInputBytes:Int=32*1024*1024,val maxFileCount:Int=16384,
    val maxSingleFileBytes:Int=4*1024*1024,val maxTotalUncompressedBytes:Int=64*1024*1024,val maxPackMetadataBytes:Int=64*1024){
    init{require(listOf(maxInputBytes,maxFileCount,maxSingleFileBytes,maxTotalUncompressedBytes,maxPackMetadataBytes).all{it>0})}
}
data class ResourceArchiveEntry(val path:String,val physicalPath:String,val bytes:Int)

/** A bounded index, not a retained expanded JAR. The input file belongs to the
 * caller and must be an immutable private candidate while this handle is open.
 * Nothing is executed or extracted to an archive-supplied filesystem path. */
class NativeResourceArchive private constructor(private val source:ArchiveInput,private val entries:Map<String,ZipRecord>,
    val pack:ResourcePackMetadata,val archiveFileCount:Int,val inputSha256:String,val clientJar:Boolean):Closeable{
    val paths:List<String> = Collections.unmodifiableList(entries.keys.sorted())
    val selectedBytes:Long=entries.values.sumOf{it.expanded.toLong()}
    private var closed=false
    fun entry(path:String):ResourceArchiveEntry?=entries[path]?.let{ResourceArchiveEntry(path,it.path,it.expanded.toInt())}
    @Synchronized fun read(path:String,cancelled:()->Boolean={false}):ByteArray{
        check(!closed){"Resource archive is closed"};checkpoint(cancelled)
        return inflate(source,entries[path]?:throw IllegalArgumentException("Missing resource: $path"),cancelled)
    }
    @Synchronized override fun close(){if(!closed){closed=true;source.close()}}
    companion object{
        const val MAX_JAR_BYTES=64*1024*1024
        fun from(bytes:ByteArray,limits:ResourceArchiveLimits=ResourceArchiveLimits(),cancelled:()->Boolean={false}):NativeResourceArchive{
            packRequire(bytes.size<=MAX_JAR_BYTES,"INPUT_TOO_LARGE");checkpoint(cancelled)
            return prepare(MemoryInput(bytes.copyOf()),limits,cancelled)
        }
        fun open(file:File,limits:ResourceArchiveLimits=ResourceArchiveLimits(),cancelled:()->Boolean={false}):NativeResourceArchive{
            packRequire(file.length()<=MAX_JAR_BYTES,"INPUT_TOO_LARGE");checkpoint(cancelled)
            return prepare(FileInput(file),limits,cancelled)
        }
        private fun prepare(source:ArchiveInput,limits:ResourceArchiveLimits,cancelled:()->Boolean):NativeResourceArchive=try{
            packRequire(source.size<=MAX_JAR_BYTES,"INPUT_TOO_LARGE");val audited=audit(source,cancelled)
            val files=audited.filter{!it.directory};val root=files.firstOrNull{it.path=="pack.mcmeta"};val effective=LinkedHashMap<String,ZipRecord>()
            val metadata:ResourcePackMetadata;val client=root==null
            if(root!=null){
                packRequire(source.size<=limits.maxInputBytes,"INPUT_TOO_LARGE");budget(audited,limits.maxFileCount,minOf(limits.maxSingleFileBytes,4*1024*1024),minOf(limits.maxTotalUncompressedBytes,64*1024*1024)){true}
                packRequire(root.expanded<=limits.maxPackMetadataBytes,"INVALID_PACK_MCMETA","pack.mcmeta")
                val parsed=ResourceMetadataParser.parse(inflate(source,root,cancelled),cancelled);metadata=parsed.pack
                for(entry in files)if(!entry.path.startsWith("overlays/"))effective[entry.path]=entry
                for(overlay in parsed.overlays)if(overlay.applies){val prefix="overlays/${overlay.directory}/"
                    for(entry in files)if(entry.path.startsWith(prefix)){val path=entry.path.removePrefix(prefix)
                        if(path.isNotEmpty()&&path!="pack.mcmeta"&&path!="pack.png")effective[path]=entry}
                }
            }else{
                val version=files.firstOrNull{it.path=="version.json"}
                packRequire(version!=null&&files.any{it.path.startsWith("assets/minecraft/blockstates/")}&&files.any{it.path.startsWith("assets/minecraft/textures/block/")},"MISSING_PACK_MCMETA")
                val assets=files.filter{it.path.startsWith("assets/")};packRequire(assets.size<=16384,"TOO_MANY_FILES")
                packRequire(version!!.expanded<=minOf(limits.maxPackMetadataBytes,65536),"FILE_TOO_LARGE","version.json")
                budget(audited,50000,minOf(limits.maxSingleFileBytes,4*1024*1024),minOf(limits.maxTotalUncompressedBytes,64*1024*1024)){it.path.startsWith("assets/")}
                packRequire(ResourceMetadataParser.isClient(inflate(source,version,cancelled),cancelled),"MISSING_PACK_MCMETA")
                metadata=ResourceMetadataParser.client();for(entry in assets)effective[entry.path]=entry
            }
            val digest=MessageDigest.getInstance("SHA-256");var at=0
            while(at<source.size){checkpoint(cancelled);val bytes=source.read(at,minOf(65536,source.size-at));digest.update(bytes);at+=bytes.size}
            val sha=digest.digest().joinToString(""){"%02x".format(it.toInt()and 255)}
            NativeResourceArchive(source,Collections.unmodifiableMap(effective),metadata,files.size,sha,client)
        }catch(e:Throwable){try{source.close()}catch(close:Throwable){e.addSuppressed(close)};throw e}
        private fun budget(entries:List<ZipRecord>,count:Int,single:Int,total:Int,include:(ZipRecord)->Boolean){
            packRequire(entries.size<=count,"TOO_MANY_FILES");var sum=0L
            for(e in entries)if(include(e)){packRequire(e.expanded<=single,"FILE_TOO_LARGE",e.path);sum+=e.expanded;packRequire(sum<=total,"TOTAL_UNCOMPRESSED_TOO_LARGE")}
        }
        private fun u16(b:ByteArray,at:Int):Int=(b[at].toInt()and 255)or((b[at+1].toInt()and 255)shl 8)
        private fun u32(b:ByteArray,at:Int):Long=(0..3).fold(0L){n,i->n or((b[at+i].toLong()and 255)shl(i*8))}
        private fun signature(b:ByteArray,at:Int,value:Long)=u32(b,at)==value
        private fun extra(bytes:ByteArray){var at=0;while(at<bytes.size){packRequire(at+4<=bytes.size,"INVALID_ZIP");val id=u16(bytes,at);val len=u16(bytes,at+2)
            packRequire(at+4+len<=bytes.size,"INVALID_ZIP");packRequire(id!=1,"ZIP64_UNSUPPORTED");at+=4+len}}
        private fun name(raw:ByteArray,flags:Int):String{
            packRequire(flags and 0x800!=0||raw.all{it>=0},"INVALID_ZIP")
            val value=try{Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(raw)).toString().removePrefix("\uFEFF")}
                catch(e:java.nio.charset.CharacterCodingException){throw ResourcePackException("INVALID_ZIP",cause=e)}
            packRequire(value.isNotEmpty()&&!value.contains('\u0000')&&!value.contains('\\')&&!value.startsWith('/')&&!Regex("^[a-zA-Z]:").containsMatchIn(value),"UNSAFE_PATH",value)
            val parts=value.removeSuffix("/").split('/');packRequire(parts.all{it.isNotEmpty()&&it!="."&&it!=".."},"UNSAFE_PATH",value);return value
        }
        private fun audit(source:ArchiveInput,cancelled:()->Boolean):List<ZipRecord>{
            packRequire(source.size>=22,"INVALID_ZIP");val tailStart=maxOf(0,source.size-65557);val tail=source.read(tailStart,source.size-tailStart)
            val end=(tail.size-22 downTo 0).firstOrNull{signature(tail,it,0x06054b50)&&it+22+u16(tail,it+20)==tail.size}
            packRequire(end!=null,"INVALID_ZIP");val e=end!!;val count=u16(tail,e+10);val size=u32(tail,e+12);val start=u32(tail,e+16)
            packRequire(u16(tail,e+4)==0&&u16(tail,e+6)==0&&u16(tail,e+8)==count&&count!=65535&&size!=0xffffffffL&&start!=0xffffffffL,"ZIP64_UNSUPPORTED")
            packRequire(count<=50000,"TOO_MANY_FILES");val centralEnd=start+size;packRequire(centralEnd<=tailStart+e&&centralEnd<=source.size,"INVALID_ZIP")
            val records=ArrayList<ZipRecord>();val exact=HashSet<String>();val folded=HashSet<String>();var at=start.toInt()
            repeat(count){checkpoint(cancelled);packRequire(at.toLong()+46<=centralEnd,"INVALID_ZIP");val header=source.read(at,46);packRequire(signature(header,0,0x02014b50),"INVALID_ZIP")
                val flags=u16(header,8);val method=u16(header,10);val packed=u32(header,20);val expanded=u32(header,24);val offset=u32(header,42)
                val nameSize=u16(header,28);val extraSize=u16(header,30);val commentSize=u16(header,32);val next=at.toLong()+46+nameSize+extraSize+commentSize
                packRequire(next<=centralEnd,"INVALID_ZIP");packRequire(flags and 0x41==0,"ENCRYPTED_ENTRY");packRequire(method==0||method==8,"UNSUPPORTED_COMPRESSION")
                packRequire(expanded!=0xffffffffL&&packed!=0xffffffffL&&offset!=0xffffffffL&&u16(header,34)==0,"ZIP64_UNSUPPORTED")
                val rawName=source.read(at+46,nameSize);val path=name(rawName,flags);packRequire(exact.add(path),"DUPLICATE_PATH",path);packRequire(folded.add(path.lowercase(Locale.US)),"CASE_COLLISION",path)
                extra(source.read(at+46+nameSize,extraSize));packRequire(offset+30<=start,"INVALID_ZIP",path)
                val local=source.read(offset.toInt(),30);packRequire(signature(local,0,0x04034b50)&&u16(local,6)==flags&&u16(local,8)==method,"INVALID_ZIP",path)
                val localName=u16(local,26);val localExtra=u16(local,28);val data=offset+30+localName+localExtra;packRequire(data+packed<=start,"INVALID_ZIP",path)
                packRequire(rawName.contentEquals(source.read((offset+30).toInt(),localName)),"INVALID_ZIP",path);extra(source.read((offset+30+localName).toInt(),localExtra))
                val crc=u32(header,16)
                if(flags and 8==0)packRequire(u32(local,14)==crc&&u32(local,18)==packed&&u32(local,22)==expanded,"INVALID_ZIP",path)
                else packRequire((u32(local,14)==0L||u32(local,14)==crc)&&(u32(local,18)==0L||u32(local,18)==packed)&&(u32(local,22)==0L||u32(local,22)==expanded),"INVALID_ZIP",path)
                packRequire(method!=0||packed==expanded,"INVALID_ZIP",path)
                records+=ZipRecord(path,expanded,packed.toInt(),data.toInt(),offset.toInt(),crc,method,path.endsWith('/'));at=next.toInt()
            };packRequire(at.toLong()==centralEnd,"INVALID_ZIP")
            var used=0L;for(row in records.sortedBy{it.local}){packRequire(row.local>=used,"INVALID_ZIP",row.path);used=row.data.toLong()+row.packed}
            return records
        }
        private fun inflate(source:ArchiveInput,e:ZipRecord,cancelled:()->Boolean):ByteArray{
            checkpoint(cancelled);packRequire(e.expanded<=Int.MAX_VALUE,"FILE_TOO_LARGE",e.path);val out=ByteArray(e.expanded.toInt())
            if(e.method==0){var at=0;while(at<out.size){checkpoint(cancelled);val n=minOf(65536,out.size-at);source.read(e.data+at,n).copyInto(out,at);at+=n}}
            else{val inflater=Inflater(true);var input=0;var written=0;val overflow=ByteArray(1)
                try{while(!inflater.finished()){
                    checkpoint(cancelled)
                    if(inflater.needsInput()){packRequire(input<e.packed,"INVALID_ZIP",e.path);val n=minOf(32768,e.packed-input);val bytes=source.read(e.data+input,n);inflater.setInput(bytes);input+=n}
                    val n=if(written<out.size)inflater.inflate(out,written,minOf(32768,out.size-written))else inflater.inflate(overflow)
                    packRequire(written<out.size||n==0,"INVALID_ZIP",e.path);written+=n
                    packRequire(n>0||inflater.finished()||inflater.needsInput(),"INVALID_ZIP",e.path)
                };packRequire(written==out.size&&inflater.bytesRead==e.packed.toLong(),"INVALID_ZIP",e.path)
                }catch(error:DataFormatException){throw ResourcePackException("INVALID_ZIP",e.path,cause=error)}finally{inflater.end()}
            }
            val crc=CRC32();var at=0;while(at<out.size){checkpoint(cancelled);val n=minOf(65536,out.size-at);crc.update(out,at,n);at+=n}
            packRequire(crc.value==e.crc,"INVALID_ZIP",e.path);return out
        }
    }
}
private data class ZipRecord(val path:String,val expanded:Long,val packed:Int,val data:Int,val local:Int,val crc:Long,val method:Int,val directory:Boolean)
private interface ArchiveInput:Closeable{val size:Int;fun read(offset:Int,count:Int):ByteArray}
private class MemoryInput(private val bytes:ByteArray):ArchiveInput{
    override val size=bytes.size;override fun read(offset:Int,count:Int):ByteArray{packRequire(offset>=0&&count>=0&&offset.toLong()+count<=size,"INVALID_ZIP");return bytes.copyOfRange(offset,offset+count)}
    override fun close(){}
}
private class FileInput(file:File):ArchiveInput{
    private val input=RandomAccessFile(file,"r");override val size:Int
    private val pages=object:LinkedHashMap<Int,ByteArray>(8,.75f,true){override fun removeEldestEntry(eldest:MutableMap.MutableEntry<Int,ByteArray>?)=this.size>8}
    init{try{packRequire(input.length()<=NativeResourceArchive.MAX_JAR_BYTES,"INPUT_TOO_LARGE");size=input.length().toInt()}catch(error:Throwable){input.close();throw error}}
    override fun read(offset:Int,count:Int):ByteArray{
        packRequire(offset>=0&&count>=0&&offset.toLong()+count<=size,"INVALID_ZIP");val bytes=ByteArray(count);var copied=0
        while(copied<count){val at=offset+copied;val index=at/65536;val start=index*65536
            val page=pages[index]?:ByteArray(minOf(65536,size-start)).also{input.seek(start.toLong());input.readFully(it);pages[index]=it}
            val local=at-start;val n=minOf(count-copied,page.size-local);page.copyInto(bytes,copied,local,local+n);copied+=n
        };return bytes
    }
    override fun close(){pages.clear();input.close()}
}
