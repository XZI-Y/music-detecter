package io.github.xziy.radar

import kotlinx.serialization.Serializable
import java.time.LocalDate
import java.time.ZoneId

@Serializable data class Artist(val id:Long=0,val name:String="")
@Serializable data class Instrument(val name:String,val confidence:Double)
@Serializable data class Audio(val instruments:List<Instrument> = emptyList(),val bpm:Double?=null,val brightness:Double?=null,val dynamics:Double?=null,val chroma:List<Double> = emptyList(),val vocal:Double?=null,val model:String="AST-AudioSet-q8")
@Serializable data class Song(val id:Long,val name:String,val artists:List<Artist> = emptyList(),val album:String="",val albumId:Long=0,val cover:String="",val duration:Long=0,val year:Int?=null,val tags:List<String> = emptyList(),val mood:List<String> = emptyList(),val theme:List<String> = emptyList(),val language:String?=null,val audio:Audio?=null,val lyrics:String="",val seedIds:List<Long> = emptyList(),val score:Double=0.0,val reasons:List<String> = emptyList(),val unavailable:Boolean=false) { val artistText get()=artists.joinToString(" / "){it.name} }
@Serializable data class Playlist(val id:Long,val name:String,val count:Int=0,val ownerId:Long=0,val tags:List<String> = emptyList(),val specialType:Int=0)
@Serializable data class Profile(val id:Long,val name:String)
@Serializable data class Settings(val selected:List<Long> = emptyList(),val favorite:Long?=null,val count:Int=20,val exploration:Int=30,val repeatDays:Int=14,val avoidKnownArtists:Boolean=true,val artistLimit:Int=1,val albumLimit:Int=2,val hour:Int=8,val weights:Map<String,Double> = emptyMap(),val avoidTypes:Map<String,List<String>> = emptyMap(),val avoidStrength:Int=85,val deepAudio:Boolean=false,val audioBatch:Int=24,val wifiOnly:Boolean=true,val mode:String="system",val material:String="smooth",val hue:Int=140)
@Serializable data class Exposure(val date:String,val ids:List<Long>,val identities:List<String> = emptyList())
@Serializable data class Data(val version:Int=1,val profile:Profile?=null,val settings:Settings=Settings(),val playlists:List<Playlist> = emptyList(),val library:List<Song> = emptyList(),val archive:List<Song> = emptyList(),val recommendations:List<Song> = emptyList(),val history:List<Exposure> = emptyList(),val feedback:Map<Long,String> = emptyMap(),val favorites:Map<Long,List<Long>> = emptyMap(),val analyzed:Boolean=false,val lastUpdate:String="",val recommendationDate:String="",val generations:Int=0,val lyricsChecked:List<Long> = emptyList(),val audioAttempts:Map<Long,String> = emptyMap(),val analysisTime:String="",val analysisHistory:List<String> = emptyList())
fun day():String=LocalDate.now(ZoneId.of("Asia/Shanghai")).toString()
val weightNames=linkedMapOf("relation" to "歌曲关联","style" to "音乐风格","mood" to "情绪","theme" to "歌词主题","language" to "语言","era" to "年代","duration" to "时长","feedback" to "喜好反馈","instruments" to "乐器","rhythm" to "节奏","timbre" to "音色","harmony" to "音高分布","dynamics" to "动态","vocal" to "人声")
val dimensionNames=linkedMapOf("style" to "风格","instruments" to "乐器","tempo" to "节奏","timbre" to "音色","vocal" to "人声","dynamics" to "动态","language" to "语言","mood" to "情绪","theme" to "主题","era" to "年代","duration" to "时长")
