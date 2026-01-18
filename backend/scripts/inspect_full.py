import pandas as pd
import sys

file_path = "data/raw_csvs/数据库20251031.xlsx"
xl = pd.ExcelFile(file_path)

for sheet in xl.sheet_names:
    df = pd.read_excel(xl, sheet)
    cols = [str(c).replace('\n', ' ') for c in df.columns]
    print(f"SHEET: {sheet}")
    print(f"COLUMNS: {cols}")
    print("-" * 20)
