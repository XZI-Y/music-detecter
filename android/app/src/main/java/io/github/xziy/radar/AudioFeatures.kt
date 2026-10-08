package io.github.xziy.radar

import kotlin.math.*

object AudioFeatures {
 fun resample(samples:FloatArray,sourceRate:Int,targetRate:Int=16000,maxSeconds:Int=30):FloatArray {
  require(sourceRate>0&&targetRate>0&&maxSeconds>0){"音频采样率无效"}
  if(samples.isEmpty())return FloatArray(0)
  val size=minOf(samples.size.toLong()*targetRate/sourceRate,targetRate.toLong()*maxSeconds,Int.MAX_VALUE.toLong()).toInt()
  return FloatArray(size){i->
   // Convert before multiplying: Int arithmetic overflows after ~3 seconds at 44.1 kHz.
   val at=i.toDouble()*sourceRate/targetRate
   val left=at.toInt().coerceIn(0,samples.lastIndex);val right=min(left+1,samples.lastIndex)
   (samples[left]+(samples[right]-samples[left])*(at-left).coerceIn(0.0,1.0)).toFloat()
  }
 }

 fun fft(real:DoubleArray,imag:DoubleArray){val n=real.size;var j=0;for(i in 1 until n){var bit=n shr 1;while(j and bit!=0){j=j xor bit;bit=bit shr 1};j=j xor bit;if(i<j){val a=real[i];real[i]=real[j];real[j]=a;val b=imag[i];imag[i]=imag[j];imag[j]=b}};var size=2;while(size<=n){for(start in 0 until n step size)for(k in 0 until size/2){val angle=-2*PI*k/size;val a=start+k;val b=a+size/2;val tr=cos(angle)*real[b]-sin(angle)*imag[b];val ti=sin(angle)*real[b]+cos(angle)*imag[b];real[b]=real[a]-tr;imag[b]=imag[a]-ti;real[a]+=tr;imag[a]+=ti};size*=2}}
 fun fbank(samples:FloatArray):FloatArray {
  val result=FloatArray(1024*128);val melPoints=DoubleArray(130){i->1127*ln(1+20.0/700)+(1127*ln(1+8000.0/700)-1127*ln(1+20.0/700))*i/129}
  val filters=Array(128){m->DoubleArray(257){k->val mel=1127*ln(1+(k*16000.0/512)/700);max(0.0,min((mel-melPoints[m])/(melPoints[m+1]-melPoints[m]),(melPoints[m+2]-mel)/(melPoints[m+2]-melPoints[m+1])))}}
  val frames=if(samples.size<400)0 else min(1024,1+(samples.size-400)/160)
  for(frame in 0 until frames){val r=DoubleArray(512);val im=DoubleArray(512);val start=frame*160;val mean=(0 until 400).sumOf{samples[start+it].toDouble()}/400
   for(i in 399 downTo 0){val now=samples[start+i]-mean;val prev=if(i>0)samples[start+i-1]-mean else now;r[i]=(now-.97*prev)*(.5-.5*cos(2*PI*i/399))}
   fft(r,im);for(m in 0 until 128){var power=0.0;for(k in 0..256)power+=(r[k]*r[k]+im[k]*im[k])*filters[m][k];result[frame*128+m]=ln(max(power,1.192092955078125e-7)).toFloat()}
  }
  for(i in result.indices)result[i]=((result[i]+4.2677393)/9.1379948).toFloat()
  return result
 }
 fun signal(samples:FloatArray):Audio {
  val energies=mutableListOf<Double>();for(start in 0 until max(0,samples.size-1600) step 1600)energies+=sqrt((start until start+1600).sumOf{samples[it].toDouble().pow(2)}/1600)
  val mean=energies.average().takeIf{it.isFinite()}?:0.0;val dynamics=if(mean>0)sqrt(energies.sumOf{(it-mean).pow(2)}/max(1,energies.size))/mean else 0.0
  val onset=energies.mapIndexed{i,v->max(0.0,v-(energies.getOrNull(i-1)?:v))};var best=0.0;var lagBest=0
  for(lag in 3..12){var cross=0.0;var aa=0.0;var bb=0.0;for(i in lag until onset.size){cross+=onset[i]*onset[i-lag];aa+=onset[i].pow(2);bb+=onset[i-lag].pow(2)};val c=if(aa*bb>0)cross/sqrt(aa*bb) else 0.0;if(c>best){best=c;lagBest=lag}}
  val chroma=DoubleArray(12);var centroid=0.0;var spectra=0
  for(start in 0 until max(0,samples.size-1024) step 8000){val r=DoubleArray(1024){samples[start+it]*(.5-.5*cos(2*PI*it/1023))};val im=DoubleArray(1024);fft(r,im);var total=0.0;var weighted=0.0;for(k in 1 until 512){val freq=k*16000.0/1024;val mag=hypot(r[k],im[k]);total+=mag;weighted+=mag*freq;if(freq in 80.0..4000.0){val note=(69+12*log2(freq/440)).roundToInt();chroma[(note%12+12)%12]+=mag}};if(total>0){centroid+=weighted/total;spectra++}}
  val sum=chroma.sum().coerceAtLeast(1e-10);return Audio(bpm=if(best>.25&&lagBest>0)(600.0/lagBest).roundToInt().toDouble() else null,brightness=if(spectra>0)centroid/spectra else null,dynamics=dynamics,chroma=chroma.map{it/sum})
 }
}
