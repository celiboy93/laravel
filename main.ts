import { S3Client } from "npm:@aws-sdk/client-s3";
import { Upload } from "npm:@aws-sdk/lib-storage";

// --- 1. CONFIGURATION ---
const R2_ACCOUNT_ID = Deno.env.get("R2_ACCOUNT_ID")!;
const R2_ACCESS_KEY_ID = Deno.env.get("R2_ACCESS_KEY_ID")!;
const R2_SECRET_ACCESS_KEY = Deno.env.get("R2_SECRET_ACCESS_KEY")!;
const R2_BUCKET_NAME = Deno.env.get("R2_BUCKET_NAME")!;

// 🔥 မင်းရဲ့ R2 Public Domain (Example: https://pub-xxxx.r2.dev)
// နောက်ဆုံးမှာ / မပါရ
const R2_PUBLIC_DOMAIN = Deno.env.get("R2_PUBLIC_DOMAIN")!; 

const ADMIN_PASSWORD = Deno.env.get("ADMIN_PASSWORD") || "123";

// --- 2. SETUP ---
const s3Client = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

// --- 3. HELPER: Get Content-Type ---
function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'mp4': return 'video/mp4';
    case 'mkv': return 'video/x-matroska';
    case 'webm': return 'video/webm';
    case 'mov': return 'video/quicktime';
    case 'avi': return 'video/x-msvideo';
    default: return 'application/octet-stream';
  }
}

// --- 4. SERVER ---
Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  // (A) UI PAGE
  if (req.method === "GET" && url.pathname === "/") {
    const pass = url.searchParams.get("pass");
    if (pass !== ADMIN_PASSWORD) return new Response("Unauthorized", { status: 403 });
    return new Response(renderUI(pass), { headers: { "content-type": "text/html" } });
  }

  // (B) API: UPLOAD (Inline Optimized)
  if (req.method === "POST" && url.pathname === "/api/upload") {
    const pass = url.searchParams.get("pass");
    if (pass !== ADMIN_PASSWORD) return new Response("Unauthorized", { status: 403 });

    try {
      const body = await req.json();
      const { remoteUrl, customName } = body;

      if (!remoteUrl || !customName) return new Response("Missing info", { status: 400 });

      // 1. Fetch Remote File
      const remoteRes = await fetch(remoteUrl);
      if (!remoteRes.ok || !remoteRes.body) throw new Error("Cannot fetch remote url");

      // 2. Determine Content-Type
      const contentType = getMimeType(customName);

      // 3. Stream Upload to R2
      const upload = new Upload({
        client: s3Client,
        params: {
          Bucket: R2_BUCKET_NAME,
          Key: customName,
          Body: remoteRes.body,
          ContentType: contentType, // video/mp4 (အရေးကြီးသည်)
          
          // 🔥 KEY SETTING FOR PLAYBACK 🔥
          // "inline" = Browser မှာ Video တန်းလာမယ်
          // "attachment" = အတင်း Download ဆွဲမယ်
          ContentDisposition: "inline", 
          
          CacheControl: "public, max-age=31536000, immutable",
        },
        queueSize: 4,
        partSize: 20 * 1024 * 1024, // 20MB chunks
      });

      await upload.done();

      // 4. Construct Public Link
      const directLink = `${R2_PUBLIC_DOMAIN}/${encodeURIComponent(customName)}`;

      return new Response(JSON.stringify({
        success: true,
        link: directLink,
        type: contentType
      }), { headers: { "content-type": "application/json" } });

    } catch (e) {
      return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500 });
    }
  }

  return new Response("Not Found", { status: 404 });
});

// --- UI ---
function renderUI(pass: string) {
  return `
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>R2 Inline Uploader</title>
<style>
  body{font-family:sans-serif;background:#111;color:#eee;display:flex;justify-content:center;padding-top:20px}
  .box{background:#222;padding:20px;border-radius:10px;width:95%;max-width:500px;border:1px solid #444}
  h2{text-align:center;color:#3b82f6;margin-top:0}
  input{width:100%;padding:10px;margin:5px 0 15px;background:#333;border:1px solid #555;color:#fff;border-radius:5px;box-sizing:border-box}
  button{width:100%;padding:12px;background:#2563eb;color:#fff;border:none;border-radius:5px;font-weight:bold;cursor:pointer}
  button:disabled{background:#555}
  .res{margin-top:20px;display:none;background:#000;padding:15px;border-radius:5px;border:1px solid #333}
  #link{color:#4ade80;background:none;border:none;width:100%;font-family:monospace;outline:none}
  .note{font-size:0.8rem;color:#888;margin-top:5px;text-align:center}
</style>
</head>
<body>
<div class="box">
  <h2>R2 Video Uploader (Play Mode)</h2>
  <label>Video URL:</label>
  <input type="text" id="url" placeholder="http://...">
  <label>Save As:</label>
  <input type="text" id="name" placeholder="movie.mp4">
  <button onclick="up()" id="btn">Upload</button>
  <div class="res" id="res">
    <p style="margin-top:0;color:#4ade80">✅ Uploaded (Inline Mode)!</p>
    <input type="text" id="link" readonly>
    <button onclick="cpy()" style="background:#22c55e;margin-top:10px;color:#000">Copy Link</button>
  </div>
  <p class="note">Links generated here will PLAY directly in browser.</p>
</div>
<script>
async function up(){
  const u = document.getElementById('url').value;
  const n = document.getElementById('name').value;
  if(!u||!n) return alert('Data missing');
  
  const btn = document.getElementById('btn');
  btn.disabled=true; btn.innerText="Uploading...";
  
  try {
    const r = await fetch('/api/upload?pass=${pass}', {
      method:'POST', body:JSON.stringify({remoteUrl:u, customName:n})
    });
    const d = await r.json();
    if(d.success){
      document.getElementById('link').value = d.link;
      document.getElementById('res').style.display='block';
      btn.innerText="Upload Success";
    } else {
      alert("Error: " + d.error); btn.innerText="Try Again";
    }
  } catch(e){ alert('Network Error'); } finally { btn.disabled=false; }
}
function cpy(){
  document.getElementById('link').select();
  document.execCommand('copy');
  alert('Copied');
}
</script>
</body>
</html>
  `;
}
