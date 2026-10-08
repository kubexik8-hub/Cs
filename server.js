const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.PUBLIC_BASE_URL || "";

const DATA_FILE = path.join(__dirname, "data.json");

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return {};
    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function saveData(data) {
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(data, null, 2),
    "utf8"
  );
}

const database = loadData();

function json(res, status, data) {
  const body = JSON.stringify(data);

  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  });

  res.end(body);
}

function html(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store"
  });

  res.end(body);
}

function randomToken() {
  return crypto.randomBytes(24).toString("hex");
}

function validSteam64(value) {
  return /^7656119\d{10}$/.test(String(value));
}

function validShareCode(value) {
  return /^CSGO-[A-Za-z0-9]+(?:-[A-Za-z0-9]+){4,6}$/.test(
    String(value)
  );
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function publicBase(req) {
  if (BASE_URL) {
    return BASE_URL.replace(/\/+$/, "");
  }

  const host =
    req.headers["x-forwarded-host"] ||
    req.headers.host ||
    `127.0.0.1:${PORT}`;

  const proto =
    req.headers["x-forwarded-proto"] ||
    "http";

  return `${proto}://${host}`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", chunk => {
      body += chunk;

      if (body.length > 100_000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });

    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON."));
      }
    });

    req.on("error", reject);
  });
}

function obsPage(widget) {
  const safeName = escapeHtml(
    widget.playerName || "{twój nick}"
  );

  return `
<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OBS Widget</title>

<style>
*{
  box-sizing:border-box;
}

html,
body{
  margin:0;
  width:100%;
  height:100%;
  overflow:hidden;
  background:transparent;
  font-family:Arial,Helvetica,sans-serif;
  color:white;
}

.widget{
  width:100%;
  min-height:100%;
  padding:20px;
  border-radius:20px;
  background:
    linear-gradient(
      135deg,
      rgba(12,8,20,.96),
      rgba(25,18,36,.94)
    );
  border:1px solid rgba(255,255,255,.08);
  box-shadow:0 15px 50px rgba(0,0,0,.4);
}

.header{
  display:flex;
  justify-content:space-between;
  align-items:flex-start;
}

.name{
  font-size:27px;
  font-weight:950;
}

.label{
  margin-top:3px;
  color:#938ca3;
  font-size:10px;
  font-weight:800;
  letter-spacing:1.5px;
}

.matches{
  margin-top:18px;
  display:grid;
  grid-template-columns:repeat(5,1fr);
  gap:8px;
}

.empty{
  grid-column:1/-1;
  padding:20px;
  border-radius:13px;
  background:rgba(255,255,255,.04);
  color:#8d859a;
  font-size:12px;
}

.match{
  padding:10px;
  min-width:0;
  border-radius:13px;
  background:rgba(255,255,255,.04);
  border:1px solid rgba(255,255,255,.06);
}

.top{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:5px;
}

.result{
  font-size:18px;
  font-weight:950;
}

.result.w{
  color:#5ced89;
}

.result.l{
  color:#ff7676;
}

.result.t{
  color:#ffd75d;
}

.result.q{
  color:#9da4b0;
}

.map{
  max-width:80px;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
  color:#858d9b;
  font-size:9px;
  font-weight:800;
}

.score{
  margin-top:5px;
  font-size:17px;
  font-weight:900;
}

.meta{
  margin-top:5px;
  display:flex;
  justify-content:space-between;
  gap:5px;
  color:#696f7c;
  font-size:8px;
}

.status{
  margin-top:9px;
  color:#626976;
  font-size:8px;
  text-align:right;
}

@media(max-width:900px){
  .matches{
    grid-template-columns:repeat(5,1fr);
  }
}
</style>
</head>

<body>

<div class="widget">

  <div class="header">
    <div>
      <div class="name" id="player">
        ${safeName}
      </div>

      <div class="label">
        OSTATNIE MECZE
      </div>
    </div>
  </div>

  <div id="matches" class="matches">
    <div class="empty">
      Ładowanie danych...
    </div>
  </div>

  <div id="status" class="status">
    Łączenie...
  </div>

</div>

<script>
const widgetToken = ${JSON.stringify(widget.token)};

function resultClass(result){
  if(result === "W") return "w";
  if(result === "L") return "l";
  if(result === "T") return "t";
  return "q";
}

function escapeHtml(value){
  return String(value ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function formatDate(value){
  if(!value) return "—";

  const date = new Date(value);

  if(Number.isNaN(date.getTime())){
    return "—";
  }

  return date.toLocaleDateString("pl-PL", {
    day:"2-digit",
    month:"2-digit"
  });
}

async function load(){
  try{
    const response = await fetch(
      "/api/widget/" + encodeURIComponent(widgetToken),
      {
        cache:"no-store"
      }
    );

    const data = await response.json();

    if(!response.ok || !data.ok){
      throw new Error(
        data.error || "Nie udało się pobrać danych."
      );
    }

    document.getElementById("player").textContent =
      data.playerName || "{twój nick}";

    const matches = data.matches || [];

    if(!matches.length){
      document.getElementById("matches").innerHTML = `
        <div class="empty">
          Widget jest gotowy.
          Dane meczów pojawią się po podłączeniu źródła Valve.
        </div>
      `;
    }else{
      document.getElementById("matches").innerHTML =
        matches.slice(0,10).map(match => `
          <div class="match">

            <div class="top">

              <div class="result ${resultClass(match.result)}">
                ${escapeHtml(match.result)}
              </div>

              <div class="map">
                ${escapeHtml(match.map)}
              </div>

            </div>

            <div class="score">
              ${escapeHtml(match.score)}
            </div>

            <div class="meta">

              <span>
                K ${escapeHtml(match.kills ?? "—")}
                · D ${escapeHtml(match.deaths ?? "—")}
              </span>

              <span>
                ${escapeHtml(formatDate(match.date))}
              </span>

            </div>

          </div>
        `).join("");
    }

    document.getElementById("status").textContent =
      "LIVE · " +
      new Date().toLocaleTimeString("pl-PL");

  }catch(error){

    document.getElementById("matches").innerHTML = `
      <div class="empty">
        ${escapeHtml(error.message)}
      </div>
    `;

    document.getElementById("status").textContent =
      "Błąd pobierania danych";
  }
}

load();

setInterval(load, 30000);
</script>

</body>
</html>
`;
}

