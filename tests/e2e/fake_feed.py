"""Write a small fictional Simplify-style feed into <data>/cache so the hidden-listings search has something to find."""
import json
import os
import sys
import time

data = sys.argv[1]
os.makedirs(os.path.join(data, "cache"), exist_ok=True)
now = int(time.time())
rows = [("Northwind Analytics", "Data Engineer Intern", "Summer 2026", ["Austin, TX"]),
        ("Contoso Robotics", "Software Engineer Intern", "Summer 2027", ["Toronto, ON"]),
        ("Tailspin Toys", "Marketing Intern", "Summer 2027", ["Seattle, WA"]),
        ("Litware Systems", "Software Engineer Intern - Clearance Required", "Summer 2027", ["Arlington, VA"])]
feed = [{"source": "Simplify", "category": "Software", "company_name": c, "id": f"fake-{i}", "title": t, "active": True, "terms": [term],
         "date_updated": now, "date_posted": now - 2 * 86400, "url": f"https://example.com/jobs/{i}", "locations": loc,
         "is_visible": True, "degrees": ["Bachelor's", "Master's"], "sponsorship": "Other"} for i, (c, t, term, loc) in enumerate(rows)]
with open(os.path.join(data, "cache", "simplify.json"), "w") as f:
    json.dump(feed, f)
