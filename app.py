from flask import Flask, render_template, request, jsonify, session, send_from_directory, redirect, url_for, Response
import openai
from flask_session import Session
import os
from dotenv import load_dotenv
import re
import requests
import json
from datetime import datetime
from collections import defaultdict
from functools import wraps, lru_cache
from werkzeug.security import generate_password_hash, check_password_hash
import csv
from io import StringIO
import asyncio
import aiohttp
from concurrent.futures import ThreadPoolExecutor
import hashlib
import traceback
from hypercorn.asyncio import serve
from hypercorn.config import Config
from typing import List, Dict, Optional
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from bs4 import BeautifulSoup
import io
from werkzeug.utils import secure_filename
import uuid


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

# Feedback storage
FEEDBACK_FILE = 'feedback.json'
FEEDBACK_ANALYSIS_FILE = 'feedback_analysis.json'
CACHE_FILE = 'response_cache.json'

# Cache settings
CACHE_EXPIRY = 3600  # 1 hour in seconds
MAX_CACHE_SIZE = 1000  # Maximum number of cached responses

# Admin credentials (in production, use environment variables)
ADMIN_USERNAME = os.getenv('ADMIN_USERNAME', 'admin')
ADMIN_PASSWORD = os.getenv('ADMIN_PASSWORD', 'admin123')  # Change this in production!

# Create a thread pool for running async operations
thread_pool = ThreadPoolExecutor(max_workers=4)

# Add these constants after the existing ones
KNOWLEDGE_BASE_FILE = 'knowledge_base.json'
MIN_SIMILARITY_THRESHOLD = 0.7  # Minimum similarity score to consider a match
ALLOWED_EXTENSIONS = {'txt', 'md'}
UPLOAD_FOLDER = 'uploads'

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('admin_logged_in'):
            return redirect(url_for('admin_login'))
        return f(*args, **kwargs)
    return decorated_function

def load_feedback():
    if os.path.exists(FEEDBACK_FILE):
        with open(FEEDBACK_FILE, 'r') as f:
            return json.load(f)
    return []

def save_feedback(feedback_data):
    feedback = load_feedback()
    feedback.append({
        'text': feedback_data['text'],
        'isPositive': feedback_data['isPositive'],
        'timestamp': datetime.now().isoformat()
    })
    with open(FEEDBACK_FILE, 'w') as f:
        json.dump(feedback, f)

def load_cache():
    if os.path.exists(CACHE_FILE):
        with open(CACHE_FILE, 'r') as f:
            return json.load(f)
    return {}

def save_cache(cache):
    with open(CACHE_FILE, 'w') as f:
        json.dump(cache, f)

response_cache = load_cache()

def get_cache_key(question, is_detailed):
    """Generate a unique cache key for the question."""
    return hashlib.md5(f"{question}:{is_detailed}".encode()).hexdigest()

def get_cached_response(question, is_detailed):
    """Get cached response if it exists and is not expired."""
    cache_key = get_cache_key(question, is_detailed)
    if cache_key in response_cache:
        cached_data = response_cache[cache_key]
        if datetime.now().timestamp() - cached_data['timestamp'] < CACHE_EXPIRY:
            return cached_data['response']
    return None

def cache_response(question, is_detailed, response):
    """Cache the response with timestamp."""
    cache_key = get_cache_key(question, is_detailed)
    response_cache[cache_key] = {
        'response': response,
        'timestamp': datetime.now().timestamp()
    }
    
    # Clean up old cache entries if size exceeds limit
    if len(response_cache) > MAX_CACHE_SIZE:
        oldest_key = min(response_cache.items(), key=lambda x: x[1]['timestamp'])[0]
        del response_cache[oldest_key]
    
    save_cache(response_cache)

