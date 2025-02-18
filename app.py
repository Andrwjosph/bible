from flask import Flask, render_template, request, jsonify, session, send_from_directory
import openai
from flask_session import Session
import os
from dotenv import load_dotenv
import re
import requests


# Load environment variables from .env file
load_dotenv()

app = Flask(__name__)
app.secret_key = "your_secret_key"
app.config["SESSION_TYPE"] = "filesystem"
Session(app)

# Get API key from .env file
api_key = os.getenv("OPENAI_API_KEY")
bible_api_url = "https://bible-api.com/"

if not api_key:
    raise ValueError("Missing OpenAI API key. Please check your .env file.")

# Initialize OpenAI client
client = openai.OpenAI(api_key=api_key)

def fetch_bible_verse(reference):
    """Fetch Bible verse from external API."""
    try:
        response = requests.get(f"{bible_api_url}{reference}")
        if response.status_code == 200:
            data = response.json()
            return data.get("text","Verse not found.")
        return "Verse not found."
    except requests.RequestException:
        return "Error retrieving verse."


def summarize_chat_history(chat_history):
    """Summarizes past chat history to keep context relevant."""
    if len(chat_history) > 10:  # If too many messages, summarize
        summary_prompt = "Summarize the following conversation briefly while keeping key biblical references only:\n\n"
        summary_prompt += "\n".join([f"{msg['role']}: {msg['content']}" for msg in chat_history[-10:]])
        response = client.chat.completions.create(
            model="gpt-4",
            messages=[{"role": "system", "content": summary_prompt}]
        )
        summary = response.choices[0].message.content
        return [{"role": "system", "content": "Summary of previous conversation with strict biblical references: " + summary}]
    return chat_history


@app.route("/")
def index():
    return render_template("index.html")

@app.route("/ask", methods=["POST"])
def ask():
    user_input = request.json.get("question")
    if not user_input:
        return jsonify({"answer": "Invalid input."})

    if "chat_history" not in session:
        session["chat_history"] = [
                {"role": "system", "content": "You are Bible AI, an assistant that answers questions strictly using the Bible. Do not provide personal opinions, external theories, or interpretations beyond direct scripture references. Keep responses brief unless the user explicitly asks for a longer explanation."}
                
        ]
    session["chat_history"].append({"role": "user", "content": user_input})
    session["chat_history"] = summarize_chat_history(session["chat_history"])

    try:
        response = client.chat.completions.create(
            model="gpt-4",
            messages=session["chat_history"],
            temperature=0.7,
            max_tokens=150 if "long" not in user_input.lower() and "detailed" not in user_input.lower() else 500
        )

        ai_message = response.choices[0].message.content

        verse_match = re.findall(r"[A-Za-z]+ \d+:\d+", ai_message)
        if verse_match:
            for verse in verse_match:
                verse_text = fetch_bible_verse(verse)
                ai_message += f"\n\n📖 {verse}: {verse_text}"

        session["chat_history"].append({"role": "assistant", "content": ai_message})
        session.modified = True

        return jsonify({"answer": ai_message})

    except openai.OpenAIError as e:
        return jsonify({"answer": f"Error: {str(e)}"})

@app.route('/static/<path:filename>')
def serve_static(filename):
    return send_from_directory('static', filename)

if __name__ == "__main__":
    app.run(debug=True)