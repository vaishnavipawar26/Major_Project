"""How long each supported crop can practically wait before it is sold, by storage facility and produce condition.

This is general post-harvest guidance, NOT a survival timer and NOT learned from the price data. Real storage life depends on temperature,
humidity, ventilation, maturity, handling damage, moisture (dry goods) and pests, so every duration here is approximate and the page says
so. Where the sources give a range, the LOWER end is used (a cautious estimate), and a figure the sources do not support is left empty
(``days: None``) rather than guessed.

Supported crops (the price model covers exactly these 7): Brinjal, Cabbage, Cauliflower, Onion, Potato, Tomato, Wheat. Maize, soybean,
cotton and chickpea have no price forecast in this project, so there is nothing to compare for them and no storage entry is kept: adding
guidance without a forecast would be unused, and cotton fibre and pulses/oilseeds need their own (non-vegetable) rules.

Structure
---------
CROPS[crop] = {category, perishability, profiles: {profile_key: profile}, default_profile}
profile     = {label, conditions, risks, advice[], facilities: {facility_key: facility}}
facility    = {label, days, range, basis, sources[], confidence}
  ``days``        practical days the produce may be held AFTER the farmer's planned selling date (None = no reliable figure for this crop and
                  facility; the next simpler facility is then used and the page says so)
  ``range``       what the sources say, in words
  ``confidence``  "moderate" (an Indian official source or a controlled study for this crop and facility) or "low" (indirect or a single
                  non-Indian source): low-confidence figures get an extra warning on the page

Facilities: ordinary (the default: nothing is assumed beyond what an ordinary farm has), improved (low-cost cooling, ventilated or sealed
stores) and cold (a cold room or cold store). A farmer is never assumed to have cold storage.

Deadline rule (see window.py): storage deadline = planned selling date + ``days``. Dates after the deadline are not recommended.
"""
from __future__ import annotations

FACILITIES = ("ordinary", "improved", "cold")
FACILITY_LABELS = {"ordinary": "Ordinary farm storage", "improved": "Improved low-cost storage", "cold": "Cold storage or cold room"}
DEFAULT_FACILITY = "ordinary"
FALLBACK = {"cold": "improved", "improved": "ordinary"}     # used when a facility has no reliable figure for the crop

SOURCES = {
    "nhb_brinjal": {"title": "Post-harvest management of brinjal (storage)", "publisher": "National Horticulture Board, India",
                    "url": "https://nhb.gov.in/pdf/vegetable/brinjal/bri008.pdf"},
    "nhb_tomato": {"title": "Post-harvest management of tomato (storage)", "publisher": "National Horticulture Board, India",
                   "url": "https://www.nhb.gov.in/pdf/vegetable/tomato/tom009.pdf"},
    "nhb_cabbage": {"title": "Post-harvest management of cabbage (storage)", "publisher": "National Horticulture Board, India",
                    "url": "https://www.nhb.gov.in/pdf/vegetable/cabbage/cab008.pdf"},
    "nhb_cauliflower": {"title": "Post-harvest management of cauliflower (storage)", "publisher": "National Horticulture Board, India",
                        "url": "https://nhb.gov.in/pdf/vegetable/cauliflower/cau009.pdf"},
    "wvc_cooling": {"title": "Low-cost cooling methods for vegetables (shelf life at 22-35 °C and at 13 °C)",
                    "publisher": "World Vegetable Center, with UC Davis HortCRSP / USAID", "url": "https://worldveg.tind.io/record/65852/files/f0253.pdf"},
    "pasighat_chamber": {"title": "Efficacy of evaporative cool chamber in Pasighat condition, Arunachal Pradesh, India (tomato, brinjal)",
                         "publisher": "Int. J. Bio-resource and Stress Management", "url": "https://ojs.pphouse.org/index.php/IJBSM/article/view/489"},
    "icar_onion": {"title": "Onion cold storage: potential to stabilise price fluctuation (ventilated-store and cold-store losses)",
                   "publisher": "ICAR, India", "url": "https://icar.org.in/node/4701"},
    "dogr_ventilated": {"title": "Bottom- and side-ventilated onion storage structures (losses cut by 20-50%)",
                        "publisher": "ICAR-Directorate of Onion and Garlic Research, Indian Journal of Horticulture",
                        "url": "https://epubs.icar.org.in/index.php/IndHort/article/download/123801/46862/472893"},
    "cpri_nonrefrigerated": {"title": "Non-refrigerated storage of potatoes (heaps and pits, evaporatively cooled stores)",
                             "publisher": "ICAR-Central Potato Research Institute, Potato Journal",
                             "url": "https://epubs.icar.org.in/index.php/PotatoJ/article/view/32560"},
    "cpri_heaps_malwa": {"title": "Storage behaviour of potatoes stored in heaps and pits in the Malwa region (3-4 months; rotting 10-21%)",
                         "publisher": "ICAR-Central Potato Research Institute, Potato Journal",
                         "url": "https://epubs.icar.org.in/index.php/PotatoJ/article/view/38775"},
    "icar_potato_postharvest": {"title": "Post-harvest management of potatoes (cold stores 2-4 °C; losses in indigenous stores)",
                                "publisher": "ICAR, Indian Farming", "url": "https://epubs.icar.org.in/index.php/IndFarm/article/view/151959"},
    "niphm_moisture": {"title": "Safe moisture content for stored grain (wheat 12%)", "publisher": "National Institute of Plant Health Management, India",
                       "url": "https://www.niphm.gov.in/Education/msp.pdf"},
    "icar_wheat_bags": {"title": "Efficacy of PVC-coated fabric bag for on-farm storage of wheat (about 6 months within quality limits)",
                        "publisher": "ICAR, Indian Journal of Agricultural Sciences", "url": "https://epubs.icar.org.in/index.php/IJAgS/article/view/95297"},
    "hau_hermetic": {"title": "Wheat stored 9 months in hermetic bags vs metal bins and gunny bags (Haryana, India)",
                     "publisher": "University of Illinois and Haryana Agricultural University", "url": "https://grainger.illinois.edu/news/stories/28424"},
}

