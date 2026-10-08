package io.github.xziy.radar
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test

class QrLoginTest{
 @Test fun waitsUntilConfirmedAndCompletesOnce()=runBlocking{val codes=ArrayDeque(listOf(801,802,803));val seen=mutableListOf<Int>();var waits=0;awaitQrConfirmation({codes.removeFirst()},{seen+=it},{waits++});assertEquals(listOf(801,802,803),seen);assertEquals(2,waits);assertTrue(codes.isEmpty())}
 @Test fun expirationStopsPolling()=runBlocking{var calls=0;try{awaitQrConfirmation({calls++;800},{},{error("must not wait")});fail()}catch(e:IllegalStateException){assertTrue(e.message!!.contains("过期"))};assertEquals(1,calls)}
 @Test fun cancellationDoesNotContinueOrBecomeLoginSuccess()=runBlocking{var calls=0;try{awaitQrConfirmation({calls++;throw CancellationException()},{fail()});fail()}catch(_:CancellationException){};assertEquals(1,calls)}
 @Test fun responseBodyCredentialsAndHeadersBothWork(){assertEquals("MUSIC_U=new; __csrf=c",LoginCookies.merge("MUSIC_U=old",listOf("MUSIC_U=new; Path=/; HttpOnly","__csrf=c; Max-Age=100"),true));assertEquals("MUSIC_U=body; __csrf=c",LoginCookies.merge("MUSIC_U=old",listOf("MUSIC_U=body; __csrf=c"),true))}
 @Test fun confirmedQrCannotReuseOldAccountCredentials(){assertThrows(IllegalStateException::class.java){LoginCookies.merge("MUSIC_U=old",listOf("NMTID=anonymous"),true)}}
 @Test fun emptyCookieRemovesPreviousValue(){assertEquals("deviceId=d",LoginCookies.merge("MUSIC_U=old; deviceId=d",listOf("MUSIC_U=; Path=/")))}
}
