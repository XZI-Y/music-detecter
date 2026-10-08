import io.github.xziy.radar.AudioFeatures
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.*
fun main(args:Array<String>){fun read(path:String):FloatArray{val b=ByteBuffer.wrap(File(path).readBytes()).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer();return FloatArray(b.remaining()).also{b.get(it)}};val wave=read(args[0]);val reference=read(args[1]);val actual=AudioFeatures.fbank(wave);val max=actual.indices.maxOf{abs(actual[it]-reference[it])};println("AST reference maximum difference: $max");check(max<0.005);val b=ByteBuffer.allocate(actual.size*4).order(ByteOrder.LITTLE_ENDIAN);actual.forEach{b.putFloat(it)};File(args[2]).writeBytes(b.array())}
