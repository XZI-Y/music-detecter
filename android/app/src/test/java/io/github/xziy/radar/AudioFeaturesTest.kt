package io.github.xziy.radar
import org.junit.Assert.*
import org.junit.Test
import kotlin.math.*

class AudioFeaturesTest {
 @Test fun shortAudioPadsWithoutOutOfBounds(){val f=AudioFeatures.fbank(FloatArray(120));assertEquals(1024*128,f.size);assertTrue(f.all{it.isFinite()});assertEquals((4.2677393/9.1379948).toFloat(),f[0],0.000001f)}
 @Test fun silentAudioAndPaddingAreDifferent(){val f=AudioFeatures.fbank(FloatArray(16000));assertTrue(f[0]<-1f);assertTrue(f.last()>0f)}
 @Test fun sineHasFiniteSpectralFeatures(){val samples=FloatArray(16000){(.2*sin(2*PI*440*it/16000)).toFloat()};val f=AudioFeatures.fbank(samples);assertTrue(f.all{it.isFinite()});val a=AudioFeatures.signal(samples);assertTrue(a.brightness!! in 350.0..550.0);assertEquals(1.0,a.chroma.sum(),0.00001)}
 @Test fun fftPeakMatchesInputFrequency(){val r=DoubleArray(512){sin(2*PI*16*it/512)};val i=DoubleArray(512);AudioFeatures.fft(r,i);assertEquals(16,(1..255).maxBy{hypot(r[it],i[it])})}
}
