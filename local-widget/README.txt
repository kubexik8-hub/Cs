CS2 OBS WIDGET — WERSJA LOKALNA

Ta wersja nie korzysta z Rendera ani innego hostingu.
Dane historii są pobierane z Leetify API, a program działa na Twoim komputerze.
CS2 nie musi być uruchomione.

WYMAGANIA
- Windows
- Node.js 20 lub nowszy
- Konto Leetify połączone ze Steam i historia meczów dostępna w Leetify

INSTALACJA
1. Rozpakuj folder lokalnego widgetu.
2. Uruchom RUN_WIDGET.bat.
3. Przy pierwszym uruchomieniu utworzy się config.json.
4. W config.json wpisz swój Steam64 ID i opcjonalnie klucz API Leetify.
5. Zapisz plik i uruchom RUN_WIDGET.bat ponownie.
6. Zostaw otwarte okno serwera.
7. W OBS dodaj Źródło -> Przeglądarka i ustaw adres:
   http://127.0.0.1:3210/obs
8. Zalecany rozmiar na początek: 1280 x 300.

KLUCZ API
Klucz API można uzyskać na https://leetify.com/app/developer
Jest opcjonalny, ale bez niego Leetify może ograniczać częstotliwość zapytań.
Wpisz go lokalnie w config.json w polu leetifyApiKey.
Nie wysyłaj nikomu swojego klucza i nie umieszczaj config.json w publicznym repozytorium.

ŚLEDZENIE MECZÓW
Leetify pokazuje mecze, które zostały przez niego przetworzone.
Jeżeli brakuje historii, sprawdź na stronie Leetify połączenie konta Steam
i ustawienia śledzenia meczów / kod udostępniania meczów Matchmaking.

OBS
Program działa lokalnie; okno RUN_WIDGET.bat musi być otwarte, gdy korzystasz z widgetu.
Nie musisz uruchamiać CS2.
Wersja lokalna nie korzysta z Rendera ani zapisanej w jego bazie historii.
