package io.github.xziy.radar
import org.junit.Assert.*
import org.junit.Test
import java.net.UnknownHostException

class NetworkSupportTest {
 @Test fun compressedAnswerDecodes(){val q=DnsWire.query("music.163.com");val reply=q.copyOf().apply{this[2]=0x81.toByte();this[3]=0x80.toByte();this[7]=1}+byteArrayOf(0xc0.toByte(),12,0,1,0,1,0,0,0,60,0,4,1,2,3,4);val answers=DnsWire.addresses(reply);assertEquals(1,answers.size);assertArrayEquals(byteArrayOf(1,2,3,4),answers[0])}
 @Test fun errorAndTruncatedResponsesRejected(){val q=DnsWire.query("music.163.com").apply{this[2]=0x81.toByte();this[3]=0x83.toByte()};assertThrows(IllegalArgumentException::class.java){DnsWire.addresses(q)};assertThrows(IllegalArgumentException::class.java){DnsWire.addresses(byteArrayOf(0,1))}}
 @Test fun malformedRecordRejected(){val q=DnsWire.query("music.163.com").apply{this[2]=0x81.toByte();this[3]=0x80.toByte();this[7]=1};assertThrows(IllegalArgumentException::class.java){DnsWire.addresses(q+byteArrayOf(0xc0.toByte()))}}
 @Test fun unrelatedHostsNeverUseFallback(){assertTrue(DnsWire.eligible("music.163.com"));assertTrue(DnsWire.eligible("interface.music.163.com"));assertTrue(DnsWire.eligible("m10.music.126.net"));assertFalse(DnsWire.eligible("music.163.com.example.com"));assertFalse(DnsWire.eligible("huggingface.co"))}
 @Test fun nestedDnsErrorHasFriendlyMessage(){val error=IllegalStateException("failed",UnknownHostException("music.163.com"));assertTrue(NetworkProblems.dns(error));assertTrue(NetworkProblems.message(error).contains("域名解析失败"));assertFalse(NetworkProblems.message(error).contains("unable to resolve host"))}
}
