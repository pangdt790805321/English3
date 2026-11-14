/* ============ EHS-AI 共享数据层（数据保存在本机浏览器 localStorage） ============ */

// ---------- 存储 ----------
const Store = {
  get(k, d){ try{ const v = JSON.parse(localStorage.getItem(k)); return v ?? d; }catch(e){ return d; } },
  set(k, v){ localStorage.setItem(k, JSON.stringify(v)); },
  del(k){ localStorage.removeItem(k); }
};

// ---------- 业务数据 ----------
const DB = {
  // 检查任务
  inspections(){ return Store.get('ehs_inspections', []); },
  saveInspection(ins){
    const list = DB.inspections().filter(i => i.id !== ins.id);
    list.unshift(ins);
    Store.set('ehs_inspections', list);
  },
  inspection(id){ return DB.inspections().find(i => i.id === id); },
  currentInspection(){ return DB.inspection(Store.get('ehs_current', null)); },
  setCurrent(id){ Store.set('ehs_current', id); },

  // 隐患
  hazards(){ return Store.get('ehs_hazards', {}); },
  saveHazard(h){
    if(!h.id) h.id = 'H' + Date.now().toString(36) + Math.random().toString(36).slice(2,5);
    if(!h.timeline) h.timeline = [];
    if(!h.status) h.status = 'todo';
    const all = DB.hazards(); all[h.id] = h; Store.set('ehs_hazards', all);
    return h;
  },
  hazard(id){ return DB.hazards()[id]; },
  listHazards(){ return Object.values(DB.hazards()).sort((a,b)=>(b.created||0)-(a.created||0)); },

  // 引用夹
  citations(){ return Store.get('ehs_citations', []); },
  toggleCitation(cid){
    const list = DB.citations();
    const i = list.indexOf(cid);
    if(i >= 0) list.splice(i,1); else list.push(cid);
    Store.set('ehs_citations', list);
    return i < 0;
  },

  // 设置
  apiKey(){ return Store.get('ehs_key',''); },
  model(){ return Store.get('ehs_model','glm-4v-flash'); }
};

function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
function now(){ return new Date(); }
function fmt(d){ const n = new Date(d); const p = x => String(x).padStart(2,'0'); return `${n.getMonth()+1}-${p(n.getDate())} ${p(n.getHours())}:${p(n.getMinutes())}`; }
function todayISO(){ return new Date().toISOString().slice(0,10); }
function addEvent(h, txt){ h.timeline = h.timeline||[]; h.timeline.push({ t: Date.now(), txt }); DB.saveHazard(h); }

// ---------- AI 识别（经本地代理调用多模态模型，BYOK） ----------
async function analyzePhotoAI({ dataUrl, mode, juris, onStep }){
  const step = i => onStep && onStep(i);
  const key = DB.apiKey(); if(!key) throw new Error('NO_KEY');
  const model = DB.model();
  const sys = `你是一名资深 EHS 检查专家。识别照片中可确认的安全隐患，严格按 JSON 数组输出（无其他文字、无 markdown）：
[{"hazard":"隐患描述（中文，具体到部位与问题）","risk":"high|medium|low|review","confidence":0-100,"citation_standard":"建议标准号（不确定填 null）","citation_text":"条文关键内容（简短摘述，禁止编造原文）","fix":"整改建议（一句话，可执行）"}]
要求：只列照片中真实可见、可确认的隐患，宁缺毋滥；无关照片返回 []；置信度低于70用 review；引用偏好：${juris}。`;
  const body = {
    model,
    messages: [
      { role:'system', content: sys },
      { role:'user', content: [
        { type:'image_url', image_url:{ url: dataUrl } },
        { type:'text', text:`检查模式：${mode}。请识别这张照片中的安全隐患，按约定 JSON 输出。` }
      ]}
    ],
    temperature: 0.1
  };
  step(0);
  // 本地环境走 8643 代理；公网托管环境直连开放平台
  const IS_LOCAL = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname);
  let url, headers = { 'Content-Type':'application/json' };
  if(IS_LOCAL){
    url = 'http://' + location.hostname + ':8643/api/analyze';
    headers['X-Api-Key'] = key;
  } else {
    url = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
    headers['Authorization'] = 'Bearer ' + key;
  }
  const resp = await fetch(url, { method:'POST', headers, body: JSON.stringify(body) });
  step(2);
  const data = await resp.json();
  if(!resp.ok) throw new Error(data.error?.message || ('HTTP ' + resp.status));
  const text = data.choices?.[0]?.message?.content || '';
  step(3);
  const m = text.match(/\[[\s\S]*\]/);
  const list = m ? JSON.parse(m[0]) : [];
  step(4);
  return list;
}

