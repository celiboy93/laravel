import { S3Client } from "npm:@aws-sdk/client-s3";
import { Upload } from "npm:@aws-sdk/lib-storage";

// --- 1. CONFIGURATION ---
const R2_ACCOUNT_ID = Deno.env.get("R2_ACCOUNT_ID")!;
const R2_ACCESS_KEY_ID = Deno.env.get("R2_ACCESS_KEY_ID")!;
const R2_SECRET_ACCESS_KEY = Deno.env.get("R2_SECRET_ACCESS_KEY")!;
const R2_BUCKET_NAME = Deno.env.get("R2_BUCKET_NAME")!;
const R2_PUBLIC_DOMAIN = Deno.env.get("R2_PUBLIC_DOMAIN")!; 
const ADMIN_PASSWORD = Deno.env.get("ADMIN_PASSWORD") || "123";

// --- 2. SETUP ---
const s3Client = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

// --- 3. HELPER ---
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

  // (B) API: UPLOAD WITH PROGRESS STREAM
  if (req.method === "POST" && url.pathname === "/api/upload") {
    const pass = url.searchParams.get("pass");
    if (pass !== ADMIN_PASSWORD) return new Response("Unauthorized", { status: 403 });

    // Stream Response setup
    const body = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (data: any) => controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));

        try {
          const reqBody = await req.json();
          const { remoteUrl, customName } = reqBody;

          if (!remoteUrl || !customName) {
             send({ error: "Missing info" });
             controller.close();
             return;
          }

          // 1. Fetch Remote File
          const remoteRes = await fetch(remoteUrl);
          if (!remoteRes.ok || !remoteRes.body) throw new Error("Cannot fetch remote url");

          // Get Total Size for Progress Calculation
          const totalSize = Number(remoteRes.headers.get("content-length")) || 0;
          const contentType = getMimeType(customName);

          // 2. Setup Upload
          const upload = new Upload({
            client: s3Client,
            params: {
              Bucket: R2_BUCKET_NAME,
              Key: customName,
              Body: remoteRes.body,
              ContentType: contentType,
              ContentDisposition: "inline", // Play directly
              CacheControl: "public, max-age=31536000, immutable",
            },
            queueSize: 4,
            partSize: 50 * 1024 * 1024,
          });

          // 3. Monitor Progress
          upload.on("httpUploadProgress", (progress) => {
            if (totalSize > 0 && progress.loaded) {
              const percentage = Math.round((progress.loaded / totalSize) * 100);
              send({ progress: percentage });
            }
          });

          // 4. Start Upload
          await upload.done();

          // 5. Success
          const permanentLink = `${R2_PUBLIC_DOMAIN}/${encodeURIComponent(customName)}`;
          send({ success: true, link: permanentLink });

        } catch (e) {
          send({ error: e.message });
        } finally {
          controller.close();
        }
      }
    });

    return new Response(body, { 
        headers: { "content-type": "application/x-ndjson" }
    });
  }

  return new Response("Not Found", { status: 404 });
});

// --- UI WITH SPINNER ---
function renderUI(pass: string) {
  return `
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>R2 Upload</title>
<style>
  body{font-family:sans-serif;background:#0d1117;color:#c9d1d9;display:flex;justify-content:center;padding-top:20px}
  .box{background:#161b22;padding:25px;border-radius:10px;width:95%;max-width:500px;border:1px solid #30363d;position:relative}
  h2{text-align:center;color:#58a6ff;margin-top:0}
  label{display:block;margin-bottom:5px;font-size:0.9rem;color:#8b949e}
  input{width:100%;padding:12px;margin-bottom:15px;background:#0d1117;border:1px solid #30363d;color:#fff;box-sizing:border-box;border-radius:6px;outline:none}
  input:focus{border-color:#58a6ff}
  button{width:100%;padding:12px;background:#238636;color:#fff;border:none;border-radius:6px;font-weight:bold;cursor:pointer;font-size:1rem;transition:0.2s}
  button:hover{background:#2ea043}
  button:disabled{background:#333;color:#888;cursor:not-allowed}
  
  /* Loading Overlay */
  .overlay {
      position: absolute; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(13, 17, 23, 0.9);
      border-radius: 10px;
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 10;
  }
  
  /* Spinner */
  .spinner {
      width: 50px; height: 50px;
      border: 5px solid #30363d;
      border-top: 5px solid #58a6ff;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin-bottom: 15px;
  }
  @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
  
  .percent { font-size: 1.5rem; font-weight: bold; color: #fff; }
  .status-text { color: #8b949e; margin-top: 5px; font-size: 0.9rem; }

  .res{margin-top:20px;display:none;background:#0d1117;padding:15px;border-radius:6px;border:1px solid #30363d}
  #link{color:#58a6ff;background:none;border:none;width:100%;outline:none;font-family:monospace}
</style>
</head>
<body>
<div class="box">
  <!-- Loading Overlay -->
  <div class="overlay" id="loader">
      <div class="spinner"></div>
      <div class="percent" id="pct">0%</div>
      <div class="status-text">Uploading to Cloud...</div>
  </div>

  <h2>🚀 R2 Video Upload</h2>
  
  <label>Remote Video URL:</label>
  <input type="text" id="url" placeholder="http://example.com/video.mp4">
  
  <label>Save As (Name):</label>
  <input type="text" id="name" placeholder="movie.mp4">
  
  <button onclick="up()" id="btn">Start Upload</button>
  
  <div class="res" id="res">
    <p style="margin-top:0;color:#3fb950">✅ Upload Complete!</p>
    <input type="text" id="link" readonly>
    <button onclick="cpy()" style="background:#1f6feb;margin-top:10px">Copy Link</button>
  </div>
</div>

<script>
async function up(){
  const u = document.getElementById('url').value;
  const n = document.getElementById('name').value;
  if(!u||!n) return alert('Fill all fields');
  
  const btn = document.getElementById('btn');
  const loader = document.getElementById('loader');
  const pct = document.getElementById('pct');
  const resBox = document.getElementById('res');

  // Reset UI
  btn.disabled = true; 
  resBox.style.display = 'none';
  loader.style.display = 'flex'; // Show Overlay
  pct.innerText = '0%';
  
  try {
    const response = await fetch('/api/upload?pass=${pass}', {
      method:'POST', body:JSON.stringify({remoteUrl:u, customName:n})
    });

    // Stream Reader Setup
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\\n');
        buffer = lines.pop(); 

        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const msg = JSON.parse(line);
                
                // Update Progress
                if (msg.progress) {
                    pct.innerText = msg.progress + '%';
                }
                
                // Success
                if (msg.success) {
                    loader.style.display = 'none';
                    document.getElementById('link').value = msg.link;
                    resBox.style.display = 'block';
                    btn.disabled = false;
                }
                
                // Error
                if (msg.error) {
                    throw new Error(msg.error);
                }
            } catch (e) {
                console.error("Parse error", e);
            }
        }
    }

  } catch(e){ 
      alert('Error: ' + e.message); 
      btn.disabled=false; 
      loader.style.display = 'none';
  }
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