_APP_RULE = ("App rule, not a measured storage time: no source gives a safe holding time in this condition, so waiting is not recommended.")


def _fac(label, days, rng, basis, sources, confidence="moderate"):
    return {"label": label, "days": days, "range": rng, "basis": basis, "sources": list(sources), "confidence": confidence}


def _none(label):
    return _fac(label, None, None, "No reliable figure for this crop and facility, so the simpler facility's figure is used.", [])


CROPS: dict[str, dict] = {
    "Tomato": {
        "category": "Fresh vegetable", "perishability": "Highly perishable", "default_profile": "fresh",
        "profiles": {"fresh": {
            "label": "Fresh tomatoes",
            "conditions": "Tomatoes are chilling-sensitive. About 13 °C with 90-95% humidity slows ripening; fully ripe fruit is kept near 7 °C and 90% humidity.",
            "risks": "Over-ripening, softening, shrivel and rot. Ripe fruit keeps only about a week even in a cold room.",
            "advice": ["Sort out soft, cracked or diseased fruit before storing.", "Keep tomatoes in a shaded, airy place; never in the sun.",
                       "Sell ripe fruit first. Do not keep fruit that has started to soften."],
            "facilities": {
                "ordinary": _fac("Shaded, airy place without cooling", 7, "about 7 to 12 days",
                                 "Studies at 20-35 °C report about 7 days (gunny bags) to 9-12 days; 7 days is used as a cautious figure.",
                                 ["wvc_cooling", "nhb_tomato"]),
                "improved": _fac("Evaporative cool chamber", 14, "about 14 to 15 days (about 7 days in room conditions)",
                                 "A cool-chamber trial in India kept tomatoes 14-15 days against 7 days in the room.", ["pasighat_chamber"]),
                "cold": _fac("Cold room at about 13 °C", 14, "2 to 3 weeks at about 13 °C; ripe fruit about 1 week at 7 °C",
                             "NHB: 2-3 weeks at 13 °C and 90-95% humidity (lower end used); unripe fruit up to 4 weeks at 8-10 °C.", ["nhb_tomato"]),
            }}},
    },
    "Brinjal": {
        "category": "Fresh vegetable", "perishability": "Highly perishable", "default_profile": "fresh",
        "profiles": {"fresh": {
            "label": "Fresh brinjal",
            "conditions": "Cold storage at 7-10 °C with 85-95% humidity. Colder than that can cause chilling injury.",
            "risks": "Shrivelling, loss of gloss, calyx browning and rot within days. Brinjal spoils faster than most vegetables.",
            "advice": ["Keep brinjal in shade and handle gently; bruises rot quickly.", "Do not pile it deep or leave it in the sun.",
                       "Selling soon matters more than a small price gain."],
            "facilities": {
                "ordinary": _fac("In shade under ordinary conditions", 2, "1 to 2 days in summer, 3 to 4 days in winter",
                                 "NHB: 1-2 days in summer and 3-4 days in winter in shade; the summer figure is used as the cautious estimate.",
                                 ["nhb_brinjal", "wvc_cooling"]),
                "improved": _fac("Evaporative cool chamber", 9, "about 9 to 15 days (4 to 5 days in the room)",
                                 "Cool-chamber trials in India: 9-15 days against 4-5 days at room temperature; the lower end is used.",
                                 ["pasighat_chamber"]),
                "cold": _fac("Cold room at 7-10 °C", 7, "7 to 10 days at 7-10 °C and 85-95% humidity",
                             "NHB: 7-10 days in cold storage at 7-10 °C and 85-95% humidity (lower end used).", ["nhb_brinjal"]),
            }}},
    },
    "Cauliflower": {
        "category": "Fresh vegetable", "perishability": "Highly perishable", "default_profile": "fresh",
        "profiles": {"fresh": {
            "label": "Fresh cauliflower curds",
            "conditions": "Cold storage at 0 °C with 95% humidity, and a steady temperature. NHB advises against storing it longer than about 3 weeks.",
            "risks": "Wilting, browning and yellowing of leaves, darkening of curds and decay, faster above 5 °C or when the temperature swings.",
            "advice": ["Keep heads cool, shaded and moist; wilting starts fast in heat.", "Slightly immature, compact heads keep better than overgrown ones.",
                       "Do not store it near ripening fruit (ethylene yellows the leaves)."],
            "facilities": {
                "ordinary": _fac("Shaded, airy place without cooling", 7, "about 7 days at 22-35 °C",
                                 "One research-centre table gives 7 days at 22-35 °C (low confidence: a single, non-Indian source); NHB warns that "
                                 "quality falls quickly above 5 °C.", ["wvc_cooling", "nhb_cauliflower"], "low"),
                "improved": _none("Low-cost cooling"),
                "cold": _fac("Cold room at about 0 °C", 14, "up to 3 weeks at 0 °C and 95% humidity",
                             "NHB: up to 3 weeks at 0 °C and not recommended beyond that; 2 weeks is used as a cautious figure.", ["nhb_cauliflower"]),
            }}},
    },
    "Cabbage": {
        "category": "Fresh vegetable", "perishability": "Perishable", "default_profile": "fresh",
        "profiles": {"fresh": {
            "label": "Fresh cabbage heads",
            "conditions": "Cold storage at 0 °C with 95-98% humidity; only solid heads with 3-6 tight wrapper leaves, with no yellowing or injury, keep well.",
            "risks": "Wilting, yellowing, cracked or loose heads and rot. Late-harvested heads keep better than early ones.",
            "advice": ["Store only solid, undamaged heads and trim loose outer leaves.", "Keep them in a cool, shaded, airy place; avoid sun and heat.",
                       "Check weekly and sell any heads that crack or yellow."],
            "facilities": {
                "ordinary": _fac("Shaded, airy place without cooling", 8, "about 8 days at 22-35 °C",
                                 "One research-centre table gives 8 days at 22-35 °C (low confidence: a single, non-Indian source).",
                                 ["wvc_cooling", "nhb_cabbage"], "low"),
                "improved": _none("Low-cost cooling"),
                "cold": _fac("Cold room at about 0 °C", 21, "3 to 6 weeks at 0 °C and 95-98% humidity",
                             "NHB: 3-6 weeks at 0 °C (lower end used).", ["nhb_cabbage"]),
            }}},
    },
    "Potato": {
        "category": "Tuber", "perishability": "Storable with care", "default_profile": "tubers",
        "profiles": {"tubers": {
            "label": "Cured, undamaged potato tubers",
            "conditions": "Cold stores run at 2-4 °C and about 90% humidity. Without refrigeration, cool, dark, airy heaps or pits are used for short-term storage.",
            "risks": "Sprouting, shrinking and rotting in heat (farm stores often lose 10-40%), greening in light, and spreading rot from bruised tubers.",
            "advice": ["Cure and dry tubers in shade and discard cut, bruised or rotting ones.", "Keep them dark and airy; light turns them green.",
                       "Check regularly and remove rotting tubers; sell earlier if sprouting starts."],
            "facilities": {
                "ordinary": _fac("Cool, dark, airy place on the farm", 60, "about 2 months before rotting starts under normal conditions",
                                 "Farm storage commonly loses 10-40% to sprouting and rotting; about 2 months is a cautious figure and depends heavily on heat.",
                                 ["icar_potato_postharvest", "cpri_nonrefrigerated"], "low"),
                "improved": _fac("Heap, pit or evaporatively cooled store", 90, "about 3 to 4 months in heaps and pits (rotting 10-21%)",
                                 "CPRI trials: heaps and pits were viable for short-term storage; 3 months is used, and rotting was 10-21%.",
                                 ["cpri_heaps_malwa", "cpri_nonrefrigerated"]),
                "cold": _fac("Cold store at 2-4 °C", 180, "about 6 months (cold stores run April to September)",
                             "Indian cold stores keep potatoes at 2-4 °C for about 6 months; they cannot be kept 9-10 months without refrigeration.",
                             ["icar_potato_postharvest"]),
            }}},
    },
    "Onion": {
        "category": "Bulb", "perishability": "Storable with care", "default_profile": "cured",
        "profiles": {
            "cured": {
                "label": "Well-cured, dry onion bulbs",
                "conditions": "Dry necks, dry skins and a dry, well-ventilated store. Curing in shade lowers losses. Cold stores use about 0-5 °C and 60-65% humidity.",
                "risks": "Weight loss, sprouting and rotting grow with time: Indian trials of ventilated stores lost up to about 40-50% over 4 months. Wet or "
                         "sprouting bulbs and damp stores spoil fastest.",
                "advice": ["Make sure bulbs are fully cured and dry before storing.", "Store in thin, well-ventilated layers; keep the store dry.",
                           "Remove rotting or sprouting bulbs often, and sell earlier if losses rise."],
                "facilities": {
                    "ordinary": _fac("Ordinary ventilated store or chawl", 120, "about 4 months, with heavy weight loss",
                                     "ICAR trials of ventilated structures ran 4 months and lost up to 42-46% (54% in an uncontrolled one); long holding is "
                                     "possible but costly.", ["icar_onion"]),
                    "improved": _fac("Improved ventilated structure", 120, "about 4 months with 20-50% lower losses",
                                     "ICAR-DOGR bottom- and side-ventilated designs cut storage losses by 20-50%.", ["dogr_ventilated", "icar_onion"]),
                    "cold": _none("Cold store"),
                }},
            "uncured": {
                "label": "Not cured, wet or freshly harvested onion",
                "conditions": "Onion must be cured (dried) before it is stored; NHB notes curing in shade lowers losses significantly.",
                "risks": "Uncured onion rots and sprouts quickly. No source gives a safe holding time for it.",
                "advice": ["Cure (dry) the bulbs in shade first.", "Sell uncured onion soon rather than holding it."],
                "facilities": {k: _fac(FACILITY_LABELS[k], 0, "no safe holding time is known", _APP_RULE, ["icar_onion"], "low") for k in FACILITIES},
            },
        },
    },
    "Wheat": {
        "category": "Dry grain", "perishability": "Storable", "default_profile": "dry",
        "profiles": {
            "dry": {
                "label": "Properly dried wheat (about 12% moisture or less)",
                "conditions": "Moisture of about 12% or less, clean grain, a dry store, and protection from insects and rain. Sealed (hermetic) bags keep insects out.",
                "risks": "Insects, mould and rising moisture in humid weather. In trials, untreated bags and metal bins were heavily infested; "
                         "damaged grain rose from 2.7% to 48.5% in 5 months in untreated bags.",
                "advice": ["Dry grain to about 12% moisture before storing and keep the store dry.", "Clean the store and use sealed or treated bags where possible.",
                           "Inspect for insects and damp patches every few weeks."],
                "facilities": {
                    "ordinary": _fac("Jute or gunny bags, ordinary godown", 90, "about 3 months; heavy insect damage by about 5 months",
                                     "In untreated bags damage rose sharply over 5 months, so 3 months is used as a cautious figure.",
                                     ["niphm_moisture", "icar_wheat_bags"], "low"),
                    "improved": _fac("Sealed (hermetic) bags or a closed bin", 180, "about 6 to 9 months",
                                     "Sealed bags kept insect damage low for 9 months in trials; coated bags stayed within quality limits for about 6 months.",
                                     ["hau_hermetic", "icar_wheat_bags"]),
                    "cold": _none("Cold store"),
                }},
            "moist": {
                "label": "Not fully dried wheat (above about 12% moisture)",
                "conditions": "Wheat must be dried to about 12% moisture before storage (NIPHM).",
                "risks": "Grain above about 12% moisture heats, moulds and attracts insects. No source gives a safe holding time for it.",
                "advice": ["Dry the grain to about 12% moisture first.", "Sell damp grain soon rather than holding it."],
                "facilities": {k: _fac(FACILITY_LABELS[k], 0, "no safe holding time is known", _APP_RULE, ["niphm_moisture"], "low") for k in FACILITIES},
            },
        },
    },
}

