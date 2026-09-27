package main

const browserScript = `(function(){
  if(window.__towbarAnalytics)return;
  window.__towbarAnalytics=true;
  var identity=%t, last='', previous=document.referrer;
  function random(){var b=new Uint8Array(16);crypto.getRandomValues(b);return Array.from(b,function(v){return v.toString(16).padStart(2,'0')}).join('')}
  function stored(key,ttl,rolling){
    try{var now=Date.now(), item=JSON.parse(localStorage.getItem(key)||'null');
      if(!item||item.expires<now||!/^[a-f0-9]{32}$/.test(item.id))item={id:random(),expires:now+ttl};
      if(rolling)item.expires=now+ttl;localStorage.setItem(key,JSON.stringify(item));return item.id;
    }catch(e){return ''}
  }
  function page(){
    if(document.visibilityState==='prerender'||navigator.doNotTrack==='1'||navigator.globalPrivacyControl===true)return;
    var path=location.pathname;
    if(last===path)return;
    var referrer='';try{referrer=new URL(previous).origin}catch(e){}
    var event={path:path,referrer:referrer,visitor:'',session:''};
    if(identity){event.visitor=stored('towbar_visitor',30*86400000,false);event.session=stored('towbar_session',1800000,true)}
    last=path;previous=location.origin+path;
    fetch('/.well-known/towbar-analytics/event',{method:'POST',body:JSON.stringify(event),headers:{'Content-Type':'application/json'},credentials:'omit',keepalive:true}).catch(function(){});
  }
  ['pushState','replaceState'].forEach(function(name){var original=history[name];history[name]=function(){var result=original.apply(this,arguments);page();return result}});
  addEventListener('popstate',page);
  addEventListener('pageshow',function(e){if(e.persisted){last='';page()}});
  page();
})();`
