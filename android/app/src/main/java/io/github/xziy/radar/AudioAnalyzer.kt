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

class AudioAnalyzer(private val context:Context,private val api:Netease,private val progress:(String)->Unit):AutoCloseable {
 companion object { const val VERSION="AST-AudioSet-q8-local-v2" }
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
 suspend fun ensureReady(){
  if(session!=null)return
  val model=prepare();val opts=OrtSession.SessionOptions().apply{setIntraOpNumThreads(2);setInterOpNumThreads(1)}
  try{session=OrtEnvironment.getEnvironment().createSession(model.absolutePath,opts)}finally{opts.close()}
 }
 suspend fun analyze(id:Long):Audio {
  ensureReady();progress("正在获取可分析音频");val url=api.playback(id).first;currentCoroutineContext().ensureActive()
  // Fetch through the same TLS/DNS client as metadata, then decode locally.
  val temporary=File.createTempFile("radar-audio-",".tmp",context.cacheDir)
  try {
   val request=Request.Builder().url(url).build()
   api.client.newBuilder().callTimeout(90,java.util.concurrent.TimeUnit.SECONDS).build().newCall(request).execute().use{r->
    check(r.isSuccessful){"音频暂时无法获取（HTTP ${r.code}）"}
    val body=r.body?:error("音频内容为空");check(body.contentLength()<=32*1024*1024){"音频超过本轮临时分析大小上限"}
    temporary.outputStream().use{out->body.byteStream().use{input->val buffer=ByteArray(65536);var total=0L;while(true){currentCoroutineContext().ensureActive();val n=input.read(buffer);if(n<0)break;total+=n;check(total<=32*1024*1024){"音频超过本轮临时分析大小上限"};out.write(buffer,0,n)}}}
   }
   progress("正在解码音频片段");val samples=decode(temporary.absolutePath);check(samples.size>16000){"音频片段过短，暂不能识别"}
   val labels=JSONObject(context.assets.open("ast-config.json").bufferedReader().use{it.readText()}).getJSONObject("id2label")
   val scores=linkedMapOf<String,Double>();var vocal=0.0
   val clips=listOf(samples.copyOfRange(0,min(samples.size,160000)))+if(samples.size>21*16000)listOf(samples.copyOfRange(20*16000,min(samples.size,30*16000))) else emptyList()
   for((index,clip) in clips.withIndex()){currentCoroutineContext().ensureActive();progress("正在识别音频片段 ${index+1} / ${clips.size}")
    OnnxTensor.createTensor(OrtEnvironment.getEnvironment(),FloatBuffer.wrap(AudioFeatures.fbank(clip)),longArrayOf(1,1024,128)).use{tensor->
     session!!.run(mapOf(session!!.inputNames.first() to tensor)).use{result->val values=(result[0].value as Array<*>)[0] as FloatArray
      check(values.size==labels.length()&&values.all{it.isFinite()}){"音频模型输出异常，请重试"}
      values.forEachIndexed{i,logit->val score=1/(1+exp(-logit.toDouble()));val label=labels.optString(i.toString());instrumentNames[label]?.let{name->if(score>=.12)scores[name]=max(scores[name]?:0.0,score)};if(label in listOf("Singing","Male singing","Female singing","Choir","Vocal music"))vocal=max(vocal,score)}
     }
    }
   }
   return AudioFeatures.signal(samples).copy(instruments=scores.entries.sortedByDescending{it.value}.take(6).map{Instrument(it.key,it.value)},vocal=vocal,model=VERSION)
  }finally{temporary.delete()}
 }
 private suspend fun decode(url:String):FloatArray {
  val extractor=MediaExtractor();var codec:MediaCodec?=null
  try{extractor.setDataSource(url);val track=(0 until extractor.trackCount).firstOrNull{extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/")==true}?:error("未找到可分析音频");extractor.selectTrack(track);val format=extractor.getTrackFormat(track);val c=MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!);codec=c;c.configure(format,null,null,0);c.start()
   var rate=format.getInteger(MediaFormat.KEY_SAMPLE_RATE);var channels=format.getInteger(MediaFormat.KEY_CHANNEL_COUNT);var floatPcm=false;var inputEnded=false;var ended=false;val mono=ArrayList<Float>();val info=MediaCodec.BufferInfo();val started=System.nanoTime()
   while(!ended&&mono.size<rate*30){currentCoroutineContext().ensureActive();check((System.nanoTime()-started)/1e9<45){"音频解码超时"};if(!inputEnded){val index=c.dequeueInputBuffer(10000);if(index>=0){val buffer=c.getInputBuffer(index)!!;val n=extractor.readSampleData(buffer,0);if(n<0){c.queueInputBuffer(index,0,0,0,MediaCodec.BUFFER_FLAG_END_OF_STREAM);inputEnded=true}else{c.queueInputBuffer(index,0,n,extractor.sampleTime,0);extractor.advance()}}}
    val out=c.dequeueOutputBuffer(info,10000);if(out==MediaCodec.INFO_OUTPUT_FORMAT_CHANGED){val f=c.outputFormat;rate=f.getInteger(MediaFormat.KEY_SAMPLE_RATE);channels=f.getInteger(MediaFormat.KEY_CHANNEL_COUNT);floatPcm=f.containsKey(MediaFormat.KEY_PCM_ENCODING)&&f.getInteger(MediaFormat.KEY_PCM_ENCODING)==AudioFormat.ENCODING_PCM_FLOAT}
    if(out>=0){if(info.size>0){val b=c.getOutputBuffer(out)!!.duplicate().order(ByteOrder.LITTLE_ENDIAN);b.position(info.offset);b.limit(info.offset+info.size);while(b.remaining()>=(if(floatPcm)4 else 2)*channels){var sum=0f;repeat(channels){sum+=if(floatPcm)b.float else b.short/32768f};mono+=sum/channels}};ended=info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM!=0;c.releaseOutputBuffer(out,false)}
   }
   val size=min(480000,(mono.size*16000.0/rate).toInt());return FloatArray(size){i->val at=i*rate/16000.0;val left=at.toInt().coerceAtMost(mono.size-1);val right=min(left+1,mono.size-1);(mono[left]+(mono[right]-mono[left])*(at-left)).toFloat()}
  }finally{try{codec?.stop()}catch(_:Exception){};codec?.release();extractor.release()}
 }
 override fun close(){session?.close();session=null}
}
