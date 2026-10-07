package io.github.xziy.radar

import org.junit.Assert.*
import org.junit.Test

class EngineTest{
 private fun song(id:Long,artist:Long=id)=Song(id,"s"+id,listOf(Artist(artist,"a"+artist)),albumId=id,year=2000,duration=200000,tags=listOf("folk"))
 @Test fun scoringMatchesDesktopFixture(){val seed=song(1);val candidate=song(2).copy(seedIds=listOf(1));assertEquals(.6485203488372093,Engine.rank(candidate,listOf(seed),Data(library=listOf(seed))).score,1e-12)}
 @Test fun artistNeverIncreasesScore(){val seed=song(1);val same=song(2,1);val other=same.copy(artists=listOf(Artist(3,"other")));assertEquals(Engine.rank(same,listOf(seed),Data()).score,Engine.rank(other,listOf(seed),Data()).score,1e-12)}
 @Test fun excludesKnownArtistsAndRecentSongs(){val seed=song(1);val d=Data(library=listOf(seed),history=listOf(Exposure("2026-10-06",listOf(3))));assertEquals(listOf(4L),Engine.recommend(listOf(song(2,1),song(3),song(4)),d,"2026-10-07").map{it.id})}
 @Test fun hardAvoidanceDoesNotFillWithRejectedGenres(){val d=Data(library=listOf(song(1)),settings=Settings(avoidTypes=mapOf("style" to listOf("folk")),avoidStrength=100));assertTrue(Engine.recommend(listOf(song(2)),d,"2026-10-07").isEmpty())}
 @Test fun artistQuotaAndSavedVersionIdentityPreventRepeats(){val d=Data(library=listOf(song(1)),history=listOf(Exposure("2026-10-07",emptyList(),listOf(Engine.identity(song(2))))));val result=Engine.recommend(listOf(song(2),song(3,4),song(5,4)),d,"2026-10-07");assertEquals(1,result.size);assertEquals(4L,result[0].artists[0].id)}
 @Test fun missingAudioDoesNotInventStatistics(){val (n,values)=Engine.distribution(listOf(song(1)),"instruments");assertEquals(0,n);assertTrue(values.isEmpty())}
 @Test fun identicalAudioHasPerfectSimilarity(){val a=Audio(instruments=listOf(Instrument("钢琴",.8)),bpm=90.0,brightness=1200.0,chroma=listOf(1.0,0.0),dynamics=.3,vocal=.8);val ranked=Engine.rank(song(2).copy(audio=a),listOf(song(1).copy(audio=a)),Data());assertTrue(ranked.reasons.any{it.contains("钢琴")});assertTrue(ranked.score>.5)}
 @Test fun lrcFractionsAndMultipleTimeTags(){val lines=lyricLines("[00:01.2][00:02.34]x\n[00:04.567]y");assertEquals(listOf(1200L,2340L,4567L),lines.map{it.time})}
 @Test fun cryptoMatchesExistingClient(){val (params,key)=Netease.encrypt("{}","abcdefghijklmnop");assertEquals("qFnMWVHk2FofqgdXwao9gVJSweI5iRQHowAHHOvBiiA=",params);assertEquals("d15a1683c992095d0c234c19966605c5c5964911268bbeda8cb8d08d834913e59d53b32358903a121b5fca784c1f5ae44951fd02524df58ecc98e52cc7cf8689b42c2e93ddf05b0592512d87f5960467e2f086c018849d76014d323500e30f13ef4cafbb0cf5a66731a3f1776c75ca35d0062dac70a3e33245afabcf47938487",key)}
 @Test fun rejectsForeignPlaybackHosts(){assertEquals("https://m10.music.126.net/test.mp3",Netease.safePlaybackUrl("http://m10.music.126.net/test.mp3"));assertThrows(IllegalArgumentException::class.java){Netease.safePlaybackUrl("https://music.126.net.evil.example/x")}}
 @Test fun fftDetectsKnownTone(){val real=DoubleArray(1024){kotlin.math.sin(2*kotlin.math.PI*64*it/1024)};val imag=DoubleArray(1024);AudioFeatures.fft(real,imag);assertEquals(64,(1 until 512).maxBy{java.lang.Math.hypot(real[it],imag[it])})}
}