@lru_cache(maxsize=100)
def analyze_feedback():
    """Cache feedback analysis results."""
    feedback = load_feedback()
    if not feedback:
        return None

    # Group feedback by common themes
    themes = defaultdict(lambda: {'positive': 0, 'negative': 0, 'total': 0})
    
    for entry in feedback:
        # Extract key themes from the text
        response = client.chat.completions.create(
            model="gpt-4",
            messages=[
                {"role": "system", "content": "Extract key themes from this biblical response. Return only the themes as a comma-separated list."},
                {"role": "user", "content": entry['text']}
            ],
            temperature=0.3,
            max_tokens=100
        )
        
        themes_list = response.choices[0].message.content.strip().split(',')
        for theme in themes_list:
            theme = theme.strip()
            if theme:
                themes[theme]['total'] += 1
                if entry['isPositive']:
                    themes[theme]['positive'] += 1
                else:
                    themes[theme]['negative'] += 1

    # Calculate success rates for each theme
    analysis = {
        'themes': {},
        'success_rate': 0,
        'total_feedback': len(feedback)
    }

    total_success_rate = 0
    for theme, stats in themes.items():
        if stats['total'] >= 3:  # Only include themes with sufficient feedback
            success_rate = stats['positive'] / stats['total']
            analysis['themes'][theme] = {
                'success_rate': success_rate,
                'total_feedback': stats['total']
            }
            total_success_rate += success_rate

    if analysis['themes']:
        analysis['success_rate'] = total_success_rate / len(analysis['themes'])

    return analysis

def get_improvement_prompt():
    """Generate a prompt based on feedback analysis to improve responses."""
    analysis = analyze_feedback()
    if not analysis or not analysis['themes']:
        return None

    # Identify themes that need improvement
    improvement_themes = [
        theme for theme, stats in analysis['themes'].items()
        if stats['success_rate'] < 0.6  # Themes with less than 60% positive feedback
    ]

    if not improvement_themes:
        return None

    improvement_prompt = "Based on user feedback, please improve responses by:\n"
    for theme in improvement_themes:
        improvement_prompt += f"- Paying more attention to {theme}\n"
    
    return improvement_prompt

def load_knowledge_base():
    """Load the knowledge base from file."""
    if os.path.exists(KNOWLEDGE_BASE_FILE):
        with open(KNOWLEDGE_BASE_FILE, 'r') as f:
            return json.load(f)
    return {
        'entries': [],
        'vectorizer': None,
        'vectors': None
    }

def save_knowledge_base(kb):
    """Save the knowledge base to file."""
    with open(KNOWLEDGE_BASE_FILE, 'w') as f:
        json.dump(kb, f)

def update_knowledge_base_vectors(kb):
    """Update the TF-IDF vectors for the knowledge base."""
    if not kb['entries']:
        return kb
    
    texts = [entry['question'] + " " + entry['answer'] for entry in kb['entries']]
    vectorizer = TfidfVectorizer()
    vectors = vectorizer.fit_transform(texts)
    
    kb['vectorizer'] = vectorizer
    kb['vectors'] = vectors.toarray().tolist()
    return kb

def find_relevant_knowledge(query: str, kb: Dict) -> Optional[str]:
    """Find the most relevant knowledge base entry for a query."""
    if not kb['entries'] or not kb['vectorizer'] or not kb['vectors']:
        return None
    
    query_vector = kb['vectorizer'].transform([query])
    query_vector = query_vector.toarray()
    
    similarities = cosine_similarity(query_vector, kb['vectors'])[0]
    max_similarity_idx = np.argmax(similarities)
    max_similarity = similarities[max_similarity_idx]
    
    if max_similarity >= MIN_SIMILARITY_THRESHOLD:
        return kb['entries'][max_similarity_idx]['answer']
    return None

def add_to_knowledge_base(question: str, answer: str, source: str = "user_feedback", category: str = "Uncategorized", tags: List[str] = None):
    """Add a new entry to the knowledge base."""
    kb = load_knowledge_base()
    
    # Check if similar entry already exists
    existing_answer = find_relevant_knowledge(question, kb)
    if existing_answer:
        return  # Skip if similar entry exists
    
    kb['entries'].append({
        'id': str(uuid.uuid4()),
        'question': question,
        'answer': answer,
        'source': source,
        'category': category,
        'tags': tags or [],
        'timestamp': datetime.now().isoformat(),
        'last_modified': datetime.now().isoformat()
    })
    
    kb = update_knowledge_base_vectors(kb)
    save_knowledge_base(kb)

