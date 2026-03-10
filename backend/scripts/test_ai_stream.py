import requests
import json
import time

def test_stream():
    url = "http://localhost:8000/api/ai-assistant/chat"
    payload = {
        "message": "你是谁？",
        "history": []
    }
    
    print(f"Sending request to {url}...")
    start_time = time.time()
    first_chunk_time = None
    try:
        response = requests.post(url, json=payload, stream=True)
        response.raise_for_status()
        
        print("Streaming response:")
        for line in response.iter_lines():
            if line:
                if first_chunk_time is None:
                    first_chunk_time = time.time()
                    print(f"First chunk received at: {first_chunk_time - start_time:.4f}s")
                
                decoded_line = line.decode('utf-8')
                if decoded_line.startswith("[REPLY] "):
                    payload = decoded_line[8:]
                    try:
                        parsed = json.loads(payload)
                        print(f"Chunk (parsed): {repr(parsed)}")
                    except:
                        print(f"Chunk (raw): {repr(payload)}")
                else:
                    print(f"Other: {decoded_line}")
        
        end_time = time.time()
        print(f"Total time: {end_time - start_time:.4f}s")
                
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    test_stream()
