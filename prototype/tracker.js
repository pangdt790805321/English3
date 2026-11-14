/* ============ EHS-AI 访问统计追踪 ============
 * 1) 本机统计：记录到 localStorage（admin.html 数据看板可看）
 * 2) 远程统计：analytics-config.js 配置 goatcounter 后，全站访问上报
 */
(function(){
  const KEY = 'ehs_stats';
  const PAGE2MOD = {
    'index.html':'home', 'home.html':'home', 'scan.html':'scan', 'result.html':'result',
    'hazard-detail.html':'detail', 'report.html':'report', 'log.html':'log',
    'search.html':'search', 'academy.html':'academy', 'profile.html':'profile'
  };
  function stats(){
    try{ return JSON.parse(localStorage.getItem(KEY)) || {pv:{}, mod:{}, events:[], first:Date.now()}; }
    catch(e){ return {pv:{}, mod:{}, events:[], first:Date.now()}; }
  }
  function save(s){ try{ localStorage.setItem(KEY, JSON.stringify(s)); }catch(e){} }

  // 远程上报（GoatCounter）
  const gc = (window.EHS_ANALYTICS && window.EHS_ANALYTICS.goatcounter) || '';
  function remoteCount(path, title){
    if(!gc) return;
    try{
      fetch('https://' + gc + '/p', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ path, title: title || document.title, r: document.referrer || undefined })
      }).catch(()=>{});
    }catch(e){}
  }
  if(gc && !document.querySelector('script[data-goatcounter]')){
    const sc = document.createElement('script');
    sc.async = true; sc.dataset.goatcounter = 'https://' + gc + '/count';
    sc.src = 'https://gc.zgo.at/count.js';
    document.head.appendChild(sc);
  }

  const page = location.pathname.split('/').pop() || 'index.html';
  const s = stats();
  s.pv[page] = (s.pv[page] || 0) + 1;
  const mod = PAGE2MOD[page];
  if(mod){ s.mod[mod] = (s.mod[mod] || 0) + 1; }
  s.last = Date.now();
  save(s);
  remoteCount(page);

  // 显式事件（如 Demo 使用、特定操作）
  window.trackModule = function(name, label){
    const st = stats();
    st.mod[name] = (st.mod[name] || 0) + 1;
    st.events.unshift({ t: Date.now(), name, label });
    st.events = st.events.slice(0, 200);
    save(st);
    remoteCount('/module/' + name, label || name);
  };
})();
