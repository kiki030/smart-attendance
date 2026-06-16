from fastapi import FastAPI
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

app = FastAPI(
    title="Smart Attendance System API",
    description="A smart attendance management system powered by FastAPI",
    version="1.0.0"
)


@app.get("/")
def root():
    return {"status": "Smart Attendance System API Running"}
