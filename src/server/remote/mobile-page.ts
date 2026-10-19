/**
 * The phone approvals page (GET /m?r=<remote token>). Self-contained: no app bundle, no session token.
 * It can only list what's waiting on the human and answer it, through /remote-api/*.
 */
export const MOBILE_HTML = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex"><meta name="referrer" content="no-referrer">
<title>AgentRoom approvals</title>
<style>
:root{--bg:#f6f8f9;--card:#fff;--fg:#1d262c;--muted:#5f6b74;--line:#e2e7eb;--brand:#0e9a9a;--brand-fg:#f2fdff;--warn:#b7791f;--bad:#c2410c;--ink:#1d262c;--ink-fg:#fff;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#101418;--card:#181e23;--fg:#e8eef2;--muted:#9aa7b0;--line:#2a3238;--brand:#4fcdcd;--brand-fg:#0f2a2e;--warn:#f0b54a;--bad:#f28b6b;--ink:#e8eef2;--ink-fg:#101418;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:calc(16px + env(safe-area-inset-top)) 16px calc(24px + env(safe-area-inset-bottom))}
header{display:flex;align-items:center;gap:10px;margin-bottom:16px}
.mark{width:36px;height:36px;border-radius:99px;border:1px solid var(--line);background:var(--card);display:grid;place-items:center;color:var(--brand)}
h1{font-size:17px;margin:0}small,.muted{color:var(--muted);font-size:13px}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:22px 0 8px}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:14px;margin-bottom:10px;display:flex;flex-direction:column;gap:8px}
code{font:13px ui-monospace,Menlo,monospace;background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:8px 10px;display:block;white-space:pre-wrap;word-break:break-word}
.row{display:flex;gap:8px;flex-wrap:wrap}
button{font:600 15px system-ui,-apple-system,sans-serif;border-radius:99px;padding:12px 16px;border:1px solid var(--line);background:var(--card);color:var(--fg);flex:1;min-height:46px}
button.primary{background:var(--ink);color:var(--ink-fg);border-color:transparent}
button.opt{flex:0 0 auto;padding:8px 14px;min-height:38px;font-weight:500}
button:disabled{opacity:.5}
input,textarea{font:15px system-ui,-apple-system,sans-serif;width:100%;border:1px solid var(--line);background:var(--bg);color:var(--fg);border-radius:16px;padding:11px 14px}
.reason{color:var(--warn);font-size:13px}
.empty{text-align:center;padding:48px 12px;color:var(--muted)}
.err{color:var(--bad);font-size:14px;margin:8px 0}
</style></head><body>
<header><span class="mark" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-linecap="round"><rect x="4.2" y="8.6" width="15.6" height="11" rx="3.6" stroke-width="2"/><path d="M12 8.6V5.1h2.6" stroke-width="2" stroke-linejoin="round"/><path d="M9.6 12.9v2.4M14.4 12.9v2.4" stroke-width="2.2"/><path d="M2.4 12.8v2.6M21.6 12.8v2.6" stroke-width="2"/></svg></span>
<div><h1>AgentRoom</h1><small id="sub">Waiting on you</small></div></header>
<div id="err" class="err" role="alert" hidden></div>
<main id="list" aria-live="polite"></main>
<script>
(function(){
  var q=new URLSearchParams(location.search), token=q.get('r')||sessionStorage.getItem('ar-remote')||'';
  if(q.get('r')){sessionStorage.setItem('ar-remote',token);history.replaceState(null,'','/m');}
  var list=document.getElementById('list'), err=document.getElementById('err'), sub=document.getElementById('sub');
  function h(tag,attrs,kids){var e=document.createElement(tag);for(var k in attrs||{}){if(k==='text')e.textContent=attrs[k];else if(k.slice(0,2)==='on')e.addEventListener(k.slice(2),attrs[k]);else e.setAttribute(k,attrs[k]);}(kids||[]).forEach(function(c){if(c)e.appendChild(c)});return e;}
  function api(path,body){return fetch('/remote-api'+path,{method:body?'POST':'GET',headers:{'content-type':'application/json','x-remote-token':token},body:body?JSON.stringify(body):undefined}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||'Request failed');return j;});});}
  function act(p,body){err.hidden=true;return api(p,body).then(load).catch(function(e){err.textContent=e.message;err.hidden=false;});}
  function section(title,items){if(!items.length)return null;return h('section',{},[h('h2',{text:title})].concat(items));}
  function render(d){
    list.textContent='';
    var n=d.approvals.length+d.questions.length+d.plans.length;
    sub.textContent=n?n+' waiting on you':'Nothing waiting';
    if(!n){list.appendChild(h('div',{class:'empty',text:"You're all caught up. This page refreshes on its own."}));return;}
    list.appendChild(section('Approvals',d.approvals.map(function(a){return h('div',{class:'card'},[
      h('div',{text:a.botName+' wants to use '+a.tool}),h('code',{text:a.summary||a.tool}),h('div',{class:'reason',text:a.reason}),
      h('div',{class:'row'},[h('button',{class:'primary',text:'Approve',onclick:function(){act('/approvals/'+encodeURIComponent(a.requestId),{allow:true});}}),h('button',{text:'Deny',onclick:function(){act('/approvals/'+encodeURIComponent(a.requestId),{allow:false});}})])]);})));
    list.appendChild(section('Questions',d.questions.map(function(x){var inp=h('input',{placeholder:'Type an answer','aria-label':'Answer'});return h('div',{class:'card'},[
      h('div',{text:x.botName+' asks'}),h('div',{text:x.question}),
      x.options.length?h('div',{class:'row'},x.options.map(function(o){return h('button',{class:'opt',text:o,onclick:function(){act('/questions/'+encodeURIComponent(x.id),{answer:o});}});})):null,
      inp,h('button',{class:'primary',text:'Send answer',onclick:function(){if(inp.value.trim())act('/questions/'+encodeURIComponent(x.id),{answer:inp.value});}})]);})));
    list.appendChild(section('Plans to review',d.plans.map(function(p){var fb=h('textarea',{rows:'2',placeholder:'What should change? (optional)','aria-label':'Feedback'});return h('div',{class:'card'},[
      h('div',{text:p.goalId+' · '+p.title}),h('small',{text:p.tasks+' tasks planned'}),fb,
      h('div',{class:'row'},[h('button',{class:'primary',text:'Approve plan',onclick:function(){act('/plans/'+encodeURIComponent(p.goalId)+'/approve',{});}}),h('button',{text:'Request changes',onclick:function(){act('/plans/'+encodeURIComponent(p.goalId)+'/changes',{feedback:fb.value});}})])]);})));
  }
  function load(){return api('/pending').then(render).catch(function(e){err.textContent=e.message==='unauthorized'?'This link expired or was turned off. Open a new one from AgentRoom.':e.message;err.hidden=false;});}
  load();setInterval(function(){if(!document.hidden)load();},4000);
})();
</script></body></html>`;
