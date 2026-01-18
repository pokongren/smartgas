import pandas as pd

file_path = "data/raw_csvs/数据库20251031.xlsx"
xl = pd.ExcelFile(file_path)

for sheet in xl.sheet_names:
    df = pd.read_excel(xl, sheet, nrows=1)
    print(f"### {sheet}")
    for col in df.columns:
        print(f"  - {col}")
