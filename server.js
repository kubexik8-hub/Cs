const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.PUBLIC_BASE_URL || "";
const DATA_FILE = path.join(__dirname, "data.json");

let database = {};

try {
  if (fs.existsSync(DATA_FILE)) {
    database = JSON.parse(
      fs.readFileSync(DATA_FILE, "utf8")
    );
  }
} catch {
  database = {};
}

function saveDatabase() {
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(database, null, 2),
    "utf8"
  );
}

function randomToken() {
  return crypto.randomBytes(24).toString("hex");
}

function validSteam64(value) {
  return /^\d{17}$/.test(String(value));
}

function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  });

  res.end(JSON.stringify(data));
}

function html(res, status, content) {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store"
  });

  res.end(content);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", chunk => {
      body += chunk;

      if (body.length > 2000000) {
        reject(new Error("Request too large"));
        req.destroy();
      }
    });

    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });

    req.on("error", reject);
  });
}

function getBaseUrl(req) {
  if (BASE_URL) {
    return BASE_URL.replace(/\/+$/, "");
  }

  const proto =
    req.headers["x-forwarded-proto"] || "https";

  const host =
    req.headers["x-forwarded-host"] ||
    req.headers.host;

  return `${proto}://${host}`;
}

function deepMerge(target, source) {
  if (!source || typeof source !== "object") {
    return target;
  }

  for (const key of Object.keys(source)) {
    const value = source[key];

    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      if (
        !target[key] ||
        typeof target[key] !== "object" ||
        Array.isArray(target[key])
      ) {
        target[key] = {};
      }

      deepMerge(target[key], value);
    } else {
      target[key] = value;
    }
  }

  return target;
}

function getPlayer(widget) {
  const state =
    widget.lastState || {};

  const wanted =
    String(widget.steamId);

  if (
    state.allplayers &&
    state.allplayers[wanted]
  ) {
    return {
      steamid: wanted,
      ...state.allplayers[wanted]
    };
  }

  if (
    state.player &&
    (
      !state.player.steamid ||
      String(state.player.steamid) === wanted
    )
  ) {
    return state.player;
  }

  return state.player || {};
}

function getLiveData(widget) {
  const state =
    widget.lastState || {};

  const map =
    state.map || {};

  const player =
    getPlayer(widget);

  const stats =
    player.match_stats || {};

  const team =
    String(
      player.team || ""
    ).toUpperCase();

  const ctScore =
    Number(
      map.team_ct?.score ?? 0
    );

  const tScore =
    Number(
      map.team_t?.score ?? 0
    );

  let myScore = 0;
  let enemyScore = 0;

  if (team === "CT") {
    myScore = ctScore;
    enemyScore = tScore;
  } else if (team === "T") {
    myScore = tScore;
    enemyScore = ctScore;
  } else {
    myScore = ctScore;
    enemyScore = tScore;
  }

  const kills =
    Number(stats.kills ?? 0);

  const deaths =
    Number(stats.deaths ?? 0);

  return {
    active:
      Boolean(
        widget.currentMatch
      ),

    map:
      String(
        map.name || ""
      )
        .replace(/^de_/, "")
        .toUpperCase(),

    mode:
      map.mode || "",

    phase:
      map.phase || "",

    round:
      Number(map.round ?? 0),

    score:
      `${myScore}:${enemyScore}`,

    playerName:
      player.name ||
      widget.playerName ||
      "{twój nick}",

    steamId:
      String(
        player.steamid ||
        widget.steamId
      ),

    team,

    kills,

    deaths,

    assists:
      Number(stats.assists ?? 0),

    mvps:
      Number(stats.mvps ?? 0),

    points:
      Number(stats.score ?? 0),

    kd:
      deaths > 0
        ? Number(
            (kills / deaths).toFixed(2)
          )
        : kills
  };
}

function startMatch(widget) {
  const live =
    getLiveData(widget);

  widget.currentMatch = {
    id:
      `${Date.now()}-${randomToken().slice(0, 8)}`,

    startedAt:
      new Date().toISOString(),

    map:
      live.map,

    playerName:
      live.playerName,

    steamId:
      live.steamId
  };
}

