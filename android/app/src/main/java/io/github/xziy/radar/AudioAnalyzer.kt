package io.github.xziy.radar

import android.content.Context
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.AudioFormat
import ai.onnxruntime.*
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.security.MessageDigest
import kotlin.math.*

object AudioFeatures {
 fun fft(real:DoubleArray,imag:DoubleArray){val n=real.size;var j=0;for(i in 1 until n){var bit=n shr 1;while(j and bit!=0){j=j xor bit;bit=bit shr 1};j=j xor bit;if(i<j){val a=real[i];real[i]=real[j];real[j]=a;val b=imag[i];imag[i]=imag[j];imag[j]=b}};var size=2;while(size<=n){for(start in 0 until n step size)for(k in 0 until size/2){val angle=-2*PI*k/size;val a=start+k;val b=a+size/2;val tr=cos(angle)*real[b]-sin(angle)*imag[b];val ti=sin(angle)*real[b]+cos(angle)*imag[b];real[b]=real[a]-tr;imag[b]=imag[a]-ti;real[a]+=tr;imag[a]+=ti};size*=2}}
 fun fbank(samples:FloatArray):FloatArray {
  val result=FloatArray(1024*128);val melPoints=DoubleArray(130){i->1127*ln(1+20.0/700)+(1127*ln(1+8000.0/700)-1127*ln(1+20.0/700))*i/129}
  val filters=Array(128){m->DoubleArray(257){k->val mel=1127*ln(1+(k*16000.0/512)/700);max(0.0,min((mel-melPoints[m])/(melPoints[m+1]-melPoints[m]),(melPoints[m+2]-mel)/(melPoints[m+2]-melPoints[m+1])))}}
  val frames=min(1024,max(0,1+(samples.size-400)/160))
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
class AudioAnalyzer(private val context:Context,private val api:Netease,private val progress:(String)->Unit):AutoCloseable {
 private var session:OrtSession?=null
 private val instrumentNames=mapOf("Piano" to "钢琴","Electric piano" to "电钢琴","Guitar" to "吉他","Acoustic guitar" to "原声吉他","Electric guitar" to "电吉他","Bass guitar" to "贝斯","Drum" to "鼓","Drum kit" to "架子鼓","Percussion" to "打击乐","Violin, fiddle" to "小提琴","Cello" to "大提琴","Flute" to "长笛","Saxophone" to "萨克斯","Trumpet" to "小号","Trombone" to "长号","Clarinet" to "单簧管","Harp" to "竖琴","Organ" to "管风琴","Accordion" to "手风琴","Synthesizer" to "合成器","Banjo" to "班卓琴","Ukulele" to "尤克里里","Gong" to "锣","Marimba, xylophone" to "木琴","Mandolin" to "曼陀铃")
 private val checksum="807d244b58a30eaa89f0a721fb841619c696857aabe4eac93769bd0b61497f61"
 private fun digest(file:File):String {val hash=MessageDigest.getInstance("SHA-256");file.inputStream().use{input->val buffer=ByteArray(65536);while(true){val n=input.read(buffer);if(n<0)break;hash.update(buffer,0,n)}};return hash.digest().joinToString(""){"%02x".format(it)}}
 private suspend fun prepare():File {
  val dir=File(context.filesDir,"models/ast").apply{mkdirs()};val file=File(dir,"model-q8.onnx");if(file.exists()&&file.length()==90807386L&&digest(file)==checksum)return file
  val part=File(dir,"model-q8.onnx.part");if(part.length()==90807386L){if(digest(part)==checksum){check(part.renameTo(file)){"无法保存模型文件"};return file}else part.delete()};var offset=part.length();if(offset>90807386L){part.delete();offset=0}
  val url="https://huggingface.co/Xenova/ast-finetuned-audioset-10-10-0.4593/resolve/249a1fbf0286b40e7f1ed687a8ae396997bf7dc6/onnx/model_quantized.onnx"
  val request=Request.Builder().url(url).apply{if(offset>0)header("Range","bytes="+offset+"-")}.build()
  api.client.newBuilder().callTimeout(20,java.util.concurrent.TimeUnit.MINUTES).readTimeout(60,java.util.concurrent.TimeUnit.SECONDS).build().newCall(request).execute().use{response->
   check(response.isSuccessful){"乐器模型下载失败，可稍后继续"};if(response.code==206)check(response.header("Content-Range")?.startsWith("bytes "+offset+"-")==true){"下载范围无效"} else {offset=0}
   java.io.FileOutputStream(part,offset>0).use{out->response.body!!.byteStream().use{input->val buffer=ByteArray(65536);var last=0L;while(true){currentCoroutineContext().ensureActive();val n=input.read(buffer);if(n<0)break;offset+=n;check(offset<=90807386L){"模型文件大小异常"};out.write(buffer,0,n);if(System.currentTimeMillis()-last>500){last=System.currentTimeMillis();progress("首次准备乐器模型 · "+(offset*100/90807386L)+"%")}}}}
  }
  check(part.length()==90807386L&&digest(part)==checksum){"模型校验未通过，请重试下载"};check(part.renameTo(file)){"无法保存模型文件"};return file
 }
 suspend fun analyze(id:Long):Audio {
  if(session==null){val model=prepare();val opts=OrtSession.SessionOptions().apply{setIntraOpNumThreads(2);setInterOpNumThreads(1)};try{session=OrtEnvironment.getEnvironment().createSession(model.absolutePath,opts)}finally{opts.close()}}
  val url=api.playback(id).first;currentCoroutineContext().ensureActive();val samples=decode(url);check(samples.size>16000){"音频片段过短，暂不能识别"}
  val tensor=OnnxTensor.createTensor(OrtEnvironment.getEnvironment(),FloatBuffer.wrap(AudioFeatures.fbank(samples)),longArrayOf(1,1024,128))
  val labels=JSONObject(context.assets.open("ast-config.json").bufferedReader().use{it.readText()}).getJSONObject("id2label")
  val list=mutableListOf<Instrument>();var vocal=0.0
  tensor.use{session!!.run(mapOf(session!!.inputNames.first() to it)).use{result->val values=(result[0].value as Array<*>)[0] as FloatArray;values.forEachIndexed{i,logit->val score=1/(1+exp(-logit.toDouble()));val label=labels.optString(i.toString());instrumentNames[label]?.let{name->if(score>=.12)list+=Instrument(name,score)};if(label in listOf("Singing","Male singing","Female singing","Choir","Vocal music"))vocal=max(vocal,score)}}}
  return AudioFeatures.signal(samples).copy(instruments=list.sortedByDescending{it.confidence}.take(6),vocal=vocal)
 }
 private suspend fun decode(url:String):FloatArray {
  val extractor=MediaExtractor();var codec:MediaCodec?=null
  try{extractor.setDataSource(url,emptyMap());val track=(0 until extractor.trackCount).firstOrNull{extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/")==true}?:error("未找到可分析音频");extractor.selectTrack(track);val format=extractor.getTrackFormat(track);val c=MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!);codec=c;c.configure(format,null,null,0);c.start()
   var rate=format.getInteger(MediaFormat.KEY_SAMPLE_RATE);var channels=format.getInteger(MediaFormat.KEY_CHANNEL_COUNT);var floatPcm=false;var inputEnded=false;var ended=false;val mono=ArrayList<Float>();val info=MediaCodec.BufferInfo();val started=System.nanoTime()
   while(!ended&&mono.size<rate*10){currentCoroutineContext().ensureActive();check((System.nanoTime()-started)/1e9<45){"音频解码超时"};if(!inputEnded){val index=c.dequeueInputBuffer(10000);if(index>=0){val buffer=c.getInputBuffer(index)!!;val n=extractor.readSampleData(buffer,0);if(n<0){c.queueInputBuffer(index,0,0,0,MediaCodec.BUFFER_FLAG_END_OF_STREAM);inputEnded=true}else{c.queueInputBuffer(index,0,n,extractor.sampleTime,0);extractor.advance()}}}
    val out=c.dequeueOutputBuffer(info,10000);if(out==MediaCodec.INFO_OUTPUT_FORMAT_CHANGED){val f=c.outputFormat;rate=f.getInteger(MediaFormat.KEY_SAMPLE_RATE);channels=f.getInteger(MediaFormat.KEY_CHANNEL_COUNT);floatPcm=f.containsKey(MediaFormat.KEY_PCM_ENCODING)&&f.getInteger(MediaFormat.KEY_PCM_ENCODING)==AudioFormat.ENCODING_PCM_FLOAT}
    if(out>=0){val b=c.getOutputBuffer(out)!!.duplicate().order(ByteOrder.LITTLE_ENDIAN);b.position(info.offset);b.limit(info.offset+info.size);while(b.remaining()>=(if(floatPcm)4 else 2)*channels){var sum=0f;repeat(channels){sum+=if(floatPcm)b.float else b.short/32768f};mono+=sum/channels};ended=info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM!=0;c.releaseOutputBuffer(out,false)}
   }
   val size=min(160000,(mono.size*16000.0/rate).toInt());return FloatArray(size){i->val at=i*rate/16000.0;val left=at.toInt().coerceAtMost(mono.size-1);val right=min(left+1,mono.size-1);(mono[left]+(mono[right]-mono[left])*(at-left)).toFloat()}
  }finally{try{codec?.stop()}catch(_:Exception){};codec?.release();extractor.release()}
 }
 override fun close(){session?.close();session=null}
}
