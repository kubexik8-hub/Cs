const http = require("http");
const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "config.json");
const WIDGET_PATH = path.join(__dirname, "widget.html");

function log(type, message) {
  const time = new Date().toLocaleTimeString("pl-PL", { hour12: false });
  console.log("[" + time + "] [" + type + "] " + message);
}

function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error("Brak config.json. Uruchom RUN_WIDGET.bat ponownie lub skopiuj config.example.json jako config.json.");
  }

  const raw = fs.readFileSync(CONFIG_PATH, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(raw);
}

function send(res, status, contentType, body) {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(body);
}

function sendJson(res, status, data) {
  send(res, status, "application/json; charset=utf-8", JSON.stringify(data));
}

async function leetifyGet(pathname, apiKey) {
  const headers = { Accept: "application/json" };

  if (apiKey) {
    headers.Authorization = "Bearer " + apiKey;
  }

  let response;

  try {
    response = await fetch("https://api-public.cs-prod.leetify.com" + pathname, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(15000)
    });
  } catch (error) {
    throw new Error("Nie można połączyć się z Leetify API. Sprawdź internet i spróbuj ponownie.");
  }

  let data = null;

  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Leetify zwróciło HTTP 401: sprawdź LEETIFY_API_KEY w config.json.");
    }

    if (response.status === 403 || response.status === 404) {
      throw new Error("Leetify nie udostępnia tego profilu. Zaloguj się do Leetify i sprawdź Steam64 ID oraz ustawienia prywatności.");
    }

    if (response.status === 429) {
      throw new Error("Leetify ograniczyło liczbę zapytań (HTTP 429). Dodaj klucz API albo spróbuj później.");
    }

    throw new Error("Leetify API zwróciło HTTP " + response.status + ".");
  }

  return data;
}