function finishMatch(widget) {
  const live =
    getLiveData(widget);

  if (!widget.currentMatch) {
    return null;
  }

  const [myScore, enemyScore] =
    live.score
      .split(":")
      .map(Number);

  let result = "?";

  if (
    Number.isFinite(myScore) &&
    Number.isFinite(enemyScore)
  ) {
    if (myScore > enemyScore) {
      result = "W";
    } else if (myScore < enemyScore) {
      result = "L";
    } else {
      result = "T";
    }
  }

  const match = {
    id:
      widget.currentMatch.id,

    date:
      new Date().toISOString(),

    playerName:
      live.playerName,

    steamId:
      live.steamId,

    map:
      live.map,

    result,

    score:
      live.score,

    kills:
      live.kills,

    deaths:
      live.deaths,

    assists:
      live.assists,

    mvps:
      live.mvps,

    points:
      live.points,

    kd:
      live.kd
  };

  const duplicate =
    widget.matches.some(
      item =>
        item.id === match.id
    );

  if (!duplicate) {
    widget.matches.unshift(match);
  }

  widget.matches =
    widget.matches.slice(
      0,
      100
    );

  widget.playerName =
    live.playerName;

  widget.currentMatch =
    null;

  widget.updatedAt =
    new Date().toISOString();

  saveDatabase();

  return match;
}

function processGsi(widget, incoming) {
  if (!widget.lastState) {
    widget.lastState = {};
  }

  deepMerge(
    widget.lastState,
    incoming
  );

  const map =
    widget.lastState.map || {};

  const phase =
    String(
      map.phase || ""
    ).toLowerCase();

  const mode =
    String(
      map.mode || ""
    ).toLowerCase();

  const live =
    getLiveData(widget);

  if (
    mode === "competitive" &&
    phase === "live" &&
    !widget.currentMatch
  ) {
    startMatch(widget);
  }

  if (
    mode === "competitive" &&
    phase === "gameover" &&
    widget.currentMatch
  ) {
    return {
      type: "match_finished",
      match:
        finishMatch(widget)
    };
  }

  return {
    type: "state",
    live
  };
}

const LEETIFY_HISTORY_CACHE = new Map();

async function fetchLeetifyJson(path, headers) {
  let response;

  try {
    response = await fetch(
      "https://api-public.cs-prod.leetify.com" + path,
      {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(12000)
      }
    );
  } catch (error) {
    throw new Error("Nie można połączyć się z API Leetify. Spróbuj ponownie za chwilę.");
  }

  let payload = null;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Leetify odrzuciło żądanie (401). Sprawdź klucz API w ustawieniach Render.");
    }

    if (response.status === 403 || response.status === 404) {
      throw new Error("Leetify nie udostępnia tego profilu. Sprawdź, czy masz konto Leetify i poprawne Steam64 ID.");
    }

    if (response.status === 429) {
      throw new Error("Limit zapytań Leetify został osiągnięty. Dodaj LEETIFY_API_KEY w Render lub spróbuj później.");
    }

    throw new Error("API Leetify zwróciło błąd HTTP " + response.status + ".");
  }

  return payload;
}

