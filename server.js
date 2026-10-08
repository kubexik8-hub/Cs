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
    req.headers["x-forwarded-proto"] ||
    "https";

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

function startMatch(widget, state) {
  const map = state.map || {};
  const player = state.player || {};

  widget.currentMatch = {
    id:
      `${Date.now()}-${randomToken().slice(0, 8)}`,

    startedAt:
      new Date().toISOString(),

    map:
      map.name || "",

    mode:
      map.mode || "",

    playerName:
      player.name || widget.playerName || "",

    steamId:
      player.steamid ||
      widget.steamId ||
      "",

    state: state
  };
}

function getCurrentPlayer(widget, state) {
  const wanted = String(widget.steamId);

  if (
    state.player &&
    String(state.player.steamid || "") === wanted
  ) {
    return state.player;
  }

  return state.player || {};
}

function finalizeMatch(widget) {
  if (!widget.currentMatch) {
    return null;
  }

  const state =
    widget.currentMatch.state || {};

  const map =
    state.map || {};

  const player =
    getCurrentPlayer(
      widget,
      state
    );

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

  let myScore = null;
  let enemyScore = null;

  if (team === "CT") {
    myScore = ctScore;
    enemyScore = tScore;
  }

  if (team === "T") {
    myScore = tScore;
    enemyScore = ctScore;
  }

  let result = "?";

  if (
    myScore !== null &&
    enemyScore !== null
  ) {
    if (myScore > enemyScore) {
      result = "W";
    } else if (myScore < enemyScore) {
      result = "L";
    } else {
      result = "T";
    }
  }

  const stats =
    player.match_stats || {};

  const kills =
    Number(stats.kills ?? 0);

  const deaths =
    Number(stats.deaths ?? 0);

  const assists =
    Number(stats.assists ?? 0);

  const mvps =
    Number(stats.mvps ?? 0);

  const points =
    Number(stats.score ?? 0);

  const match = {
    id:
      widget.currentMatch.id,

    date:
      new Date().toISOString(),

    playerName:
      player.name ||
      widget.currentMatch.playerName ||
      "{twój nick}",

    steamId:
      String(
        player.steamid ||
        widget.steamId
      ),

    map:
      String(
        map.name ||
        widget.currentMatch.map ||
        ""
      )
        .replace(/^de_/, "")
        .toUpperCase(),

    result,

    score:
      myScore !== null &&
      enemyScore !== null
        ? `${myScore}:${enemyScore}`
        : "—",

    kills,
    deaths,
    assists,
    mvps,
    points,

    kd:
      deaths > 0
        ? Number(
            (
              kills / deaths
            ).toFixed(2)
          )
        : kills
  };

  widget.matches.unshift(match);

  if (widget.matches.length > 100) {
    widget.matches =
      widget.matches.slice(0, 100);
  }

  widget.playerName =
    match.playerName;

  widget.currentMatch = null;

  widget.updatedAt =
    new Date().toISOString();

  saveDatabase();

  return match;
}

function processGsi(widget, state) {
  const map =
    state.map || {};

  const mode =
    String(
      map.mode || ""
    ).toLowerCase();

  const phase =
    String(
      map.phase || ""
    ).toLowerCase();

  if (mode !== "competitive") {
    return {
      type: "ignored",
      reason: "not_competitive"
    };
  }

  if (
    phase === "live" &&
    !widget.currentMatch
  ) {
    startMatch(
      widget,
      state
    );

    saveDatabase();

    return {
      type: "match_started"
    };
  }

  if (widget.currentMatch) {
    deepMerge(
      widget.currentMatch.state,
      state
    );
  }

  if (
    phase === "gameover" &&
    widget.currentMatch
  ) {
    const match =
      finalizeMatch(widget);

    return {
      type: "match_finished",
      match
    };
  }

  return {
    type: "state"
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
<title>OBS Widget</title>

<style>
* {
  box-sizing: border-box;
}

html,
body {
  width: 100%;
  height: 100%;
  margin: 0;
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
      rgba(11, 7, 18, .96),
      rgba(25, 17, 37, .94)
    );
  border: 1px solid rgba(255,255,255,.08);
  box-shadow: 0 15px 50px rgba(0,0,0,.4);
}

.header {
  display: flex;
  align-items: flex-start;
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

.matches {
  margin-top: 18px;
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
}

.empty {
  grid-column: 1 / -1;
  padding: 20px;
  border-radius: 13px;
  background: rgba(255,255,255,.04);
  color: #8d859a;
  font-size: 12px;
}

.match {
  padding: 10px;
  min-width: 0;
  border-radius: 13px;
  background: rgba(255,255,255,.04);
  border: 1px solid rgba(255,255,255,.06);
}

.top {
  display: flex;
  align-items: center;
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
  max-width: 85px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: #858d9b;
  font-size: 9px;
  font-weight: 800;
}

.score {
  margin-top: 5px;
  font-size: 17px;
  font-weight: 900;
}

.meta {
  display: flex;
  justify-content: space-between;
  gap: 5px;
  margin-top: 5px;
  color: #696f7c;
  font-size: 8px;
}

.status {
  margin-top: 9px;
  text-align: right;
  color: #626976;
  font-size: 8px;
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
        OSTATNIE MECZE
      </div>

    </div>
  </div>

  <div
    id="matches"
    class="matches"
  >
    <div class="empty">
      Oczekiwanie na pierwszy zakończony mecz...
    </div>
  </div>

  <div
    id="status"
    class="status"
  >
    LIVE
  </div>

</div>

<script>
const token = ${JSON.stringify(token)};

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cls(result) {
  if (result === "W") return "w";
  if (result === "L") return "l";
  if (result === "T") return "t";
  return "q";
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleDateString(
    "pl-PL",
    {
      day: "2-digit",
      month: "2-digit"
    }
  );
}

async function load() {
  try {

    const response = await fetch(
      "/api/widget/" +
      encodeURIComponent(token),
      {
        cache: "no-store"
      }
    );

    const data =
      await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(
        data.error ||
        "Błąd pobierania danych"
      );
    }

    document.getElementById(
      "player"
    ).textContent =
      data.playerName ||
      "{twój nick}";

    const matches =
      data.matches || [];

    if (!matches.length) {

      document.getElementById(
        "matches"
      ).innerHTML =
        '<div class="empty">' +
        'Oczekiwanie na pierwszy zakończony mecz...' +
        '</div>';

    } else {

      let output = "";

      matches
        .slice(0, 10)
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
                '</span>' +

                '<span>' +
                esc(formatDate(match.date)) +
                '</span>' +

              '</div>' +

            '</div>';
        });

      document.getElementById(
        "matches"
      ).innerHTML = output;
    }

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
      "BŁĄD";
  }
}