UNKNOWN_NOTE = ("There is no storage guidance for this crop in the app, so waiting is not recommended. Check how long your crop keeps before holding it.")


def supported_crops() -> list[str]:
    return list(CROPS)


def _days_for(profile: dict, facility: str) -> tuple[str, dict]:
    """The facility actually used: the requested one, or the nearest simpler one that has a reliable figure."""
    key = facility if facility in FACILITIES else DEFAULT_FACILITY
    while profile["facilities"][key]["days"] is None and key in FALLBACK:
        key = FALLBACK[key]
    return key, profile["facilities"][key]


def resolve(crop: str, facility: str = DEFAULT_FACILITY, profile: str | None = None) -> dict:
    """One storage plan: how many days after the planned date the crop may be held, with the reasons, the advice and the sources."""
    c = CROPS.get(crop)
    if c is None:
        return {"crop": crop, "supported": False, "profile": None, "profile_label": None, "facility": facility, "facility_used": None,
                "facility_label": None, "fallback": False, "hold_days": 0, "range": None, "basis": UNKNOWN_NOTE, "approximate": True,
                "confidence": "low", "category": None, "perishability": None, "conditions": None, "risks": None, "advice": [], "sources": [],
                "uncertainty": UNKNOWN_NOTE}
    pkey = profile if profile in c["profiles"] else c["default_profile"]
    p = c["profiles"][pkey]
    used, f = _days_for(p, facility)
    asked = facility if facility in FACILITIES else DEFAULT_FACILITY
    low = f["confidence"] == "low"
    uncertainty = ("This is an approximate estimate that depends on temperature, humidity, ventilation, how mature and undamaged the produce is, "
                   "and pests or moisture." + (" The figure is low-confidence because the sources for it are indirect or limited." if low else ""))
    return {"crop": crop, "supported": True, "profile": pkey, "profile_label": p["label"], "facility": asked, "facility_used": used,
            "facility_label": f["label"], "fallback": used != asked, "hold_days": int(f["days"]), "range": f["range"], "basis": f["basis"],
            "approximate": True, "confidence": f["confidence"], "category": c["category"], "perishability": c["perishability"],
            "conditions": p["conditions"], "risks": p["risks"], "advice": list(p["advice"]),
            "sources": [{"id": s, **SOURCES[s]} for s in f["sources"]], "uncertainty": uncertainty}