@app.route('/feedback', methods=['POST'])
def feedback():
    data = request.json
    save_feedback(data)
    
    # If feedback is positive, add to knowledge base
    if data.get('isPositive'):
        # Get the last question and answer from the session
        if 'chat_history' in session and len(session['chat_history']) >= 2:
            last_user_msg = next((msg['content'] for msg in reversed(session['chat_history']) 
                                if msg['role'] == 'user'), None)
            last_assistant_msg = next((msg['content'] for msg in reversed(session['chat_history']) 
                                     if msg['role'] == 'assistant'), None)
            
            if last_user_msg and last_assistant_msg:
                add_to_knowledge_base(last_user_msg, last_assistant_msg)
    
    return jsonify({'status': 'success'})

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
    is_detailed = request.json.get("detailed", False)
    
    if not user_input:
        return jsonify({"answer": "Invalid input."})

    # Check cache first
    cached_response = get_cached_response(user_input, is_detailed)
    if cached_response:
        return jsonify({"answer": cached_response})

    # Check knowledge base
    kb = load_knowledge_base()
    kb_answer = find_relevant_knowledge(user_input, kb)
    if kb_answer:
        return jsonify({"answer": kb_answer})

    if "chat_history" not in session:
        session["chat_history"] = [
            {"role": "system", "content": "You are Bible AI, an assistant that answers questions strictly using the Bible. Do not provide personal opinions, external theories, or interpretations beyond direct scripture references. Keep responses brief unless the user explicitly asks for a longer explanation."}
        ]
    
    session["chat_history"] = summarize_chat_history(session["chat_history"])

    try:
        # Create a new event loop for this request
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        try:
            # Run the async operation
            answers = loop.run_until_complete(generate_answers_parallel(session["chat_history"], user_input, is_detailed))
        finally:
            # Always close the loop
            loop.close()
        
        if not answers or len(answers) < 3:
            print("Error: Not enough valid answers generated")
            return jsonify({"answer": "Error generating responses. Please try again."})

        # Combine and summarize the answers
        ai_message = combine_and_summarize_answers(answers, user_input, is_detailed)

        # Add Bible verses if found
        verse_match = re.findall(r"[A-Za-z]+ \d+:\d+", ai_message)
        if verse_match:
            for verse in verse_match:
                verse_text = fetch_bible_verse(verse)
                ai_message += f"\n\n📖 {verse}: {verse_text}"

        # Cache the response
        cache_response(user_input, is_detailed, ai_message)

        # Update session
        session["chat_history"].append({"role": "user", "content": user_input})
        session["chat_history"].append({"role": "assistant", "content": ai_message})
        session.modified = True

        return jsonify({"answer": ai_message})

    except Exception as e:
        print(f"Error in ask route: {e}")
        print(traceback.format_exc())
        return jsonify({"answer": "An error occurred. Please try again."})

async def generate_answers_parallel(chat_history, user_input, is_detailed=False):
    """Generate multiple answers in parallel using async API calls."""
    max_tokens = 500 if is_detailed else 50  # Reduced from 100 to 50 for initial answers
    system_prompt = "You are Bible AI, an assistant that answers questions strictly using the Bible. Provide very brief, concise answers (1-2 sentences) that focus on the most relevant biblical references. Do not provide personal opinions or external interpretations. Keep responses extremely brief unless explicitly asked for more detail."
    
    improvement_prompt = get_improvement_prompt()
    if improvement_prompt:
        system_prompt += "\n\n" + improvement_prompt
    
    messages = [{"role": "system", "content": system_prompt}] + chat_history + [{"role": "user", "content": user_input}]
    
    try:
        async with aiohttp.ClientSession() as session:
            tasks = []
            for _ in range(3):
                task = generate_single_answer(session, messages, 0.8, max_tokens)
                tasks.append(task)
            
            answers = await asyncio.gather(*tasks)
            valid_answers = [ans for ans in answers if ans is not None and ans.strip()]
            
            if not valid_answers:
                print("Error: No valid answers generated")
                return None
                
            if len(valid_answers) < 3:
                print(f"Error: Not enough valid answers. Got {len(valid_answers)} valid answers.")
                return None
                
            return valid_answers
    except Exception as e:
        print(f"Error in generate_answers_parallel: {e}")
        print(traceback.format_exc())
        return None

async def generate_single_answer(session, messages, temperature, max_tokens):
    """Generate a single answer using async API call."""
    try:
        response = await session.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            },
            json={
                "model": "gpt-4",
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens
            }
        )
        
        if response.status != 200:
            error_text = await response.text()
            print(f"OpenAI API error: {error_text}")
            return None
            
        data = await response.json()
        content = data['choices'][0]['message']['content']
        return content.strip() if content else None
    except Exception as e:
        print(f"Error generating answer: {e}")
        print(traceback.format_exc())
        return None

