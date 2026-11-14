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
  { id:'c01', cat:'高处作业', sys:'GB', code:'JGJ 80-2016', clause:'4.1.1', title:'临边防护栏杆', text:'临边作业应设置防护栏杆，栏杆由横杆、立杆及不低于180mm挡脚板组成，高度不低于1.2m，安全网封闭。', xref:'OSHA 1926.501(b)(1) · ISO 45001 §8.1.2', kw:'临边 防护栏 栏杆 坠落 高处 建筑施工' },
  { id:'c02', cat:'高处作业', sys:'GB', code:'JGJ 80-2016', clause:'4.2', title:'洞口防护', text:'短边尺寸≥500mm的洞口应设置防护栏杆或牢固盖板并固定，加盖板需能承受荷载并有防位移措施。', xref:'OSHA 1926.501(b)(4)', kw:'洞口 盖板 防护 坠落 预留孔' },
  { id:'c03', cat:'高处作业', sys:'GB', code:'GB 6095-2021', clause:'4.2', title:'安全带使用', text:'高处作业应佩戴全身式安全带并系挂于可靠挂点，高挂低用；使用前检查织带、缝线与金属件。', xref:'OSHA 1926.502(d) · EN 361', kw:'安全带 坠落防护 高挂低用 挂点' },
  { id:'c04', cat:'高处作业', sys:'OSHA', code:'29 CFR 1926.501(b)(1)', clause:'', title:'临边与未防护边缘（美国）', text:'在无防护边缘（距下方1.8米/6英尺以上）的行走作业面上，人员必须通过防护栏杆、安全网或坠落制动系统进行保护。', xref:'GB JGJ 80-2016 §4.1.1', kw:'guardrail edge fall 临边 unprotected' },
  { id:'c05', cat:'高处作业', sys:'OSHA', code:'29 CFR 1926.502(d)', clause:'', title:'个人坠落制动系统（美国）', text:'坠落制动系统每次使用前应检查；挂点须能承受每名系挂人员约2270公斤（5000磅）。', xref:'GB 6095-2021', kw:'harness anchor PFAS 安全带 fall arrest' },
  { id:'c06', cat:'高处作业', sys:'GB', code:'JGJ 80-2016', clause:'5.2', title:'攀登与悬空作业', text:'攀登作业应使用专用爬梯或通道；悬空作业应有牢靠的立足点并配备坠落防护设施。', xref:'OSHA 1926.1053', kw:'攀登 悬空 爬梯 作业' },
  // ---- 脚手架 ----
  { id:'c07', cat:'脚手架', sys:'GB', code:'JGJ 130-2011', clause:'7', title:'脚手架搭设与验收', text:'脚手架应按专项方案搭设；连墙件按两步三跨或方案设置；搭设完成分阶段验收合格后方可使用。', xref:'OSHA 1926.451 · EN 12811', kw:'脚手架 搭设 验收 连墙件 扣件 盘扣' },
  { id:'c08', cat:'脚手架', sys:'GB', code:'JGJ 130-2011', clause:'9', title:'脚手架拆除', text:'拆除应自上而下逐层进行，严禁上下同时作业；连墙件随脚手架逐层拆除，严禁先拆连墙件。', xref:'OSHA 1926.451(d)', kw:'脚手架 拆除 连墙件' },
  { id:'c09', cat:'脚手架', sys:'OSHA', code:'29 CFR 1926.451', clause:'(b)(1)', title:'脚手架承载与平台（美国）', text:'脚手架须承受自重加4倍最大预期荷载；作业平台满铺脚手板，间隙不超过1英寸（约2.5厘米）。', xref:'GB JGJ 130-2011', kw:'scaffold platform planking 脚手架' },
  // ---- 临时用电 ----
  { id:'c10', cat:'临时用电', sys:'GB', code:'JGJ 46-2005', clause:'8.1', title:'配电箱管理', text:'配电箱应上锁、专人管理，箱内无杂物；门处设置安全警示标识；进出线整齐并做防护。', xref:'OSHA 1926.403 · NFPA 70E', kw:'配电箱 上锁 警示 临时用电 电箱' },
  { id:'c11', cat:'临时用电', sys:'GB', code:'JGJ 46-2005', clause:'8.2', title:'漏电保护器', text:'开关箱中漏电保护器额定动作电流≤30mA、动作时间≤0.1s；潮湿场所≤15mA。', xref:'OSHA 1926.404 · IEC 60364', kw:'漏电保护 RCD 30mA 开关箱' },
  { id:'c12', cat:'临时用电', sys:'GB', code:'JGJ 46-2005', clause:'5', title:'接地与防雷', text:'TN-S 系统 PE 线不得断线；保护接地电阻一般≤10Ω（部分场合≤4Ω）；防雷装置按规范设置。', xref:'OSHA 1926.404(f) · IEC 60364-5-54', kw:'接地 电阻 TN-S PE 防雷' },
  { id:'c13', cat:'临时用电', sys:'GB', code:'JGJ 46-2005', clause:'7', title:'电缆敷设', text:'电缆应架空或埋地敷设，严禁沿地面明敷通行处；架空高度、与热力管道距离满足规范。', xref:'OSHA 1926.405', kw:'电缆 敷设 架空 明敷 破皮' },
  { id:'c14', cat:'临时用电', sys:'OSHA', code:'29 CFR 1926.404', clause:'(b)(1)', title:'漏电保护（美国）', text:'非永久线路的120伏插座回路必须配备人员防护用漏电保护器（GFCI）。', xref:'GB JGJ 46-2005 §8.2', kw:'GFCI receptacle 漏电 protection' },
  // ---- 动火 ----
  { id:'c15', cat:'动火作业', sys:'GB', code:'GB 30871-2022', clause:'5', title:'动火作业分级与审批', text:'动火作业分特级/一级/二级，实行票证管理；作业前清理可燃物、配备灭火器材、专人监火。', xref:'OSHA 1910.252(a)', kw:'动火 焊接 气割 审批 动火证 监火' },
  { id:'c16', cat:'动火作业', sys:'GB', code:'GB 30871-2022', clause:'6', title:'气体检测判据', text:'动火分析合格判据按 LEL 分档：LEL≥4% 时≤0.5%，LEL<4% 时≤0.2%（体积分数），超过不得作业。', xref:'NFPA 51B', kw:'动火分析 LEL 气体检测 可燃 浓度' },
  { id:'c17', cat:'动火作业', sys:'GB', code:'TSG 23-2021', clause:'气瓶', title:'气瓶存放与间距', text:'氧气瓶与乙炔瓶间距≥5m，与明火距离≥10m；气瓶直立固定存放，防倾倒，避免暴晒。', xref:'OSHA 1910.253(b)', kw:'气瓶 乙炔 氧气 间距 存放 倾倒' },
  { id:'c18', cat:'动火作业', sys:'OSHA', code:'29 CFR 1910.252', clause:'(a)', title:'动火防火（美国）', text:'焊接切割须经授权；可燃物移除或隔离；作业期间及结束后30分钟设专人监火。', xref:'GB 30871-2022 §5', kw:'welding hot work fire watch 动火' },
  // ---- 受限空间 ----
  { id:'c19', cat:'受限空间', sys:'GB', code:'GB 30871-2022', clause:'8', title:'受限空间作业审批', text:'受限空间作业实行作业许可；先通风、再检测、后作业；检测氧含量与有害气体合格后方可进入。', xref:'OSHA 1910.146(c)', kw:'受限空间 有限空间 审批 作业票 检测' },
  { id:'c20', cat:'受限空间', sys:'GB', code:'GB 8958-2006', clause:'6', title:'缺氧作业与通风', text:'缺氧危险作业应持续机械通风；氧含量19.5%~23.5%方可进入；作业中连续监测。', xref:'OSHA 1910.146(d)', kw:'缺氧 通风 氧含量 受限空间 硫化氢' },
  { id:'c21', cat:'受限空间', sys:'GB', code:'GB 30871-2022', clause:'8.4', title:'监护与救援', text:'受限空间作业须专人监护，监护人不得离开；救援应佩戴正压式呼吸器，严禁盲目施救。', xref:'OSHA 1910.146(k)', kw:'监护 救援 盲目施救 呼吸器 三脚架' },
  { id:'c22', cat:'受限空间', sys:'OSHA', code:'29 CFR 1910.146', clause:'(c)', title:'许可类受限空间（美国）', text:'用人单位应识别许可类受限空间；进入须书面许可、气体检测、专人监护并落实救援安排。', xref:'GB 30871-2022 §8', kw:'confined space permit attendant 受限空间' },
  // ---- 起重吊装 ----
  { id:'c23', cat:'起重吊装', sys:'GB', code:'GB/T 6067.1-2010', clause:'4', title:'起重机械作业要求', text:'起重作业应有方案与指挥；吊装区域警戒；严禁超载、斜拉斜吊、吊物越过人员。', xref:'OSHA 1926.1400 · ASME B30.5', kw:'吊装 起重 指挥 警戒 超载 斜拉' },
  { id:'c24', cat:'起重吊装', sys:'GB', code:'GB/T 5972-2016', clause:'5', title:'钢丝绳检验与报废', text:'钢丝绳断丝、磨损、锈蚀达到报废标准立即更换；吊索具使用前检查，合格标识齐全。', xref:'OSHA 1926.251', kw:'钢丝绳 吊索 报废 断丝 磨损 检查' },
  { id:'c25', cat:'起重吊装', sys:'GB', code:'GB/T 6067.1-2010', clause:'10', title:'吊索夹角与受力', text:'多分支吊索夹角增大受力放大：夹角60°时每分支约为垂直的1.15倍，120°时约2倍，避免大夹角吊装。', xref:'ASME B30.9', kw:'吊索 夹角 受力 千斤绳 卸扣' },
  { id:'c26', cat:'起重吊装', sys:'OSHA', code:'29 CFR 1926.1407', clause:'', title:'起重机与电力线安全距离（美国）', text:'起重机械与架空电力线须保持规范表格要求的最小距离；设观察哨或采取绝缘措施。', xref:'GB/T 6067.1 §10', kw:'crane power line clearance 高压线 塔吊 触电' },
  // ---- 土方 ----
  { id:'c27', cat:'土方基坑', sys:'GB', code:'GB 50797 / JGJ 180-2009', clause:'土方开挖', title:'基坑边坡与支护', text:'基坑开挖按方案放坡或支护；坑边堆载距离与高度受控；严禁在坑边超载堆土堆料。', xref:'OSHA 1926.651', kw:'基坑 土方 边坡 支护 堆载 坍塌 开挖' },
  { id:'c28', cat:'土方基坑', sys:'GB', code:'JGJ 180-2009', clause:'8', title:'基坑监测与上下通道', text:'深基坑按规定监测位移与沉降；人员上下应设专用通道，不得攀爬支护或边坡。', xref:'OSHA 1926.651(c)(2)', kw:'基坑 监测 通道 上下 沉降' },
  { id:'c29', cat:'土方基坑', sys:'OSHA', code:'29 CFR 1926.651', clause:'(j)', title:'开挖防护系统（美国）', text:'深度1.5米（5英尺）以上的沟槽须设防护系统；1.2米以上须在7.6米内设置梯子；弃土距沟边至少0.6米。', xref:'JGJ 180-2009', kw:'trench excavation protective 基坑 spoil' },
  // ---- 消防 / 危化品 ----
  { id:'c30', cat:'消防安全', sys:'GB', code:'GB 50140-2005', clause:'5', title:'灭火器配置', text:'灭火器按危险等级与场所类型配置，选型匹配；压力指示在绿区；定期检查维护有记录。', xref:'OSHA 1910.157 · EN 3', kw:'灭火器 配置 压力 检查 消防' },
  { id:'c31', cat:'危化品', sys:'GB', code:'GB 15603-2022', clause:'5', title:'危化品储存', text:'危化品分类分区存放，禁忌物料隔离；剧毒品双人双锁；储存间通风、防爆、防泄漏措施齐全。', xref:'OSHA 1910.106 · NFPA 30', kw:'危化品 储存 双人双锁 禁忌 通风 防爆' },
  { id:'c32', cat:'消防安全', sys:'GB', code:'GB 50444-2008', clause:'建筑灭火器检查维修', title:'消防设施维护', text:'消火栓、喷淋、报警系统定期检测维保，消防通道与安全出口保持畅通，不得占用堵塞。', xref:'NFPA 25', kw:'消火栓 喷淋 消防通道 安全出口 堵塞 维保' },
  { id:'c33', cat:'消防安全', sys:'GB', code:'GB 50016-2014', clause:'3', title:'防火间距与疏散', text:'建（构）筑物间防火间距满足规范；疏散通道宽度、疏散指示与应急照明完好有效。', xref:'NFPA 101', kw:'防火间距 疏散 应急照明 指示标志' },
  { id:'c34', cat:'危化品', sys:'OSHA', code:'29 CFR 1910.106', clause:'(b)', title:'易燃液体储存（美国）', text:'易燃液体应存放于经认证的容器/防火安全柜中；每个控制区的存放数量受限。', xref:'GB 15603-2022', kw:'flammable storage cabinet 易燃 储存' },
  // ---- 职业健康 ----
  { id:'c35', cat:'职业健康', sys:'GB', code:'GBZ 2.2-2007', clause:'噪声', title:'噪声接触限值', text:'8小时等效声级≥85dB(A)须纳入噪声作业管理，配备护听器并落实听力保护计划。', xref:'OSHA 1910.95 · ISO 9612', kw:'噪声 分贝 护听器 耳塞 听力' },
  { id:'c36', cat:'职业健康', sys:'GB', code:'GBZ 2.1-2019', clause:'粉尘', title:'粉尘接触与呼吸防护', text:'粉尘作业应控制接触浓度并配备合规呼吸防护用品，面具与滤棉匹配危害并定期更换。', xref:'OSHA 1910.134 · EN 143', kw:'粉尘 口罩 呼吸器 防尘 滤棉' },
  { id:'c37', cat:'职业健康', sys:'GB', code:'GBZ 2.2-2007', clause:'高温', title:'高温作业', text:'高温作业按 WBGT 指数分级管理，合理安排作息与补水，配备防暑降温措施。', xref:'OSHA 1904.7 / ACGIH TLV', kw:'高温 中暑 WBGT 防暑' },
  { id:'c38', cat:'职业健康', sys:'GB', code:'GB/T 18664-2002', clause:'呼吸防护用品选择', title:'呼吸防护选择', text:'按危害类型与浓度选择呼吸防护等级，指定防护因数满足要求；密合性面罩做适合性检验。', xref:'OSHA 1910.134(f)', kw:'呼吸防护 面罩 适合性 防护因数' },
  // ---- 机械 ----
  { id:'c39', cat:'机械安全', sys:'GB', code:'GB 5083-1999', clause:'5', title:'机械安全防护', text:'机械传动部位应设置防护罩/栏；防护装置与安全距离匹配，不得随意拆除或失效。', xref:'OSHA 1910.212 · ISO 13857', kw:'机械 防护罩 传动 联锁 安全距离' },
  { id:'c40', cat:'机械安全', sys:'GB', code:'GB 24904 / GB/T 15706-2012', clause:'6', title:'手持电动工具', text:'手持电动工具绝缘完好、定期检测；一类工具配漏电保护；砂轮片无裂纹并在有效期内。', xref:'OSHA 1926.302 · EN 62841', kw:'电动工具 砂轮 角磨机 绝缘 检测' },
  { id:'c41', cat:'机械安全', sys:'OSHA', code:'29 CFR 1910.212', clause:'(a)', title:'机械防护（美国）', text:'必须为机械设置一种或多种防护装置，使操作者免受作业点、卷入夹点、旋转部件及飞溅碎屑/火花的伤害。', xref:'GB 5083', kw:'machine guard 防护 机械 point of operation' },
  // ---- PPE / 现场 ----
  { id:'c42', cat:'个体防护', sys:'GB', code:'GB 2811-2019', clause:'安全帽', title:'安全帽佩戴', text:'进入作业区应正确佩戴安全帽并在有效期内使用；帽衬与帽壳间隙正常，系紧下颏带。', xref:'OSHA 1926.100 · EN 397', kw:'安全帽 佩戴 下颏带 有效期' },
  { id:'c43', cat:'个体防护', sys:'GB', code:'GB 39800.1-2020', clause:'4', title:'个体防护装备配备', text:'按风险评估结果配备 PPE；作业人员正确穿戴，破损或过期及时更换。', xref:'OSHA 1926.95 · EU 2016/425', kw:'PPE 防护用品 配备 反光衣 手套' },
  // ---- 管理 / ISO ----
  { id:'c44', cat:'管理体系', sys:'ISO', code:'ISO 45001:2018', clause:'8.1.2', title:'消除危险源与降低风险', text:'通过层级控制消除危险源与降低职业健康安全风险：消除→替代→工程控制→管理控制→个体防护。', xref:'各法域通用', kw:'层级控制 风险 管理 体系 hierarchy' },
  { id:'c45', cat:'管理体系', sys:'ISO', code:'ISO 45001:2018', clause:'10.2', title:'事件调查与不符合', text:'组织应调查事件并确定根本原因，采取纠正措施防止再发生，保存文件化信息。', xref:'GB/T 45001-2020 §10.2', kw:'事件调查 根因 纠正 事故' },
  { id:'c46', cat:'管理体系', sys:'GB', code:'安全生产法（2021）', clause:'第四十一条', title:'隐患排查治理', text:'生产经营单位应建立健全生产安全事故隐患排查治理制度，采取管理技术措施及时发现并消除隐患，如实记录。', xref:'各行业细则', kw:'隐患排查 治理 制度 记录 法律' },
  { id:'c47', cat:'管理体系', sys:'GB', code:'GB/T 45001-2020', clause:'8.1.1', title:'运行策划和控制', text:'建立过程准则并实施控制，按变更管理要求控制变更，对外包、采购、承包方实施控制。', xref:'ISO 45001:2018 §8.1.1', kw:'运行控制 变更 承包方 外包 采购' },
  { id:'c48', cat:'应急管理', sys:'GB', code:'GB 6441 / GB 6442', clause:'事故管理', title:'事故调查与报告', text:'事故按规定分类报告与调查，坚持"四不放过"：原因未查清不放过、责任人未处理不放过、整改措施未落实不放过、有关人员未受教育不放过。', xref:'ILO C155', kw:'事故 调查 四不放过 报告' },
  { id:'c49', cat:'应急管理', sys:'OSHA', code:'29 CFR 1904', clause:'', title:'工伤记录与报告（美国）', text:'用人单位须在OSHA 300日志记录工伤与职业病；死亡事故8小时内报告，住院/截肢事故24小时内报告。', xref:'GB 6441', kw:'recordkeeping injury log OSHA 300' },
  { id:'c50', cat:'高处作业', sys:'GB', code:'GB 30862-2014', clause:'坠落防护装备', title:'坠落防护系统检查', text:'坠落防护装备使用前后检查；发生坠落冲击后的安全带、缓冲器整件报废。', xref:'OSHA 1926.502(d)(20)', kw:'坠落防护 检查 报废 缓冲器' },
