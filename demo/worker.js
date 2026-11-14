/**
 * EHS-AI 识别代理 · Cloudflare Worker（可选部署）
 * ------------------------------------------------------------
 * 用途：浏览器直连 open.bigmodel.cn 若被跨域(CORS)拦截，
 *      部署本 Worker 作为中转（Key 存在 Worker 环境变量里，不公开）。
 *
 * 部署 3 步（免费）：
 * 1. 注册 cloudflare.com → Workers & Pages → Create Worker
 * 2. 把本文件内容粘贴进在线编辑器 → Deploy
 * 3. Settings → Variables 添加：
 *      API_KEY = 你的智谱 API Key
 *    然后把 Worker 地址（https://xxx.your-name.workers.dev）
 *    填入网站根目录 ai-config.js 的 worker 字段（key 可留空）
 *
 * 页面调用方式：POST 任意路径，头 X-Api-Key 可传访问者自填 Key（优先），
 * 未传则使用环境变量 API_KEY。
 */
export default {
  async fetch(request) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405, headers: cors });

    const visitorKey = request.headers.get('X-Api-Key');
    const key = visitorKey || (globalThis.API_KEY || '');
    if (!key) return new Response(JSON.stringify({ error: { message: '未配置 API Key' } }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...cors } });

    const body = await request.text();
    const r = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body,
    });
    return new Response(r.body, {
      status: r.status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors },
    });
  },
};
