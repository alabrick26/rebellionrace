# Protocol notes (reverse-engineered from the SWF)

Three server surfaces, all same-origin on the Worker:

## 1. Legacy auth — `GET /common/getauthcookie.aspx`
`LoadVars.load()` → body `userID=<id>&`. Identity comes from the `rr_token` cookie.

## 2. Flash Remoting (AMF0) — `POST /gateway.aspx`
Responses are `{ Table: RecordSet }` like the original ADO.NET DataSet; a `RecordSet` is the typed AMF0 object
`serverInfo{version:1, columnNames[], initialData[][], cursor, totalCount}` which `mx.remoting.RecordSet` consumes.

| Method | Columns returned |
|---|---|
| `UserServices_HW.GetUserInfo(id)` | userID, NickName, Avatar, Background, EmailAddressUser, EmailAddressParent, LastBirthdayEmailSentDate, CountBirthdayYear, lastplaydate |
| `Shared_GameService.GetPlayerStatus(uid, siteid)` | max_score, rank |
| `.GetUserCar(uid, siteid, gameid)` | username, car1..car12 (`id=c3&locked=false&speedIcons=2&handlingIcons=0&accelIcons=1`) |
| `.UpdateCar1..12(uid, siteid, gameid, status)` | result |
| `.RecordCarScore(...)` | rank, score — **ignored**: scores are credited by the race server |
| `.GetTopCarList(siteid, gameid, n)` | username, score |

(`siteid=34`, `gameid=114`.) The player is taken from the cookie; the `userid` argument is only a fallback.

## 3. Game socket — `GET /ws` (WebSocket) carrying XMLSocket bytes
Ruffle's `socketProxy` maps `game.local:9875` → `wss://<host>/ws`. Every message ends with a NUL byte.

**XML control messages** (ElectroServer 3 envelope `<XmlDoc><Action>…</Action><Parameters>…</Parameters></XmlDoc>`)

| Direction | Message |
|---|---|
| S→C (on connect) | `ConnectionResponse` — `Result=Accepted`, `Version Major=3 Minor=2 Sub=0` |
| C→S | `Login` — `<Name>`, `<Password>`, optional `<EventHandlerVariables>` (the original sends a constant `token`; ignored here) ; S→C `LoginResponse` `Accepted` (+`<Username>`,`<Variables>`) or `Declined` (+`<Reason>`) |
| C→S | `CreateRoom` (zone "HW Chat", room "Lobby<n>") — the original `joinLobby()`, sent after login and whenever a player leaves a race. S→C `CreateRoom` `<Result>Success</Result>`; the server also frees the player's race seat |
| C→S | `RegisterRawHandler` `<Name>RebellionRace</Name>` |
| C→S | `ExecutePlugin` `HWGameManager` / `JoinAnyGame` or `LeaveGame` |
| C→S / S→C | `GetServerTime` / `<ServerTime>` (keep-alive) |

**Raw game messages** (anything not starting with `<`; fields separated by `~`)

| C→S | Meaning | S→C reply |
|---|---|---|
| `GST` | time sync | `ST\|serverMs` |
| `SCT\|car~speed~handling~accel` | chosen car + upgrade icons | (stored; used in `CL`) |
| `R` | client finished loading the track | — |
| `CA\|action~x~y~speed~rot~pct` | car state change | `CA\|serverMs~name~action~x~y~speed~rot~pct` to everyone, sender included |
| `AC\|itemId` | attempt to collect | first caller wins → `IC\|itemId~name` to all |
| `ICL\|id~speed~angle~name` | item collision | same message to all with the real sender name |
| `F` | crossed the finish line | `F\|name~raceMs` to all |
| `SendTaunt\|text-or-index` | taunt | `DisplayTaunt\|name~text` |

Server-initiated sequence for one race:
`TRI|0~seed` → (all `R`, or 5 s) → `CL|name,x,y,car,s,h,a~…~` + `PGCD|10000` → `SG` (lights) → +3 s `RSG` (go) →
`F|…` per finisher → `GO|first~second~…` + `GRCD|8000` → next `TRI`. Also `UL|name` (player left),
`PGCDC` / `GRCDC` (countdown cancelled: not enough players).

Scoring: on `F`, `carsBeaten = playersInRace − 1 − finishersBefore` is added to the player's score (D1).
