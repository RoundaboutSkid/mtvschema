# Favoritkalender-Worker (Cloudflare)

En liten Cloudflare Worker som låter schemats **Prenumerera**-knapp lägga dina
favoriter i en egen, självuppdaterande kalender. Workern lagrar bara en lista
med event-id per webbläsare i Workers KV – själva eventdetaljerna ligger i den
genererade [src/programme.js](src/programme.js).

## Endpoints

| Metod | Sökväg | Beskrivning |
| ----- | ------ | ----------- |
| `POST` | `/save?u=<id>` | Sparar `{favs:[…], bought:[…]}` för användaren. |
| `GET` | `/fav.ics?u=<id>` | Returnerar en iCalendar-feed med användarens favoriter. |
| `GET` | `/` | Kort hjälptext. |

## Engångsuppsättning

Allt körs från den här mappen (`worker/`).

```bash
# 1. Logga in (öppnar webbläsaren)
npx wrangler login

# 2. Skapa KV-lagringen och kopiera id:t som skrivs ut
npx wrangler kv namespace create MV_KV
#    -> klistra in id:t i wrangler.toml (ersätt REPLACE_WITH_KV_ID)

# 3. Generera programdatan (från projektroten, en nivå upp)
cd .. && python3 build_schedule.py && cd worker

# 4. Publicera
npx wrangler deploy
```

`wrangler deploy` skriver ut din Worker-URL, t.ex.
`https://medeltidsveckan-fav.<konto>.workers.dev`.

## Koppla ihop med schemat

Bygg om HTML:en med din Worker-URL (görs en gång; den sparas i
`medeltidsveckan_output/medeltidsveckan_config.json`):

```bash
cd ..
python3 build_schedule.py --ics-endpoint https://medeltidsveckan-fav.<konto>.workers.dev
```

Nu visas knappen **🔗 Prenumerera** i schemat.

## När programmet uppdateras

Kör om `build_schedule.py` (regenererar `src/programme.js`) och sedan
`npx wrangler deploy`. Befintliga prenumerationer fortsätter fungera; nya/ändrade
event slår igenom vid kalenderappens nästa hämtning.

## Lokalt test

```bash
npx wrangler dev
# i ett annat fönster:
curl -X POST 'http://127.0.0.1:8787/save?u=testuser1' \
  -H 'Content-Type: application/json' \
  -d '{"favs":["<ett-event-id>"],"bought":[]}'
curl 'http://127.0.0.1:8787/fav.ics?u=testuser1'
```
