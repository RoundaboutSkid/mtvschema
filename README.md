# Medeltidsveckan schemaöversikt

Verktyget hämtar programmet från Medeltidsveckans programsida och bygger ett
dag-för-dag-schema. Arbetet är uppdelat i två skript:

1. **`fetch_programme.py`** – hämtar programmet och skriver en normaliserad
   datafil. Behöver normalt bara köras en gång; spara den för att kunna
   *återställa* datan.
2. **`fetch_inofficial.py`** – (valfritt) hämtar det *inofficiella* programmet
   från imtv.se och skriver en egen datafil som byggskriptet slår ihop med det
   officiella.
3. **`build_schedule.py`** – läser datafilen/-erna och bygger gränssnittet.

En delad modul, `medeltidsveckan_common.py`, innehåller datamodellen, lane-layout
och läs/skriv-hjälpare. Den körs inte direkt.

## Utdata

- `medeltidsveckan_events.json` – kanonisk datafil (skapas av `fetch_programme.py`).
- `medeltidsveckan_events.csv` – samma data som CSV för egen justering.
- `medeltidsveckan_inofficial.json` / `.csv` – det inofficiella programmet
  (skapas av `fetch_inofficial.py`), slås automatiskt ihop vid bygget.
- `medeltidsveckan_schema.html` – interaktiv tidslinje per dag.
- `medeltidsveckan_schema.xlsx` – samma layout som Excel, en flik per dag.

## Installation

```bash
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## Körning

Steg 1 – hämta programmet (en gång, eller för att återställa datan):

```bash
python fetch_programme.py
```

Steg 2 – bygg schemat från datafilen:

```bash
python build_schedule.py
```

Öppna sedan `medeltidsveckan_output/medeltidsveckan_schema.html` i webbläsaren.

*Valfritt* – ta även med det inofficiella programmet (imtv.se). Kör det här
**innan** steg 2, så slås det ihop automatiskt:

```bash
python fetch_inofficial.py
```

### Användbara flaggor

`fetch_programme.py`:

- `--workers 8` – antal parallella anrop till detalj-API:t.
- `--limit 12` – hämta bara några event (för snabbtest).
- `--save-html` – spara även den råa `programme.html`.

`fetch_inofficial.py`:

- `--default-duration-minutes 90` – antagen längd (sluttid saknas på imtv.se).
- `--year 2026` – årtal för datumen (autodetekteras annars från sidan).
- `--save-html` – spara även den råa sidan.

`build_schedule.py`:

- `--slot-minutes 60` – grövre tidsetiketter i rutnätet.
- `--input path/till/fil.csv` – läs en specifik datafil (kan upprepas). Annars
  hittas det officiella (och inofficiella) JSON/CSV i `--outdir` automatiskt.
- `--no-inofficial` – ta inte med det inofficiella programmet även om datafilen
  finns.
- `--exclude "Titel"` – filtrera bort en titel (kan upprepas).
- `--exclude-file path` – egen fil med titlar att filtrera bort.
- `--no-exclude-file` – ignorera `exclude_titles.txt` även om den finns.
- `--no-excel` – hoppa över Excel-utdata.

## Filtrera bort event

Heldagsöppna eller dagligen återkommande punkter (t.ex. själva marknaden eller
"kyrkan är öppen") kan döljas utan att datan hämtas om. Lägg titlarna i
`exclude_titles.txt` – en per rad:

```text
# Heldagsöppet
Visby domkyrka Sankta Maria
Forum Vulgaris, marknadens hjärta

