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

function obsPage(token) {
  return `
<!DOCTYPE html>
<html lang="pl">
<head>

<meta charset="UTF-8">
<meta
  name="viewport"
  content="width=device-width,initial-scale=1"
>

<title>CS2 OBS Widget</title>

<style>

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: transparent;
  font-family: Arial, sans-serif;
  color: white;
}

.widget {
  width: 100%;
  min-height: 100%;
  padding: 20px;
  border-radius: 20px;
  background:
    linear-gradient(
      135deg,
      rgba(11,7,18,.97),
      rgba(27,18,39,.95)
    );
  border: 1px solid rgba(255,255,255,.08);
  box-shadow:
    0 15px 50px rgba(0,0,0,.4);
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 20px;
}

.name {
  font-size: 27px;
  font-weight: 950;
}

.label {
  margin-top: 4px;
  color: #938ca3;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 1.5px;
}

.live {
  text-align: right;
}

.live-label {
  color: #938ca3;
  font-size: 9px;
  letter-spacing: 1px;
  font-weight: 800;
}

.live-value {
  margin-top: 3px;
  font-size: 16px;
  font-weight: 950;
}

.stats {
  margin-top: 15px;
  display: grid;
  grid-template-columns:
    1.15fr
    .8fr
    .8fr
    .8fr
    .8fr
    .8fr;
  gap: 7px;
}

.stat {
  padding: 9px;
  border-radius: 11px;
  background: rgba(255,255,255,.045);
  border: 1px solid rgba(255,255,255,.055);
}

.stat-label {
  color: #777e8b;
  font-size: 8px;
  font-weight: 800;
}

.stat-value {
  margin-top: 3px;
  font-size: 16px;
  font-weight: 950;
}

.matches {
  margin-top: 12px;
  display: grid;
  grid-template-columns:
    repeat(5, 1fr);
  gap: 8px;
}

.empty {
  grid-column: 1 / -1;
  padding: 18px;
  border-radius: 13px;
  background: rgba(255,255,255,.04);
  color: #8d859a;
  font-size: 11px;
}

.match {
  min-width: 0;
  padding: 10px;
  border-radius: 13px;
  background: rgba(255,255,255,.04);
  border:
    1px solid
    rgba(255,255,255,.06);
}

.top {
  display: flex;
  justify-content: space-between;
  gap: 6px;
}

.result {
  font-size: 18px;
  font-weight: 950;
}

.w {
  color: #5ced89;
}

.l {
  color: #ff7777;
}

.t {
  color: #ffd75d;
}

.q {
  color: #a0a7b3;
}

.map {
  max-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #858d9b;
  font-size: 9px;
  font-weight: 800;
}

.score {
  margin-top: 5px;
  font-size: 16px;
  font-weight: 900;
}

.meta {
  margin-top: 5px;
  display: flex;
  justify-content: space-between;
  gap: 5px;
  color: #696f7c;
  font-size: 8px;
}

.status {
  margin-top: 8px;
  color: #626976;
  font-size: 8px;
  text-align: right;
}

@media(max-width:900px) {

  .stats {
    grid-template-columns:
      repeat(3,1fr);
  }

  .matches {
    grid-template-columns:
      repeat(5,1fr);
  }

}

</style>

</head>

<body>

<div class="widget">

  <div class="header">

    <div>

      <div
        class="name"
        id="player"
      >
        {twój nick}
      </div>

      <div class="label">
        CS2
      </div>

    </div>

    <div class="live">

      <div class="live-label">
        MECZ
      </div>

      <div
        class="live-value"
        id="liveMap"
      >
        —
      </div>

    </div>

  </div>

  <div class="stats">

    <div class="stat">
      <div class="stat-label">
        WYNIK
      </div>

      <div
        class="stat-value"
        id="score"
      >
        —
      </div>
    </div>

    <div class="stat">
      <div class="stat-label">
        KILLS
      </div>

      <div
        class="stat-value"
        id="kills"
      >
        —
      </div>
    </div>

    <div class="stat">
      <div class="stat-label">
        DEATHS
      </div>

      <div
        class="stat-value"
        id="deaths"
      >
        —
      </div>
    </div>

    <div class="stat">
      <div class="stat-label">
        ASSISTS
      </div>

      <div
        class="stat-value"
        id="assists"
      >
        —
      </div>
    </div>

    <div class="stat">
      <div class="stat-label">
        K/D
      </div>

      <div
        class="stat-value"
        id="kd"
      >
        —
      </div>
    </div>

    <div class="stat">
      <div class="stat-label">
        MVP
      </div>

      <div
        class="stat-value"
        id="mvps"
      >
        —
      </div>
    </div>

  </div>

  <div
    id="matches"
    class="matches"
  >
    <div class="empty">
      Brak zapisanych meczów.
    </div>
  </div>

  <div
    id="status"
    class="status"
  >
    Łączenie...
  </div>

</div>

<script>

const token =
  ${JSON.stringify(token)};

function esc(value) {

  return String(value ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");

}

function cls(result) {

  if(result === "W")
    return "w";

  if(result === "L")
    return "l";

  if(result === "T")
    return "t";

  return "q";

}

function date(value) {

  if(!value)
    return "—";

  const d =
    new Date(value);

  if(
    Number.isNaN(
      d.getTime()
    )
  )
    return "—";

  return d.toLocaleDateString(
    "pl-PL",
    {
      day:"2-digit",
      month:"2-digit"
    }
  );

}

function renderLive(data) {

  const live =
    data.live || {};

  document.getElementById(
    "player"
  ).textContent =
    live.playerName ||
    data.playerName ||
    "{twój nick}";

  document.getElementById(
    "liveMap"
  ).textContent =
    live.map ||
    "—";

  document.getElementById(
    "score"
  ).textContent =
    live.score ||
    "—";

  document.getElementById(
    "kills"
  ).textContent =
    live.kills ?? "—";

  document.getElementById(
    "deaths"
  ).textContent =
    live.deaths ?? "—";

  document.getElementById(
    "assists"
  ).textContent =
    live.assists ?? "—";

  document.getElementById(
    "kd"
  ).textContent =
    live.kd ?? "—";

  document.getElementById(
    "mvps"
  ).textContent =
    live.mvps ?? "—";

}

function renderMatches(matches) {

  if(!matches.length) {

    document.getElementById(
      "matches"
    ).innerHTML =
      '<div class="empty">' +
      'Historia zacznie się zapisywać od meczów rozegranych po uruchomieniu widgetu.' +
      '</div>';

    return;
  }

  let output = "";

  matches
    .slice(0,10)
    .forEach(match => {

      output +=
        '<div class="match">' +

          '<div class="top">' +

            '<div class="result ' +
            cls(match.result) +
            '">' +
            esc(match.result) +
            '</div>' +

            '<div class="map">' +
            esc(match.map) +
            '</div>' +

          '</div>' +

          '<div class="score">' +
          esc(match.score) +
          '</div>' +

          '<div class="meta">' +

            '<span>' +
            'K ' +
            esc(match.kills) +
            ' · D ' +
            esc(match.deaths) +
            ' · K/D ' +
            esc(match.kd) +
            '</span>' +

            '<span>' +
            esc(date(match.date)) +
            '</span>' +

          '</div>' +

        '</div>';

    });

  document.getElementById(
    "matches"
  ).innerHTML =
    output;

}

async function load() {

  try {

    const response =
      await fetch(
        "/api/widget/" +
        encodeURIComponent(token),
        {
          cache:"no-store"
        }
      );

    const data =
      await response.json();

    if(
      !response.ok ||
      !data.ok
    ) {
      throw new Error(
        data.error ||
        "Błąd"
      );
    }

    renderLive(data);

    renderMatches(
      data.matches || []
    );

    document.getElementById(
      "status"
    ).textContent =
      "LIVE · " +
      new Date()
        .toLocaleTimeString("pl-PL");

  } catch {

    document.getElementById(
      "status"
    ).textContent =
      "BRAK DANYCH";

  }

}

load();

setInterval(
  load,
  2000
);

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

          return json(
            res,
            200,
            {
              ok:true,

              playerName:
                widget.playerName ||
                getLiveData(
                  widget
                ).playerName,

              live:
                getLiveData(
                  widget
                ),

              matches:
                Array.isArray(
                  widget.matches
                )
                  ? widget.matches
                      .slice(0,10)
                  : []
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
