// 单个Worker整合：AI生成指令 + Cloudflare执行 + KV历史存储 + 新话题清空
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

// 硬编码的密钥和KV信息
const AI_API_KEY = "a345ac3e-5252-49ce-a7be-c27d76264178"; // 你的火山AI API Key
const CF_API_TOKEN = "Psl0i4hu10tjX20l8qIM1zyHTxWmiQuXYN0p5Nwy"; // 你的Cloudflare API令牌
const ALLOWED_ORIGIN = "【替换成你的Cloudflare Pages域名，如https://xxx.pages.dev】"; // 仅域名变量
const HISTORY_KV_NAME = "2"; // 你创建的KV名称
const HISTORY_KV_ID = "ca3f80ee6eff412fbd123995c4b3e152"; // 你创建的KV ID

// 基础配置
const AI_MODEL = "deepseek-r1";
const AI_API_URL = "https://ark.cn-beijing.volces.com/api/v3/chat/completions";
const CF_API_BASE = "https://api.cloudflare.com/client/v4";
const HISTORY_KEY = "cf_ai_operation_history"; // 存储历史的固定Key

async function handleRequest(request) {
  // 1. 验证请求来源（防滥用）
  const origin = request.headers.get("Origin");
  if (origin!== ALLOWED_ORIGIN && origin) {
    return new Response("非法请求", { status: 403 });
  }

  // 2. 解析请求参数（支持：执行操作、获取历史、清空历史）
  const { user需求, 获取历史 = false, 清空历史 = false } = await request.json();

  // 3. 清空历史逻辑（开启新话题时触发）
  if (清空历史) {
    const kvNamespace = await __STORAGE_NAMESPACES__.get(HISTORY_KV_ID);
    await kvNamespace.put(HISTORY_KEY, JSON.stringify([]));
    return new Response(JSON.stringify({ 提示: "历史记录已清空，可开启新话题" }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": ALLOWED_ORIGIN }
    });
  }

  // 4. 获取历史逻辑
  if (获取历史) {
    const kvNamespace = await __STORAGE_NAMESPACES__.get(HISTORY_KV_ID);
    const 历史记录 = await kvNamespace.get(HISTORY_KEY) || "[]";
    return new Response(历史记录, {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": ALLOWED_ORIGIN }
    });
  }

  // 5. 执行AI+Cloudflare操作逻辑
  if (!user需求) {
    return new Response(JSON.stringify({ 错误: "请输入需求" }), { status: 400 });
  }

  try {
    // 5.1 调用火山AI生成Cloudflare API指令
    const aiResponse = await fetch(AI_API_URL, {
      method: "POST",
      headers: { "Authorization": `Bearer ${AI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          {
            role: "system",
            content: "你是Cloudflare API助手，用户说需求后，直接返回JSON格式的API调用指令，格式：{cfPath: '/API路径（如/zones/区域ID/workers/scripts）', method: 'GET/POST', body: 参数对象（无则null）}，不要任何多余文字！"
          },
          { role: "user", content: user需求 }
        ],
        max_tokens: 500
      })
    });

    const aiData = await aiResponse.json();
    if (aiData.error) throw new Error(`AI错误：${aiData.error.message}`);
    
    // 5.2 解析AI指令并调用Cloudflare API
    const cf指令 = JSON.parse(aiData.choices[0].message.content);
    const { cfPath, method = "GET", body = null } = cf指令;

    const cfResponse = await fetch(`${CF_API_BASE}${cfPath}`, {
      method: method,
      headers: {
        "Authorization": `Bearer ${CF_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: body? JSON.stringify(body) : null
    });

    const cfResult = await cfResponse.json();

    // 5.3 存储操作记录到KV
    const kvNamespace = await __STORAGE_NAMESPACES__.get(HISTORY_KV_ID);
    const 历史记录 = await kvNamespace.get(HISTORY_KEY) || "[]";
    const 历史列表 = JSON.parse(历史记录);
    历史列表.unshift({
      时间: new Date().toISOString(),
      需求: user需求,
      AI指令: cf指令,
      CF结果: cfResult
    });
    await kvNamespace.put(HISTORY_KEY, JSON.stringify(历史列表.slice(0, 20))); // 只存最近20条

    // 5.4 返回结果给前端
    return new Response(JSON.stringify({
      AI生成的指令: cf指令,
      Cloudflare执行结果: cfResult
    }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN
      }
    });

  } catch (e) {
    return new Response(JSON.stringify({ 错误: e.message }), { status: 500 });
  }
}