// ---------- 图片压缩（缩略图，控制 localStorage 体积） ----------
function compressImage(file, maxW = 520, quality = 0.72){
  return new Promise((resolve, reject)=>{
    const r = new FileReader();
    r.onerror = reject;
    r.onload = ()=>{
      const img = new Image();
      img.onerror = reject;
      img.onload = ()=>{
        const scale = Math.min(1, maxW / img.width);
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.src = r.result;
    };
    r.readAsDataURL(file);
  });
}

// ---------- 通用提示 ----------
function toast(msg){
  let t = document.querySelector('.toast');
  if(!t){ t = document.createElement('div'); t.className='toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(()=>t.classList.remove('show'), 3000);
}

// ---------- 条文库（GB / JGJ / GBZ / TSG / OSHA / ISO，条文为要点摘述，引用请以官方文本为准） ----------
const CLAUSES = [
  // ---- 高处作业 / 临边 ----
  { id:'c01', sys:'GB', code:'JGJ 80-2016', clause:'4.1.1', title:'临边防护栏杆', text:'临边作业应设置防护栏杆，栏杆由横杆、立杆及不低于180mm挡脚板组成，高度不低于1.2m，安全网封闭。', xref:'OSHA 1926.501(b)(1) · ISO 45001 §8.1.2', kw:'临边 防护栏 栏杆 坠落 高处 建筑施工' },
  { id:'c02', sys:'GB', code:'JGJ 80-2016', clause:'4.2', title:'洞口防护', text:'短边尺寸≥500mm的洞口应设置防护栏杆或牢固盖板并固定，加盖板需能承受荷载并有防位移措施。', xref:'OSHA 1926.501(b)(4)', kw:'洞口 盖板 防护 坠落 预留孔' },
  { id:'c03', sys:'GB', code:'GB 6095-2021', clause:'4.2', title:'安全带使用', text:'高处作业应佩戴全身式安全带并系挂于可靠挂点，高挂低用；使用前检查织带、缝线与金属件。', xref:'OSHA 1926.502(d) · EN 361', kw:'安全带 坠落防护 高挂低用 挂点' },
  { id:'c04', sys:'OSHA', code:'29 CFR 1926.501(b)(1)', clause:'', title:'Unprotected sides and edges', text:'Employees on walking/working surfaces with an unprotected side or edge 6 ft or more above a lower level shall be protected by guardrail, safety net, or fall arrest systems.', xref:'GB JGJ 80-2016 §4.1.1', kw:'guardrail edge fall 临边 unprotected' },
  { id:'c05', sys:'OSHA', code:'29 CFR 1926.502(d)', clause:'', title:'Personal fall arrest systems', text:'PFAS shall be inspected prior to each use; anchorages must support 5000 lb per employee attached.', xref:'GB 6095-2021', kw:'harness anchor PFAS 安全带 fall arrest' },
  { id:'c06', sys:'GB', code:'JGJ 80-2016', clause:'5.2', title:'攀登与悬空作业', text:'攀登作业应使用专用爬梯或通道；悬空作业应有牢靠的立足点并配备坠落防护设施。', xref:'OSHA 1926.1053', kw:'攀登 悬空 爬梯 作业' },
  // ---- 脚手架 ----
  { id:'c07', sys:'GB', code:'JGJ 130-2011', clause:'7', title:'脚手架搭设与验收', text:'脚手架应按专项方案搭设；连墙件按两步三跨或方案设置；搭设完成分阶段验收合格后方可使用。', xref:'OSHA 1926.451 · EN 12811', kw:'脚手架 搭设 验收 连墙件 扣件 盘扣' },
  { id:'c08', sys:'GB', code:'JGJ 130-2011', clause:'9', title:'脚手架拆除', text:'拆除应自上而下逐层进行，严禁上下同时作业；连墙件随脚手架逐层拆除，严禁先拆连墙件。', xref:'OSHA 1926.451(d)', kw:'脚手架 拆除 连墙件' },
  { id:'c09', sys:'OSHA', code:'29 CFR 1926.451', clause:'(b)(1)', title:'Scaffold capacity & platform', text:'Scaffolds shall support own weight plus 4x maximum intended load; platforms fully planked with no gaps over 1 inch.', xref:'GB JGJ 130-2011', kw:'scaffold platform planking 脚手架' },
  // ---- 临时用电 ----
  { id:'c10', sys:'GB', code:'JGJ 46-2005', clause:'8.1', title:'配电箱管理', text:'配电箱应上锁、专人管理，箱内无杂物；门处设置安全警示标识；进出线整齐并做防护。', xref:'OSHA 1926.403 · NFPA 70E', kw:'配电箱 上锁 警示 临时用电 电箱' },
  { id:'c11', sys:'GB', code:'JGJ 46-2005', clause:'8.2', title:'漏电保护器', text:'开关箱中漏电保护器额定动作电流≤30mA、动作时间≤0.1s；潮湿场所≤15mA。', xref:'OSHA 1926.404 · IEC 60364', kw:'漏电保护 RCD 30mA 开关箱' },
  { id:'c12', sys:'GB', code:'JGJ 46-2005', clause:'5', title:'接地与防雷', text:'TN-S 系统 PE 线不得断线；保护接地电阻一般≤10Ω（部分场合≤4Ω）；防雷装置按规范设置。', xref:'OSHA 1926.404(f) · IEC 60364-5-54', kw:'接地 电阻 TN-S PE 防雷' },
  { id:'c13', sys:'GB', code:'JGJ 46-2005', clause:'7', title:'电缆敷设', text:'电缆应架空或埋地敷设，严禁沿地面明敷通行处；架空高度、与热力管道距离满足规范。', xref:'OSHA 1926.405', kw:'电缆 敷设 架空 明敷 破皮' },
  { id:'c14', sys:'OSHA', code:'29 CFR 1926.404', clause:'(b)(1)', title:'GFCI protection', text:'All 120V receptacle outlets not part of permanent wiring shall have GFCI protection for personnel.', xref:'GB JGJ 46-2005 §8.2', kw:'GFCI receptacle 漏电 protection' },
  // ---- 动火 ----
  { id:'c15', sys:'GB', code:'GB 30871-2022', clause:'5', title:'动火作业分级与审批', text:'动火作业分特级/一级/二级，实行票证管理；作业前清理可燃物、配备灭火器材、专人监火。', xref:'OSHA 1910.252(a)', kw:'动火 焊接 气割 审批 动火证 监火' },
  { id:'c16', sys:'GB', code:'GB 30871-2022', clause:'6', title:'气体检测判据', text:'动火分析合格判据按 LEL 分档：LEL≥4% 时≤0.5%，LEL<4% 时≤0.2%（体积分数），超过不得作业。', xref:'NFPA 51B', kw:'动火分析 LEL 气体检测 可燃 浓度' },
  { id:'c17', sys:'GB', code:'TSG 23-2021', clause:'气瓶', title:'气瓶存放与间距', text:'氧气瓶与乙炔瓶间距≥5m，与明火距离≥10m；气瓶直立固定存放，防倾倒，避免暴晒。', xref:'OSHA 1910.253(b)', kw:'气瓶 乙炔 氧气 间距 存放 倾倒' },
  { id:'c18', sys:'OSHA', code:'29 CFR 1910.252', clause:'(a)', title:'Welding fire prevention', text:'Welding/cutting shall be authorized; combustibles removed or shielded; fire watch maintained during and 30 min after work.', xref:'GB 30871-2022 §5', kw:'welding hot work fire watch 动火' },
  // ---- 受限空间 ----
  { id:'c19', sys:'GB', code:'GB 30871-2022', clause:'8', title:'受限空间作业审批', text:'受限空间作业实行作业许可；先通风、再检测、后作业；检测氧含量与有害气体合格后方可进入。', xref:'OSHA 1910.146(c)', kw:'受限空间 有限空间 审批 作业票 检测' },
  { id:'c20', sys:'GB', code:'GB 8958-2006', clause:'6', title:'缺氧作业与通风', text:'缺氧危险作业应持续机械通风；氧含量19.5%~23.5%方可进入；作业中连续监测。', xref:'OSHA 1910.146(d)', kw:'缺氧 通风 氧含量 受限空间 硫化氢' },
  { id:'c21', sys:'GB', code:'GB 30871-2022', clause:'8.4', title:'监护与救援', text:'受限空间作业须专人监护，监护人不得离开；救援应佩戴正压式呼吸器，严禁盲目施救。', xref:'OSHA 1910.146(k)', kw:'监护 救援 盲目施救 呼吸器 三脚架' },
  { id:'c22', sys:'OSHA', code:'29 CFR 1910.146', clause:'(c)', title:'Permit-required confined spaces', text:'Employer shall identify permit spaces; entry requires written permit, atmospheric testing, attendant, and rescue arrangements.', xref:'GB 30871-2022 §8', kw:'confined space permit attendant 受限空间' },
  // ---- 起重吊装 ----
  { id:'c23', sys:'GB', code:'GB/T 6067.1-2010', clause:'4', title:'起重机械作业要求', text:'起重作业应有方案与指挥；吊装区域警戒；严禁超载、斜拉斜吊、吊物越过人员。', xref:'OSHA 1926.1400 · ASME B30.5', kw:'吊装 起重 指挥 警戒 超载 斜拉' },
  { id:'c24', sys:'GB', code:'GB/T 5972-2016', clause:'5', title:'钢丝绳检验与报废', text:'钢丝绳断丝、磨损、锈蚀达到报废标准立即更换；吊索具使用前检查，合格标识齐全。', xref:'OSHA 1926.251', kw:'钢丝绳 吊索 报废 断丝 磨损 检查' },
  { id:'c25', sys:'GB', code:'GB/T 6067.1-2010', clause:'10', title:'吊索夹角与受力', text:'多分支吊索夹角增大受力放大：夹角60°时每分支约为垂直的1.15倍，120°时约2倍，避免大夹角吊装。', xref:'ASME B30.9', kw:'吊索 夹角 受力 千斤绳 卸扣' },
  { id:'c26', sys:'OSHA', code:'29 CFR 1926.1407', clause:'', title:'Power line safety', text:'Cranes shall maintain minimum clearance from power lines per Table A; use spotter or insulating measures.', xref:'GB/T 6067.1 §10', kw:'crane power line clearance 高压线 塔吊 触电' },
  // ---- 土方 ----
  { id:'c27', sys:'GB', code:'GB 50797 / JGJ 180-2009', clause:'土方开挖', title:'基坑边坡与支护', text:'基坑开挖按方案放坡或支护；坑边堆载距离与高度受控；严禁在坑边超载堆土堆料。', xref:'OSHA 1926.651', kw:'基坑 土方 边坡 支护 堆载 坍塌 开挖' },
  { id:'c28', sys:'GB', code:'JGJ 180-2009', clause:'8', title:'基坑监测与上下通道', text:'深基坑按规定监测位移与沉降；人员上下应设专用通道，不得攀爬支护或边坡。', xref:'OSHA 1926.651(c)(2)', kw:'基坑 监测 通道 上下 沉降' },
  { id:'c29', sys:'OSHA', code:'29 CFR 1926.651', clause:'(j)', title:'Excavation protective systems', text:'Trenches 5 ft or deeper require protective system; 4 ft+ need ladder within 25 ft of workers; spoils ≥2 ft from edge.', xref:'JGJ 180-2009', kw:'trench excavation protective 基坑 spoil' },
  // ---- 消防 / 危化品 ----
  { id:'c30', sys:'GB', code:'GB 50140-2005', clause:'5', title:'灭火器配置', text:'灭火器按危险等级与场所类型配置，选型匹配；压力指示在绿区；定期检查维护有记录。', xref:'OSHA 1910.157 · EN 3', kw:'灭火器 配置 压力 检查 消防' },
  { id:'c31', sys:'GB', code:'GB 15603-2022', clause:'5', title:'危化品储存', text:'危化品分类分区存放，禁忌物料隔离；剧毒品双人双锁；储存间通风、防爆、防泄漏措施齐全。', xref:'OSHA 1910.106 · NFPA 30', kw:'危化品 储存 双人双锁 禁忌 通风 防爆' },
  { id:'c32', sys:'GB', code:'GB 50444-2008', clause:'建筑灭火器检查维修', title:'消防设施维护', text:'消火栓、喷淋、报警系统定期检测维保，消防通道与安全出口保持畅通，不得占用堵塞。', xref:'NFPA 25', kw:'消火栓 喷淋 消防通道 安全出口 堵塞 维保' },
  { id:'c33', sys:'GB', code:'GB 50016-2014', clause:'3', title:'防火间距与疏散', text:'建（构）筑物间防火间距满足规范；疏散通道宽度、疏散指示与应急照明完好有效。', xref:'NFPA 101', kw:'防火间距 疏散 应急照明 指示标志' },
  { id:'c34', sys:'OSHA', code:'29 CFR 1910.106', clause:'(b)', title:'Flammable liquids storage', text:'Flammable liquids shall be stored in approved containers/cabinets; quantities per control area limited.', xref:'GB 15603-2022', kw:'flammable storage cabinet 易燃 储存' },
  // ---- 职业健康 ----
  { id:'c35', sys:'GB', code:'GBZ 2.2-2007', clause:'噪声', title:'噪声接触限值', text:'8小时等效声级≥85dB(A)须纳入噪声作业管理，配备护听器并落实听力保护计划。', xref:'OSHA 1910.95 · ISO 9612', kw:'噪声 分贝 护听器 耳塞 听力' },
  { id:'c36', sys:'GB', code:'GBZ 2.1-2019', clause:'粉尘', title:'粉尘接触与呼吸防护', text:'粉尘作业应控制接触浓度并配备合规呼吸防护用品，面具与滤棉匹配危害并定期更换。', xref:'OSHA 1910.134 · EN 143', kw:'粉尘 口罩 呼吸器 防尘 滤棉' },
  { id:'c37', sys:'GB', code:'GBZ 2.2-2007', clause:'高温', title:'高温作业', text:'高温作业按 WBGT 指数分级管理，合理安排作息与补水，配备防暑降温措施。', xref:'OSHA 1904.7 / ACGIH TLV', kw:'高温 中暑 WBGT 防暑' },
  { id:'c38', sys:'GB', code:'GB/T 18664-2002', clause:'呼吸防护用品选择', title:'呼吸防护选择', text:'按危害类型与浓度选择呼吸防护等级，指定防护因数满足要求；密合性面罩做适合性检验。', xref:'OSHA 1910.134(f)', kw:'呼吸防护 面罩 适合性 防护因数' },
  // ---- 机械 ----
  { id:'c39', sys:'GB', code:'GB 5083-1999', clause:'5', title:'机械安全防护', text:'机械传动部位应设置防护罩/栏；防护装置与安全距离匹配，不得随意拆除或失效。', xref:'OSHA 1910.212 · ISO 13857', kw:'机械 防护罩 传动 联锁 安全距离' },
  { id:'c40', sys:'GB', code:'GB 24904 / GB/T 15706-2012', clause:'6', title:'手持电动工具', text:'手持电动工具绝缘完好、定期检测；一类工具配漏电保护；砂轮片无裂纹并在有效期内。', xref:'OSHA 1926.302 · EN 62841', kw:'电动工具 砂轮 角磨机 绝缘 检测' },
  { id:'c41', sys:'OSHA', code:'29 CFR 1910.212', clause:'(a)', title:'Machine guarding', text:'One or more methods of machine guarding shall be provided to protect operator from point of operation, ingoing nip points, rotating parts, flying chips/sparks.', xref:'GB 5083', kw:'machine guard 防护 机械 point of operation' },
  // ---- PPE / 现场 ----
  { id:'c42', sys:'GB', code:'GB 2811-2019', clause:'安全帽', title:'安全帽佩戴', text:'进入作业区应正确佩戴安全帽并在有效期内使用；帽衬与帽壳间隙正常，系紧下颏带。', xref:'OSHA 1926.100 · EN 397', kw:'安全帽 佩戴 下颏带 有效期' },
  { id:'c43', sys:'GB', code:'GB 39800.1-2020', clause:'4', title:'个体防护装备配备', text:'按风险评估结果配备 PPE；作业人员正确穿戴，破损或过期及时更换。', xref:'OSHA 1926.95 · EU 2016/425', kw:'PPE 防护用品 配备 反光衣 手套' },
  // ---- 管理 / ISO ----
  { id:'c44', sys:'ISO', code:'ISO 45001:2018', clause:'8.1.2', title:'消除危险源与降低风险', text:'通过层级控制消除危险源与降低职业健康安全风险：消除→替代→工程控制→管理控制→个体防护。', xref:'各法域通用', kw:'层级控制 风险 管理 体系 hierarchy' },
  { id:'c45', sys:'ISO', code:'ISO 45001:2018', clause:'10.2', title:'事件调查与不符合', text:'组织应调查事件并确定根本原因，采取纠正措施防止再发生，保存文件化信息。', xref:'GB/T 45001-2020 §10.2', kw:'事件调查 根因 纠正 事故' },
  { id:'c46', sys:'GB', code:'安全生产法（2021）', clause:'第四十一条', title:'隐患排查治理', text:'生产经营单位应建立健全生产安全事故隐患排查治理制度，采取管理技术措施及时发现并消除隐患，如实记录。', xref:'各行业细则', kw:'隐患排查 治理 制度 记录 法律' },
  { id:'c47', sys:'GB', code:'GB/T 45001-2020', clause:'8.1.1', title:'运行策划和控制', text:'建立过程准则并实施控制，按变更管理要求控制变更，对外包、采购、承包方实施控制。', xref:'ISO 45001:2018 §8.1.1', kw:'运行控制 变更 承包方 外包 采购' },
  { id:'c48', sys:'GB', code:'GB 6441 / GB 6442', clause:'事故管理', title:'事故调查与报告', text:'事故按规定分类报告与调查，坚持"四不放过"：原因未查清不放过、责任人未处理不放过、整改措施未落实不放过、有关人员未受教育不放过。', xref:'ILO C155', kw:'事故 调查 四不放过 报告' },
  { id:'c49', sys:'OSHA', code:'29 CFR 1904', clause:'', title:'Recordkeeping', text:'Employers must record work-related injuries/illnesses on OSHA 300 log; report fatalities within 8 hours, hospitalizations/amputations within 24 hours.', xref:'GB 6441', kw:'recordkeeping injury log OSHA 300' },
  { id:'c50', sys:'GB', code:'GB 30862-2014', clause:'坠落防护装备', title:'坠落防护系统检查', text:'坠落防护装备使用前后检查；发生坠落冲击后的安全带、缓冲器整件报废。', xref:'OSHA 1926.502(d)(20)', kw:'坠落防护 检查 报废 缓冲器' },
];

function findClauses(q){
  if(!q || !q.trim()) return [];
  const kw = q.trim().toLowerCase();
  return CLAUSES.filter(c => (c.title + ' ' + c.text + ' ' + c.code + ' ' + c.kw).toLowerCase().includes(kw));
}
