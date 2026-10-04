# What to change in `rebellion.swf`

## Short answer: with the ORIGINAL SWF, nothing is required.

The original game connects, logs in and joins its lobby **by itself** (frame 13, label "Code"):

```
es.connect(ip, port)                     ip/port come from ServerSettings.xml
 └ onConnection(true) → es.login(username, "", {token})      username = the nickname from GetUserInfo
    └ loggedIn(true)  → joinLobby()      = es.createRoom({zone:"HW Chat", roomName:"Lobby<n>"})
```
and `joinLobby()` runs again whenever a player leaves a race. This repo's server simply answers those calls:
`ConnectionResponse` → `LoginResponse Accepted` → `CreateRoom Success` (and treats `CreateRoom` as "leave my race").
If the connection fails the original code picks a random guest name and plays the offline AI race; the garage/scores
screens call `reconnect()`, which really tries again. So multiplayer and the AI fallback both come for free.

> **Do not apply the earlier "four edits" patch.** It was written against a *modified* copy of the SWF in which the
> connection code had been removed (`joinLobby` jumped to "StartAI", `es.connect` was gone). That is also why the
> offline copy needed `?username=…`: only the original code assigns `username`.

## Step 0 – make sure you are using the original `frame_13`
Open `rebellion.swf` in JPEXS → **Scripts → frame_13 → DoAction**.
* If it contains `es.connect(ip,port);` and `function reconnect()` with `es.onConnection = …` inside it,
  it is the original – continue.
* If it still says `_parent._parent.gotoAndPlay("StartAI")` or `"!!! Connection closed (offline mode) !!!"`, it is the
  modified one. Either start from the original SWF, or select all in the editor, paste the contents of
  [`frame13_original.as`](frame13_original.as), **Save**, then **File → Save as** `public/game/rebellion.swf`.

## Optional but recommended – one block of insurance
Add [`optional_ondata_shim.as`](optional_ondata_shim.as) right after `es.addListener(this);`.
Apply it if (after a normal install) DevTools shows `/ws` frames going both ways but the game never reaches the
lobby/countdown. It is harmless in real Flash Player.

## Nothing else changes
`/gateway.aspx`, `/common/getauthcookie.aspx`, the game sprite and the XML files are served/emulated by the repo.
The hard-coded `token` in the login is simply ignored by this server.

## Caveats
* **Other frames may also have been modified.** The server protocol was derived mainly from the game sprite
  (`DefineSprite_842`) and the `ElectroServer` class. If the garage, scores or game screens behave oddly, re-export
  the scripts from the *original* SWF (JPEXS → Export → Scripts) and compare frames 9, 24, 29, 35, 42 and the game sprite.
* **Identity depends on Flash Remoting.** The nickname reaches the game through `GetUserInfo` at `/gateway.aspx`
  (frame 9). If Ruffle can't do AS2 Remoting, `_global.username` stays empty, the game generates a guest name
  (`DesertDog_209`…), and this server declines that login (the name doesn't match your profile) – you'd only get
  offline AI races. Use **Ruffle 0.4.0 or newer** (2026 releases added AS2 Flash Remoting).

## Verify (browser DevTools → Network)
1. `POST /gateway.aspx` → 200 `application/x-amf` (user info + cars). No request = Ruffle too old/unsupported.
2. `GET /ws` → 101. Frames, in order: `<XmlDoc>…ConnectionResponse…`, then (right after login) `…LoginResponse…Accepted…`,
   then `…CreateRoom…Success…`.
3. Start a race with a friend: `TRI|0~…`, `CL|…`, `PGCD|10000`, then a stream of `CA|…`.