def combine_and_summarize_answers(answers, user_input, is_detailed=False):
    """Combine multiple answers and create a final summary."""
    if not answers or len(answers) < 3:
        print(f"Error: Not enough answers to combine. Got {len(answers) if answers else 0} answers.")
        return "I apologize, but I encountered an error while generating the detailed response. Please try again."

    try:
        combine_prompt = f"""Question: "{user_input}"

        Here are three biblical perspectives:
        {answers[0]}
        {answers[1]}
        {answers[2]}

        Provide a {'detailed' if is_detailed else 'brief'} answer that:
        1. Combines the key insights
        2. Uses only biblical references
        3. {'Explains the context and meaning' if is_detailed else 'Gives a direct answer in 2-3 sentences'}
        
        Answer:"""
        
        response = client.chat.completions.create(
            model="gpt-4",
            messages=[{"role": "system", "content": "You are a biblical scholar. Provide direct answers without disclaimers or meta-commentary."},
                     {"role": "user", "content": combine_prompt}],
            temperature=0.7,
            max_tokens=800 if is_detailed else 150
        )
        return response.choices[0].message.content
    except Exception as e:
        print(f"Error in combine_and_summarize_answers: {e}")
        print(traceback.format_exc())
        return "I apologize, but I encountered an error while generating the detailed response. Please try again."

@app.route('/static/<path:filename>')
def serve_static(filename):
    return send_from_directory('static', filename)

# Admin routes
@app.route('/admin/login', methods=['GET', 'POST'])
def admin_login():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        
        if username == ADMIN_USERNAME and password == ADMIN_PASSWORD:
            session['admin_logged_in'] = True
            return redirect(url_for('admin'))
        
        return render_template('admin_login.html', error='Invalid credentials')
    
    return render_template('admin_login.html')

@app.route('/admin/logout')
def admin_logout():
    session.pop('admin_logged_in', None)
    return redirect(url_for('admin_login'))

@app.route("/admin")
@login_required
def admin():
    return render_template("admin.html")

@app.route("/admin/overview")
@login_required
def admin_overview():
    analysis = analyze_feedback()
    if not analysis:
        return jsonify({
            "success_rate": 0,
            "total_feedback": 0,
            "positive_rate": 0,
            "active_themes": 0,
            "feedback_trend": {
                "labels": [],
                "success_rates": []
            }
        })

    # Calculate positive rate
    total_positive = sum(1 for entry in load_feedback() if entry['isPositive'])
    positive_rate = (total_positive / len(load_feedback())) * 100 if load_feedback() else 0

    # Generate feedback trend (last 7 days)
    feedback = load_feedback()
    feedback.sort(key=lambda x: x['timestamp'])
    
    # Group feedback by day
    daily_feedback = defaultdict(list)
    for entry in feedback:
        date = datetime.fromisoformat(entry['timestamp']).strftime('%Y-%m-%d')
        daily_feedback[date].append(entry)

    # Calculate daily success rates
    dates = sorted(daily_feedback.keys())[-7:]  # Last 7 days
    success_rates = []
    for date in dates:
        day_feedback = daily_feedback[date]
        if day_feedback:
            positive_count = sum(1 for entry in day_feedback if entry['isPositive'])
            success_rates.append((positive_count / len(day_feedback)) * 100)
        else:
            success_rates.append(0)

    return jsonify({
        "success_rate": analysis['success_rate'] * 100,
        "total_feedback": analysis['total_feedback'],
        "positive_rate": positive_rate,
        "active_themes": len(analysis['themes']),
        "feedback_trend": {
            "labels": dates,
            "success_rates": success_rates
        }
    })

@app.route("/admin/themes")
@login_required
def admin_themes():
    analysis = analyze_feedback()
    if not analysis:
        return jsonify({"themes": []})

    themes_data = []
    for theme, stats in analysis['themes'].items():
        themes_data.append({
            "name": theme,
            "success_rate": stats['success_rate'] * 100,
            "total": stats['total_feedback'],
            "positive": int(stats['success_rate'] * stats['total_feedback']),
            "negative": int((1 - stats['success_rate']) * stats['total_feedback'])
        })

    return jsonify({"themes": themes_data})

