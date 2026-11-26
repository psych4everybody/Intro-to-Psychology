/* Test mode: a timed, full-screen test drawn from the unit's practice bank.
   Students choose sections and 10 to 20 questions. No feedback until they submit.
   Leaving the test window (switching tabs or apps, or exiting full screen) is recorded
   and shown on the results. Nothing is sent anywhere. */
(function(){
"use strict";
var U=window.UNIT;
var CONFIG={secondsPerQuestion:90,minItems:10,maxItems:20,defaultItems:15,warnAt:[300,60]};
var LTR=["A","B","C","D"];
/* For checking changes: add ?speed=60 to the page address to make one minute pass in one second. */
var SPEED=Math.max(1,parseInt(new URLSearchParams(location.search).get("speed"),10)||1);
function $(id){return document.getElementById(id);}
function shuffle(a){a=a.slice();for(var i=a.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var t=a[i];a[i]=a[j];a[j]=t;}return a;}
var store={get:function(k){try{return localStorage.getItem(k);}catch(e){return null;}},set:function(k,v){try{localStorage.setItem(k,v);}catch(e){}}};
function fmt(s){s=Math.max(0,s);var m=Math.floor(s/60),r=s%60;return m+":"+(r<10?"0":"")+r;}
function secKeys(){return Object.keys(U.sections);}
function bank(keys){
  var out=[];keys.forEach(function(k){(U.practice[k]||[]).forEach(function(q,i){out.push({id:k+"-"+i,sec:k,q:q});});});return out;
}

var T=null; /* running test state */
var stageEl;

/* ---------- setup ---------- */
function renderSetup(){
  var keys=secKeys();
  stageEl.innerHTML=
    '<div class="tm-setup">'+

    '<div class="tm-rules"><b>How it works</b><ul>'+
      '<li>The test opens in full screen and hides the rest of the site.</li>'+
      '<li>You have '+(CONFIG.secondsPerQuestion/60).toFixed(1).replace(".0","")+' minutes per question. When time runs out, the test is submitted for you.</li>'+
      '<li>You will not see whether you are right until you submit. You can move between questions, change answers, and flag questions to come back to.</li>'+
      '<li>Leaving the test (switching tabs or apps, or exiting full screen) is recorded and shown on your results.</li>'+
    '</ul></div>'+
    '<fieldset class="tm-field"><legend>Sections</legend><div class="tm-secs">'+
      keys.map(function(k){var n=(U.practice[k]||[]).length;return '<label class="tm-sec"><input type="checkbox" value="'+k+'" checked> <span><b>'+k+'.</b> '+U.sections[k]+' <small>('+n+' questions)</small></span></label>';}).join("")+
    '</div></fieldset>'+
    '<fieldset class="tm-field"><legend>Number of questions</legend>'+
      '<div class="tm-count"><input type="range" id="tmCount" min="'+CONFIG.minItems+'" max="'+CONFIG.maxItems+'" value="'+CONFIG.defaultItems+'" step="1" aria-label="Number of questions"><output id="tmCountOut">'+CONFIG.defaultItems+'</output></div>'+
      '<p class="tm-time" id="tmTime"></p>'+
    '</fieldset>'+
    '<p class="tm-warn" id="tmWarn" hidden></p>'+
    '<div class="actions"><button class="btn btn-primary" id="tmStart">Start test</button></div>'+
    '</div>';
  var range=$("tmCount");
  function update(){
    var chosen=Array.prototype.filter.call(stageEl.querySelectorAll(".tm-secs input"),function(c){return c.checked;}).map(function(c){return c.value;});
    var avail=bank(chosen).length;
    var max=Math.min(CONFIG.maxItems,avail);
    range.max=String(Math.max(CONFIG.minItems,max));
    if(parseInt(range.value,10)>max)range.value=String(Math.max(CONFIG.minItems,max));
    $("tmCountOut").textContent=range.value;
    var n=parseInt(range.value,10);
    $("tmTime").textContent="Time allowed: "+Math.round(n*CONFIG.secondsPerQuestion/60)+" minutes for "+n+" questions.";
    var warn=$("tmWarn"),ok=avail>=CONFIG.minItems;
    warn.hidden=ok;
    if(!ok)warn.textContent=chosen.length?"These sections have "+avail+" questions between them. Add another section to reach "+CONFIG.minItems+".":"Choose at least one section.";
    $("tmStart").disabled=!ok;
  }
  range.addEventListener("input",update);
  Array.prototype.forEach.call(stageEl.querySelectorAll(".tm-secs input"),function(c){c.addEventListener("change",update);});
  $("tmStart").addEventListener("click",function(){
    var chosen=Array.prototype.filter.call(stageEl.querySelectorAll(".tm-secs input"),function(c){return c.checked;}).map(function(c){return c.value;});
    start(chosen,parseInt(range.value,10));
  });
  update();
}

/* ---------- choose items, avoiding the previous test where possible ---------- */
function pick(keys,n){
  var key="intro-psych:"+U.id+":lastTest",last={};
  try{(JSON.parse(store.get(key)||"[]")).forEach(function(id){last[id]=true;});}catch(e){}
  var all=shuffle(bank(keys));
  var fresh=all.filter(function(x){return !last[x.id];}),used=all.filter(function(x){return last[x.id];});
  var chosen=fresh.concat(used).slice(0,n);
  store.set(key,JSON.stringify(chosen.map(function(x){return x.id;})));
  /* keep sections together in a sensible order, shuffled within each */
  var order=secKeys();
  chosen.sort(function(a,b){return order.indexOf(a.sec)-order.indexOf(b.sec);});
  return chosen.map(function(x){var o=shuffle([0,1,2,3]);return {id:x.id,sec:x.sec,q:x.q,order:o,ans:o.indexOf(x.q.answer),pick:null,flag:false};});
}

/* ---------- full screen and leaving ---------- */
function fsElement(){return document.fullscreenElement||document.webkitFullscreenElement||null;}
function enterFS(){
  var el=document.documentElement,fn=el.requestFullscreen||el.webkitRequestFullscreen;
  if(!fn)return false;
  try{var p=fn.call(el);if(p&&p.catch)p.catch(function(){T&&(T.fsBlocked=true);});return true;}catch(e){return false;}
}
function exitFS(){var fn=document.exitFullscreen||document.webkitExitFullscreen;if(fsElement()&&fn){try{fn.call(document);}catch(e){}}}
function left(reason){
  if(!T||T.done)return;
  var now=Date.now();if(now-T.lastLeave<1500)return; /* one event per departure */
  T.lastLeave=now;T.leaves++;T.leaveLog.push({at:T.total-T.left,why:reason});
  $("tmLeaveCount").textContent=T.leaves;
  $("tmAway").hidden=false;
}
function onVis(){if(document.hidden)left("switched away from the page");}
function onFS(){if(T&&!T.done&&T.fsUsed&&!fsElement())left("exited full screen");}
function onUnload(e){if(T&&!T.done){e.preventDefault();e.returnValue="";return "";}}

/* ---------- running the test ---------- */
function start(keys,n){
  T={keys:keys,items:pick(keys,n),i:0,total:n*CONFIG.secondsPerQuestion,left:n*CONFIG.secondsPerQuestion,
     leaves:0,leaveLog:[],lastLeave:0,done:false,timer:null,fsUsed:false,fsBlocked:false,started:Date.now(),warned:{}};
  document.body.classList.add("test-running");
  T.fsUsed=enterFS();
  renderShell();
  renderQ();
  T.timer=setInterval(tick,250);
  document.addEventListener("visibilitychange",onVis);
  document.addEventListener("fullscreenchange",onFS);
  document.addEventListener("webkitfullscreenchange",onFS);
  window.addEventListener("beforeunload",onUnload);
  document.addEventListener("keydown",onKey);
}
function renderShell(){
  stageEl.innerHTML=
    '<div class="tm-bar"><div class="tm-bar-l"><b>'+U.eyebrow+' test</b><span id="tmPos"></span></div>'+
    '<div class="tm-timer" id="tmTimer" role="timer" aria-live="off">'+fmt(T.left)+'</div></div>'+
    '<div class="tm-toast" id="tmToast" hidden></div>'+
    (!T.fsUsed?'<p class="tm-note">Full screen is not available on this device. Leaving the page will still be recorded.</p>':'')+
    '<div id="tmQ"></div>'+
    '<div class="tm-nav"><button class="btn btn-ghost" id="tmPrev">Previous</button><button class="btn btn-ghost tm-flag" id="tmFlag" aria-pressed="false">Flag for review</button><button class="btn btn-slate" id="tmNext">Next</button></div>'+
    '<div class="tm-grid-wrap"><div class="tm-grid-h">Questions <span>(answered, flagged, and current)</span></div><div class="tm-grid" id="tmGrid"></div></div>'+
    '<div class="actions" style="justify-content:center;"><button class="btn btn-primary" id="tmFinish">Finish and submit</button></div>'+
    '<div class="tm-overlay" id="tmAway" hidden><div class="tm-dialog" role="alertdialog" aria-labelledby="tmAwayH"><h3 id="tmAwayH">You left the test</h3><p>This has been recorded on your results. The timer kept running.</p><p class="tm-small">Times you have left this test: <b id="tmLeaveCount">0</b></p><button class="btn btn-primary" id="tmBack">Return to the test</button></div></div>'+
    '<div class="tm-overlay" id="tmConfirm" hidden><div class="tm-dialog" role="alertdialog" aria-labelledby="tmConfirmH"><h3 id="tmConfirmH">Submit your test?</h3><p id="tmConfirmText"></p><div class="actions" style="justify-content:center;"><button class="btn btn-ghost" id="tmKeep">Keep working</button><button class="btn btn-primary" id="tmSubmit">Submit now</button></div></div></div>';
  $("tmPrev").addEventListener("click",function(){go(T.i-1);});
  $("tmNext").addEventListener("click",function(){go(T.i+1);});
  $("tmFlag").addEventListener("click",function(){var it=T.items[T.i];it.flag=!it.flag;renderQ();});
  $("tmFinish").addEventListener("click",askSubmit);
  $("tmBack").addEventListener("click",function(){$("tmAway").hidden=true;if(T.fsUsed&&!fsElement())enterFS();});
  $("tmKeep").addEventListener("click",function(){$("tmConfirm").hidden=true;});
  $("tmSubmit").addEventListener("click",function(){finish(false);});
}
function go(i){if(i<0||i>=T.items.length)return;T.i=i;renderQ();}
function renderQ(){
  var it=T.items[T.i],q=it.q;
  $("tmPos").textContent="Question "+(T.i+1)+" of "+T.items.length;
  $("tmQ").innerHTML='<div class="badges"><span class="badge sec">Section '+it.sec+'</span>'+(it.flag?'<span class="badge app">Flagged</span>':'')+'</div>'+
    '<div class="q-text">'+q.q+'</div><div class="opts" id="tmOpts">'+it.order.map(function(oi,k){
      return '<button class="opt'+(it.pick===k?' chosen':'')+'" data-k="'+k+'" aria-pressed="'+(it.pick===k)+'"><span class="ltr">'+LTR[k]+'</span><span>'+q.opts[oi]+'</span></button>';}).join("")+'</div>';
  Array.prototype.forEach.call(document.querySelectorAll("#tmOpts .opt"),function(b){
    b.addEventListener("click",function(){var k=parseInt(b.dataset.k,10);it.pick=it.pick===k?null:k;renderQ();});
  });
  $("tmPrev").disabled=T.i===0;
  $("tmNext").disabled=T.i===T.items.length-1;
  var f=$("tmFlag");f.textContent=it.flag?"Remove flag":"Flag for review";f.setAttribute("aria-pressed",String(it.flag));
  $("tmGrid").innerHTML=T.items.map(function(x,k){
    var cls="tm-cell"+(x.pick!==null?" done":"")+(x.flag?" flag":"")+(k===T.i?" now":"");
    return '<button class="'+cls+'" data-k="'+k+'" aria-label="Question '+(k+1)+(x.pick!==null?", answered":"")+(x.flag?", flagged":"")+'">'+(k+1)+'</button>';}).join("");
  Array.prototype.forEach.call(document.querySelectorAll("#tmGrid .tm-cell"),function(b){b.addEventListener("click",function(){go(parseInt(b.dataset.k,10));});});
}
function onKey(e){
  if(!T||T.done||!$("tmAway").hidden||!$("tmConfirm").hidden||e.ctrlKey||e.metaKey||e.altKey)return;
  var k=(e.key||"").toUpperCase(),idx=LTR.indexOf(k);
  if(idx<0&&/^[1-4]$/.test(k))idx=parseInt(k,10)-1;
  if(idx>=0){var it=T.items[T.i];it.pick=it.pick===idx?null:idx;renderQ();}
  else if(e.key==="ArrowRight")go(T.i+1);
  else if(e.key==="ArrowLeft")go(T.i-1);
}
function tick(){
  /* Time is measured from the real clock, so it stays accurate even if the browser slows timers in the background. */
  var prev=T.left;
  T.left=T.total-Math.floor((Date.now()-T.started)*SPEED/1000);
  var el=$("tmTimer");if(!el)return;
  el.textContent=fmt(T.left);
  el.classList.toggle("low",T.left<=60);
  CONFIG.warnAt.forEach(function(w){
    if(prev>w&&T.left<=w&&!T.warned[w]&&T.left>0){T.warned[w]=true;var m=$("tmToast");m.textContent=(w>=60?Math.round(w/60)+" minute"+(w>=120?"s":""):w+" seconds")+" left.";m.hidden=false;setTimeout(function(){m.hidden=true;},5000);}
  });
  if(T.left<=0)finish(true);
}
function askSubmit(){
  var blank=T.items.filter(function(x){return x.pick===null;}).length;
  var flagged=T.items.filter(function(x){return x.flag;}).length;
  $("tmConfirmText").textContent=(blank?blank+" question"+(blank>1?"s are":" is")+" unanswered. ":"You have answered every question. ")+(flagged?flagged+" flagged for review. ":"")+"You cannot change your answers after you submit.";
  $("tmConfirm").hidden=false;
}

/* ---------- results ---------- */
function finish(timeUp){
  if(T.done)return;T.done=true;clearInterval(T.timer);
  document.removeEventListener("visibilitychange",onVis);
  document.removeEventListener("fullscreenchange",onFS);
  document.removeEventListener("webkitfullscreenchange",onFS);
  window.removeEventListener("beforeunload",onUnload);
  document.removeEventListener("keydown",onKey);
  exitFS();
  document.body.classList.remove("test-running");
  var n=T.items.length,right=0,bySec={};
  T.items.forEach(function(x){var ok=x.pick===x.ans;x.ok=ok;if(ok)right++;bySec[x.sec]=bySec[x.sec]||{c:0,n:0};bySec[x.sec].n++;if(ok)bySec[x.sec].c++;});
  var used=T.total-Math.max(0,T.left),p=Math.round(right/n*100);
  T.result={right:right,n:n,p:p,used:used,timeUp:timeUp,bySec:bySec};
  var rows=Object.keys(bySec).sort().map(function(k){var r=bySec[k],pc=Math.round(r.c/r.n*100);
    return '<div class="sec-row"><div>'+k+'. '+U.sections[k]+'</div><div class="sec-track"><div class="sec-fill" style="width:'+pc+'%"></div></div><div class="sec-num">'+r.c+'/'+r.n+'</div></div>';}).join("");
  var review=T.items.map(function(x,k){
    var opt=function(i){return i===null?"(no answer)":LTR[i]+". "+x.q.opts[x.order[i]];};
    return '<details class="rev"'+(x.ok?'':' open')+'><summary>'+(x.ok?'&#10003; ':'&#10007; ')+'Question '+(k+1)+' (Section '+x.sec+')</summary><div class="body"><p>'+x.q.q+'</p>'+
      '<p class="'+(x.ok?'right':'you')+'"><strong>Your answer:</strong> '+opt(x.pick)+'</p>'+(x.ok?'':'<p class="right"><strong>Correct answer:</strong> '+opt(x.ans)+'</p>')+
      '<p>'+x.q.why+'</p>'+(x.q.ref?'<p class="ref" style="font-size:.85rem;font-weight:700;color:var(--muted);">'+x.q.ref+'</p>':'')+'</div></details>';}).join("");
  stageEl.innerHTML='<div class="score">'+
    (timeUp?'<div class="fb neutral" style="margin-bottom:14px;">Time is up. Your test was submitted automatically.</div>':'')+
    '<div class="big">'+p+'%</div><div class="lbl">'+right+' correct out of '+n+'</div>'+
    '<div class="tm-facts"><span>Time used: <b>'+fmt(used)+'</b> of '+fmt(T.total)+'</span><span>Left the test: <b>'+T.leaves+'</b> time'+(T.leaves===1?'':'s')+'</span><span>Unanswered: <b>'+T.items.filter(function(x){return x.pick===null;}).length+'</b></span></div>'+
    '<div class="sec-break"><div class="sec-h">By section</div>'+rows+'</div>'+
    '<div class="actions" style="justify-content:center;"><button class="btn btn-primary" id="tmAgain">New test</button><button class="btn btn-ghost" id="tmPrint">Print results</button></div>'+
    '<div class="review"><div class="sec-h">Review every question</div>'+review+'</div></div>';
  $("tmAgain").addEventListener("click",renderSetup);
  $("tmPrint").addEventListener("click",printResults);
  stageEl.scrollIntoView({block:"start"});
}
function printResults(){
  var r=T.result,LT=LTR;
  var rows=T.items.map(function(x,k){var a=function(i){return i===null?"(none)":LT[i];};
    return '<tr><td>'+(k+1)+'</td><td>'+x.sec+'</td><td>'+x.q.q+'</td><td>'+a(x.pick)+'</td><td>'+a(x.ans)+'</td><td>'+(x.ok?"Correct":"Review")+'</td></tr>';}).join("");
  $("printArea").innerHTML='<h1>Intro to Psychology '+U.eyebrow+': '+U.title+'</h1><p>Test mode results</p>'+
    '<p>Name: ______________________________ &nbsp; Date: __________________</p>'+
    '<p>Score: '+r.right+' / '+r.n+' ('+r.p+'%) &nbsp;|&nbsp; Time used: '+fmt(r.used)+' of '+fmt(T.total)+(r.timeUp?' (time ran out)':'')+' &nbsp;|&nbsp; Left the test: '+T.leaves+' time'+(T.leaves===1?'':'s')+'</p>'+
    '<p>Sections: '+T.keys.map(function(k){return k+". "+U.sections[k];}).join(", ")+'</p>'+
    '<table><tr><th>#</th><th>Sec.</th><th>Question</th><th>Your answer</th><th>Correct</th><th>Result</th></tr>'+rows+'</table>';
  document.body.classList.add("printing-summary");
  var done=function(){document.body.classList.remove("printing-summary");window.removeEventListener("afterprint",done);};
  window.addEventListener("afterprint",done);
  try{window.print();}catch(e){done();}
}

function setup(){
  stageEl=$("testStage");if(!stageEl)return;
  renderSetup();
  window.addEventListener("hashchange",function(){if(T&&!T.done&&location.hash!=="#test")location.hash="test";});
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",setup);else setup();
})();