load();

setInterval(
  load,
  10000
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

        if (
          req.method === "GET" &&
          url.pathname === "/api/health"
        ) {
          return json(
            res,
            200,
            {
              ok: true,
              service: "CS2 OBS Widget"
            }
          );
        }

        if (
          req.method === "POST" &&
          url.pathname === "/api/setup"
        ) {

          const body =
            await readBody(req);

          const steamId =
            String(
              body.steamId || ""
            ).trim();

          if (!validSteam64(steamId)) {
            return json(
              res,
              400,
              {
                ok: false,
                error:
                  "Steam64 ID musi mieć 17 cyfr."
              }
            );
          }

          let widget =
            Object.values(database)
              .find(
                item =>
                  item.steamId === steamId
              );

          if (!widget) {

            widget = {
              token:
                randomToken(),

              steamId,

              playerName:
                "",

              matches: [],

              currentMatch:
                null,

              createdAt:
                new Date().toISOString(),

              updatedAt:
                new Date().toISOString()
            };

            database[
              widget.token
            ] = widget;

          }

          saveDatabase();

          const widgetUrl =
            getBaseUrl(req) +
            "/obs/" +
            widget.token;

          return json(
            res,
            200,
            {
              ok: true,
              widgetUrl,
              token:
                widget.token,
              gsiToken:
                widget.token
            }
          );
        }

        if (
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

          if (!widget) {
            return json(
              res,
              404,
              {
                ok: false,
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

          if (
            authToken !== token
          ) {
            return json(
              res,
              401,
              {
                ok: false,
                error:
                  "Nieprawidłowy token GSI."
              }
            );
          }

          const player =
            state.player || {};

          const steamId =
            String(
              player.steamid || ""
            );

          if (
            steamId &&
            steamId !==
              String(widget.steamId)
          ) {
            return json(
              res,
              403,
              {
                ok: false,
                error:
                  "Steam64 ID nie pasuje do widgetu."
              }
            );
          }

          const result =
            processGsi(
              widget,
              state
            );

          widget.updatedAt =
            new Date().toISOString();

          saveDatabase();

          return json(
            res,
            200,
            {
              ok: true,
              result
            }
          );
        }

        if (
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

          if (!widget) {
            return json(
              res,
              404,
              {
                ok: false,
                error:
                  "Widget nie istnieje."
              }
            );
          }

          return json(
            res,
            200,
            {
              ok: true,

              playerName:
                widget.playerName ||
                "{twój nick}",

              matches:
                Array.isArray(
                  widget.matches
                )
                  ? widget.matches.slice(0, 10)
                  : []
            }
          );
        }

        if (
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

          if (!database[token]) {
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

        if (
          req.method === "GET" &&
          url.pathname === "/"
        ) {

          const file =
            path.join(
              __dirname,
              "index.html"
            );

          if (!fs.existsSync(file)) {
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
            ok: false,
            error: "Not found"
          }
        );

      } catch (error) {

        return json(
          res,
          500,
          {
            ok: false,
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
