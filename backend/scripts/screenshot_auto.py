import os
from playwright.sync_api import sync_playwright

def run():
    out_dir = r"f:\smartgas-grid\docs\assets"
    os.makedirs(out_dir, exist_ok=True)
    
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": 1920, "height": 1080})
            
            # 1. Dashboard
            print("Taking dashboard screenshot...")
            page.goto("http://localhost:3000/#/tech")
            page.wait_for_timeout(3000)
            page.screenshot(path=os.path.join(out_dir, "screenshot_dashboard.png"))
            
            # 2. AI Assistant
            print("Taking AI search screenshot...")
            page.goto("http://localhost:3000/#/popout/assistant")
            page.wait_for_timeout(3000)
            page.screenshot(path=os.path.join(out_dir, "screenshot_ai_search.png"))
            
            # 3. Workflow Agent
            print("Taking workflow screenshot...")
            page.goto("http://localhost:3000/#/workflow")
            page.wait_for_timeout(3000)
            page.screenshot(path=os.path.join(out_dir, "screenshot_workflow_agent.png"))
            
            # 4. Data Analysis
            print("Taking data analysis screenshot...")
            page.goto("http://localhost:3000/#/global")
            page.wait_for_timeout(4000)
            page.screenshot(path=os.path.join(out_dir, "screenshot_data_analysis.png"))
            
            browser.close()
            print("All screenshots generated successfully.")
    except Exception as e:
        print(f"Error occurred: {e}")
        # Try to install browsers if missing
        if "executable doesn't exist" in str(e).lower():
            print("Attempting to install playwright browsers...")
            os.system("playwright install chromium")
            # Retry
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                page = browser.new_page(viewport={"width": 1920, "height": 1080})
                page.goto("http://localhost:3000/#/tech")
                page.wait_for_timeout(3000)
                page.screenshot(path=os.path.join(out_dir, "screenshot_dashboard.png"))
                page.goto("http://localhost:3000/#/popout/assistant")
                page.wait_for_timeout(3000)
                page.screenshot(path=os.path.join(out_dir, "screenshot_ai_search.png"))
                page.goto("http://localhost:3000/#/workflow")
                page.wait_for_timeout(3000)
                page.screenshot(path=os.path.join(out_dir, "screenshot_workflow_agent.png"))
                page.goto("http://localhost:3000/#/global")
                page.wait_for_timeout(4000)
                page.screenshot(path=os.path.join(out_dir, "screenshot_data_analysis.png"))
                browser.close()
                print("All screenshots generated successfully after install.")

if __name__ == "__main__":
    run()
