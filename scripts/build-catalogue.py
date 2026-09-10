import json, urllib.parse, urllib.request, collections, re, time, sys
UA = {"User-Agent": "TrekovCatalogue/0.1 (contact@airotor.in)", "Accept": "application/sparql-results+json"}
def sparql(q):
    url = "https://query.wikidata.org/sparql?" + urllib.parse.urlencode({"query": q})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=170) as r:
                return json.load(r)["results"]["bindings"]
        except Exception as e:
            print("sparql retry", attempt, e, file=sys.stderr); time.sleep(5)
    raise SystemExit("sparql failed")

# 1. Class IDs by label
labels = ["hill station","fort","island","stepwell","desert","glacier","stupa","tomb","mausoleum","gurdwara","mosque","tourist destination","river island","viewpoint","Buddhist monastery","Jain temple","sand dune","archaeological site","ghat","hot spring","wildlife sanctuary","tiger reserve","botanical garden","dam","reservoir","rock-cut architecture","ruins","heritage railway"]
vals = " ".join(f'"{l}"@en' for l in labels)
rows = sparql(f'SELECT ?c ?l (COUNT(?i) AS ?n) WHERE {{ VALUES ?l {{ {vals} }} ?c rdfs:label ?l . ?i wdt:P31 ?c ; wdt:P17 wd:Q668 . }} GROUP BY ?c ?l ORDER BY ?l DESC(?n)')
extra = {}
for r in rows:
    l = r["l"]["value"]; c = r["c"]["value"].rsplit("/",1)[1]; n = int(r["n"]["value"])
    if l not in extra and n >= 3: extra[l] = c
print("extra classes:", extra)

base = ["Q570116","Q1107656","Q57821","Q23397","Q34038","Q40080","Q46169","Q842402","Q16560","Q39816","Q133056","Q4989906",
        "Q23413","Q179700","Q44613","Q15243209","Q8502","Q54050","Q35509","Q12280","Q9259","Q2977","Q187223","Q5003624","Q473972"]
classes = sorted(set(base) | set(extra.values()))
q = f"""SELECT ?item ?itemLabel ?itemDescription ?class ?classLabel ?lat ?lng ?image ?links ?state ?stateLabel WHERE {{
  VALUES ?class {{ {" ".join("wd:"+c for c in classes)} }}
  ?item wdt:P31 ?class ; wdt:P17 wd:Q668 ; wdt:P625 ?coord ; wdt:P18 ?image ; wikibase:sitelinks ?links .
  FILTER(?links >= 4)
  OPTIONAL {{ ?item wdt:P131* ?state . ?state wdt:P31 ?stype . VALUES ?stype {{ wd:Q12443800 wd:Q467745 }} }}
  BIND(geof:latitude(?coord) AS ?lat) BIND(geof:longitude(?coord) AS ?lng)
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
}}"""
import os
if os.path.exists('rows.json'): rows = json.load(open('rows.json'))
else:
    rows = sparql(q); json.dump(rows, open('rows.json','w'))
items = {}
for b in rows:
    qid = b["item"]["value"].rsplit("/",1)[1]
    name = b["itemLabel"]["value"]
    if re.fullmatch(r"Q\d+", name): continue
    it = items.setdefault(qid, {"q": qid, "name": name, "desc": b.get("itemDescription",{}).get("value",""),
        "lat": round(float(b["lat"]["value"]),5), "lng": round(float(b["lng"]["value"]),5),
        "image": urllib.parse.unquote(b["image"]["value"].rsplit("/",1)[1]), "links": int(b["links"]["value"]),
        "classes": set(), "states": set()})
    it["classes"].add(b["classLabel"]["value"])
    if "stateLabel" in b: it["states"].add(b["stateLabel"]["value"])
print("candidates:", len(items), "with state:", sum(1 for i in items.values() if i["states"]))

CURRENT = {"Andhra Pradesh","Arunachal Pradesh","Assam","Bihar","Chhattisgarh","Goa","Gujarat","Haryana","Himachal Pradesh",
 "Jharkhand","Karnataka","Kerala","Madhya Pradesh","Maharashtra","Manipur","Meghalaya","Mizoram","Nagaland","Odisha","Punjab",
 "Rajasthan","Sikkim","Tamil Nadu","Telangana","Tripura","Uttar Pradesh","Uttarakhand","West Bengal","Andaman and Nicobar Islands",
 "Chandigarh","Dadra and Nagar Haveli and Daman and Diu","National Capital Territory of Delhi","Delhi","Jammu and Kashmir","Ladakh",
 "Lakshadweep","Puducherry"}
PRETTY = {"National Capital Territory of Delhi": "Delhi"}
for i in items.values():
    cur = sorted(st for st in i["states"] if st in CURRENT)
    i["states"] = {PRETTY.get(cur[0], cur[0])} if cur else set()