def plan_key(facility: str, profile: str) -> str:
    return f"{facility}:{profile}"


def storage_plans(crop: str) -> dict:
    """Every plan a farmer can choose for this crop, keyed 'facility:profile', with the defaults (ordinary farm storage, the crop's usual
    condition). The page lets the farmer pick; nothing is assumed beyond ordinary farm storage."""
    c = CROPS.get(crop)
    if c is None:
        plan = resolve(crop)
        return {"crop": crop, "supported": False, "default": plan_key(DEFAULT_FACILITY, "unknown"),
                "facilities": [{"key": DEFAULT_FACILITY, "label": FACILITY_LABELS[DEFAULT_FACILITY]}], "profiles": [],
                "plans": {plan_key(DEFAULT_FACILITY, "unknown"): plan}}
    plans = {}
    for pk in c["profiles"]:
        for fk in FACILITIES:
            plans[plan_key(fk, pk)] = resolve(crop, fk, pk)
    return {"crop": crop, "supported": True, "default": plan_key(DEFAULT_FACILITY, c["default_profile"]),
            "facilities": [{"key": fk, "label": FACILITY_LABELS[fk]} for fk in FACILITIES],
            "profiles": [{"key": pk, "label": p["label"]} for pk, p in c["profiles"].items()] if len(c["profiles"]) > 1 else [],
            "plans": plans}


def legacy_storage(crop: str) -> dict:
    """The older single-figure summary (``advice.storage``): ordinary-farm days and the longest days any facility supports."""
    c = CROPS.get(crop)
    if c is None:
        return {"category": "Unknown", "max_hold_days": 0, "farm_hold_days": 0, "note": UNKNOWN_NOTE}
    p = c["profiles"][c["default_profile"]]
    ordinary = resolve(crop, "ordinary")["hold_days"]
    best = max(resolve(crop, fk)["hold_days"] for fk in FACILITIES)
    return {"category": c["perishability"], "max_hold_days": best, "farm_hold_days": ordinary,
            "note": f"{p['label']}: about {p['facilities']['ordinary']['range']} in ordinary farm storage. {p['risks']}"}
