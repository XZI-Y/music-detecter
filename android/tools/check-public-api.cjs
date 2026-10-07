const fs=require('fs'),crypto=require('crypto');
const source=fs.readFileSync('app/src/main/java/io/github/xziy/radar/Netease.kt','utf8');
const encoded=source.match(/const val PUBLIC="([^"]+)"/)[1];
const pub='-----BEGIN PUBLIC KEY-----\n'+encoded+'\n-----END PUBLIC KEY-----';
const aes=(text,key)=>{const cipher=crypto.createCipheriv('aes-128-cbc',key,Buffer.from('0102030405060708'));return Buffer.concat([cipher.update(text),cipher.final()]).toString('base64');};
function encrypt(data,secret='abcdefghijklmnop'){
 const padded=Buffer.alloc(128);Buffer.from(secret.split('').reverse().join('')).copy(padded,128-16);
 return {params:aes(aes(JSON.stringify(data),'0CoJUm6Qyw8W8jud'),secret),encSecKey:crypto.publicEncrypt({key:pub,padding:crypto.constants.RSA_NO_PADDING},padded).toString('hex')};
}
console.log('crypto fixture',JSON.stringify(encrypt({})));
(async()=>{
 const results=[];
 for(const [path,data] of [['v3/song/detail',{c:'[{"id":347230}]'}],['song/lyric',{id:347230,lv:-1,tv:-1}],['song/enhance/player/url/v1',{ids:'[347230]',level:'standard',encodeType:'aac'}]]){
  try{const response=await fetch('https://music.163.com/weapi/'+path,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Referer':'https://music.163.com/','User-Agent':'Mozilla/5.0'},body:new URLSearchParams(encrypt({...data,e_r:false,csrf_token:''})),signal:AbortSignal.timeout(25000)});const value=await response.json();results.push({endpoint:path,http:response.status,code:value.code,songCount:value.songs?.length,hasLyrics:!!value.lrc?.lyric,hasPlayback:!!value.data?.[0]?.url});}
  catch(e){results.push({endpoint:path,error:e.name});}
 }
 console.log(JSON.stringify(results));fs.mkdirSync('verification',{recursive:true});fs.writeFileSync('verification/public-api.json',JSON.stringify(results,null,2));
})();
