package io.github.xziy.radar
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException
import java.net.SocketException
import java.net.UnknownHostException

class UpdateNetworkTest {
 @Test fun resetUsesOfficialApiFallback(){val tried=mutableListOf<String>();val result=UpdateNetwork.fetch{url->tried+=url;if(tried.size==1)throw SocketException("Connection reset");"manifest"};assertEquals("manifest",result);assertEquals(UpdateNetwork.addresses,tried)}
 @Test fun successDoesNotRequestFallback(){var count=0;assertEquals("manifest",UpdateNetwork.fetch{count++;"manifest"});assertEquals(1,count)}
 @Test fun failureReportsUpdateServiceInsteadOfNetease(){try{UpdateNetwork.fetch{throw UnknownHostException("github")};fail()}catch(e:UpdateConnectionException){assertTrue(NetworkProblems.message(e).contains("GitHub"));assertFalse(NetworkProblems.message(e).contains("网易云"));assertTrue(e.cause is UnknownHostException)}}
 @Test(expected=IllegalStateException::class) fun invalidContentDoesNotTriggerNetworkFallback(){UpdateNetwork.fetch{throw IllegalStateException("invalid manifest")}}
}
