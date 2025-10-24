// 单个Worker整合：AI生成指令 + Cloudflare执行操作
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

// ------------- 后续部署时要改的3处（现在不用填）-------------
const AI_API_KEY = "【替换成你的火山AI API Key】"; 
const CF_API_TOKEN = "【替换成你的Cloudflare API令牌】"; 
const ALLOWED_ORIGIN = "【替换成你的Cloudflare Pages域名，如https://xxx.pages.dev】"; 
// --------------------------------------------------------

const AI_MODEL = "deepseek-r1";
const AI_API_URL = "https://ark.cn-beijing.volces.com/api/v3/chat/completions";
const CF_API_BASE = "https://api.cloudflare.com/client/v4";

async function handleRequest(request) {
  // 1. 验证请求来源（防滥用）
  const origin = request.headers.get("Origin");
  if (origin!== ALLOWED_ORIGIN && origin) {
    return new Response("非法请求", { status: 403 });
  }

  // 2. 接收前端传来的用户需求
  const { user需求 } = await request.json();
  if (!user需求) {
    return new Response("请输入需求", { status: 400 });
  }

  try {
    // 3. 调用AI生成Cloudflare指令
    const aiResponse = await fetch(AI_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${AI_API_KEY}`,
        "Content-Type": "application/json"
      },
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
    
    // 4. 解析AI指令并调用Cloudflare API
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
    // 5. 返回结果给前端
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