# 2. Pick ~300, spread across states and types
CAP_CLASS = {"island": 10, "archaeological site": 12, "national park": 28, "Hindu temple": 40, "mountain": 12, "cathedral": 4, "bridge": 3, "memorial": 4, "mosque": 6, "tomb": 6,
             "mausoleum": 5, "protected area": 8, "dam": 5, "reservoir": 3, "statue": 3, "garden": 6, "botanical garden": 3}
def kind(i):
    order = ["lake","waterfall","beach","valley","mountain pass","hill station","national park","wildlife sanctuary","tiger reserve",
             "fort","fortification","palace","castle","cave","island","desert","glacier","stepwell","monastery","Buddhist monastery",
             "stupa","Hindu temple","Jain temple","gurdwara","mosque","cathedral","tomb","mausoleum","World Heritage Site","monument"]
    for o in order:
        if o in i["classes"]: return o
    return sorted(i["classes"])[0]
pool = [i for i in items.values() if i["states"] and not re.search(r"former|district$", i["name"], re.I)]
BOOST = {"beach": 2.0, "lake": 1.6, "hill station": 1.8, "waterfall": 1.5, "valley": 1.6, "mountain pass": 1.6, "desert": 1.5, "glacier": 1.4}
pool.sort(key=lambda i: -(i["links"] * BOOST.get(kind(i), 1.0)))
per_state, per_class, chosen, seen_names = collections.Counter(), collections.Counter(), [], set()
states = sorted({s for i in pool for s in i["states"]})
# pass 1: guarantee each state its best 4
for st in states:
    for i in [x for x in pool if st in x["states"]][:4]:
        if i["q"] not in {c["q"] for c in chosen}: chosen.append(i); per_state[st]+=1; per_class[kind(i)]+=1
# pass 2: fill to 300 by popularity, caps: 18 per state, class caps
for i in pool:
    if len(chosen) >= 310: break
    if i["q"] in {c["q"] for c in chosen}: continue
    st = sorted(i["states"])[0]; k = kind(i)
    if per_state[st] >= 18 or per_class[k] >= CAP_CLASS.get(k, 40): continue
    key = i["name"].lower()
    if key in seen_names: continue
    chosen.append(i); per_state[st]+=1; per_class[k]+=1; seen_names.add(key)
print("chosen:", len(chosen), "states covered:", len({sorted(c['states'])[0] for c in chosen}), "of", len(states))
print("by kind:", collections.Counter(kind(c) for c in chosen).most_common(25))

# 3. Commons credits + thumbnails
files = sorted({c["image"] for c in chosen})
meta = {}
for n in range(0, len(files), 40):
    batch = files[n:n+40]
    params = {"action":"query","format":"json","prop":"imageinfo","iiprop":"url|extmetadata","iiurlwidth":"640",
              "iiextmetadatafilter":"Artist|LicenseShortName|LicenseUrl|UsageTerms|AttributionRequired","titles":"|".join("File:"+f for f in batch)}
    url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA["User-Agent"]}), timeout=60) as r:
        data = json.load(r)
    norm = {x["to"]: x["from"] for x in data["query"].get("normalized", [])}
    for p in data["query"]["pages"].values():
        if "imageinfo" not in p: continue
        ii = p["imageinfo"][0]; em = ii.get("extmetadata", {})
        artist = re.sub(r"<[^>]+>", "", em.get("Artist",{}).get("value","")).strip()
        title = norm.get(p["title"], p["title"]).replace("File:","",1)
        meta[title.replace(" ", "_")] = meta[title] = {
            "thumb": re.sub(r"\?.*$", "", ii.get("thumburl") or ii["url"]), "page": ii.get("descriptionurl",""),
            "artist": re.sub(r"\s+"," ",artist)[:80] or "Unknown",
            "license": em.get("LicenseShortName",{}).get("value",""), "licenseUrl": em.get("LicenseUrl",{}).get("value","")}
    time.sleep(0.5)

out = []
for c in chosen:
    m = meta.get(c["image"]) or meta.get(c["image"].replace("_"," "))
    if not m: continue
    lic = m["license"]
    if not re.search(r"CC|Public domain|PD|GFDL", lic, re.I): continue   # only openly licensed photos
    out.append({"id": "wd_" + c["q"], "wikidata": c["q"], "name": c["name"], "region": sorted(c["states"])[0], "country": "India",
                "lat": c["lat"], "lng": c["lng"], "kind": kind(c), "blurb": (c["desc"][:1].upper() + c["desc"][1:]) if c["desc"] else "",
                "photo": {"src": m["thumb"], "page": m["page"], "by": m["artist"], "license": lic, "licenseUrl": m["licenseUrl"]}})
print("final with open licence + photo:", len(out))
json.dump(out, open("catalogue.json","w"), ensure_ascii=False, indent=0)
print("sample:", json.dumps(out[:2], ensure_ascii=False)[:700])
