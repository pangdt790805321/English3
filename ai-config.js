/* ============================================================
 * EHS-AI 平台 · AI 识别服务配置（站长填写一次，全体访问者免配置）
 * ------------------------------------------------------------
 * 三种获得 Key 的方式（任选其一，都是免费的）：
 *
 * 【方式A·智谱】https://open.bigmodel.cn
 *   手机号注册 → 登录后点右上角「控制台」→ 左侧「API Keys」
 *   →「创建 API Key」→ 复制。glm-4v-flash 模型免费。
 *   （入口直达：https://open.bigmodel.cn/usercenter/apikeys）
 *
 * 【方式B·硅基流动】https://siliconflow.cn
 *   注册 → 控制台「API 密钥」→ 新建。Qwen/Qwen2.5-VL 免费档。
 *
 * 【方式C·阿里百炼】https://bailian.console.aliyun.com
 *   注册 → API-KEY 管理。qwen-vl 系列有免费额度。
 *
 * 填写方法：把 Key 粘到 key 引号里；若用 B/C 等其他服务商，
 * 再把 baseUrl 换成注释里对应的地址、model 换成该家的视觉模型名。
 * 填好后推送 GitHub（或告诉我帮你填），全站访问者即可直接使用。
 * ============================================================ */
window.EHS_AI_CONFIG = {
  key: '',
  baseUrl: '',                // 留空 = 智谱官方 https://open.bigmodel.cn/api/paas/v4
                              // 硅基流动: https://api.siliconflow.cn/v1
                              // 阿里百炼: https://dashscope.aliyuncs.com/compatible-mode/v1
  model: 'glm-4v-flash',      // 智谱: glm-4v-flash（免费）/ 硅基流动: Qwen/Qwen2.5-VL-32B-Instruct / 百炼: qwen-vl-plus
  worker: ''                  // 可选：Cloudflare Worker 代理地址（跨域受阻时自动启用，见 demo/worker.js）
};

// 各服务商直连地址（自动选择）
(function(){
  const c = window.EHS_AI_CONFIG;
  if(!c.baseUrl){
    c.baseUrl = 'https://open.bigmodel.cn/api/paas/v4';
  }
})();
