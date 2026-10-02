# Trekov commercial — 75 / 60 / 30 s (9:16, Hinglish, all video)

Updated 2026-09-11 for the new features: one route for the whole group, the live
count and turn chips, big STOP / WAIT / LET'S GO and VOICE buttons, invite
statuses, alerts that wait for signal, installing from the website, members-only
live location, and the pre-release offer. Voice: ElevenLabs "Reyaansh – Deep
Premium Brand Ad" (YWaBwjubozVSPD1RgnRa), eleven_multilingual_v2, one clip per
line in `assets/lines/` (the previous takes of replaced lines are in
`assets/lines/v1/`). Every claim is something the app does today.

Build: `python3 build_cut.py 75|60|30` (ORDER in build_cut.py). App scenes are
recorded with `node shoot.mjs <scene>` against a dev server with no account
server (VITE_SUPABASE_URL empty) — see shoot.mjs for the dev-only hooks it uses.

| # | Visual | VO | In |
|---|--------|----|----|
| L01 | Drone: riders on a Himalayan road | लद्दाख की सड़क... दोस्तों का group... पर सब अलग-अलग रास्ते पे? | 75 · 60 |
| L02 | Go live → 6 riders on one route, "6 live" | Trekov पे Start trip दबाओ — पूरा group, एक ही route पे, एक ही map पे live. | all |
| L03 | Vehicle picker | अपनी सवारी चुनो — classic, cruiser, या SUV. | 75 |
| L04 | Navigating, traffic on | Turn-by-turn navigation — हर कुछ मिनट में fresh traffic, और screen हमेशा on. | 75 · 60 |
| L05 | Rider stops → full-screen STOP | कोई पीछे छूट गया? एक tap — STOP! पूरे group को तुरंत पता. | all |
| L06 | Lake b-roll → big VOICE button | बड़ा VOICE button — बस दबाओ, और बोलो. Gloves पहन के भी. | 75 · 60 |
| L07 | Trip page: "Go live with the group", stop added | Trip plan करो seconds में — stops, दूरी, time, tolls — सब ready. | 75 · 60 |
| L08 | Invites: pending → accepted | Username से invite करो — कौन pending है, किसने accept किया, सब दिखता है. | 75 · 60 |
| L09 | Offline: STOP "Queued", sends on reconnect | Network चला गया? आपका STOP फिर भी जाएगा — signal आते ही. | all |
| L10 | Discover: fuel nearby | रास्ते में petrol, garage, stay — सब nearby. | 75 |
| L11 | Live photo, GPS verified | और photo? सिर्फ़ वही, जो वहाँ खड़े होकर खींची — GPS verified. | 75 |
| L12 | Website "Get the app": Home Screen, stores coming soon | Play Store और App Store जल्द आ रहे हैं — अभी browser से Home Screen पे add करो. | all |
| L13 | The group on the live map | और आपकी live location? सिर्फ़ आपका group देखता है. | 75 · 60 |
| L14 | Convoy → end card "Free till 31 October" | Trekov. इकतीस October तक बिल्कुल free — आज ही join करो, trekov dot com. | all |

30 s: music hook (2.5 s) → L02 → L05 → L09 → L12 → L14.

After 31 October the offer line (L14) and the end card's "Free till 31 October" need replacing.
