'use strict';
const {dateKey,identity}=require('./engine');
function nextDaily(now,hour,todayReady){
 const date=dateKey(now),due=Date.parse(date+'T'+String(hour).padStart(2,'0')+':00:00+08:00');
 return new Date(todayReady?due+86400000:due).toISOString();
}
function dailyRetry(data,now=new Date()){return data.dailyUpdate?.status==='error'&&data.dailyUpdate.date===dateKey(now);}
function dailyStatus(data,connected,busy,now=new Date()){
 const today=dateKey(now),list=data.history.find(h=>h.date===today),attempt=data.dailyUpdate||{};
 const nextAt=nextDaily(now,data.settings.syncHour,!!list);
 let status='scheduled',message='到点后自动准备新的歌单';
 if(!connected){status='disconnected';message='连接网易云后开启每日推荐';}
 else if(!data.settings.sourceConfirmed||!data.settings.analysisStarted){status='setup';message='选择歌单并开始分析后开启每日推荐';}
 else if(attempt.status==='updating'&&busy){status='updating';message='正在为你准备新歌曲';}
 else if(attempt.date===today&&attempt.status==='error'){status='error';message=attempt.message;}
 else if(list){status='ready';message='今日 '+list.songs.length+' 首新推荐已准备好';}
 else if(now.getTime()>=Date.parse(nextAt)){status='due';message='今日歌单待更新，软件运行时会自动补上';}
 return {status,message,date:today,nextAt,updatedAt:list?.createdAt||null,retryAt:attempt.nextRetryAt||null,count:list?.songs.length||0};
}
function recordSeen(data,songs,at=new Date().toISOString()){
 const cutoff=Date.parse(at)-120*86400000;
 const records=new Map((data.seenRecommendations||[]).filter(r=>Date.parse(r.at)>=cutoff).map(r=>[r.id,r]));
 for(const song of songs)if(!records.has(song.id)||Date.parse(records.get(song.id).at)<Date.parse(at))records.set(song.id,{id:song.id,identity:identity(song),at});
 data.seenRecommendations=[...records.values()].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)).slice(-15000);
}
module.exports={dailyStatus,nextDaily,recordSeen,dailyRetry};