@app.route("/admin/thresholds", methods=["GET"])
@login_required
def get_thresholds():
    if os.path.exists(FEEDBACK_ANALYSIS_FILE):
        with open(FEEDBACK_ANALYSIS_FILE, 'r') as f:
            analysis = json.load(f)
            return jsonify({
                "success_rate": int(analysis.get('success_rate', 60) * 100),
                "min_feedback": 3  # Default value
            })
    return jsonify({
        "success_rate": 60,
        "min_feedback": 3
    })

@app.route("/admin/thresholds", methods=["POST"])
@login_required
def update_thresholds():
    data = request.json
    success_rate = data.get('success_rate', 60) / 100
    min_feedback = data.get('min_feedback', 3)

    if os.path.exists(FEEDBACK_ANALYSIS_FILE):
        with open(FEEDBACK_ANALYSIS_FILE, 'r') as f:
            analysis = json.load(f)
            analysis['success_rate'] = success_rate
            analysis['min_feedback'] = min_feedback
            with open(FEEDBACK_ANALYSIS_FILE, 'w') as f:
                json.dump(analysis, f)

    return jsonify({"status": "success"})

@app.route("/admin/recent-feedback")
@login_required
def admin_recent_feedback():
    feedback = load_feedback()
    feedback.sort(key=lambda x: x['timestamp'], reverse=True)
    return jsonify(feedback[:20])  # Return last 20 feedback entries

@app.route("/admin/analytics/time")
@login_required
def time_analytics():
    feedback = load_feedback()
    if not feedback:
        return jsonify({
            "hourly": [],
            "daily": [],
            "weekly": [],
            "monthly": []
        })

    # Group feedback by time periods
    hourly_data = defaultdict(lambda: {'positive': 0, 'total': 0})
    daily_data = defaultdict(lambda: {'positive': 0, 'total': 0})
    weekly_data = defaultdict(lambda: {'positive': 0, 'total': 0})
    monthly_data = defaultdict(lambda: {'positive': 0, 'total': 0})

    for entry in feedback:
        timestamp = datetime.fromisoformat(entry['timestamp'])
        
        # Hourly
        hour_key = timestamp.strftime('%H:00')
        hourly_data[hour_key]['total'] += 1
        if entry['isPositive']:
            hourly_data[hour_key]['positive'] += 1

        # Daily
        day_key = timestamp.strftime('%Y-%m-%d')
        daily_data[day_key]['total'] += 1
        if entry['isPositive']:
            daily_data[day_key]['positive'] += 1

        # Weekly
        week_key = timestamp.strftime('%Y-W%W')
        weekly_data[week_key]['total'] += 1
        if entry['isPositive']:
            weekly_data[week_key]['positive'] += 1

        # Monthly
        month_key = timestamp.strftime('%Y-%m')
        monthly_data[month_key]['total'] += 1
        if entry['isPositive']:
            monthly_data[month_key]['positive'] += 1

    def calculate_success_rates(data):
        return {
            'labels': list(data.keys()),
            'success_rates': [
                (entry['positive'] / entry['total'] * 100) if entry['total'] > 0 else 0
                for entry in data.values()
            ]
        }

    return jsonify({
        'hourly': calculate_success_rates(hourly_data),
        'daily': calculate_success_rates(daily_data),
        'weekly': calculate_success_rates(weekly_data),
        'monthly': calculate_success_rates(monthly_data)
    })

@app.route("/admin/export")
@login_required
def export_data():
    feedback = load_feedback()
    analysis = analyze_feedback()
    
    # Create CSV data
    output = StringIO()
    writer = csv.writer(output)
    
    # Write feedback data
    writer.writerow(['Timestamp', 'Feedback', 'Sentiment'])
    for entry in feedback:
        writer.writerow([
            entry['timestamp'],
            entry['text'],
            'Positive' if entry['isPositive'] else 'Negative'
        ])
    
    # Write analysis data
    writer.writerow([])
    writer.writerow(['Theme', 'Success Rate', 'Total Feedback'])
    if analysis and 'themes' in analysis:
        for theme, stats in analysis['themes'].items():
            writer.writerow([
                theme,
                f"{stats['success_rate']*100:.1f}%",
                stats['total_feedback']
            ])
    
    output.seek(0)
    return Response(
        output.getvalue(),
        mimetype='text/csv',
        headers={'Content-Disposition': 'attachment;filename=feedback_analysis.csv'}
    )

