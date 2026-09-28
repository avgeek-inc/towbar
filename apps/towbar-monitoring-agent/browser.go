package main

const browserScript = `(function(){
  if(window.__towbarAnalytics)return;
  window.__towbarAnalytics=true;
  var identity=%t, last='', previous=document.referrer, current=null, visibleSince=null;
  function allowed(){return navigator.doNotTrack!=='1'&&navigator.globalPrivacyControl!==true}
  function random(){var b=new Uint8Array(16);crypto.getRandomValues(b);return Array.from(b,function(v){return v.toString(16).padStart(2,'0')}).join('')}
  function stored(key,ttl,rolling){
    try{var now=Date.now(), item=JSON.parse(localStorage.getItem(key)||'null');
      if(!item||item.expires<now||!/^[a-f0-9]{32}$/.test(item.id))item={id:random(),expires:now+ttl};
      if(rolling)item.expires=now+ttl;localStorage.setItem(key,JSON.stringify(item));return item.id;
    }catch(e){return ''}
  }
  function send(kind,extra){
    if(!current||!allowed())return;
    var event=Object.assign({kind:kind,path:current.path,referrer:current.referrer,visitor:current.visitor,session:current.session,pageId:current.id,pageStartedAt:current.started},extra||{});
    fetch('/.well-known/towbar-analytics/event',{method:'POST',body:JSON.stringify(event),headers:{'Content-Type':'application/json'},credentials:'omit',keepalive:true}).catch(function(){});
  }
  function flush(){
    if(!allowed()){current=null;last='';visibleSince=null;return}
    if(!current)return;
    if(visibleSince!==null){current.visible+=Math.max(0,performance.now()-visibleSince);visibleSince=null}
    var total=Math.min(86400000,Math.round(current.visible));
    if(total!==current.sent){send('engagement',{visibleMs:total});current.sent=total}
  }
  function page(){
    if(document.visibilityState!=='visible'||!allowed())return;
    var path=location.pathname;
    if(last===path)return;
    flush();
    var referrer='';try{referrer=new URL(previous).origin}catch(e){}
    var started=new Date(Math.max(Date.now(),current?Date.parse(current.started)+1:0)).toISOString();
    current={path:path,referrer:referrer,visitor:'',session:'',id:random(),started:started,visible:0,sent:-1};
    if(identity){current.visitor=stored('towbar_visitor',30*86400000,false);current.session=stored('towbar_session',1800000,true)}
    last=path;previous=location.origin+path;visibleSince=performance.now();
    send('pageview');
  }
  function resume(){
    if(document.visibilityState!=='visible'||!allowed())return;
    if(current&&identity&&stored('towbar_session',1800000,true)!==current.session){last='';page();return}
    page();
    if(current&&visibleSince===null)visibleSince=performance.now();
  }
  ['pushState','replaceState'].forEach(function(name){var original=history[name];history[name]=function(){var result=original.apply(this,arguments);page();return result}});
  addEventListener('popstate',page);
  addEventListener('pageshow',function(e){if(e.persisted){last='';current=null;page()}});
  addEventListener('pagehide',flush);
  document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')flush();else resume()});
  function outbound(e){
    if(e.defaultPrevented||(e.type==='click'?e.button!==0:e.button!==1)||!current||!allowed())return;
    var link=e.target&&e.target.closest?e.target.closest('a[href]'):null;
    if(!link)return;
    try{var url=new URL(link.href,location.origin);if((url.protocol==='https:'||url.protocol==='http:')&&url.hostname!==location.hostname)send('outbound',{destination:url.origin})}catch(error){}
  }
  document.addEventListener('click',outbound);
  document.addEventListener('auxclick',outbound);
  setInterval(function(){
    if(!allowed()){flush();return}
    if(document.visibilityState!=='visible')return;
    flush();
    if(current&&Date.now()-Date.parse(current.started)>23*3600000)last='';
    resume();
  },15000);
  page();
})();`