const server = http.createServer(async (req, res) => {

  try {

    const url = new URL(
      req.url,
      `http://${req.headers.host || "localhost"}`
    );

    if (
      req.method === "GET" &&
      url.pathname === "/api/health"
    ) {
      return json(res, 200, {
        ok:true,
        service:"CS2 OBS Widget"
      });
    }

    if (
      req.method === "POST" &&
      url.pathname === "/api/setup"
    ) {

      const body = await readBody(req);

      const steamId =
        String(body.steamId || "").trim();

      const steamIdKey =
        String(body.steamIdKey || "").trim();

      const shareCode =
        String(body.shareCode || "").trim();

      if(!validSteam64(steamId)){
        return json(res, 400, {
          ok:false,
          error:"Nieprawidłowy Steam64 ID."
        });
      }

      if(!steamIdKey){
        return json(res, 400, {
          ok:false,
          error:"Brakuje Steam Authentication Key."
        });
      }

      if(!validShareCode(shareCode)){
        return json(res, 400, {
          ok:false,
          error:"Nieprawidłowy Match Share Code."
        });
      }

      let existing = Object.values(database)
        .find(item => item.steamId === steamId);

      if(!existing){

        existing = {
          token:randomToken(),
          steamId,
          steamIdKey,
          firstShareCode:shareCode,
          latestShareCode:shareCode,
          playerName:"",
          matches:[],
          createdAt:new Date().toISOString(),
          updatedAt:new Date().toISOString()
        };

        database[existing.token] = existing;

      }else{

        existing.steamIdKey = steamIdKey;
        existing.firstShareCode = shareCode;
        existing.latestShareCode = shareCode;
        existing.updatedAt = new Date().toISOString();

      }

      saveData(database);

      const widgetUrl =
        `${publicBase(req)}/obs/${existing.token}`;

      return json(res, 200, {
        ok:true,
        widgetUrl,
        token:existing.token
      });
    }

    if (
      req.method === "GET" &&
      url.pathname.startsWith("/api/widget/")
    ) {

      const token =
        decodeURIComponent(
          url.pathname.substring("/api/widget/".length)
        );

      const widget = database[token];

      if(!widget){
        return json(res, 404, {
          ok:false,
          error:"Nie znaleziono widgetu."
        });
      }

      return json(res, 200, {
        ok:true,
        playerName:widget.playerName || "{twój nick}",
        matches:Array.isArray(widget.matches)
          ? widget.matches.slice(0,10)
          : []
      });
    }

    if (
      req.method === "GET" &&
      url.pathname.startsWith("/obs/")
    ) {

      const token =
        decodeURIComponent(
          url.pathname.substring("/obs/".length)
        );

      const widget = database[token];

      if(!widget){
        return html(
          res,
          404,
          "<h1>Widget nie istnieje.</h1>"
        );
      }

      return html(
        res,
        200,
        obsPage(widget)
      );
    }

    if (
      req.method === "GET" &&
      url.pathname === "/"
    ) {

      const file =
        path.join(__dirname, "index.html");

      if(!fs.existsSync(file)){
        return html(
          res,
          404,
          "<h1>Brak index.html</h1>"
        );
      }

      return html(
        res,
        200,
        fs.readFileSync(file, "utf8")
      );
    }

    return json(res, 404, {
      ok:false,
      error:"Not found"
    });

  }catch(error){

    return json(res, 500, {
      ok:false,
      error:
        error?.message ||
        "Wystąpił nieznany błąd."
    });

  }

});

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `CS2 OBS Widget działa na porcie ${PORT}`
  );
});
