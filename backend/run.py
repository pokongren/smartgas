import uvicorn
from dotenv import load_dotenv

# NOTE: 加载 .env 文件，确保 AI API 等配置可被读取
load_dotenv()

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8080,
        reload=True
    )
