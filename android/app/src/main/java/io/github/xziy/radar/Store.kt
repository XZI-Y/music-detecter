package io.github.xziy.radar

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import android.util.Base64
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class Store(private val context:Context) {
 val json=Json { ignoreUnknownKeys=true; encodeDefaults=true }
 var readProblem:String=""
 private set
 private val state=AtomicFile(File(context.filesDir,"radar.json"))
 @Synchronized fun read():Data=try { json.decodeFromString<Data>(state.openRead().bufferedReader().use{it.readText()}) }catch(_:Exception){val file=File(context.filesDir,"radar.json");if(file.exists()){runCatching{file.copyTo(File(context.filesDir,"radar-backup-"+System.currentTimeMillis()+".json"))};readProblem="旧资料未能完整读取，已保留备份。请重新选择歌单分析"};Data()}
 @Synchronized fun save(value:Data){val out=state.startWrite();try{out.write(json.encodeToString(value).toByteArray());state.finishWrite(out)}catch(e:Exception){state.failWrite(out);throw e}}
 private fun key():SecretKey {val store=KeyStore.getInstance("AndroidKeyStore").apply{load(null)};return (store.getKey("radar-session",null) as? SecretKey)?:KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore").run{init(KeyGenParameterSpec.Builder("radar-session",KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());generateKey()}}
 @Synchronized fun cookie():String {return try{val encoded=context.getSharedPreferences("account",0).getString("session",null)?:return "";val bytes=Base64.decode(encoded,Base64.NO_WRAP);val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),GCMParameterSpec(128,bytes.copyOfRange(0,12)));String(cipher.doFinal(bytes.copyOfRange(12,bytes.size)))}catch(_:Exception){""}}
 @Synchronized fun cookie(value:String){val prefs=context.getSharedPreferences("account",0);if(value.isBlank()){prefs.edit().remove("session").commit();return};val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());check(prefs.edit().putString("session",Base64.encodeToString(cipher.iv+cipher.doFinal(value.toByteArray()),Base64.NO_WRAP)).commit())}
}
