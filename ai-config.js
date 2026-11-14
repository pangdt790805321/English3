/* ============================================================
 * EHS-AI 平台 · AI 识别服务配置（站长填写一次，全体访问者免配置）
 * ------------------------------------------------------------
 * 想让所有人"有网络就能识别、无需填 API Key"：
 * 1. 到 https://open.bigmodel.cn 注册并创建 API Key
 *    （glm-4v-flash 模型免费，适合全员使用）
 * 2. 把 Key 粘贴到下面 key 的两个引号之间，重新推送 GitHub
 * 3. 完成。所有访问者打开拍照识隐患即可直接用 AI
 *
 * ⚠ 注意：
 * - Key 会随静态站点公开，任何人可见。请只用"免费模型"
 *   （glm-4v-flash），并在开放平台设置用量提醒，防止被盗刷。
 * - 如需保密，可部署 Cloudflare Worker 代理（见 demo/worker.js，
 *   一分钟部署），把 worker 地址填到下面 worker 字段，key 留空。
 * ============================================================ */
window.EHS_AI_CONFIG = {
  key: '',                    // ← 站长 API Key（直接调用模式）
  model: 'glm-4v-flash',      // 模型，免费档用 glm-4v-flash
  worker: ''                  // ← 可选：Cloudflare Worker 代理地址（https://xxx.workers.dev），CORS 受阻时自动走它
};