@app.route("/admin/knowledge-base", methods=["GET"])
@login_required
def admin_knowledge_base():
    kb = load_knowledge_base()
    return jsonify({
        "entries": kb.get('entries', []),
        "categories": list(set(entry.get('category', 'Uncategorized') for entry in kb.get('entries', []))),
        "tags": list(set(tag for entry in kb.get('entries', []) for tag in entry.get('tags', [])))
    })

@app.route("/admin/knowledge-base/entry", methods=["POST"])
@login_required
def add_knowledge_base_entry():
    data = request.json
    question = data.get('question')
    answer = data.get('answer')
    category = data.get('category', 'Uncategorized')
    tags = data.get('tags', [])
    source = data.get('source', 'manual_entry')
    
    if not question or not answer:
        return jsonify({"error": "Question and answer are required"}), 400
    
    add_to_knowledge_base(question, answer, source, category, tags)
    return jsonify({"status": "success"})

@app.route("/admin/knowledge-base/entry/<entry_id>", methods=["PUT"])
@login_required
def update_knowledge_base_entry(entry_id):
    data = request.json
    kb = load_knowledge_base()
    
    for entry in kb['entries']:
        if entry.get('id') == entry_id:
            entry.update({
                'question': data.get('question', entry['question']),
                'answer': data.get('answer', entry['answer']),
                'category': data.get('category', entry.get('category', 'Uncategorized')),
                'tags': data.get('tags', entry.get('tags', [])),
                'last_modified': datetime.now().isoformat()
            })
            kb = update_knowledge_base_vectors(kb)
            save_knowledge_base(kb)
            return jsonify({"status": "success"})
    
    return jsonify({"error": "Entry not found"}), 404

@app.route("/admin/knowledge-base/entry/<entry_id>", methods=["DELETE"])
@login_required
def delete_knowledge_base_entry(entry_id):
    kb = load_knowledge_base()
    kb['entries'] = [entry for entry in kb['entries'] if entry.get('id') != entry_id]
    kb = update_knowledge_base_vectors(kb)
    save_knowledge_base(kb)
    return jsonify({"status": "success"})

@app.route("/admin/knowledge-base/import-url", methods=["POST"])
@login_required
def import_from_url():
    data = request.json
    url = data.get('url')
    category = data.get('category', 'Uncategorized')
    tags = data.get('tags', [])
    
    if not url:
        return jsonify({"error": "URL is required"}), 400
    
    try:
        response = requests.get(url)
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # Extract text content
        text = soup.get_text()
        
        # Split into chunks (you might want to adjust this logic)
        chunks = [chunk.strip() for chunk in text.split('\n\n') if chunk.strip()]
        
        # Add each chunk to knowledge base
        for chunk in chunks:
            # Use first sentence as question, rest as answer
            sentences = chunk.split('.')
            if len(sentences) > 1:
                question = sentences[0].strip()
                answer = '. '.join(sentences[1:]).strip()
                add_to_knowledge_base(question, answer, f"url_import_{url}", category, tags)
        
        return jsonify({"status": "success", "chunks_imported": len(chunks)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/admin/knowledge-base/import-file", methods=["POST"])
@login_required
def import_from_file():
    if 'file' not in request.files:
        return jsonify({"error": "No file provided"}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No file selected"}), 400
    
    if not file.filename.endswith(tuple(f'.{ext}' for ext in ALLOWED_EXTENSIONS)):
        return jsonify({"error": "Invalid file type"}), 400
    
    try:
        content = file.read().decode('utf-8')
        category = request.form.get('category', 'Uncategorized')
        tags = request.form.get('tags', '').split(',')
        tags = [tag.strip() for tag in tags if tag.strip()]
        
        # Split into chunks (you might want to adjust this logic)
        chunks = [chunk.strip() for chunk in content.split('\n\n') if chunk.strip()]
        
        # Add each chunk to knowledge base
        for chunk in chunks:
            # Use first sentence as question, rest as answer
            sentences = chunk.split('.')
            if len(sentences) > 1:
                question = sentences[0].strip()
                answer = '. '.join(sentences[1:]).strip()
                add_to_knowledge_base(question, answer, f"file_import_{file.filename}", category, tags)
        
        return jsonify({"status": "success", "chunks_imported": len(chunks)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    config = Config()
    config.bind = ["localhost:5000"]
    asyncio.run(serve(app, config))