function normalizeMatches(apiData, steamId) {
  const allMatches = Array.isArray(apiData)
    ? apiData
    : Array.isArray(apiData && apiData.matches)
      ? apiData.matches
      : Array.isArray(apiData && apiData.data)
        ? apiData.data
        : [];

  return allMatches
    .filter(match => String(match && match.data_source || "").toLowerCase() === "matchmaking_competitive")
    .map(match => {
      const players = Array.isArray(match.stats) ? match.stats : [];
      const player = players.find(entry => String(entry && entry.steam64_id || "") === steamId);

      if (!player) return null;

      const teams = Array.isArray(match.team_scores) ? match.team_scores : [];
      const teamNo = Number(player.initial_team_number);
      const ownTeam = teams.find(team => Number(team.team_number) === teamNo);
      const enemyTeam = teams.find(team => Number(team.team_number) !== teamNo);

      const ownScore = Number(ownTeam && ownTeam.score !== undefined
        ? ownTeam.score
        : player.rounds_won !== undefined ? player.rounds_won : 0);
      const enemyScore = Number(enemyTeam && enemyTeam.score !== undefined
        ? enemyTeam.score
        : player.rounds_lost !== undefined ? player.rounds_lost : 0);

      let result = "T";
      if (ownScore > enemyScore) result = "W";
      if (ownScore < enemyScore) result = "L";

      const kills = Number(player.total_kills || 0);
      const deaths = Number(player.total_deaths || 0);
      const kd = Number(player.kd_ratio !== undefined
        ? player.kd_ratio
        : deaths > 0 ? kills / deaths : kills);

      return {
        id: String(match.id || ""),
        date: match.finished_at || "",
        map: String(match.map_name || "—").replace(/^de_/, "").toUpperCase(),
        score: ownScore + ":" + enemyScore,
        result,
        kills,
        deaths,
        assists: Number(player.total_assists || 0),
        headshots: Number(player.total_hs_kills || 0),
        kd: Number.isFinite(kd) ? Number(kd.toFixed(2)) : 0,
        leetifyRating: player.leetify_rating === undefined ? null : player.leetify_rating
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 10);
}

let historyRequestAt = 0;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");

  if (req.method === "POST" && url.pathname === "/gsi") {
    return send(res, 200, "text/plain; charset=utf-8", "This local widget reads match history from Leetify.");
  }

  if (req.method !== "GET") {
    return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  }

  if (url.pathname === "/api/health") {
    return sendJson(res, 200, { ok: true, service: "Local Leetify OBS Widget" });
  }

  if (url.pathname === "/api/history") {
    const now = Date.now();

    if (now - historyRequestAt < 10000) {
      return sendJson(res, 429, {
        ok: false,
        error: "Odczekaj kilka sekund przed kolejnym odświeżeniem."
      });
    }

    historyRequestAt = now;

    try {
      const config = readConfig();
      const steamId = String(config.steamId || "").trim();
      const apiKey = String(config.leetifyApiKey || "").trim();

      if (!/^\d{17}$/.test(steamId)) {
        return sendJson(res, 400, {
          ok: false,
          error: "Uzupełnij poprawny, 17-cyfrowy Steam64 ID w pliku config.json."
        });
      }

      const query = new URLSearchParams({ steam64_id: steamId }).toString();
      log("LEETIFY", "Pobieram aktualny profil i historię meczów.");

      const [profile, apiMatches] = await Promise.all([
        leetifyGet("/v3/profile?" + query, apiKey),
        leetifyGet("/v3/profile/matches?" + query, apiKey)
      ]);

      const matches = normalizeMatches(apiMatches, steamId);
      const profileName = String(profile && profile.name || (matches[0] && matches[0].playerName) || "");

      let historyError = "";

      if (profile && profile.privacy_mode === "private") {
        historyError = "Profil Leetify jest prywatny lub nie udostępnia historii przez API.";
      } else if (!matches.length) {
        historyError = "Leetify nie zwróciło jeszcze meczów Competitive. Sprawdź, czy konto Leetify jest połączone ze Steam i ma włączone śledzenie meczów.";
      }

      log("LEETIFY OK", "Profil: " + (profileName || "bez nazwy") + "; zapisane mecze Competitive: " + matches.length);

      return sendJson(res, 200, {
        ok: true,
        playerName: profileName || "{twój nick}",
        steamId,
        matches,
        historyError,
        provider: "Leetify",
        refreshedAt: new Date().toISOString()
      });
    } catch (error) {
      log("LEETIFY ERROR", error.message || String(error));
      return sendJson(res, 502, {
        ok: false,
        error: error.message || "Nie można pobrać historii z Leetify."
      });
    }
  }

  if (url.pathname === "/" || url.pathname === "/obs" || url.pathname === "/obs/") {
    if (!fs.existsSync(WIDGET_PATH)) {
      return send(res, 500, "text/plain; charset=utf-8", "Brak pliku widget.html.");
    }

    return send(res, 200, "text/html; charset=utf-8", fs.readFileSync(WIDGET_PATH, "utf8"));
  }

  return sendJson(res, 404, { ok: false, error: "Not found" });
});

server.on("error", error => {
  log("SERVER ERROR", error.message || String(error));
  if (error.code === "EADDRINUSE") {
    log("INFO", "Port jest zajęty. Zamknij stare okno SERWER_CS2.bat (Ctrl+C) i uruchom lokalny widget ponownie.");
  }
  process.exitCode = 1;
});

try {
  const config = readConfig();
  const port = Number(config.port || 3210);

  server.listen(port, "127.0.0.1", () => {
    console.log("");
    console.log("========================================");
    console.log("       CS2 WIDGET — LEETIFY LOCAL");
    console.log("========================================");
    log("START", "Widget: http://127.0.0.1:" + port + "/obs");
    log("START", "Dane pobierane bezpośrednio z Leetify API.");
    log("START", "CS2 nie musi być uruchomione.");
    log("START", "Klucz API jest czytany lokalnie z config.json i nie jest wypisywany w logach.");
    log("START", "Pozostaw to okno otwarte podczas korzystania z OBS.");
    console.log("");
  });
} catch (error) {
  log("CONFIG ERROR", error.message || String(error));
  process.exit(1);
}
