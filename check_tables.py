import sys
import os
import json

sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, os.path.abspath('backend'))

try:
    from backend.app.services.raw_excel_ai_index import raw_excel_ai_index
    raw_excel_ai_index.ensure_loaded(force_rebuild=True)
    res = raw_excel_ai_index.query_distributions(keyword="伊宁")
    print("Found distributions for '伊宁':", len(res))
    for d in res[:3]:
        print(d["name"], "Trunk:", d["trunk_name"])
        
    print("\nTotal distributions loaded:", len(raw_excel_ai_index.distribution_catalog))
except Exception as e:
    import traceback
    traceback.print_exc()