async function fetchLeetifyMatches(widget) {
  const steamId = String(widget.steamId || "").trim();

  if (!/^\d{17}$/.test(steamId)) {
    throw new Error("Widget nie ma poprawnego Steam64 ID.");
  }

  const cached = LEETIFY_HISTORY_CACHE.get(steamId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const headers = {
    "Accept": "application/json"
  };

  const apiKey = String(process.env.LEETIFY_API_KEY || "").trim();

  if (apiKey) {
    headers.Authorization = "Bearer " + apiKey;
  }

  const query = new URLSearchParams({
    steam64_id: steamId
  }).toString();

  // Leetify data is requested live and deliberately not written to our database.
  const [profile, response] = await Promise.all([
    fetchLeetifyJson("/v3/profile?" + query, headers),
    fetchLeetifyJson("/v3/profile/matches?" + query, headers)
  ]);

  const allMatches = Array.isArray(response)
    ? response
    : Array.isArray(response?.matches)
      ? response.matches
      : Array.isArray(response?.data)
        ? response.data
        : [];

  const matches = allMatches
    .filter(match =>
      String(match?.data_source || "").toLowerCase() === "matchmaking_competitive"
    )
    .map(match => {
      const stats = Array.isArray(match.stats) ? match.stats : [];
      const player = stats.find(item =>
        String(item?.steam64_id || "") === steamId
      );

      if (!player) {
        return null;
      }

      const teamScores = Array.isArray(match.team_scores)
        ? match.team_scores
        : [];

      const playerTeam = Number(player.initial_team_number);
      const ownTeam = teamScores.find(team =>
        Number(team.team_number) === playerTeam
      );
      const enemyTeam = teamScores.find(team =>
        Number(team.team_number) !== playerTeam
      );

      const ownScore = Number(
        ownTeam?.score ?? player.rounds_won ?? 0
      );
      const enemyScore = Number(
        enemyTeam?.score ?? player.rounds_lost ?? 0
      );

      let result = "?";

      if (ownScore > enemyScore) result = "W";
      else if (ownScore < enemyScore) result = "L";
      else result = "T";

      const kills = Number(player.total_kills ?? 0);
      const deaths = Number(player.total_deaths ?? 0);
      const kd = Number(
        player.kd_ratio ?? (deaths > 0 ? kills / deaths : kills)
      );

      return {
        id: String(match.id || ""),
        date: match.finished_at || "",
        playerName: player.name || profile?.name || "",
        map: String(match.map_name || "—").replace(/^de_/, "").toUpperCase(),
        score: ownScore + ":" + enemyScore,
        result,
        kills,
        deaths,
        assists: Number(player.total_assists ?? 0),
        kd: Number.isFinite(kd) ? Number(kd.toFixed(2)) : 0,
        leetifyRating: player.leetify_rating ?? null,
        source: String(match.data_source || "")
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 10);

  let historyError = "";

  if (profile?.privacy_mode === "private") {
    historyError = "Profil Leetify jest prywatny lub nie udostępnia historii przez API.";
  } else if (!matches.length) {
    historyError = "Leetify nie zwróciło jeszcze żadnych przetworzonych meczów Competitive dla tego profilu.";
  }

  const result = {
    playerName: profile?.name || matches[0]?.playerName || "",
    matches,
    historyError
  };

  LEETIFY_HISTORY_CACHE.set(steamId, {
    expiresAt: Date.now() + 5 * 60 * 1000,
    data: result
  });

  return result;
}

function obsPage(token) {
  return `
<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>CS2 OBS Widget</title>
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      width: 100%;
      min-height: 100%;
      overflow: hidden;
      background: transparent;
      font-family: Inter, Arial, sans-serif;
      color: white;
    }
    .widget {
      width: 100%;
      min-height: 100%;
      padding: 17px;
      border-radius: 17px;
      border: 1px solid rgba(255,255,255,.07);
      background: linear-gradient(135deg,#0d0a14,#191321);
    }
    .widget-name {
      font-size: 22px;
      line-height: 1.2;
      font-weight: 950;
      color: #f4efff;
      overflow-wrap: anywhere;
    }
    .results {
      margin-top: 16px;
      display: flex;
      gap: 5px;
      flex-wrap: wrap;
    }
    .result-pill {
      width: 27px;
      height: 27px;
      flex: 0 0 27px;
      border-radius: 7px;
      display: grid;
      place-items: center;
      font-size: 10px;
      font-weight: 900;
    }
    .w { color: #5ced89; background: rgba(22,206,82,.12); }
    .l { color: #ff7676; background: rgba(255,72,72,.12); }
    .t { color: #ffd75d; background: rgba(255,215,93,.12); }
    .q { color: #9ca3af; background: rgba(156,163,175,.10); }
    .match-grid {
      margin-top: 12px;
      display: grid;
      grid-template-columns: repeat(5,minmax(0,1fr));
      gap: 6px;
    }
    .match {
      min-width: 0;
      padding: 9px;
      border-radius: 9px;
      background: rgba(255,255,255,.035);
      border: 1px solid rgba(255,255,255,.045);
    }
    .match-line {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 5px;
    }
    .match-result {
      font-size: 13px;
      line-height: 1.2;
      font-weight: 950;
    }
    .match-map {
      min-width: 0;
      color: #838b98;
      font-size: 8px;
      font-weight: 800;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .match-score {
      margin-top: 4px;
      color: white;
      font-size: 11px;
      font-weight: 900;
    }
    .match-meta {
      margin-top: 3px;
      color: #646c79;
      font-size: 7px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .empty {
      grid-column: 1/-1;
      padding: 14px;
      border-radius: 9px;
      background: rgba(255,255,255,.035);
      border: 1px solid rgba(255,255,255,.045);
      color: #838b98;
      font-size: 11px;
      line-height: 1.5;
    }
    .match-link {
      display: inline-block;
      margin-top: 7px;
      color: #f84982;
      font-size: 8px;
      font-weight: 800;
      text-decoration: underline;
    }
    .leetify-footer {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 8px;
      margin-top: 10px;
      color: #a19aaa;
      font-size: 9px;
    }
    .leetify-footer img {
      display: block;
      width: 76px;
      max-height: 23px;
      object-fit: contain;
    }
    .leetify-footer a {
      color: #f84982;
      font-size: 9px;
      font-weight: 700;
      text-decoration: underline;
    }
    @media(max-width:700px) {
      .match-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }
    }
  </style>
</head>
<body>
  <div class="widget">
    <div class="widget-name" id="player">{twój nick}</div>
    <div class="results" id="results"></div>
    <div class="match-grid" id="matches">
      <div class="empty">Łączenie z widgetem…</div>
    </div>
    <div class="leetify-footer">
      <a href="https://leetify.com/" target="_blank" rel="noopener noreferrer" aria-label="Data Provided by Leetify">
        <img src="https://raw.githubusercontent.com/hurr1star/BrowserLeetify/main/Leetify%20Badge%20White%20Small.png" alt="Data Provided by Leetify">
      </a>
      <a href="https://leetify.com/" target="_blank" rel="noopener noreferrer">Data Provided by Leetify</a>
    </div>
  </div>
  <script>
    const token = ${JSON.stringify(token)};

    function esc(value) {
      return String(value ?? "")
        .replaceAll("&","&amp;")
        .replaceAll("<","&lt;")
        .replaceAll(">","&gt;")
        .replaceAll('"',"&quot;")
        .replaceAll("'","&#039;");
    }

    function cls(result) {
      if (result === "W") return "w";
      if (result === "L") return "l";
      if (result === "T") return "t";
      return "q";
    }

    function formatDate(value) {
      if (!value) return "—";
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return "—";
      return d.toLocaleDateString("pl-PL",{day:"2-digit",month:"2-digit"});
    }

    function render(data) {
      const live = data.live || {};
      const player = live.playerName || data.playerName || "{twój nick}";
      document.getElementById("player").textContent = player;

      const matches = Array.isArray(data.matches) ? data.matches.slice(0,10) : [];
      const results = document.getElementById("results");

      if (matches.length) {
        results.innerHTML = matches.map(match =>
          '<div class="result-pill ' + cls(match.result) + '">' +
          esc(match.result || "—") + '</div>'
        ).join("");
      } else {
        results.innerHTML = Array.from({length:10},() =>
          '<div class="result-pill q">—</div>'
        ).join("");
      }

      const container = document.getElementById("matches");
      if (!matches.length) {
        container.innerHTML =
          '<div class="empty">' +
          esc(data.historyError || "Brak historii Competitive w Leetify.") +
          '</div>';
        return;
      }

      container.innerHTML = matches.map(match =>
        '<div class="match">' +
          '<div class="match-line">' +
            '<div class="match-result ' + cls(match.result) + '">' + esc(match.result || "—") + '</div>' +
            '<div class="match-map">' + esc(String(match.map || "—").replace(/^de_/,"")) + '</div>' +
          '</div>' +
          '<div class="match-score">' + esc(match.score || "—") + '</div>' +
          '<div class="match-meta">K/D ' + esc(match.kd ?? "—") + ' · ' + esc(formatDate(match.date)) + '</div>' +
          (match.id ? '<a class="match-link" href="https://leetify.com/app/match-details/' + encodeURIComponent(match.id) + '" target="_blank" rel="noopener noreferrer">View on Leetify</a>' : '') +
        '</div>'
      ).join("");
    }

    async function load() {
      try {
        const response = await fetch("/api/widget/" + encodeURIComponent(token), {cache:"no-store"});
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "Błąd");
        render(data);
      } catch {
        document.getElementById("matches").innerHTML =
          '<div class="empty">Nie można pobrać danych widgetu. Sprawdź połączenie z serwerem.</div>';
      }
    }

    load();
    setInterval(load,60000);
  </script>
</body>
</html>
`;
}

const server =
  http.createServer(
    async (req, res) => {

      try {

        const url =
          new URL(
            req.url,
            "http://" +
            (
              req.headers.host ||
              "localhost"
            )
          );

        if(
          req.method === "GET" &&
          url.pathname === "/api/health"
        ) {

          return json(
            res,
            200,
            {
              ok:true,
              service:
                "CS2 OBS Widget"
            }
          );

        }

        if(
          req.method === "POST" &&
          url.pathname === "/api/setup"
        ) {

          const body =
            await readBody(req);

          const steamId =
            String(
              body.steamId || ""
            ).trim();

          if(
            !validSteam64(
              steamId
            )
          ) {

            return json(
              res,
              400,
              {
                ok:false,
                error:
                  "Steam64 ID musi mieć 17 cyfr."
              }
            );

          }

          let widget =
            Object.values(
              database
            ).find(
              item =>
                item.steamId ===
                steamId
            );

          if(!widget) {

            widget = {

              token:
                randomToken(),

              steamId,

              playerName:"",

              matches:[],

              currentMatch:null,

              lastState:{},

              createdAt:
                new Date()
                  .toISOString(),

              updatedAt:
                new Date()
                  .toISOString()

            };

            database[
              widget.token
            ] = widget;

          }

          saveDatabase();

          return json(
            res,
            200,
            {
              ok:true,

              widgetUrl:
                getBaseUrl(req) +
                "/obs/" +
                widget.token,

              token:
                widget.token,

              gsiToken:
                widget.token
            }
          );

        }

        if(
          req.method === "POST" &&
          url.pathname.startsWith(
            "/api/gsi/"
          )
        ) {

          const token =
            decodeURIComponent(
              url.pathname.substring(
                "/api/gsi/".length
              )
            );

          const widget =
            database[token];

          if(!widget) {

            return json(
              res,
              404,
              {
                ok:false,
                error:
                  "Widget nie istnieje."
              }
            );

          }

          const state =
            await readBody(req);

          const authToken =
            String(
              state.auth?.token || ""
            );

          if(
            authToken !== token
          ) {

            return json(
              res,
              401,
              {
                ok:false,
                error:
                  "Nieprawidłowy token GSI."
              }
            );

          }

          if(!widget.lastState) {
            widget.lastState = {};
          }

          deepMerge(
            widget.lastState,
            state
          );

          const player =
            getPlayer(widget);

          if(
            player.steamid &&
            String(
              player.steamid
            ) !==
            String(
              widget.steamId
            )
          ) {

            return json(
              res,
              403,
              {
                ok:false,
                error:
                  "Steam64 ID nie pasuje."
              }
            );

          }

          const result =
            processGsi(
              widget,
              {}
            );

          widget.updatedAt =
            new Date()
              .toISOString();

          saveDatabase();

          return json(
            res,
            200,
            {
              ok:true,
              result
            }
          );

        }

        if(
          req.method === "GET" &&
          url.pathname.startsWith(
            "/api/widget/"
          )
        ) {

          const token =
            decodeURIComponent(
              url.pathname.substring(
                "/api/widget/".length
              )
            );

          const widget =
            database[token];

          if(!widget) {

            return json(
              res,
              404,
              {
                ok:false,
                error:
                  "Widget nie istnieje."
              }
            );

          }

          const live = getLiveData(widget);
          let history;

          try {
            history = await fetchLeetifyMatches(widget);
          } catch (error) {
            console.error("[Leetify API]", error.message || error);
            history = {
              playerName: "",
              matches: [],
              historyError: error.message || "Nie można pobrać historii z Leetify."
            };
          }

          return json(
            res,
            200,
            {
              ok:true,
              playerName:
                history.playerName ||
                live.playerName ||
                widget.playerName ||
                "{twój nick}",
              live,
              matches: history.matches,
              historyProvider: "Leetify",
              historyError: history.historyError
            }
          );

        }

        if(
          req.method === "GET" &&
          url.pathname.startsWith(
            "/obs/"
          )
        ) {

          const token =
            decodeURIComponent(
              url.pathname.substring(
                "/obs/".length
              )
            );

          if(
            !database[token]
          ) {

            return html(
              res,
              404,
              "<h1>Widget nie istnieje.</h1>"
            );

          }

          return html(
            res,
            200,
            obsPage(token)
          );

        }

        if(
          req.method === "GET" &&
          url.pathname === "/"
        ) {

          const file =
            path.join(
              __dirname,
              "index.html"
            );

          if(
            !fs.existsSync(file)
          ) {

            return html(
              res,
              404,
              "<h1>Brak index.html</h1>"
            );

          }

          return html(
            res,
            200,
            fs.readFileSync(
              file,
              "utf8"
            )
          );

        }

        return json(
          res,
          404,
          {
            ok:false,
            error:"Not found"
          }
        );

      } catch(error) {

        console.error(
          error
        );

        return json(
          res,
          500,
          {
            ok:false,
            error:
              error?.message ||
              "Server error"
          }
        );

      }

    }
  );

server.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      "CS2 OBS Widget działa na porcie " +
      PORT
    );

  }
);
