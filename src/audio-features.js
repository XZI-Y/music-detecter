'use strict';
const INSTRUMENTS = { 'Piano':'钢琴', 'Electric piano':'电钢琴', 'Guitar':'吉他', 'Acoustic guitar':'原声吉他', 'Electric guitar':'电吉他', 'Bass guitar':'贝斯', 'Drum':'鼓', 'Drum kit':'架子鼓', 'Percussion':'打击乐', 'Violin, fiddle':'小提琴', 'Cello':'大提琴', 'Flute':'长笛', 'Saxophone':'萨克斯', 'Trumpet':'小号', 'Trombone':'长号', 'Clarinet':'单簧管', 'Harp':'竖琴', 'Organ':'管风琴', 'Accordion':'手风琴', 'Synthesizer':'合成器', 'Banjo':'班卓琴', 'Ukulele':'尤克里里', 'Gong':'锣', 'Marimba, xylophone':'木琴', 'Mandolin':'曼陀铃' };
function fft(input) {
  const n = input.length, real = Float64Array.from(input), imag = new Float64Array(n);
  for (let i=1,j=0; i<n; i++) { let bit=n>>1; for(;j&bit;bit>>=1) j^=bit; j^=bit; if(i<j) [real[i],real[j]]=[real[j],real[i]]; }
  for(let size=2;size<=n;size<<=1) for(let start=0;start<n;start+=size) for(let k=0;k<size/2;k++) {
    const angle=-2*Math.PI*k/size, cos=Math.cos(angle),sin=Math.sin(angle),j=start+k+size/2,i=start+k;
    const tr=cos*real[j]-sin*imag[j],ti=sin*real[j]+cos*imag[j]; real[j]=real[i]-tr;imag[j]=imag[i]-ti;real[i]+=tr;imag[i]+=ti;
  }
  return Array.from({length:n/2},(_,i)=>Math.hypot(real[i],imag[i]));
}
function signalFeatures(clips, sampleRate=16000) {
  let power=0,count=0,centroid=0,spectra=0; const chroma=Array(12).fill(0), envelope=[];
  for(const clip of clips) {
    for(let start=0;start+1600<=clip.length;start+=1600) { let energy=0;for(let i=start;i<start+1600;i++){energy+=clip[i]*clip[i];power+=clip[i]*clip[i];count++;} envelope.push(Math.sqrt(energy/1600)); }
    for(let start=0;start+1024<=clip.length;start+=8000) {
      const window=Float32Array.from(clip.slice(start,start+1024),(x,i)=>x*(.5-.5*Math.cos(2*Math.PI*i/1023)));
      const mag=fft(window);let total=0,weighted=0;
      for(let k=1;k<mag.length;k++){const freq=k*sampleRate/1024;total+=mag[k];weighted+=mag[k]*freq;if(freq>=80&&freq<=4000){const note=Math.round(69+12*Math.log2(freq/440));chroma[(note%12+12)%12]+=mag[k];}}
      if(total>0){centroid+=weighted/total;spectra++;}
    }
  }
  const mean=envelope.reduce((a,b)=>a+b,0)/(envelope.length||1), deviation=Math.sqrt(envelope.reduce((s,x)=>s+(x-mean)**2,0)/(envelope.length||1));
  const onset=envelope.map((x,i)=>Math.max(0,x-(envelope[i-1]||x)));let bpm=null,bpmConfidence=0;
  let maximum=0,bestLag=0;
  for(let lag=3;lag<=12;lag++){let cross=0,a=0,b=0;for(let i=lag;i<onset.length;i++){cross+=onset[i]*onset[i-lag];a+=onset[i]**2;b+=onset[i-lag]**2;}const corr=cross/Math.sqrt(a*b||1);if(corr>maximum){maximum=corr;bestLag=lag;}}
  if(maximum>.25&&bestLag){bpm=Math.round(600/bestLag);bpmConfidence=maximum;}
  const chromaSum=chroma.reduce((a,b)=>a+b,0)||1;
  return { rms:Math.sqrt(power/(count||1)), dynamics:mean?deviation/mean:0, brightness:spectra?centroid/spectra:null, chroma:chroma.map(x=>x/chromaSum), bpm,bpmConfidence };
}
function instrumentFeatures(predictions) {
  const maxima=new Map();let vocal=0;
  for(const list of predictions) for(const item of list){const name=INSTRUMENTS[item.label];if(name&&item.score>=.12)maxima.set(name,Math.max(maxima.get(name)||0,item.score));if(['Singing','Male singing','Female singing','Choir','Vocal music'].includes(item.label))vocal=Math.max(vocal,item.score);}
  return { instruments:[...maxima].sort((a,b)=>b[1]-a[1]).slice(0,6).map(([name,confidence])=>({name,confidence})), vocal, model:'AST-AudioSet-q8', segments:predictions.length };
}
function cosine(a,b){if(!a?.length||a.length!==b?.length)return null;let dot=0,aa=0,bb=0;for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]**2;bb+=b[i]**2;}return aa&&bb?dot/Math.sqrt(aa*bb):null;}
function audioSimilarity(a,b){
  if(!a?.audio||!b?.audio)return {instruments:null,rhythm:null,timbre:null,harmony:null,dynamics:null,vocal:null};
  const x=a.audio,y=b.audio;
  const ax=x.instruments?.map(i=>i.name)||[],by=y.instruments?.map(i=>i.name)||[];
  return {instruments:ax.length&&by.length?ax.filter(n=>by.includes(n)).length/Math.min(ax.length,by.length):null,
    rhythm:x.bpm&&y.bpm?Math.max(0,1-Math.abs(x.bpm-y.bpm)/70):null,
    timbre:x.brightness&&y.brightness?Math.exp(-Math.abs(Math.log(x.brightness/y.brightness))):null,
    harmony:cosine(x.chroma,y.chroma),dynamics:Number.isFinite(x.dynamics)&&Number.isFinite(y.dynamics)?Math.max(0,1-Math.abs(x.dynamics-y.dynamics)):null,
    vocal:Number.isFinite(x.vocal)&&Number.isFinite(y.vocal)?Math.max(0,1-Math.abs(x.vocal-y.vocal)):null};
}
module.exports={INSTRUMENTS,signalFeatures,instrumentFeatures,audioSimilarity,cosine};
