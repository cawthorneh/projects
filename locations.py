# Station search patterns match against LCRA station names (case-insensitive substring).
# Every matching gauge is averaged. `exclude` drops gauges that would otherwise be
# swept up by a loose pattern (e.g. "Johnson City" sits in Blanco County).
LOCATIONS = [
    {"id": "dripping_springs", "label": "Dripping Springs", "county": "Hays Co.",
     "match": ["dripping springs", "dripping spr"]},
    {"id": "austin",           "label": "Austin",           "county": "Travis Co.",
     "match": ["austin"]},
    {"id": "fredericksburg",   "label": "Fredericksburg",   "county": "Gillespie Co.",
     "match": ["fredericksburg"]},
    {"id": "johnson_city",     "label": "Johnson City",     "county": "Blanco Co.",
     "match": ["johnson city"]},
    {"id": "blanco",           "label": "Blanco",           "county": "Blanco Co.",
     "match": ["blanco"], "exclude": ["johnson city"]},
]