# Delsträng med jokertecken
*bagpipes*
```

Matchningen är skiftlägesokänslig och `*`/`?` fungerar som jokertecken (en vanlig
titel matchas exakt). Kör sedan `python build_schedule.py` igen – datafilen rörs
inte. Du kan också ge titlar direkt på kommandoraden med `--exclude`.


## Sök och filtrera i schemat

HTML-schemat är en **fristående fil** (ingen server eller webbapp behövs) med
inbyggda kontroller högst upp som körs direkt i webbläsaren:

- **Sökruta** – matchar titel, arrangör och plats medan du skriver.
- **Kategorier ▾** – bockruta per kategori med snabbval *Alla*/*Inga* och ett
  eget filterfält. Färgrutan vid varje kategori är även teckenförklaring.
- **Platser ▾** – bockruta per plats med snabbval *Alla*/*Inga* och ett eget
  filterfält. Avbockade platser döljs helt och de kvarvarande breddas.
- **Återställ** – nollställer alla filter. En räknare visar hur många punkter som
  syns.

Filtreringen påverkar bara vad som visas; inget hämtas om och datafilen rörs inte.

## Detaljer och biljetter

Varje programpunkt visar nu hela inforutan från originalprogrammet:

- **Hovra** över ett event för en snabb sammanfattning (tid, arrangör, plats och
  ett utdrag ur beskrivningen) som webbläsarens egen tooltip.
- **Klicka** på ett event för att öppna en ruta med den **fullständiga
  beskrivningen**. Stäng med krysset, `Esc` eller genom att klicka utanför.
- Event som kräver biljett har ett **“Köp biljett ↗”**-chip som är en direkt
  länk till biljettsidan (öppnas i ny flik). Samma länk finns även som knapp i
  detaljrutan. Sökningen matchar också mot beskrivningstexten.

Beskrivning och biljettlänk följer med i datafilerna och i Excel-arket
(kolumnen `ticket_url`).

## Favoriter och köpta biljetter

Du kan markera och hålla koll på dina egna programpunkter direkt i schemat.
Markeringarna sparas i webbläsaren (`localStorage`) och ligger kvar mellan
besök – de följer **inte** med datafilerna och delas inte med andra.

- **★ Favorit** – klicka på stjärnan i eventets övre högra hörn (eller knappen i
  detaljrutan). Favoriter får en gul stjärna som alltid syns.
- **Biljett-ikon** – för event med biljett finns en liten biljettsymbol.
  Markerar du den som köpt blir biljetten grön och eventet blir **automatiskt
  favorit** om det inte redan var det.
- **Röd varning (!)** – ett event som är favorit *och* har biljett *och* ännu
  inte är markerat som köpt får ett rött utropstecken och en röd kantmarkering,
  så att du snabbt ser vilka biljetter du fortfarande behöver köpa.
- **★ Bara favoriter** – kryssrutan i verktygsfältet döljer allt utom dina
  favoriter och fungerar tillsammans med sök- och platsfiltren. *Återställ*
  nollställer även detta filter (men rör inte själva markeringarna).
- **★ Skriv ut favoriter** – öppnar en ren, utskriftsvänlig lista med dina
  favoriter grupperade per dag och sorterade på tid, med plats, arrangör och
  biljettstatus (*Biljett behövs* / *Biljett köpt*). Klicka **Skriv ut** för att
  skriva ut eller spara som PDF, eller **Stäng** (eller `Esc`) för att gå
  tillbaka.
- **📅 Lägg till i kalender** – laddar ner dina favoriter som en kalenderfil
  (`medeltidsveckan-favoriter.ics`) som du kan importera i Google Kalender,
  Apple Kalender, Outlook m.fl. Varje punkt får rätt tid i tidszonen
  *Europe/Stockholm*, plats, arrangör samt biljettstatus och en *Köp biljett*-länk
  i beskrivningen. Inget påminnelse-larm läggs till (det ställer du själv in i din
  kalender om du vill). Filen är en **ögonblicksbild** – ändrar du favoriter
  senare laddar du bara ner en ny fil och importerar om.
- **🔗 Prenumerera** – visas bara om du har satt upp prenumerations-Workern (se
  nedan). Den ger dig en länk som du prenumererar på en gång; din kalenderapp
  hämtar då dina favoriter automatiskt och uppdaterar dem när du ändrar dina val
  eller när programmet uppdateras. Till skillnad från *Lägg till i kalender* är
  detta alltså inte en ögonblicksbild.

## Så fungerar layouten

Schemat ritas som en tidslinje per dag: platser som kolumner och tiden nedåt.

- En programpunkt som sträcker sig över flera tidsrutor visas som **ett
  sammanhängande block** (höjden följer längden) istället för att upprepas.
- Programpunkter som **krockar i tid på samma plats** delas upp i sidoställda
  *lanes* så att de syns bredvid varandra. En ensam punkt fyller hela platsens
  bredd.
- Varje dag har en **begränsad höjd med egen scroll**, så den vågräta
  scrollisten alltid är nåbar och plats- och tidsrubrikerna ligger kvar medan du
  scrollar. Höjden styrs av `--board-max-h` högst upp i CSS:en.
- Tidslinjen **krymper till det synliga tidsspannet** när du filtrerar (t.ex.
  bara favoriter), så att tom tid före och efter dina träffar tas bort. Utan
  filter visas hela dagen.

## Var data kommer ifrån

Programmets huvudsida listar varje programpunkt med titel, kategori och
arrangör. Den verkliga **platsen** och **start–sluttiden** finns däremot bara i
eventets inforuta, som sidan laddar via ett detalj-API
(`/?async=true&action=fetch-programme-item&pid=...`). `fetch_programme.py`
hämtar därför varje punkt från det API:et. Saknas en sluttid används en
kategori-baserad standardlängd (se `CATEGORY_DEFAULT_MINUTES` i
`medeltidsveckan_common.py`). Listor med öppettider tas inte med i schemat.

Från samma inforuta hämtas också eventets **beskrivning** (`content.description`)
och eventuell **biljettlänk** (`sidebar.ticket_link`). Beskrivningen tvättas från
HTML till ren text innan den sparas.

## Det inofficiella programmet (imtv.se)

`fetch_inofficial.py` hämtar det inofficiella programmet och lägger till det i
schemat som **en egen kategori, "Inofficiellt"** (med egen färg). Det går därför
att slå på/av som vilken annan kategori som helst, och det syns i sök, favoriter
och utskrift precis som det officiella.

Den sidan ser annorlunda ut: varje punkt har **starttid, titel och en
fritextbeskrivning**, men **ingen sluttid** och **ingen strukturerad plats**.
Därför:

- **Sluttid** antas (standard 90 min, styrs med `--default-duration-minutes`).
- **Plats** gissas utifrån nyckelord i texten (en kurerad lista över de
  återkommande Visby-platserna: portar, torn, gravarna m.m. i
  `VENUE_KEYWORDS`). Hittas ingen plats används *Okänd plats*. För t.ex.
  "Ringmuren runt" används samlingsplatsen (Österport) som plats.
- Eventuell Facebook-/info-länk i texten sparas sist i beskrivningen som
  *"Mer info: …"*.

Vill du bygga schemat utan det inofficiella programmet, kör
`python build_schedule.py --no-inofficial`.

## Prenumerera på dina favoriter (egen kalender)

Knappen **🔗 Prenumerera** ger varje besökare en *egen, självuppdaterande*
kalender med bara sina favoriter. Det kräver en liten gratistjänst, eftersom
favoriterna sparas i webbläsaren och en kalender-prenumeration hämtas från en
webbadress – favoritlistan måste därför nå en server. Lösningen här är en
**Cloudflare Worker** (gratisnivå) som lagrar varje webbläsares favorit-id i
Workers KV och serverar en personlig `.ics`-feed. Allt ligger i mappen
[`worker/`](worker/README.md).

Översikt av flödet:

1. Du markerar favoriter som vanligt. Webbappen får ett anonymt, slumpat id
   (sparas i `localStorage`) och skickar din favoritlista till Workern.
2. Du prenumererar **en gång** på `…/fav.ics?u=<ditt-id>`.
3. Kalenderappen hämtar feeden med jämna mellanrum och håller den uppdaterad.

### Engångsuppsättning

Du behöver ett gratis [Cloudflare](https://dash.cloudflare.com/sign-up)-konto och
Node (för `wrangler`). Kör i `worker/`-mappen:

```bash
cd worker
npx wrangler login                       # öppnar webbläsaren
npx wrangler kv namespace create MV_KV   # skriv ut ett id …
#   … klistra in id:t i worker/wrangler.toml (ersätt REPLACE_WITH_KV_ID)
cd .. && python3 build_schedule.py       # genererar worker/src/programme.js
cd worker && npx wrangler deploy          # skriver ut din Worker-URL
```

Koppla sedan ihop schemat med din URL (sparas i
`medeltidsveckan_output/medeltidsveckan_config.json`, så du bara behöver göra det
en gång):

```bash
cd ..
python3 build_schedule.py --ics-endpoint https://medeltidsveckan-fav.<konto>.workers.dev
```

Nu dyker **🔗 Prenumerera** upp i verktygsfältet. Vill du dölja knappen igen, kör
en build med `--no-ics-endpoint`.

### Prenumerera i kalenderappen

- **Apple Kalender / Outlook:** klicka **Öppna i kalender** i dialogen
  (`webcal://`-länken öppnar prenumerationsrutan direkt).
- **Google Kalender:** kopiera länken och gå till *Inställningar → Lägg till
  kalender → Från URL* och klistra in den.

### Bra att veta

- **Uppdateringstakt:** kalenderappar hämtar prenumerationer på sin egen
  tidtabell (Apple ofta var ~5 min–timme, Google upp till ~24 h) – inte direkt.
- **När programmet ändras:** kör om `python3 build_schedule.py` (uppdaterar
  `worker/src/programme.js`) och sedan `npx wrangler deploy`. Befintliga
  prenumerationer fortsätter fungera.
- **Integritet:** id:t är anonymt och slumpat. Servern lagrar bara en lista med
  event-id:n per id, och inaktiva poster glöms automatiskt efter ~13 månader.
- **Inga påminnelser** läggs till; tid, plats, arrangör och biljettstatus följer
  med precis som i `.ics`-nedladdningen.

Se [`worker/README.md`](worker/README.md) för fler detaljer och lokalt test.

