package io.github.xziy.radar
import org.junit.Assert.*
import org.junit.Test
import kotlin.math.*

class AudioFeaturesTest {
 @Test fun resampleThirtySecondsAt44100AvoidsIntegerOverflow(){
  val source=FloatArray(1323008){it/1323008f};val output=AudioFeatures.resample(source,44100)
  assertEquals(480000,output.size);assertTrue(output.all{it.isFinite()&&it>=0f})
  for(i in listOf(48696,160000,300000,479999))assertEquals((i.toDouble()*44100/16000/1323008).toFloat(),output[i],0.000001f)
 }
 @Test fun resampleAt48000PreservesLastSegment(){val source=FloatArray(1440000){if(it>=960000)1f else 0f};val output=AudioFeatures.resample(source,48000);assertEquals(480000,output.size);assertEquals(0f,output[100000],0f);assertEquals(1f,output[400000],0f)}
 @Test fun resampleHandlesEmptyAndShortAudio(){assertEquals(0,AudioFeatures.resample(floatArrayOf(),44100).size);assertEquals(0,AudioFeatures.resample(floatArrayOf(.5f),48000).size);assertTrue(AudioFeatures.resample(floatArrayOf(.5f),8000).all{it==.5f})}
 @Test(expected=IllegalArgumentException::class) fun resampleRejectsInvalidRate(){AudioFeatures.resample(floatArrayOf(0f),0)}

 @Test fun shortAudioPadsWithoutOutOfBounds(){val f=AudioFeatures.fbank(FloatArray(120));assertEquals(1024*128,f.size);assertTrue(f.all{it.isFinite()});assertEquals((4.2677393/9.1379948).toFloat(),f[0],0.000001f)}
 @Test fun silentAudioAndPaddingAreDifferent(){val f=AudioFeatures.fbank(FloatArray(16000));assertTrue(f[0]<-1f);assertTrue(f.last()>0f)}
 @Test fun sineHasFiniteSpectralFeatures(){val samples=FloatArray(16000){(.2*sin(2*PI*440*it/16000)).toFloat()};val f=AudioFeatures.fbank(samples);assertTrue(f.all{it.isFinite()});val a=AudioFeatures.signal(samples);assertTrue(a.brightness!! in 350.0..550.0);assertEquals(1.0,a.chroma.sum(),0.00001)}
 @Test fun fftPeakMatchesInputFrequency(){val r=DoubleArray(512){sin(2*PI*16*it/512)};val i=DoubleArray(512);AudioFeatures.fft(r,i);assertEquals(16,(1..255).maxBy{hypot(r[it],i[it])})}
}