// ---- 高处作业（补充） ----
  { id:'c51', cat:'高处作业', sys:'GB', code:'GB 5725-2009', clause:'5', title:'安全网选用与搭设', text:'安全网分为平网、立网及密目式安全立网；密目网网目密度不低于800目/100cm²，阻燃、耐贯穿性能合格；首层网与随层网按规定设置。', xref:'JGJ 80-2016 §6', kw:'安全网 密目网 平网 立网 首层' },
  { id:'c52', cat:'高处作业', sys:'GB', code:'GB/T 3608-2008', clause:'4', title:'高处作业分级', text:'作业面距坠落基准面2m及以上为高处作业；按高度2~5m、5~15m、15~30m、30m以上分为一至四级，级别越高管控越严。', xref:'GB 30871-2022 §6', kw:'高处作业 分级 2米 30米' },
  { id:'c53', cat:'高处作业', sys:'GB', code:'GB 30871-2022', clause:'6', title:'高处作业前设备与气候确认', text:'作业前检查梯子、平台、防护栏等设施牢固可靠；五级以上强风、雷电、暴雨、大雾等恶劣天气应停止露天高处作业。', xref:'JGJ 80-2016 §3', kw:'高处作业 恶劣天气 大风 五级 停止' },
  { id:'c54', cat:'高处作业', sys:'GB', code:'JGJ 80-2016', clause:'6.2', title:'操作平台与交叉作业', text:'移动式操作平台面积、高度受控并验收挂牌；交叉作业层间设置隔离防护层，不得在同一垂直方向上下同时作业。', xref:'GB 55034-2022', kw:'操作平台 交叉作业 垂直 隔离 防护棚' },
  { id:'c55', cat:'高处作业', sys:'GB', code:'GB 55034-2022', clause:'通用规范', title:'施工现场安全总体要求', text:'施工现场安全防护设施应与工程进度同步搭设、验收后使用；高处作业安全设施验收合格并挂合格牌后方可投入使用。', xref:'GB 50870-2013', kw:'施工现场 通用规范 验收 挂牌 安全设施' },
  // ---- 脚手架（补充） ----
  { id:'c56', cat:'脚手架', sys:'GB', code:'JGJ 202-2010', clause:'吊篮', title:'吊篮安装与使用', text:'吊篮安装后经验收合格方可使用；作业人员不少于2人且均系挂独立安全绳与安全带，荷载不超额定，每日检查钢丝绳、安全锁。', xref:'GB 19155-2016', kw:'吊篮 安全锁 安全绳 安装验收 钢丝绳' },
  { id:'c57', cat:'脚手架', sys:'GB', code:'JGJ/T 231-2021', clause:'盘扣式', title:'盘扣架斜杆与立杆', text:'盘扣架每步应设置竖向斜杆或剪刀撑形成几何不变体系；立杆基础平整夯实并设垫板，扫地杆离地不大于550mm。', xref:'JGJ 130-2011', kw:'盘扣 斜杆 剪刀撑 扫地杆 垫板 立杆' },
  { id:'c58', cat:'脚手架', sys:'GB', code:'JGJ 128-2019', clause:'门式脚手架', title:'门架与加固件', text:'门式脚手架应设置剪刀撑、水平加固杆，连墙件按规范设置；首层门架立杆底座下垫板通长设置。', xref:'GB 51210-2016', kw:'门式脚手架 门架 加固杆 连墙件' },
  { id:'c59', cat:'脚手架', sys:'GB', code:'GB 51210-2016', clause:'统一标准', title:'脚手架设计与验收', text:'脚手架应进行设计计算并编制专项方案；搭设前交底、分段搭设分段验收，验收合格挂牌使用，作业层满铺脚手板并设护栏挡脚板。', xref:'JGJ 130-2011 §7', kw:'脚手架 设计 验收 交底 专项方案 脚手板' },
  { id:'c60', cat:'脚手架', sys:'GB', code:'JGJ 166-2008', clause:'碗扣式', title:'碗扣架连墙与斜撑', text:'碗扣架连墙件竖向、水平间距按规范设置；架体外侧设置连续剪刀撑，顶端防护栏杆高于作业面1.5m。', xref:'GB 51210-2016', kw:'碗扣 脚手架 剪刀撑 连墙件' },
  // ---- 临时用电（补充） ----
  { id:'c61', cat:'临时用电', sys:'GB', code:'JGJ 46-2005', clause:'3', title:'三级配电两级保护', text:'施工用电采用三级配电（总配电箱—分配电箱—开关箱），实行一机一闸一漏一箱；末级开关箱设漏电保护。', xref:'GB 55034-2022', kw:'三级配电 一机一闸 漏电保护 开关箱' },
  { id:'c62', cat:'临时用电', sys:'GB', code:'JGJ 46-2005', clause:'4', title:'外电线路安全距离', text:'在建工程与外电架空线路须保持安全距离（如1kV以下不小于4m）；达不到时采取绝缘隔离防护并悬挂警示牌。', xref:'GB 50061', kw:'外电 高压线 安全距离 防护架 警示' },
  { id:'c63', cat:'临时用电', sys:'GB', code:'GB/T 3805-2008', clause:'特低电压', title:'安全电压等级', text:'安全电压等级为42V、36V、24V、12V、6V；隧道、人防工程、高温潮湿等场所照明采用安全特低电压供电。', xref:'JGJ 46-2005 §10', kw:'安全电压 36V 24V 12V 潮湿 照明 行灯' },
  { id:'c64', cat:'临时用电', sys:'GB', code:'JGJ 46-2005', clause:'9', title:'电焊机使用', text:'电焊机装设二次侧降压保护器（空载降压保护）；一二次接线柱防护罩齐全，焊把线绝缘完好无破损。', xref:'GB 9448-1999', kw:'电焊机 二次侧 降压保护 焊把线 焊接' },
  { id:'c65', cat:'临时用电', sys:'GB', code:'GB 9448-1999', clause:'焊接切割安全', title:'焊接作业防火与防护', text:'焊接切割作业人员佩戴护目镜、绝缘手套；作业点周围10m清除可燃物或隔离，高处焊接防止火花飞溅落下引燃。', xref:'GB 30871-2022 §5', kw:'焊接 护目镜 火花 可燃物 飞溅' },
  { id:'c66', cat:'临时用电', sys:'GB', code:'GB 50194-2014', clause:'施工现场供用电', title:'用电施工组织设计', text:'施工现场临时用电设备5台及以上或总容量50kW及以上应编制用电组织设计，经审核批准后实施并验收。', xref:'JGJ 46-2005 §3', kw:'用电组织设计 5台 50kW 临时用电 验收' },
  // ---- 特殊作业 ----
  { id:'c67', cat:'特殊作业', sys:'GB', code:'GB 30871-2022', clause:'盲板抽堵', title:'盲板抽堵作业管理', text:'盲板抽堵属特殊作业实行许可管理；盲板应编号挂牌、专人管理，作业时佩戴个体防护，涉及有毒介质按最高风险防护。', xref:'HG 23001', kw:'盲板 抽堵 挂牌 编号 特殊作业' },
  { id:'c68', cat:'特殊作业', sys:'GB', code:'GB 30871-2022', clause:'动土', title:'动土作业', text:'动土作业前查明地下电缆、管线分布并交底；作业边界设置围挡和警示，深度超过规定按基坑要求放坡或支护。', xref:'GB 50870', kw:'动土 地下管线 电缆 交底 围挡' },
  { id:'c69', cat:'特殊作业', sys:'GB', code:'GB 30871-2022', clause:'断路', title:'断路作业', text:'断路作业设置围挡、警示牌和夜间警示灯，必要时安排指挥人员；作业结束及时恢复道路并验收。', xref:'GB 4387', kw:'断路 道路 围挡 警示灯 恢复' },
  { id:'c70', cat:'动火作业', sys:'GB', code:'GB 30871-2022', clause:'动火分级', title:'动火等级与票证有效期', text:'特级、一级动火安全作业票有效期不超过8小时，二级不超过72小时；动火分析与动火间隔不超过30分钟。', xref:'GB 9448', kw:'动火 有效期 8小时 票证 分析 间隔' },
  { id:'c71', cat:'动火作业', sys:'GB', code:'GB 15577-2018', clause:'粉尘防爆', title:'可燃性粉尘场所动火', text:'存在可燃性粉尘的场所动火作业前应停止产生粉尘的作业、清扫积尘并保持湿润，动火点10m范围内无粉尘沉积。', xref:'AQ 4273-2016', kw:'粉尘 动火 积尘 清扫 防爆 木工' },
  // ---- 受限空间（补充） ----
  { id:'c72', cat:'受限空间', sys:'法规', code:'应急管理部令第13号', clause:'有限空间作业安全规定', title:'有限空间作业主体责任', text:'工贸企业有限空间作业实行审批管理；作业前辨识建立台账、设置警示，先通风、再检测、后作业，严禁盲目施救。', xref:'GB 30871-2022 §8', kw:'有限空间 工贸 审批 台账 警示 盲目施救' },
  { id:'c73', cat:'受限空间', sys:'GB', code:'GBZ/T 205-2007', clause:'密闭空间防护', title:'气体检测与连续监测', text:'检测顺序为先氧含量、再可燃气体、后有毒气体；作业期间连续或定时复测，检测仪器在检定或校准有效期内。', xref:'GB 8958-2006', kw:'检测顺序 氧含量 可燃 有毒 连续监测 检测仪' },
  { id:'c74', cat:'受限空间', sys:'GB', code:'GB 30871-2022', clause:'8.2', title:'通风与个体防护', text:'受限空间作业持续机械通风，严禁向内输送氧气；涉及硫化氢等高毒介质按条件选用正压式空气呼吸器等防护装备。', xref:'GB/T 18664', kw:'通风 输氧 正压呼吸器 硫化氢 个体防护' },
  { id:'c75', cat:'受限空间', sys:'GB', code:'GB 30871-2022', clause:'8.5', title:'救援装备与预案', text:'进入深坑、井、罐等应配备三脚架、安全绳与提升装置；救援预案明确每岗位动作，救援人员先行演练。', xref:'AQ/T 9007-2019', kw:'三脚架 救援 安全绳 提升 预案 演练' },
  // ---- 起重吊装（补充） ----
  { id:'c76', cat:'起重吊装', sys:'GB', code:'GB 5144', clause:'塔式起重机', title:'塔吊安拆与安全装置', text:'塔吊安装拆卸由有资质单位实施并告知监检；力矩限制器、起重量限制器、高度限位等安全装置齐全有效，严禁调大整定值。', xref:'TSG 51-2023', kw:'塔吊 力矩限制器 限位 安装拆卸 资质' },
  { id:'c77', cat:'起重吊装', sys:'GB', code:'GB 10055-2007', clause:'施工升降机', title:'施工电梯安全装置', text:'施工升降机防坠安全器在标定期限内；楼层通道门连锁有效，司机持证，载荷不超额定，严禁超载运行。', xref:'TSG 51-2023', kw:'施工电梯 升降机 防坠安全器 楼层门 司机 持证' },
  { id:'c78', cat:'起重吊装', sys:'法规', code:'TSG 51-2023', clause:'起重机械安全技术规程', title:'起重机械检验与作业人员', text:'起重机械安装改造重大修理后经检验合格方可使用；在用起重机械定期检验，司机、指挥、司索持特种设备作业证。', xref:'GB/T 6067.1', kw:'起重机械 定期检验 特种设备 作业证 司索 指挥' },
  { id:'c79', cat:'起重吊装', sys:'GB', code:'GB 5082', clause:'指挥信号', title:'指挥信号与一人指挥', text:'吊装作业统一指挥、信号明确（手势、旗语、哨声、对讲）；多人作业时只允许一人指挥，紧急停止信号任何人可发出。', xref:'GB/T 6067.1 §8', kw:'指挥 信号 一人指挥 紧急停止 哨声 旗语' },
  { id:'c80', cat:'起重吊装', sys:'GB', code:'JGJ 88-2010', clause:'物料提升机', title:'龙门架井架物料提升机', text:'物料提升机严禁载人；各层卸料平台设防护门，缆风绳或附墙架按规范设置，卷扬机操作棚防雨防砸。', xref:'GB 55034-2022', kw:'物料提升机 龙门架 井架 载人 卸料平台 防护门' },
  { id:'c81', cat:'起重吊装', sys:'GB', code:'GB/T 6067.1-2010', clause:'流动式起重机', title:'汽车吊支腿与地基', text:'流动式起重机作业前支腿全伸并垫实，地基承载力满足要求；禁止带载伸缩臂架，回转半径内无关人员撤离。', xref:'TSG 51-2023', kw:'汽车吊 支腿 地基 承载 伸缩臂 回转半径' },
  // ---- 土方基坑（补充） ----
  { id:'c82', cat:'土方基坑', sys:'GB', code:'GB 50497-2019', clause:'监测', title:'基坑监测与报警', text:'深基坑按等级实施位移、沉降、水位、支撑轴力等监测，达到报警值立即停工撤人并处置。', xref:'JGJ 311-2013', kw:'基坑 监测 位移 沉降 报警值 支撑轴力' },
  { id:'c83', cat:'土方基坑', sys:'GB', code:'JGJ 311-2013', clause:'深基坑施工', title:'深基坑施工组织', text:'深基坑工程应编制专项施工方案并按规定专家论证；按分层开挖、先撑后挖、严禁超挖组织施工。', xref:'GB 50497-2019', kw:'深基坑 专项方案 专家论证 分层开挖 先撑后挖 超挖' },
  { id:'c84', cat:'土方基坑', sys:'GB', code:'GB 50870-2013', clause:'管线保护', title:'地下管线探查与保护', text:'开挖前查明并标识地下管线，与权属单位确认保护方案；机械开挖至管线附近改用人工，悬吊加固可见。', xref:'GB 55034-2022', kw:'地下管线 燃气管道 电缆 探查 悬吊保护 人工开挖' },
  { id:'c85', cat:'土方基坑', sys:'GB', code:'JGJ 120? 降水规范', clause:'降排水', title:'基坑降排水', text:'基坑降水设备用电按临时用电规范配置漏电保护；坑内明水及时排除，坡顶设截水沟防止冲刷。', xref:'JGJ 46-2005', kw:'降水 排水 截水沟 冲刷 漏电' },
  // ---- 消防（补充） ----
  { id:'c86', cat:'消防安全', sys:'GB', code:'GB 55037-2022', clause:'建筑防火通用规范', title:'消防救援口与疏散', text:'建筑设置可供消防救援人员进入的救援口；疏散楼梯、出口的宽度与距离满足规范，使用期间保持畅通。', xref:'GB 50016-2014', kw:'救援口 疏散楼梯 出口 宽度 距离 畅通' },
  { id:'c87', cat:'消防安全', sys:'GB', code:'GB 17945-2010', clause:'应急照明', title:'应急照明与疏散指示', text:'应急照明持续供电时间与照度满足场所要求；疏散指示标志设置在疏散通道及转角处，定期试验切换功能。', xref:'GB 13495.1', kw:'应急照明 疏散指示 照度 切换试验 蓄电' },
  { id:'c88', cat:'消防安全', sys:'GB', code:'GB 25201-2010', clause:'维保管理', title:'消防设施维保与巡查', text:'建筑消防设施定期巡查、单项检查与联动测试，每年至少一次全面检测，维保记录齐全并存档备查。', xref:'GB 25506-2010', kw:'消防设施 维保 巡查 联动 年检 记录' },
  { id:'c89', cat:'消防安全', sys:'GB', code:'GB 25506-2010', clause:'消防控制室', title:'消防控制室值班', text:'消防控制室实行24小时双人值班（每班不少于2人），值班人员持消防设施操作员证；交接班记录完整。', xref:'GB 25201-2010', kw:'消防控制室 值班 双人 持证 消防设施操作员' },
  { id:'c90', cat:'消防安全', sys:'GB', code:'GB 50444-2008', clause:'灭火器维修报废', title:'灭火器检查与报废年限', text:'灭火器每月检查压力与外观；干粉灭火器出厂满10年报废，再充装每5年一次；喷射软管、保险销完好。', xref:'GB 50140-2005', kw:'灭火器 报废 十年 检查 压力 干粉' },
  { id:'c91', cat:'消防安全', sys:'GB', code:'GB 13495.1-2015', clause:'消防标志', title:'消防标志设置', text:'消防安全标志（禁止阻塞、紧急出口、灭火器位置等）设置醒目、方向正确，破损褪色及时更换。', xref:'GB 15630-1995', kw:'消防标志 紧急出口 禁止阻塞 灭火器位置 褪色' },
  { id:'c92', cat:'消防安全', sys:'GB', code:'GB 50116-2013', clause:'火灾自动报警', title:'火灾报警系统运行', text:'火灾自动报警系统保持连续正常运行，不得擅自关停；探测器定期抽检试验，误报警及时排查原因。', xref:'GB 25201-2010', kw:'火灾报警 探测器 误报 抽检 运行' },
  // ---- 危化品/粉尘（补充） ----
  { id:'c93', cat:'危化品', sys:'GB', code:'GB 15258-2009', clause:'安全标签', title:'安全标签与GHS', text:'化学品包装粘贴符合GHS的安全标签（象形图、信号词、危险性说明）；标签脱落模糊及时补贴，不得使用无标签化学品。', xref:'GB/T 16483', kw:'安全标签 GHS 象形图 信号词 无标签' },
  { id:'c94', cat:'危化品', sys:'GB', code:'GB/T 16483-2008', clause:'SDS', title:'安全技术说明书', text:'化学品供应商提供中文安全技术说明书（SDS，16项内容）；使用单位存档并向作业人员告知危害与应急措施。', xref:'GB 15258', kw:'SDS 安全技术说明书 16项 告知 危害' },
  { id:'c95', cat:'危化品', sys:'法规', code:'危险化学品安全管理条例', clause:'剧毒化学品', title:'剧毒品双人双锁', text:'剧毒化学品购买经公安许可，储存于专用仓库双人双锁、双人收发、双人运输、双本账，账物日清。', xref:'GB 15603-2022', kw:'剧毒 双人双锁 台账 许可 收发' },
  { id:'c96', cat:'危化品', sys:'GB', code:'GB 12158-2006', clause:'防静电', title:'静电接地与跨接', text:'甲乙类液体装卸采用防静电措施：法兰跨接、静电接地、控制流速；作业人员穿防静电鞋服，严禁喷溅式灌装。', xref:'GB 50074', kw:'静电 跨接 接地 流速 防静电鞋 灌装' },
  { id:'c97', cat:'危化品', sys:'GB', code:'GB 6514-2008', clause:'涂装作业', title:'喷涂作业防火防毒', text:'喷涂作业在专用喷漆室进行，通风排毒并使用防爆电气；作业人员佩戴供气式或过滤式呼吸防护，明火距离符合规范。', xref:'GBZ 1-2010', kw:'喷涂 喷漆 通风 防爆 呼吸防护 溶剂' },
  { id:'c98', cat:'危化品', sys:'GB', code:'GB 15577-2018', clause:'粉尘防爆规程', title:'粉尘防爆整体要求', text:'可燃性粉尘场所划定危险区域、采用防爆电气；除尘系统设置泄爆隔爆措施，定期清扫积尘并记录。', xref:'AQ 4273-2016', kw:'粉尘防爆 泄爆 隔爆 除尘 积尘清扫 危险区域' },
  { id:'c99', cat:'危化品', sys:'法规', code:'AQ 4273-2016', clause:'除尘系统', title:'干式除尘防火防爆', text:'木工等干式除尘器设置在室外，采用泄爆、隔爆或抑爆措施；除尘管道保持设计风速防止粉尘沉积。', xref:'GB 15577-2018', kw:'除尘器 泄爆 隔爆 管道风速 木工 沉积' },
  { id:'c100', cat:'危化品', sys:'GB', code:'GB 50074-2014', clause:'石油库', title:'储罐区安全', text:'储罐区设置围堰与防火堤，储罐间距满足规范；装卸区设紧急切断与可燃气体报警，防雷防静电检测合格。', xref:'GB 50160', kw:'储罐 围堰 防火堤 可燃气体报警 防雷 装卸' },
  // ---- 职业健康（补充） ----
  { id:'c101', cat:'职业健康', sys:'GB', code:'GBZ 188-2014', clause:'健康监护', title:'职业健康体检', text:'接触职业病危害因素的作业人员按周期进行上岗前、在岗期间、离岗时职业健康检查，禁忌证人员调离岗位。', xref:'职业病防治法', kw:'职业健康体检 上岗前 离岗 禁忌证 周期' },
  { id:'c102', cat:'职业健康', sys:'法规', code:'《职业病防治法》', clause:'危害告知', title:'危害告知与定期检测', text:'用人单位与劳动者订立劳动合同时如实告知职业病危害；委托有资质机构每年至少一次作业场所危害因素检测并公示。', xref:'GBZ 188-2014', kw:'职业病 告知 合同 检测 公示 资质机构' },
  { id:'c103', cat:'职业健康', sys:'法规', code:'女职工劳动保护特别规定', clause:'禁忌劳动', title:'女职工与未成年工保护', text:'女职工孕期、哺乳期禁忌从事铅、苯等有毒作业及负重作业；不得安排未成年工（16-18岁）从事矿山、有毒有害等禁忌劳动。', xref:'未成年工特殊保护规定', kw:'女职工 孕期 哺乳期 未成年工 禁忌 负重' },
  { id:'c104', cat:'职业健康', sys:'法规', code:'防暑降温措施管理办法', clause:'高温作业', title:'高温作业时间控制', text:'日最高气温40℃以上停止室外露天作业；37-40℃室外累计不超6小时且12-15点不得安排；高温津贴依法发放。', xref:'GBZ 2.2', kw:'高温 中暑 40度 37度 时间 高温津贴' },
  { id:'c105', cat:'职业健康', sys:'GB', code:'GBZ 1-2010', clause:'设计卫生', title:'作业场所卫生要求', text:'产生毒害的作业与无害作业分开；局部排风与全面通风组合设计，作业场所有毒物质浓度符合GBZ 2.1限值。', xref:'GBZ 2.1-2019', kw:'卫生标准 局部排风 毒物浓度 分开 通风' },
  { id:'c106', cat:'职业健康', sys:'GB', code:'GB/T 50087', clause:'噪声控制', title:'噪声工程控制', text:'优先采用隔声、消声、减振等工程措施降低噪声源强；高噪声区域设置警示标识并限制人员进入时间。', xref:'GBZ 2.2-2007', kw:'噪声 隔声 消声 减振 警示 时间' },
  // ---- 机械/特种设备（补充） ----
  { id:'c107', cat:'机械安全', sys:'GB', code:'GB/T 8196-2018', clause:'防护装置', title:'防护装置与上锁挂牌', text:'防护装置固定可靠、不轻易拆卸，开口尺寸与安全距离匹配；检修时执行上锁挂牌（LOTO）能量隔离。', xref:'GB/T 15706-2012', kw:'防护装置 安全距离 开口 上锁挂牌 LOTO 检修' },
  { id:'c108', cat:'机械安全', sys:'GB', code:'GB 4674-2009', clause:'磨削机械', title:'砂轮机防护与检查', text:'砂轮机防护罩角度与厚度符合规程；砂轮无裂纹、在有效期，法兰直径匹配，操作者站在砂轮侧面启动。', xref:'GB/T 8196', kw:'砂轮机 砂轮 裂纹 防护罩 法兰 侧面' },
  { id:'c109', cat:'机械安全', sys:'GB', code:'GB 5091-2011', clause:'压力机防护', title:'冲压设备保护装置', text:'冲压机械配置双手操作按钮或光电保护等装置并保持有效；离合器、制动器联锁可靠，脚踏开关防误踩。', xref:'GB 5083-1999', kw:'冲床 压力机 双手按钮 光电保护 联锁 脚踏' },
  { id:'c110', cat:'特种设备', sys:'法规', code:'TSG 21-2016', clause:'压力容器', title:'压力容器检验与附件', text:'压力容器定期检验（按周期全面检验），安全阀、压力表、液位计等安全附件齐全并在校验期内；储气罐定期排污。', xref:'特种设备安全法', kw:'压力容器 储气罐 安全阀 压力表 定期检验 校验' },
  { id:'c111', cat:'特种设备', sys:'法规', code:'TSG T5002-2017', clause:'电梯维保', title:'电梯维护保养', text:'电梯由有资质单位按规定周期（半月、季度、半年、年度）维保并公示记录；机房通道畅通，警铃与对讲有效。', xref:'特种设备安全法', kw:'电梯 维保 半月 公示 警铃 对讲 机房' },
  { id:'c112', cat:'特种设备', sys:'法规', code:'TSG 81-2022', clause:'场内机动车辆', title:'叉车作业安全', text:'叉车司机持N1证作业；行驶时货叉不带载升高、门架后倾起步；严禁载人，装卸时货叉下严禁站人。', xref:'GB 4387-2008', kw:'叉车 N1证 货叉 载人 站人 门架' },
  { id:'c113', cat:'特种设备', sys:'法规', code:'《特种设备安全法》', clause:'使用登记', title:'特种设备管理总要求', text:'特种设备使用前办理使用登记，建立安全技术档案；作业人员及管理人员持证上岗，定期检验有效期届满前1个月申报。', xref:'TSG 07-2019', kw:'特种设备 使用登记 档案 持证 定期检验 申报' },
  // ---- 厂内交通 ----
  { id:'c114', cat:'厂内交通', sys:'GB', code:'GB 4387-2008', clause:'道路运输', title:'厂内道路与限速', text:'厂内道路设置交通标志标线，交叉口视线盲区设置反光镜或警示；厂内限速行驶（一般干道不超15km/h，车间内不超5km/h）。', xref:'TSG 81-2022', kw:'厂内 限速 标志 反光镜 交叉口 盲区' },
  { id:'c115', cat:'厂内交通', sys:'GB', code:'GB 4387-2008', clause:'装卸倒车', title:'车辆装卸与倒车', text:'车辆装卸停稳拉手刹、设轮挡；倒车时观察盲区或专人指挥；装载不超载不偏载并绑扎牢固。', xref:'GB 10827.1', kw:'倒车 盲区 指挥 装载 绑扎 手刹 轮挡' },
  // ---- 燃气 ----
  { id:'c116', cat:'燃气安全', sys:'GB', code:'GB 55009-2021', clause:'燃气工程规范', title:'燃气使用场所', text:'燃气燃烧器具设置在通风良好场所；地下室、半地下室不得使用液化石油气；用气场所安装可燃气体报警装置。', xref:'GB 50028-2006', kw:'燃气 液化气 通风 地下室 报警器 场所' },
  { id:'c117', cat:'燃气安全', sys:'GB', code:'GB 50028-2006', clause:'城镇燃气', title:'燃气管道与软管', text:'燃气管道明设专用；连接软管长度不超2m且不穿墙，使用金属包覆软管；用后关闭灶前阀，定期皂液检漏。', xref:'GB 55009-2021', kw:'燃气 软管 穿墙 灶前阀 漏气 皂液' },
  { id:'c118', cat:'燃气安全', sys:'法规', code:'城镇燃气管理条例', clause:'餐饮用气', title:'餐饮场所燃气', text:'餐饮场所气瓶与灶具保持安全距离、单独存放；用餐区严禁存放使用气瓶；配置干粉灭火器并保持通风排烟。', xref:'GB 55009-2021', kw:'餐饮 气瓶 用餐区 存放 灭火器 排烟' },
  // ---- PPE（补充） ----
  { id:'c119', cat:'个体防护', sys:'GB', code:'GB 21148', clause:'安全鞋', title:'足部防护', text:'按危害选择保护级别（防砸、防刺穿、防静电、绝缘等）的安全鞋；破损、鞋底磨平及时更换。', xref:'GB 39800.1-2020', kw:'安全鞋 防砸 防刺穿 绝缘 防静电' },
  { id:'c120', cat:'个体防护', sys:'GB', code:'GB 14866', clause:'眼护具', title:'眼面部防护', text:'切割打磨、焊接等作业佩戴匹配的眼面护具（防冲击眼镜、护目镜、焊接面罩）；镜片划伤影响视界时更换。', xref:'GB 9448', kw:'护目镜 面罩 防冲击 焊接面罩 切割' },
  { id:'c121', cat:'个体防护', sys:'GB', code:'GB/T 17622', clause:'绝缘防护', title:'绝缘手套与验电', text:'绝缘手套按电压等级选用并在试验周期内；使用前充气检查漏气，配合低压验电笔验电作业。', xref:'GB 39800.1', kw:'绝缘手套 试验周期 充气 验电 电工' },
  // ---- 应急管理（补充） ----
  { id:'c122', cat:'应急管理', sys:'法规', code:'生产安全事故应急条例', clause:'预案与演练', title:'应急预案体系', text:'生产经营单位编制综合、专项应急预案和现场处置方案并备案；每年至少组织一次综合或专项演练，评估改进。', xref:'GB/T 29639-2020', kw:'应急预案 备案 演练 现场处置 综合专项' },
  { id:'c123', cat:'应急管理', sys:'GB', code:'GB/T 29639-2020', clause:'编制导则', title:'预案编制与评审', text:'预案经风险辨识与应急资源调查后编制，组织评审或论证；现场处置方案卡片化，便于岗位速用。', xref:'AQ/T 9007-2019', kw:'预案编制 评审 论证 卡片化 风险辨识' },
  { id:'c124', cat:'应急管理', sys:'法规', code:'AQ/T 9007-2019', clause:'演练规范', title:'演练组织与评估', text:'演练前制定方案与保障措施，演练后评估并留存记录；针对薄弱环节修订预案与处置方案。', xref:'生产安全事故应急条例', kw:'演练 评估 记录 修订 方案' },
  { id:'c125', cat:'应急管理', sys:'法规', code:'生产安全事故报告和调查处理条例', clause:'报告时限', title:'事故报告与四不放过', text:'事故发生后1小时内向县级以上应急管理部门报告；坚持原因未查清、责任人未处理、整改未落实、人员未受教育"四不放过"。', xref:'GB 6442', kw:'事故报告 1小时 四不放过 调查' },
  { id:'c126', cat:'应急管理', sys:'法规', code:'建设工程安全生产管理条例', clause:'施工安全责任', title:'施工总承包责任', text:'施工单位主要负责人对安全生产工作全面负责；实行总承包的由总承包单位对施工现场安全负总责，分包向总包负责。', xref:'安全生产法', kw:'总承包 施工 分包 安全责任' },
  // ---- 管理体系（补充） ----
  { id:'c127', cat:'管理体系', sys:'法规', code:'《安全生产法》(2021)', clause:'全员责任制', title:'责任制与安全总监', text:'生产经营单位建立健全全员安全生产责任制；从业人员300人以上的应设置安全总监或注册安全工程师从事安全管理。', xref:'GB/T 33000-2016', kw:'安全生产法 责任制 安全总监 300人 注册安全工程师' },
  { id:'c128', cat:'管理体系', sys:'法规', code:'《安全生产法》(2021)', clause:'教育培训', title:'三级教育与持证', text:'新员工三级安全教育（公司、项目、班组）并考核合格后上岗；特种作业人员持证上岗，离岗6个月重新考核。', xref:'安全生产培训管理办法', kw:'三级教育 培训考核 特种作业 持证 离岗' },
  { id:'c129', cat:'管理体系', sys:'法规', code:'财资〔2022〕136号', clause:'安全费用', title:'安全费用提取与使用', text:'建设工程按建安造价一定比例提取安全生产费用，专款用于安全防护设施、教育培训、应急演练等，不得挪用。', xref:'安全生产法', kw:'安全费用 提取 专款 挪用 建安造价' },
  { id:'c130', cat:'管理体系', sys:'GB', code:'GB/T 33000-2016', clause:'标准化规范', title:'标准化核心要素', text:'安全生产标准化涵盖目标职责、制度化管理、教育培训、现场管理、风险管控、隐患排查治理、应急、事故查处等要素，持续改进。', xref:'GB/T 45001-2020', kw:'安全生产标准化 核心要素 持续改进 风险管控' },
  { id:'c131', cat:'管理体系', sys:'法规', code:'《安全生产法》(2021)', clause:'双重预防', title:'风险分级管控与隐患排查', text:'构建安全风险分级管控和隐患排查治理双重预防机制；重大风险制定专项管控措施，重大隐患挂牌督办闭环。', xref:'GB/T 33000-2016', kw:'双重预防 风险分级 重大隐患 挂牌督办 闭环' },
  { id:'c132', cat:'管理体系', sys:'法规', code:'《安全生产法》(2021)', clause:'相关方管理', title:'承包商与劳务派遣', text:'发包给其他单位的，签订安全生产管理协议明确各自职责；统一协调管理，不得只包不管；劳务派遣人员纳入统一管理。', xref:'GB/T 45001 §8.1.1', kw:'承包商 外包 安全协议 统一协调 劳务派遣' },
  { id:'c133', cat:'管理体系', sys:'GB', code:'GB 6441-1986', clause:'伤害分类', title:'伤害频率与严重率', text:'按GB 6441统计千人重伤率、百万工时伤害率等指标；未遂事件纳入统计用于趋势分析。', xref:'GB/T 45001 §9', kw:'千人重伤率 百万工时 伤害频率 未遂 指标' },
  { id:'c134', cat:'管理体系', sys:'GB', code:'GB/T 45001-2020', clause:'9 绩效评价', title:'安全绩效监测', text:'建立安全绩效监测指标（主动性与结果性）；定期合规性评价，管理评审输入包含事件、不符合与相关方反馈。', xref:'ISO 45001:2018 §9', kw:'绩效评价 合规性评价 管理评审 主动指标' },
];

function findClauses(q){
  if(!q || !q.trim()) return [];
  const kw = q.trim().toLowerCase();
  return CLAUSES.filter(c => (c.title + ' ' + c.text + ' ' + c.code + ' ' + c.kw).toLowerCase().includes(kw));
}
