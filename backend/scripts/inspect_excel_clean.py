import pandas as pd
import sys

file_path = "data/raw_csvs/数据库20251031.xlsx"

try:
    xl = pd.ExcelFile(file_path)
    print(f"Sheets: {xl.sheet_names}")
    
    target_sheets = ['管道站场阀室关系']
    for sheet in target_sheets:
        if sheet in xl.sheet_names:
            print(f"\n--- Sheet: {sheet} ---")
            df = pd.read_excel(file_path, sheet_name=sheet, nrows=5)
            # Flatten columns to string to avoid messy output
            cols = [str(c).replace('\n', '') for c in df.columns]
            print(f"Columns: {cols}")
            print(df.head(5).to_string())
except Exception as e:
    print(e)
